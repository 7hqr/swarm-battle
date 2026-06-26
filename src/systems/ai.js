import { measurePerformance } from "../debug/performance.js";
import { traceAiEvent } from "../debug/aiTrace.js";
import { getGameplayCommandTypes, queueGameplayCommand } from "../gameplayCommands.js";
import {
  getProducedUnitId,
  isProductionKind,
  getUnitStats,
  isUnitUnlocked
} from "../rules/catalogRules.js";
import {
  getEntitySpatialIndex,
  getEnemyBase,
  getEntityById,
  getOwnedBuildings,
  getOwnedUnits,
  getPlayerById,
  queryEntitySpatialIndex
} from "../state/entities.js";
import { getTerritoryOwnershipSummary } from "./territory.js";
import { getControlStructureObjectives } from "./mapObjectives.js";
import { updateAiDebugSnapshot } from "./ai/debugSnapshot.js";
import {
  evaluateEconomy,
  rebalanceProduction
} from "./ai/economy.js";
import {
  analyzeArmyComposition,
  getArmyPower,
  getCounterDeficits,
  getDesiredUnitDemand,
  getMissingCounterTechIds
} from "./ai/composition.js";
import {
  advanceStrategicActionPipeline,
  getDesiredReserve,
} from "./ai/macroActions.js";
import { chooseStrategicIntent } from "./ai/strategy.js";
import { findPathToPoint, resolvePointToNavigablePosition } from "./navigation.js";

const AI_THREAT_SCAN_INTERVAL_SECONDS = 0.5;
const AI_STRATEGY_INTERVAL_SECONDS = 2;
const AI_MACRO_ACTION_STAGE_INTERVAL_SECONDS = 0.3;
const LOCAL_DEFENSE_RADIUS = 320;
const AI_DEBUG_SNAPSHOT_INTERVAL_SECONDS = 0.5;
const MAIN_BASE_MIN_TRAVEL_DISTANCE = 96;

export function updateAi(state, dt, options = {}) {
  if (state.matchEnded) {
    return;
  }

  const aiPlayers = state.players.filter((player) => !!player.aiState);
  if (aiPlayers.length === 0) {
    return;
  }

  const schedulerState = state.simulation.scheduler;
  schedulerState.aiPlayerCursor %= aiPlayers.length;
  const budgetMs = options.budgetMs ?? Number.POSITIVE_INFINITY;
  const deadlineMs = performance.now() + Math.max(0, budgetMs);
  let processedPlayers = 0;

  while (processedPlayers < aiPlayers.length) {
    const aiPlayer = aiPlayers[schedulerState.aiPlayerCursor];
    updateAiPlayer(state, aiPlayer, dt, deadlineMs);
    processedPlayers += 1;
    schedulerState.aiPlayerCursor = (schedulerState.aiPlayerCursor + 1) % aiPlayers.length;
    if (processedPlayers < aiPlayers.length && performance.now() >= deadlineMs) {
      break;
    }
  }
}

function updateAiPlayer(state, aiPlayer, dt, deadlineMs) {
  measurePerformance(state, "ai.playerTotal", () => {
    const opponentPlayerId = getOpponentPlayerId(state, aiPlayer.id);
    if (!opponentPlayerId) {
      return;
    }

    const aiContext = {
      playerId: aiPlayer.id,
      opponentPlayerId
    };
    const aiState = aiPlayer.aiState;
    const runtime = createAiRuntimeContext(state, aiContext);
    ensureAiTimingState(aiState);
    aiState.threatScanCooldownSeconds -= dt;
    aiState.strategyCooldownSeconds -= dt;
    aiState.baseWaypointCooldownSeconds -= dt;
    aiState.buildingWaypointCooldownSeconds -= dt;
    aiState.macroActionCooldownSeconds -= dt;
    const evaluationContext = {
      snapshot: null,
      reserve: null
    };

    while (performance.now() < deadlineMs) {
      const nextJob = getNextAiJob(state, aiContext, aiPlayer, aiState, runtime);
      if (!nextJob) {
        break;
      }

      runAiJob(state, aiContext, aiPlayer, aiState, runtime, nextJob, evaluationContext);
      recordAiJobRun(aiState, nextJob.id);

      if (nextJob.id === "debug_snapshot") {
        break;
      }
    }

    aiState.thinkCooldownSeconds = getNextAiPhaseSeconds(aiState);
  });
}

function ensureAiTimingState(aiState) {
  aiState.threatScanCooldownSeconds ??= 0;
  aiState.strategyCooldownSeconds ??= 0;
  aiState.baseWaypointCooldownSeconds ??= 0;
  aiState.buildingWaypointCooldownSeconds ??= 0;
  aiState.macroActionCooldownSeconds ??= 0;
  aiState.thinkCooldownSeconds ??= 0;
  aiState.waypointBuildingCooldowns ??= {};
  aiState.waypointBuildingCursor ??= 0;
  aiState.lastBaseRelocationPlanTimeSeconds ??= Number.NEGATIVE_INFINITY;
  aiState.macroActionPipeline ??= null;
  aiState.lastEvaluationTick ??= -1;
  aiState.lastEvaluationTimeSeconds ??= -1;
  aiState.lastDebugSnapshotTimeSeconds ??= Number.NEGATIVE_INFINITY;
  aiState.jobRunCounts ??= {};
}

function getNextAiJob(state, aiContext, aiPlayer, aiState, runtime) {
  const jobs = [];
  const hasMacroPipeline = !!aiState.macroActionPipeline;
  const missingRoutes = hasMissingProductionRoutes(runtime);

  if (aiState.threatScanCooldownSeconds <= 0) {
    jobs.push({
      id: "threat_scan",
      priority: 100
    });
  }

  if (aiState.baseWaypointCooldownSeconds <= 0) {
    jobs.push({
      id: "base_waypoints",
      priority: 72
    });
  }

  if (missingRoutes || aiState.buildingWaypointCooldownSeconds <= 0) {
    jobs.push({
      id: "building_waypoints",
      priority: missingRoutes ? 95 : 68
    });
  }

  if (aiState.strategyCooldownSeconds <= 0) {
    jobs.push({
      id: "strategy",
      priority: 80
    });
  }

  if (hasMacroPipeline || aiState.macroActionCooldownSeconds <= 0) {
    jobs.push({
      id: "macro_action",
      priority: hasMacroPipeline ? 90 : 60
    });
  }

  const shouldRefreshDebugSnapshot =
    aiState.lastDebugSnapshotTimeSeconds + AI_DEBUG_SNAPSHOT_INTERVAL_SECONDS <= state.matchTimeSeconds &&
    jobs.length === 0;
  if (shouldRefreshDebugSnapshot) {
    jobs.push({
      id: "debug_snapshot",
      priority: 10
    });
  }

  if (jobs.length === 0) {
    return null;
  }

  jobs.sort((left, right) => right.priority - left.priority);
  return jobs[0];
}

function runAiJob(state, aiContext, aiPlayer, aiState, runtime, job, evaluationContext) {
  if (job.id === "threat_scan") {
    const snapshot = getAiEvaluationSnapshot(state, aiContext, aiState, runtime, evaluationContext);
    measurePerformance(state, "ai.threatScan", () => {
      aiState.latestThreats = snapshot.threats;
      aiState.threatScanCooldownSeconds = AI_THREAT_SCAN_INTERVAL_SECONDS;
    });
    return;
  }

  if (job.id === "strategy") {
    const snapshot = getAiEvaluationSnapshot(state, aiContext, aiState, runtime, evaluationContext);
    measurePerformance(state, "ai.strategy", () => {
      aiState.strategicIntent = chooseStrategicIntent(state, aiState, snapshot);
      rebalanceProduction(state, aiContext, aiState);
      aiState.strategyCooldownSeconds = AI_STRATEGY_INTERVAL_SECONDS;
    });
    return;
  }

  if (job.id === "base_waypoints") {
    const snapshot = getAiEvaluationSnapshot(state, aiContext, aiState, runtime, evaluationContext);
    measurePerformance(state, "ai.baseWaypoints", () => {
      updateBaseWaypointPlans(state, aiContext, aiState, snapshot);
      aiState.baseWaypointCooldownSeconds = aiState.baseRetargetIntervalSeconds;
    });
    return;
  }

  if (job.id === "building_waypoints") {
    const snapshot = getAiEvaluationSnapshot(state, aiContext, aiState, runtime, evaluationContext);
    measurePerformance(state, "ai.buildingWaypoints", () => {
      updateProductionWaypointPlans(state, aiContext, aiState, snapshot);
      aiState.buildingWaypointCooldownSeconds = getBuildingWaypointIntervalSeconds(aiState);
    });
    return;
  }

  if (job.id === "macro_action") {
    const snapshot = getAiEvaluationSnapshot(state, aiContext, aiState, runtime, evaluationContext);
    measurePerformance(state, "ai.macroAction", () => {
      advanceStrategicActionPipeline(state, aiContext, aiPlayer, aiState, snapshot);
      aiState.macroActionCooldownSeconds = AI_MACRO_ACTION_STAGE_INTERVAL_SECONDS;
    });
    return;
  }

  if (job.id === "debug_snapshot") {
    const snapshot = getAiEvaluationSnapshot(state, aiContext, aiState, runtime, evaluationContext);
    measurePerformance(state, "ai.debugSnapshot", () => {
      updateAiDebugSnapshot(state, aiPlayer, aiState, snapshot, getAiDesiredReserve(aiState, snapshot, evaluationContext));
      aiState.lastDebugSnapshotTimeSeconds = state.matchTimeSeconds;
    });
    return;
  }

  throw new Error(`Unsupported AI job: ${job.id}`);
}

function getAiEvaluationSnapshot(state, aiContext, aiState, runtime, evaluationContext) {
  if (evaluationContext.snapshot) {
    return evaluationContext.snapshot;
  }

  const snapshot = measurePerformance(state, "ai.evaluate", () => evaluateAiState(state, aiContext, aiState, runtime));
  evaluationContext.snapshot = snapshot;
  aiState.lastEvaluationTick = state.simulation.currentTick;
  aiState.lastEvaluationTimeSeconds = state.matchTimeSeconds;
  return snapshot;
}

function getAiDesiredReserve(aiState, snapshot, evaluationContext) {
  evaluationContext.reserve ??= getDesiredReserve(aiState, snapshot);
  return evaluationContext.reserve;
}

function recordAiJobRun(aiState, jobId) {
  aiState.jobRunCounts[jobId] = (aiState.jobRunCounts[jobId] ?? 0) + 1;
}

function getNextAiPhaseSeconds(aiState) {
  return Math.max(
    0,
    Math.min(
      aiState.threatScanCooldownSeconds,
      aiState.strategyCooldownSeconds,
      aiState.baseWaypointCooldownSeconds,
      aiState.buildingWaypointCooldownSeconds,
      aiState.macroActionCooldownSeconds
    )
  );
}

function createAiRuntimeContext(state, aiContext) {
  const allBuildings = getOwnedBuildings(state, aiContext.playerId);
  const constructedBuildings = allBuildings.filter((building) => building.isConstructed);
  const enemyBuildings = getOwnedBuildings(state, aiContext.opponentPlayerId);
  const enemyConstructedBuildings = enemyBuildings.filter((building) => building.isConstructed);
  const productionBuildings = constructedBuildings.filter((building) => isProductionKind(building.kind));
  const aiBase = constructedBuildings.find((building) => building.kind === "base" && building.definitionId === "main_base")
    ?? allBuildings.find((building) => building.kind === "base" && building.definitionId === "main_base")
    ?? null;
  const enemyBase = getEnemyBase(state, aiContext.playerId);

  return {
    aiUnits: getOwnedUnits(state, aiContext.playerId),
    enemyUnits: getOwnedUnits(state, aiContext.opponentPlayerId),
    allBuildings,
    constructedBuildings,
    enemyBuildings,
    enemyConstructedBuildings,
    productionBuildings,
    coreProductionBuildings: allBuildings.filter((building) => building.kind === "core_production"),
    techStructures: allBuildings.filter((building) => building.kind === "tech_structure"),
    advancedProductionBuildings: allBuildings.filter((building) => building.kind === "advanced_production"),
    aiBase,
    enemyBase,
    territory: createAiTerritoryContext(state, aiContext),
    buildPlanning: {
      ownedBuildings: constructedBuildings,
      anchor: aiBase ?? constructedBuildings[0] ?? null,
      enemyBase
    },
    waypointAnalysis: null
  };
}

function createAiTerritoryContext(state, aiContext) {
  const summary = getTerritoryOwnershipSummary(state);
  let ownCount = 0;
  let enemyCount = 0;
  let neutralFrontierCount = 0;
  let hostileFrontierCount = 0;
  const ownedCells = [];
  const nonOwnedCells = [];

  for (const cell of state.territory.cells) {
    if (cell.ownerId === aiContext.playerId) {
      ownCount += 1;
      ownedCells.push(cell);
      if (countNeighborCellsByOwner(state, cell, null) > 0) {
        neutralFrontierCount += 1;
      }
      continue;
    }

    nonOwnedCells.push(cell);

    if (cell.ownerId === aiContext.opponentPlayerId) {
      enemyCount += 1;
    }

    if (countNeighborCellsByOwner(state, cell, aiContext.playerId) === 0) {
      continue;
    }

    if (cell.ownerId === aiContext.opponentPlayerId || Math.abs(cell.control) >= 0.12) {
      hostileFrontierCount += 1;
    }
  }

  return {
    summary,
    ownCount,
    enemyCount,
    neutralFrontierCount,
    hostileFrontierCount,
    ownedCells,
    nonOwnedCells
  };
}

function hasMissingProductionRoutes(runtime) {
  return runtime.productionBuildings.some((building) => {
    return building.isConstructed && building.waypointChain.length === 0;
  });
}

function evaluateAiState(state, aiContext, aiState, runtime) {
  const territory = runtime.territory.summary;
  const ownTerritoryCount = runtime.territory.ownCount;
  const enemyTerritoryCount = runtime.territory.enemyCount;
  const economy = evaluateEconomy(state, aiContext);
  const aiUnits = runtime.aiUnits;
  const playerUnits = runtime.enemyUnits;
  const aiBuildings = runtime.constructedBuildings;
  const aiArmyPower = getArmyPower(state, aiContext.playerId, aiUnits);
  const playerArmyPower = getArmyPower(state, aiContext.opponentPlayerId, playerUnits);
  const threats = evaluateThreats(state, aiContext, runtime);
  const localDefenseThreat = threats.localDefenseThreat;
  const neutralFrontierCount = runtime.territory.neutralFrontierCount;
  const hostileFrontierCount = runtime.territory.hostileFrontierCount;
  const ownComposition = analyzeArmyComposition(state, aiContext.playerId, aiUnits);
  const enemyComposition = analyzeArmyComposition(state, aiContext.opponentPlayerId, playerUnits);
  const objectiveOpportunity = evaluateObjectiveOpportunity(state, aiContext, runtime, aiArmyPower, playerArmyPower);
  const counterDeficits = getCounterDeficits(ownComposition, enemyComposition);
  const counterNeed = clamp01(
    counterDeficits.frontline +
      counterDeficits.antiSwarm +
      counterDeficits.antiTank +
      counterDeficits.ranged * 0.6
  );
  const territoryDeficit = Math.max(0, enemyTerritoryCount - ownTerritoryCount);
  const territoryLead = Math.max(0, ownTerritoryCount - enemyTerritoryCount);
  const pressureWindow = clamp01((aiArmyPower - playerArmyPower) / Math.max(120, playerArmyPower + 80));
  const economyNeed = clamp01(
    (aiState.targetNetIncome - economy.netIncomePerSecond + 1) / 4.5 +
      (economy.disabledProductionCount > 0 ? 0.25 : 0)
  );
  const expansionNeed = clamp01(
    neutralFrontierCount / 18 +
      territory.neutralPercent / 65 +
      territoryDeficit / 36 +
      (economy.incomePerSecond < 10 ? 0.18 : 0)
  );
  const defenseNeed = clamp01(
    localDefenseThreat * 1.1 +
      Math.max(0, playerArmyPower - aiArmyPower) / Math.max(180, playerArmyPower + 120) * 0.8
  );
  const pressureNeed = clamp01(
    pressureWindow * 0.95 +
      hostileFrontierCount / 16 +
      territoryLead / 50 -
      defenseNeed * 0.6
  );
  const objectiveNeed = clamp01(
    objectiveOpportunity.priority * (1 - defenseNeed * 0.75) +
      pressureWindow * 0.2
  );
  const techNeed = clamp01(
    counterNeed * 0.45 +
      (state.matchTimeSeconds / Math.max(1, aiState.techTargetTime)) * 0.45 +
      (!hasConstructedBuildingKind(state, aiContext.playerId, "tech_structure") ? 0.18 : 0)
  );
  const advancedProductionNeed = clamp01(
    counterNeed * 0.7 +
      pressureNeed * 0.35 +
      (state.matchTimeSeconds / Math.max(1, aiState.advancedTargetTime)) * 0.4 +
      (economy.incomePerSecond >= 8 ? 0.15 : 0)
  );
  const producedUnitCounts = getProducedUnitCounts(state, aiContext);
  const missingCounterTechIds = getMissingCounterTechIds(state, aiContext, counterDeficits);
  const desiredUnitDemand = getDesiredUnitDemand(aiState, {
    economyNeed,
    expansionNeed,
    pressureNeed,
    defenseNeed,
    counterNeed,
    ownComposition,
    enemyComposition,
    counterDeficits
  });

  return {
    economy,
    territory: {
      ...territory,
      ownCount: ownTerritoryCount,
      enemyCount: enemyTerritoryCount
    },
    military: {
      aiArmyPower,
      playerArmyPower,
      localDefenseThreat,
      neutralFrontierCount,
      hostileFrontierCount,
      primaryThreat: threats.primaryThreat
    },
    threats,
    composition: {
      ownComposition,
      enemyComposition,
      counterDeficits,
      counterNeed,
      desiredUnitDemand,
      missingCounterTechIds
    },
    production: {
      coreBuildings: runtime.coreProductionBuildings,
      techStructures: runtime.techStructures,
      advancedBuildings: runtime.advancedProductionBuildings,
      producedUnitCounts
    },
    objectives: objectiveOpportunity,
    runtime,
    needs: {
      economy: economyNeed,
      expansion: expansionNeed,
      objectives: objectiveNeed,
      defense: defenseNeed,
      pressure: pressureNeed,
      tech: techNeed,
      advancedProduction: advancedProductionNeed,
      counterComposition: counterNeed
    }
  };
}

function evaluateThreats(state, aiContext, runtime) {
  const structureThreats = getStructureThreats(state, aiContext, runtime.constructedBuildings, runtime.enemyUnits);
  const laneThreats = getLaneThreats(state, aiContext, runtime);
  const primaryStructureThreat = structureThreats[0] ?? null;
  const primaryLaneThreat = laneThreats[0] ?? null;
  const primaryThreat = getPrimaryThreat(primaryStructureThreat, primaryLaneThreat);
  const localDefenseThreat = clamp01(
    (primaryStructureThreat?.severity ?? 0) * 0.9 +
      (primaryLaneThreat?.severity ?? 0) * 0.45
  );

  return {
    localDefenseThreat,
    primaryThreat,
    structureThreats,
    laneThreats
  };
}

function getStructureThreats(state, aiContext, aiBuildings, enemyUnits) {
  const threats = [];

  for (const building of aiBuildings) {
    let power = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let attackerCount = 0;

    for (const unit of enemyUnits) {
      const distance = Math.hypot(unit.x - building.x, unit.y - building.y);
      if (distance > LOCAL_DEFENSE_RADIUS) {
        continue;
      }

      const stats = getUnitStats(state, aiContext.opponentPlayerId, unit.definitionId);
      const unitPower = stats.attackDamage / Math.max(0.2, stats.attackCooldown) * 7.5 + stats.maxHealth * 0.1;
      const proximity = 1 - distance / LOCAL_DEFENSE_RADIUS;
      const targetBonus = unit.currentTargetId === building.id ? 0.55 : 0;
      power += unitPower * (proximity + targetBonus);
      nearestDistance = Math.min(nearestDistance, distance);
      attackerCount += 1;
    }

    if (attackerCount === 0) {
      continue;
    }

    threats.push({
      type: "structure",
      targetBuildingId: building.id,
      point: { x: Math.round(building.x), y: Math.round(building.y) },
      severity: clamp01(power / 260),
      enemyCount: attackerCount,
      nearestDistance
    });
  }

  return threats.sort((left, right) => right.severity - left.severity);
}

function getLaneThreats(state, aiContext, runtime) {
  const aiBase = runtime.aiBase;
  const enemyBase = runtime.enemyBase;
  const lanes = new Map();

  for (const unit of runtime.enemyUnits) {
    const unitCell = getCellAtPoint(state, unit);
    const threatensOwnedSpace =
      unitCell?.ownerId === aiContext.playerId ||
      countNeighborCellsByOwner(state, unitCell ?? { row: -99, column: -99 }, aiContext.playerId) > 0;
    if (!threatensOwnedSpace) {
      continue;
    }

    const sideSign = getLaneSideSign(aiBase, enemyBase, unit);
    const laneKey = String(sideSign);
    const current = lanes.get(laneKey) ?? {
      type: "lane",
      sideSign,
      point: { x: 0, y: 0 },
      severity: 0,
      enemyCount: 0,
      totalX: 0,
      totalY: 0
    };
    const stats = getUnitStats(state, aiContext.opponentPlayerId, unit.definitionId);
    const power = stats.attackDamage / Math.max(0.2, stats.attackCooldown) * 7.5 + stats.maxHealth * 0.1;
    const forwardProgress = getForwardProgressRatio(aiBase, enemyBase, unit);
    current.severity += power * (0.65 + forwardProgress * 0.7);
    current.enemyCount += 1;
    current.totalX += unit.x;
    current.totalY += unit.y;
    lanes.set(laneKey, current);
  }

  return [...lanes.values()]
    .map((threat) => ({
      ...threat,
      severity: clamp01(threat.severity / 420),
      point: {
        x: Math.round(threat.totalX / threat.enemyCount),
        y: Math.round(threat.totalY / threat.enemyCount)
      }
    }))
    .sort((left, right) => right.severity - left.severity);
}

function getPrimaryThreat(structureThreat, laneThreat) {
  if (!structureThreat) {
    return laneThreat;
  }

  if (!laneThreat) {
    return structureThreat;
  }

  return structureThreat.severity >= laneThreat.severity * 0.85 ? structureThreat : laneThreat;
}

function createWaypointPlanningContext(state, aiContext, aiState, snapshot) {
  const runtime = snapshot.runtime;
  const strategicIntent = aiState.strategicIntent ?? chooseStrategicIntent(state, aiState, snapshot);
  const waypointAnalysis = getWaypointAnalysis(runtime, state, aiContext);
  const territorySummary = snapshot.territory;
  const ownTerritoryCount = snapshot.territory.ownCount;
  const enemyTerritoryCount = snapshot.territory.enemyCount;
  const aiBase = runtime.aiBase;
  const enemyBase = runtime.enemyBase;
  const intentThreatPoint = strategicIntent.primary === "defense" ? strategicIntent.threatPoint : null;
  const defensePoint = intentThreatPoint ?? getDefenseResponsePoint(state, aiContext, runtime);
  const objectiveTarget = getObjectiveTargetPoint(state, aiContext, snapshot, waypointAnalysis);
  const objectivePoint = objectiveTarget?.point ?? null;
  const contestedPressurePoint = getPressureTargetPoint(state, aiContext, runtime, waypointAnalysis);
  const expansionTargets = getTerritoryExpansionTargets(state, aiContext, aiBase, enemyBase, 4, waypointAnalysis);
  const expansionPoint = expansionTargets[0]?.point ?? null;
  const pressurePoint = contestedPressurePoint ?? (
    shouldUseFallbackPressureTarget(territorySummary, ownTerritoryCount, enemyTerritoryCount)
      ? getFallbackPressurePoint(runtime)
      : null
  );
  const defenseAnchor = defensePoint ? getOwnedAnchorPointNear(state, aiContext, defensePoint, waypointAnalysis) : null;
  const objectiveAnchor = objectivePoint ? objectiveTarget.anchorPoint : null;
  const objectiveSupportPoint = objectivePoint
    ? getForwardSupportPoint(state, aiContext, objectivePoint, aiBase, waypointAnalysis)
    : null;
  const pressureAnchor = pressurePoint ? getOwnedAnchorPointNear(state, aiContext, pressurePoint, waypointAnalysis) : null;
  const pressureSupportPoint = pressurePoint
    ? getForwardSupportPoint(state, aiContext, pressurePoint, aiBase, waypointAnalysis)
    : null;
  const expansionAnchor = expansionPoint ? getOwnedAnchorPointNear(state, aiContext, expansionPoint, waypointAnalysis) : null;
  const expansionSupportPoint = expansionPoint
    ? getForwardSupportPoint(state, aiContext, expansionPoint, aiBase, waypointAnalysis)
    : null;
  return {
    runtime,
    strategicIntent,
    waypointAnalysis,
    territorySummary,
    ownTerritoryCount,
    enemyTerritoryCount,
    aiBase,
    enemyBase,
    defensePoint,
    defenseAnchor,
    objectivePoint,
    objectiveScore: objectiveTarget?.score ?? 0,
    objectiveAnchor,
    objectiveSupportPoint,
    pressurePoint,
    pressureAnchor,
    pressureSupportPoint,
    expansionTargets,
    expansionPoint,
    expansionAnchor,
    expansionSupportPoint
  };
}

function updateBaseWaypointPlans(state, aiContext, aiState, snapshot) {
  const context = createWaypointPlanningContext(state, aiContext, aiState, snapshot);
  const aiBase = context.aiBase;
  const routePlan = {
    aiBase,
    defensePoint: context.defensePoint,
    defenseAnchor: context.defenseAnchor,
    objectivePoint: context.objectivePoint,
    objectiveScore: context.objectiveScore,
    objectiveAnchor: context.objectiveAnchor,
    objectiveSupportPoint: context.objectiveSupportPoint,
    pressurePoint: context.pressurePoint,
    pressureAnchor: context.pressureAnchor,
    pressureSupportPoint: context.pressureSupportPoint,
    expansionAnchor: context.expansionAnchor,
    expansionSupportPoint: context.expansionSupportPoint,
    expansionPoint: context.expansionPoint
  };
  const baseRelocationPlan = getMainBaseRelocationPlan(
    state,
    aiContext,
    aiState,
    snapshot,
    context.strategicIntent,
    routePlan,
    context.waypointAnalysis
  );
  const baseRouteChanged = syncMainBaseWaypointChain(state, aiBase, baseRelocationPlan.route);
  aiState.lastBaseRouteRole = baseRelocationPlan.role;
  aiState.lastBaseRoutePoints = baseRelocationPlan.route.map(clonePoint);
  mergeDebugWaypointPlan(aiState, {
    lastUpdatedAtSeconds: state.matchTimeSeconds,
    nextBaseRefreshSeconds: state.matchTimeSeconds + aiState.baseRetargetIntervalSeconds,
    intent: { ...context.strategicIntent },
    defensePoint: clonePoint(context.defensePoint),
    expansionPoint: clonePoint(context.expansionPoint),
    objectivePoint: clonePoint(context.objectivePoint),
    pressurePoint: clonePoint(context.pressurePoint),
    baseRouteRole: baseRelocationPlan.role,
    baseRoutePoints: baseRelocationPlan.route.map(clonePoint)
  });
  return baseRouteChanged;
}

function updateProductionWaypointPlans(state, aiContext, aiState, snapshot) {
  const context = createWaypointPlanningContext(state, aiContext, aiState, snapshot);
  const runtime = context.runtime;
  const productionBuildings = runtime.productionBuildings;
  const buildingRefreshSeconds = getBuildingWaypointIntervalSeconds(aiState);

  if (productionBuildings.length === 0) {
    mergeDebugWaypointPlan(aiState, {
      lastUpdatedAtSeconds: state.matchTimeSeconds,
      nextBuildingRefreshSeconds: state.matchTimeSeconds + buildingRefreshSeconds,
      intent: { ...context.strategicIntent },
      defensePoint: clonePoint(context.defensePoint),
      expansionPoint: clonePoint(context.expansionPoint),
      objectivePoint: clonePoint(context.objectivePoint),
      pressurePoint: clonePoint(context.pressurePoint),
      routes: []
    });
    return false;
  }

  const aiBase = context.aiBase;
  const enemyBase = context.enemyBase;
  const frontierStretched = isFrontierStretched(aiBase, context.pressureSupportPoint, context.pressurePoint);
  const territorySummary = context.territorySummary;

  const sortedBuildings = [...productionBuildings].sort((left, right) => left.id.localeCompare(right.id));
  const selectedBuildingIndex = getNextWaypointBuildingIndex(sortedBuildings, aiState, state.matchTimeSeconds);
  if (selectedBuildingIndex === -1) {
    mergeDebugWaypointPlan(aiState, {
      lastUpdatedAtSeconds: state.matchTimeSeconds,
      nextBuildingRefreshSeconds: state.matchTimeSeconds + buildingRefreshSeconds,
      intent: { ...context.strategicIntent },
      defensePoint: clonePoint(context.defensePoint),
      expansionPoint: clonePoint(context.expansionPoint),
      objectivePoint: clonePoint(context.objectivePoint),
      pressurePoint: clonePoint(context.pressurePoint),
      routes: productionBuildings.map((building) => ({
        buildingId: building.id,
        role: "idle",
        points: building.waypointChain.map(clonePoint)
      }))
    });
    return false;
  }

  if (!context.defensePoint && !context.expansionPoint && !context.objectivePoint && !context.pressurePoint) {
    const selectedBuilding = sortedBuildings[selectedBuildingIndex];
    if (selectedBuilding) {
      aiState.waypointBuildingCooldowns[selectedBuilding.id] = state.matchTimeSeconds + buildingRefreshSeconds;
      aiState.waypointBuildingCursor = (selectedBuildingIndex + 1) % Math.max(1, sortedBuildings.length);
    }
    mergeDebugWaypointPlan(aiState, {
      lastUpdatedAtSeconds: state.matchTimeSeconds,
      nextBuildingRefreshSeconds: state.matchTimeSeconds + buildingRefreshSeconds,
      intent: { ...context.strategicIntent },
      defensePoint: clonePoint(context.defensePoint),
      expansionPoint: clonePoint(context.expansionPoint),
      objectivePoint: clonePoint(context.objectivePoint),
      pressurePoint: clonePoint(context.pressurePoint),
      updatedBuildingId: selectedBuilding?.id ?? null,
      routes: productionBuildings.map((building) => ({
        buildingId: building.id,
        role: "idle",
        points: building.waypointChain.map(clonePoint)
      }))
    });
    return false;
  }
  const defenseBuildingCount = getDefenseBuildingCount(
    sortedBuildings.length,
    !!context.defensePoint,
    frontierStretched,
    context.strategicIntent,
    snapshot
  );
  const expansionBuildingCount = getExpansionBuildingCount(
    sortedBuildings.length,
    defenseBuildingCount,
    !!context.expansionPoint,
    !!context.objectivePoint || !!context.pressurePoint,
    {
      ...territorySummary,
      ownCount: context.ownTerritoryCount,
      enemyCount: context.enemyTerritoryCount
    },
    context.strategicIntent,
    snapshot
  );
  const objectiveBuildingCount = getObjectiveBuildingCount(
    sortedBuildings.length,
    defenseBuildingCount,
    expansionBuildingCount,
    !!context.objectivePoint,
    context.strategicIntent,
    snapshot
  );
  const supportBuildingCount = getSupportBuildingCount(
    sortedBuildings.length,
    frontierStretched,
    defenseBuildingCount,
    expansionBuildingCount,
    objectiveBuildingCount,
    !!context.pressurePoint
  );
  const building = sortedBuildings[selectedBuildingIndex];
  const expansionLane = context.expansionPoint
    ? getExpansionLaneForBuilding(state, aiContext, building, context.expansionTargets, aiBase, enemyBase, context.waypointAnalysis)
    : null;
  const routePlan = {
    strategicPrimary: context.strategicIntent.primary,
    defenseBuildingCount,
    expansionBuildingCount,
    objectiveBuildingCount,
    supportBuildingCount,
    defenseAnchor: context.defenseAnchor,
    defensePoint: context.defensePoint,
    objectiveSupportPoint: context.objectiveSupportPoint,
    objectiveAnchor: context.objectiveAnchor,
    objectivePoint: context.objectivePoint,
    pressureSupportPoint: context.pressureSupportPoint,
    pressureAnchor: context.pressureAnchor,
    pressurePoint: context.pressurePoint,
    expansionSupportPoint: expansionLane?.supportPoint ?? context.expansionSupportPoint,
    expansionAnchor: expansionLane?.anchorPoint ?? context.expansionAnchor,
    expansionPoint: expansionLane?.point ?? null
  };
  const routeAssignment = buildRouteForBuilding(selectedBuildingIndex, routePlan);
  const changed = syncBuildingWaypointChain(state, building.id, routeAssignment.points);
  aiState.waypointBuildingCooldowns[building.id] = state.matchTimeSeconds + buildingRefreshSeconds;
  aiState.waypointBuildingCursor = (selectedBuildingIndex + 1) % Math.max(1, sortedBuildings.length);
  mergeDebugWaypointPlan(aiState, {
    lastUpdatedAtSeconds: state.matchTimeSeconds,
    nextBuildingRefreshSeconds: state.matchTimeSeconds + buildingRefreshSeconds,
    intent: { ...context.strategicIntent },
    defensePoint: clonePoint(context.defensePoint),
    expansionPoint: clonePoint(context.expansionPoint),
    objectivePoint: clonePoint(context.objectivePoint),
    pressurePoint: clonePoint(context.pressurePoint),
    updatedBuildingId: building.id,
    updatedRole: routeAssignment.role,
    routes: [{
      buildingId: building.id,
      role: routeAssignment.role,
      points: routeAssignment.points.map(clonePoint)
    }]
  });
  return changed;
}

function mergeDebugWaypointPlan(aiState, patch) {
  aiState.debugWaypointPlan = {
    ...(aiState.debugWaypointPlan ?? {}),
    ...patch
  };
  aiState.debugWaypointPlan.baseRouteRole ??= aiState.lastBaseRouteRole ?? "hold";
  aiState.debugWaypointPlan.baseRoutePoints ??= (aiState.lastBaseRoutePoints ?? []).map(clonePoint);
}

function getBuildingWaypointIntervalSeconds(aiState) {
  const [minIntervalSeconds, maxIntervalSeconds] = aiState.buildingWaypointIntervalRange ?? [2, 5];
  return randomRange([minIntervalSeconds, maxIntervalSeconds]);
}

function getMainBaseRelocationPlan(
  state,
  aiContext,
  aiState,
  snapshot,
  strategicIntent,
  routePlan,
  waypointAnalysis
) {
  const aiBase = routePlan.aiBase;
  if (!aiBase || !aiBase.isConstructed) {
    traceBaseRelocationDecision(state, aiContext.playerId, {
      role: "hold",
      route: [],
      reason: "no_base",
      candidates: []
    });
    return {
      role: "hold",
      route: []
    };
  }

  const enemyBase = snapshot.runtime.enemyBase;
  const baseThreatSeverity = getThreatSeverityAgainstBase(snapshot, aiBase);
  const retreatPoint = enemyBase
    ? getMainBaseRetreatPoint(state, aiContext, aiBase, enemyBase, waypointAnalysis)
    : null;
  const baseHealthRatio = aiBase.maxHealth > 0 ? aiBase.health / aiBase.maxHealth : 1;
  const highThreat = snapshot.military.localDefenseThreat >= aiState.baseHoldThreatThreshold;
  const losingArmy = snapshot.military.aiArmyPower < snapshot.military.playerArmyPower * aiState.baseRetreatArmyRatio;
  const inTransit = aiBase.waypointChain.length > 0;
  const transitStalled = isMainBaseTransitStalled(aiBase);
  const relocationRefreshReady =
    state.matchTimeSeconds >=
    (aiState.lastBaseRelocationPlanTimeSeconds ?? Number.NEGATIVE_INFINITY) + aiState.baseRetargetIntervalSeconds;
  const shouldRetreat =
    retreatPoint &&
    (
      baseThreatSeverity >= aiState.baseRetreatThreatThreshold ||
      (
        snapshot.military.localDefenseThreat >= aiState.baseOverwhelmingThreatThreshold &&
        losingArmy
      ) ||
      (
        baseHealthRatio <= aiState.baseRetreatHealthThreshold &&
        baseThreatSeverity >= aiState.baseHoldThreatThreshold
      )
    );

  if (shouldRetreat && !inTransit) {
    aiState.lastBaseRelocationPlanTimeSeconds = state.matchTimeSeconds;
    traceBaseRelocationDecision(state, aiContext.playerId, {
      role: "retreat",
      route: [retreatPoint],
      reason: "retreat_trigger",
      candidates: []
    });
    return {
      role: "retreat",
      route: [retreatPoint]
    };
  }

  if (shouldRetreat && inTransit) {
    aiState.lastBaseRelocationPlanTimeSeconds = state.matchTimeSeconds;
    traceBaseRelocationDecision(state, aiContext.playerId, {
      role: "retreat",
      route: [retreatPoint],
      reason: "retreat_while_transit",
      candidates: []
    });
    return {
      role: "retreat",
      route: [retreatPoint]
    };
  }

  if (inTransit && !transitStalled && !relocationRefreshReady) {
    traceBaseRelocationDecision(state, aiContext.playerId, {
      role: "committed",
      route: aiBase.waypointChain,
      reason: "in_transit",
      candidates: []
    });
    return {
      role: "committed",
      route: aiBase.waypointChain.map(clonePoint)
    };
  }

  if (shouldKeepMainBaseStationary(state, aiContext, aiBase, snapshot, routePlan)) {
    traceBaseRelocationDecision(state, aiContext.playerId, {
      role: "hold",
      route: [],
      reason: "supporting_battle",
      candidates: []
    });
    return {
      role: "hold",
      route: []
    };
  }

  const relocationMode = chooseMainBaseRelocationMode(
    state,
    aiContext,
    aiState,
    snapshot,
    strategicIntent,
    routePlan,
    waypointAnalysis,
    {
      highThreat,
      losingArmy,
      baseThreatSeverity
    }
  );
  const anchorCells = getMainBaseModeAnchorCells(
    state,
    aiContext,
    snapshot,
    routePlan,
    waypointAnalysis,
    relocationMode
  );
  const rawCandidates = anchorCells
    .map((cell) => {
      return scoreMainBaseModeAnchorCell(
        state,
        aiContext,
        aiState,
        snapshot,
        waypointAnalysis,
        routePlan,
        relocationMode,
        cell,
        {
          highThreat,
          losingArmy,
          baseThreatSeverity
        }
      );
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
  const candidates = finalizeMainBaseModeCandidates(
    state,
    snapshot,
    relocationMode,
    rawCandidates
  );
  const fallbackCandidate = getBestMainBaseRelocationCandidate(candidates);

  if (!fallbackCandidate) {
    if (inTransit) {
      traceBaseRelocationDecision(state, aiContext.playerId, {
        role: "committed",
        route: aiBase.waypointChain,
        reason: `retain_current_route:${relocationMode.role}`,
        candidates
      });
      return {
        role: "committed",
        route: aiBase.waypointChain.map(clonePoint)
      };
    }

    const emergencyCandidate = getMainBaseEmergencyRelocationCandidate(
      state,
      aiContext,
      aiState,
      snapshot,
      routePlan
    );
    if (emergencyCandidate) {
      aiState.lastBaseRelocationPlanTimeSeconds = state.matchTimeSeconds;
      traceBaseRelocationDecision(state, aiContext.playerId, {
        role: emergencyCandidate.role,
        route: emergencyCandidate.route,
        reason: "emergency_candidate",
        candidates
      });
      return {
        role: emergencyCandidate.role,
        route: emergencyCandidate.route
      };
    }

    traceBaseRelocationDecision(state, aiContext.playerId, {
      role: "hold",
      route: [],
      reason: `no_positive_candidate:${relocationMode.role}`,
      candidates
    });
    return {
      role: "hold",
      route: []
    };
  }

  aiState.lastBaseRelocationPlanTimeSeconds = state.matchTimeSeconds;

  traceBaseRelocationDecision(state, aiContext.playerId, {
    role: fallbackCandidate.role,
    route: fallbackCandidate.route,
    reason: `selected_candidate:${relocationMode.role}`,
    candidates
  });
  return {
    role: fallbackCandidate.role,
    route: fallbackCandidate.route
  };
}

function chooseMainBaseRelocationMode(
  state,
  aiContext,
  aiState,
  snapshot,
  strategicIntent,
  routePlan,
  waypointAnalysis = null,
  context = {}
) {
  const aiBase = routePlan.aiBase;
  const enemyBase = snapshot.runtime.enemyBase;
  const objectiveNeed = snapshot.needs.objectives ?? 0;
  const expansionNeed = snapshot.needs.expansion ?? 0;
  const pressureNeed = snapshot.needs.pressure ?? 0;
  const flankTarget = aiBase && enemyBase
    ? getMainBaseFlankTarget(state, aiContext, aiBase, enemyBase, waypointAnalysis)
    : null;

  if (routePlan.defensePoint && ((snapshot.military.localDefenseThreat ?? 0) >= 0.14 || strategicIntent.primary === "defense")) {
    return {
      role: "support_battle",
      targetPoint: routePlan.defensePoint,
      targetWeight: 1.45,
      maxThreat: 0.9,
      enemyThreatPenalty: 0.18,
      structureThreatPenalty: 0.42,
      minimumTravelDistance: getMainBaseMinimumTravelDistance(aiBase, true),
      maxTravelDistance: Math.min(state.map.width * 0.42, Math.hypot(state.map.width, state.map.height) * 0.5),
      pathSampleCount: 5,
      pathConstraints: {
        maxDetourRatio: 2.5,
        minAlignment: -0.18
      }
    };
  }

  if (routePlan.objectivePoint && objectiveNeed >= Math.max(0.42, expansionNeed + 0.08)) {
    return {
      role: "objective",
      targetPoint: routePlan.objectivePoint,
      objectiveScore: routePlan.objectiveScore ?? 0,
      targetWeight: 1.35,
      maxThreat: 0.58,
      enemyThreatPenalty: 0.45,
      structureThreatPenalty: 0.55,
      minimumTravelDistance: getMainBaseMinimumTravelDistance(aiBase, true),
      maxTravelDistance: Math.min(state.map.width * 0.45, Math.hypot(state.map.width, state.map.height) * 0.54),
      pathSampleCount: 4,
      pathConstraints: {
        maxDetourRatio: 2.4,
        minAlignment: -0.2
      }
    };
  }

  if (flankTarget && (expansionNeed + pressureNeed >= 0.68 || strategicIntent.primary === "expansion")) {
    return {
      role: "flank",
      targetPoint: flankTarget.point,
      targetSide: flankTarget.sideSign ?? 0,
      targetWeight: 1.12,
      maxThreat: 0.5,
      enemyThreatPenalty: 0.48,
      structureThreatPenalty: 0.58,
      minimumTravelDistance: getMainBaseMinimumTravelDistance(aiBase, false),
      maxTravelDistance: Math.min(state.map.width * 0.52, Math.hypot(state.map.width, state.map.height) * 0.6),
      pathSampleCount: 4,
      pathConstraints: {
        maxDetourRatio: 2.55,
        minAlignment: -0.24
      }
    };
  }

  if (routePlan.expansionPoint && expansionNeed >= Math.max(0.16, pressureNeed - 0.08)) {
    return {
      role: "expansion",
      targetPoint: routePlan.expansionPoint,
      targetWeight: 1.18,
      maxThreat: 0.46,
      enemyThreatPenalty: 0.52,
      structureThreatPenalty: 0.62,
      minimumTravelDistance: getMainBaseMinimumTravelDistance(aiBase, false),
      maxTravelDistance: Math.min(state.map.width * 0.5, Math.hypot(state.map.width, state.map.height) * 0.58),
      pathSampleCount: 4,
      pathConstraints: {
        maxDetourRatio: 2.45,
        minAlignment: -0.22
      }
    };
  }

  return {
    role: "pressure",
    targetPoint: routePlan.pressurePoint ?? getFallbackPressurePoint(snapshot.runtime) ?? { x: enemyBase.x, y: enemyBase.y },
    targetWeight: 1.08,
    maxThreat: context.highThreat ? 0.62 : 0.52,
    enemyThreatPenalty: 0.5,
    structureThreatPenalty: 0.58,
    minimumTravelDistance: getMainBaseMinimumTravelDistance(aiBase, false),
    maxTravelDistance: Math.min(state.map.width * 0.52, Math.hypot(state.map.width, state.map.height) * 0.62),
    pathSampleCount: 4,
    pathConstraints: {
      maxDetourRatio: 2.55,
      minAlignment: -0.24
    }
  };
}

function getMainBaseModeAnchorCells(
  state,
  aiContext,
  snapshot,
  routePlan,
  waypointAnalysis,
  relocationMode
) {
  const cells = [];
  const seen = new Set();
  const aiBase = routePlan.aiBase;
  const enemyBase = snapshot.runtime.enemyBase;
  const addPoint = (point, radiusCells = 1) => {
    if (!point) {
      return;
    }
    const cell = getCellAtPoint(state, point);
    addMainBaseAnchorCellNeighborhood(state, cells, seen, cell, radiusCells);
  };

  addPoint({ x: aiBase.x, y: aiBase.y }, 1);

  if (relocationMode.role === "support_battle") {
    addPoint(routePlan.defensePoint, 1);
    addPoint(routePlan.defenseAnchor, 1);
    addPoint(routePlan.pressureSupportPoint ?? routePlan.expansionSupportPoint, 1);
  } else if (relocationMode.role === "objective") {
    addPoint(routePlan.objectivePoint, 1);
    addPoint(routePlan.objectiveAnchor, 1);
    addPoint(routePlan.objectiveSupportPoint, 1);
  } else if (relocationMode.role === "expansion") {
    const expansionTargets = getTerritoryExpansionTargets(state, aiContext, aiBase, enemyBase, 3, waypointAnalysis);
    for (const target of expansionTargets) {
      addPoint(target.point, 1);
    }
    addPoint(routePlan.expansionPoint, 1);
    addPoint(routePlan.expansionAnchor, 1);
    addPoint(routePlan.expansionSupportPoint, 1);
  } else if (relocationMode.role === "flank") {
    const flankTargets = getTerritoryExpansionTargets(state, aiContext, aiBase, enemyBase, 6, waypointAnalysis)
      .filter((target) => (target.sideSign ?? 0) === (relocationMode.targetSide ?? 0))
      .slice(0, 3);
    for (const target of flankTargets) {
      addPoint(target.point, 1);
    }
    addPoint(relocationMode.targetPoint, 1);
    addPoint(routePlan.expansionSupportPoint, 1);
  } else {
    addPoint(routePlan.pressurePoint, 1);
    addPoint(routePlan.pressureAnchor, 1);
    addPoint(routePlan.pressureSupportPoint, 1);
    addPoint(getFallbackPressurePoint(snapshot.runtime), 1);
  }

  return cells;
}

function addMainBaseAnchorCellNeighborhood(state, cells, seen, originCell, radiusCells = 1) {
  if (!originCell) {
    return;
  }

  for (let row = originCell.row - radiusCells; row <= originCell.row + radiusCells; row += 1) {
    for (let column = originCell.column - radiusCells; column <= originCell.column + radiusCells; column += 1) {
      if (row < 0 || column < 0 || row >= state.territory.rows || column >= state.territory.columns) {
        continue;
      }

      const cell = state.territory.cells[row * state.territory.columns + column];
      addMainBaseAnchorCell(cells, seen, cell);
    }
  }
}

function addMainBaseAnchorCell(cells, seen, cell) {
  if (!cell) {
    return;
  }

  const key = `${cell.column}:${cell.row}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  cells.push(cell);
}

function scoreMainBaseModeAnchorCell(
  state,
  aiContext,
  aiState,
  snapshot,
  waypointAnalysis,
  routePlan,
  relocationMode,
  cell,
  situation
) {
  const aiBase = routePlan.aiBase;
  const enemyBase = snapshot.runtime.enemyBase;
  if (!aiBase || !enemyBase) {
    return null;
  }

  const point = { x: cell.centerX, y: cell.centerY };
  const travelDistance = Math.hypot(point.x - aiBase.x, point.y - aiBase.y);
  if (travelDistance < relocationMode.minimumTravelDistance || travelDistance > relocationMode.maxTravelDistance) {
    return null;
  }

  const edgeClearance = getPointEdgeClearance(state, point);
  if (edgeClearance < Math.max((aiBase.radius ?? 0) + 40, 96)) {
    return null;
  }

  const laneMetrics = getCachedWaypointCellMetrics(state, aiContext, cell, aiBase, enemyBase, waypointAnalysis);
  if (laneMetrics.structureThreat > relocationMode.maxThreat) {
    return null;
  }

  if (laneMetrics.enemyUnitPresence + laneMetrics.structureThreat * 0.85 > relocationMode.maxThreat && relocationMode.role !== "support_battle") {
    return null;
  }

  if ((relocationMode.targetSide ?? 0) !== 0 && laneMetrics.sideSign !== 0 && laneMetrics.sideSign !== relocationMode.targetSide) {
    return null;
  }

  const targetDistance = Math.max(1, Math.hypot(relocationMode.targetPoint.x - aiBase.x, relocationMode.targetPoint.y - aiBase.y));
  const targetProximity = clamp01(1 - Math.hypot(point.x - relocationMode.targetPoint.x, point.y - relocationMode.targetPoint.y) / Math.max(220, targetDistance));
  const currentEnemyDistance = Math.hypot(enemyBase.x - aiBase.x, enemyBase.y - aiBase.y);
  const enemyDistanceGain = currentEnemyDistance - laneMetrics.distanceToEnemyBase;
  const controlForAi = getControlForPlayer(cell, aiContext.playerId);
  const isNeutral = cell.ownerId === null;
  const isEnemyControlled = cell.ownerId === aiContext.opponentPlayerId || controlForAi < -0.18;
  const isContested = Math.abs(controlForAi) < 0.45;
  const edgePenaltyRatio = getMapEdgePenaltyRatio(state, point);

  let score = aiState.baseForwardBias * 0.55;
  score += targetProximity * relocationMode.targetWeight;
  score += laneMetrics.frontierReachScore * 0.34;
  score += laneMetrics.opportunityRegionScore * 0.026;
  score += laneMetrics.captureOpportunity * 0.28;
  score += Math.max(0, enemyDistanceGain) * 0.0018;
  score -= edgePenaltyRatio * 0.34;
  score -= laneMetrics.structureThreat * relocationMode.structureThreatPenalty;
  score -= laneMetrics.enemyUnitPresence * relocationMode.enemyThreatPenalty;

  if (relocationMode.role === "support_battle") {
    score += targetProximity * 0.58;
    score += laneMetrics.enemyUnitPresence * 0.68;
    score += laneMetrics.ownUnitPresence * 0.32;
    score += isContested ? 0.22 : 0;
    score -= situation.baseThreatSeverity * 0.15;
  } else if (relocationMode.role === "objective") {
    score += (relocationMode.objectiveScore ?? 0) * 0.18;
    score += isContested ? 0.2 : 0;
  } else if (relocationMode.role === "expansion") {
    score += isNeutral ? 0.46 : 0;
    score += isContested ? 0.18 : 0;
    score += laneMetrics.flankOffsetRatio * 0.12;
    score -= laneMetrics.enemyUnitPresence * 0.08;
  } else if (relocationMode.role === "flank") {
    score += laneMetrics.flankOffsetRatio * 0.58;
    score += isNeutral ? 0.32 : 0;
    score += isContested ? 0.14 : 0;
    score -= laneMetrics.outerLaneRatio * 0.08;
  } else if (relocationMode.role === "pressure") {
    score += isEnemyControlled ? 0.44 : 0.12;
    score += isContested ? 0.18 : 0;
    score += laneMetrics.playerNeighborCount * 0.08;
    score += laneMetrics.forwardProgressRatio * 0.34;
  }

  if (situation.highThreat && relocationMode.role !== "support_battle") {
    score -= 0.18;
  }

  if (situation.losingArmy && relocationMode.role === "pressure") {
    score -= 0.26;
  }

  return {
    role: relocationMode.role,
    score,
    cell,
    debug: {
      mode: relocationMode.role,
      travelDistance: round2(travelDistance),
      enemyDistanceGain: round2(enemyDistanceGain),
      destinationProgress: round2(laneMetrics.forwardProgressRatio),
      flankOffsetRatio: round2(laneMetrics.flankOffsetRatio),
      outerLaneRatio: round2(laneMetrics.outerLaneRatio),
      edgePenaltyRatio: round2(edgePenaltyRatio)
    }
  };
}

function finalizeMainBaseModeCandidates(state, snapshot, relocationMode, rawCandidates) {
  const aiBase = snapshot.runtime.aiBase;
  if (!aiBase) {
    return [];
  }

  const finalized = [];
  const topRawCandidates = rawCandidates.slice(0, relocationMode.pathSampleCount);

  for (const candidate of topRawCandidates) {
    const resolvedPoint = resolveMainBaseCandidateStandPoint(
      state,
      aiBase,
      candidate.cell,
      relocationMode.targetPoint
    );
    if (!resolvedPoint) {
      continue;
    }

    const pathEvaluation = evaluateMainBaseRoutePath(
      state,
      aiBase,
      aiBase,
      resolvedPoint,
      relocationMode.pathConstraints
    );
    if (!pathEvaluation.approved) {
      continue;
    }

    finalized.push({
      role: candidate.role,
      route: [clonePoint(resolvedPoint)],
      score: candidate.score - pathEvaluation.detourPenalty - pathEvaluation.backtrackPenalty,
      debug: {
        ...candidate.debug,
        detourPenalty: round2(pathEvaluation.detourPenalty),
        backtrackPenalty: round2(pathEvaluation.backtrackPenalty),
        detourRatio: round2(pathEvaluation.detourRatio),
        alignment: round2(pathEvaluation.alignment)
      }
    });
  }

  return finalized.sort((left, right) => right.score - left.score);
}

function resolveMainBaseCandidateStandPoint(state, aiBase, cell, targetPoint) {
  if (!cell) {
    return null;
  }

  const centerPoint = { x: cell.centerX, y: cell.centerY };
  const targetVectorX = (targetPoint?.x ?? centerPoint.x) - centerPoint.x;
  const targetVectorY = (targetPoint?.y ?? centerPoint.y) - centerPoint.y;
  const targetDistance = Math.hypot(targetVectorX, targetVectorY);
  const stepDistance = Math.min(state.territory.cellSize * 0.35, targetDistance * 0.45);
  const nudgedPoint = targetDistance > 0
    ? {
        x: centerPoint.x + (targetVectorX / targetDistance) * stepDistance,
        y: centerPoint.y + (targetVectorY / targetDistance) * stepDistance
      }
    : centerPoint;
  const candidatePoints = [nudgedPoint, centerPoint];

  for (const point of candidatePoints) {
    const resolvedPoint = resolvePointToNavigablePosition(state, point, Math.max((aiBase.radius ?? 0) + 12, 24), {
      excludedBuildingIds: new Set([aiBase.id])
    });
    if (resolvedPoint) {
      return resolvedPoint;
    }
  }

  return null;
}

function getMainBaseEmergencyRelocationCandidate(state, aiContext, aiState, snapshot, routePlan) {
  const aiBase = routePlan.aiBase;
  const enemyBase = snapshot.runtime.enemyBase;
  if (!aiBase || !enemyBase) {
    return null;
  }

  const targetEntries = [
    ["support_battle", routePlan.defensePoint],
    ["expansion", routePlan.expansionPoint],
    ["flank", getMainBaseFlankTarget(state, aiContext, aiBase, enemyBase, snapshot.runtime.waypointAnalysis ?? null)?.point ?? null],
    ["objective", routePlan.objectivePoint],
    ["pressure", routePlan.pressurePoint],
    ["pressure", getFallbackPressurePoint(snapshot.runtime)]
  ];

  for (const [role, targetPoint] of targetEntries) {
    if (!targetPoint) {
      continue;
    }

    const resolvedPoint = resolvePointToNavigablePosition(state, targetPoint, Math.max((aiBase.radius ?? 0) + 12, 24), {
      excludedBuildingIds: new Set([aiBase.id])
    });
    if (!resolvedPoint) {
      continue;
    }

    const pathEvaluation = evaluateMainBaseRoutePath(state, aiBase, aiBase, resolvedPoint, {
      maxDetourRatio: 3.8,
      minAlignment: -0.45
    });
    if (!pathEvaluation.approved) {
      continue;
    }

    return {
      role,
      route: [clonePoint(resolvedPoint)],
      score: 0,
      debug: {
        relaxation: "emergency"
      }
    };
  }

  return null;
}

function evaluateMainBaseRoutePath(state, aiBase, originPoint, destinationPoint, constraints = {}) {
  const blockerRadius = (aiBase.radius ?? 0) + 10;
  const pathOrigin = originPoint ?? aiBase;
  const path = findPathToPoint(state, state.navigation, pathOrigin, destinationPoint, {
    radius: blockerRadius,
    excludedBuildingIds: new Set([aiBase.id])
  });
  if (path === null) {
    return {
      approved: false,
      detourPenalty: 0,
      backtrackPenalty: 0
    };
  }

  const straightDistance = Math.max(1, Math.hypot(destinationPoint.x - pathOrigin.x, destinationPoint.y - pathOrigin.y));
  const pathDistance = getPathDistance(pathOrigin, path, destinationPoint);
  const detourRatio = pathDistance / straightDistance;
  if (detourRatio > (constraints.maxDetourRatio ?? 2.35)) {
    return {
      approved: false,
      detourPenalty: 0,
      backtrackPenalty: 0
    };
  }

  const firstPoint = path[0] ?? destinationPoint;
  const directVectorX = destinationPoint.x - pathOrigin.x;
  const directVectorY = destinationPoint.y - pathOrigin.y;
  const firstVectorX = firstPoint.x - pathOrigin.x;
  const firstVectorY = firstPoint.y - pathOrigin.y;
  const firstVectorLength = Math.hypot(firstVectorX, firstVectorY);
  const directVectorLength = Math.hypot(directVectorX, directVectorY);
  let alignment = 1;
  if (firstVectorLength > 0 && directVectorLength > 0) {
    alignment =
      (directVectorX * firstVectorX + directVectorY * firstVectorY) /
      (directVectorLength * firstVectorLength);
  }

  if (alignment < (constraints.minAlignment ?? -0.2)) {
    return {
      approved: false,
      detourPenalty: 0,
      backtrackPenalty: 0
    };
  }

  return {
    approved: true,
    detourRatio,
    alignment,
    detourPenalty: Math.max(0, detourRatio - 1.15) * 0.9,
    backtrackPenalty: Math.max(0, 0.45 - alignment) * 0.6
  };
}

function getPathDistance(originPoint, path, destinationPoint) {
  let totalDistance = 0;
  let previousPoint = originPoint;

  for (const point of path) {
    totalDistance += Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
    previousPoint = point;
  }

  if (!path.at(-1) || path.at(-1).x !== destinationPoint.x || path.at(-1).y !== destinationPoint.y) {
    totalDistance += Math.hypot(destinationPoint.x - previousPoint.x, destinationPoint.y - previousPoint.y);
  }

  return totalDistance;
}

function getThreatSeverityAgainstBase(snapshot, aiBase) {
  if (!aiBase) {
    return 0;
  }

  const threat = snapshot.threats?.structureThreats?.find((entry) => entry.targetBuildingId === aiBase.id) ?? null;
  return threat?.severity ?? 0;
}

function shouldKeepMainBaseStationary(state, aiContext, aiBase, snapshot, routePlan) {
  if (!aiBase) {
    return false;
  }

  const battlePoint = routePlan.defensePoint ?? routePlan.pressurePoint ?? routePlan.objectivePoint ?? null;
  if (!battlePoint) {
    return false;
  }

  const supportRadius = state.territory.cellSize * 3.25;
  const distanceToBattle = Math.hypot(battlePoint.x - aiBase.x, battlePoint.y - aiBase.y);
  if (distanceToBattle > supportRadius) {
    return false;
  }

  const baseCell = getCellAtPoint(state, aiBase);
  if (!baseCell) {
    return false;
  }

  const enemyBase = snapshot.runtime.enemyBase;
  const laneMetrics = enemyBase
    ? getCachedWaypointCellMetrics(state, aiContext, baseCell, aiBase, enemyBase, snapshot.runtime.waypointAnalysis ?? null)
    : null;
  const activeBattleNearby =
    (snapshot.military.localDefenseThreat ?? 0) >= 0.16 ||
    (laneMetrics?.enemyUnitPresence ?? 0) >= 0.18;

  return activeBattleNearby && getThreatSeverityAgainstBase(snapshot, aiBase) < 0.34;
}

function getMainBaseRetreatPoint(state, aiContext, aiBase, enemyBase, waypointAnalysis = null) {
  const currentEnemyDistance = Math.hypot(enemyBase.x - aiBase.x, enemyBase.y - aiBase.y);
  const ownedCells = waypointAnalysis?.ownedCells ?? state.territory.cells.filter((cell) => cell.ownerId === aiContext.playerId);
  let bestPoint = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const cell of ownedCells) {
    const point = { x: cell.centerX, y: cell.centerY };
    const distance = Math.hypot(point.x - aiBase.x, point.y - aiBase.y);
    if (distance < 160 || distance > 560) {
      continue;
    }

    if (getPointEdgeClearance(state, point) < (aiBase.radius ?? 0) + 72) {
      continue;
    }

    const enemyDistance = Math.hypot(enemyBase.x - point.x, enemyBase.y - point.y);
    const enemyDistanceGain = enemyDistance - currentEnemyDistance;
    if (enemyDistanceGain < 70) {
      continue;
    }

    const flankOffsetRatio = getFlankOffsetRatio(aiBase, enemyBase, point);
    const edgePenaltyRatio = getMapEdgePenaltyRatio(state, point);
    const outerLaneRatio = getOuterLaneRatio(state, cell);
    const retreatAmount = enemyDistanceGain;
    const score =
      retreatAmount / 145 -
      flankOffsetRatio * 0.7 -
      outerLaneRatio * 0.95 -
      edgePenaltyRatio * 0.65 -
      Math.abs(distance - 320) / 360;

    if (score > bestScore) {
      bestScore = score;
      bestPoint = point;
    }
  }

  return bestScore > 0 ? bestPoint : null;
}

function evaluateObjectiveOpportunity(state, aiContext, runtime, aiArmyPower, playerArmyPower) {
  const objectives = getControlStructureObjectives(state);
  if (objectives.length === 0) {
    return {
      priority: 0,
      target: null
    };
  }

  let bestTarget = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const objective of objectives) {
    const nearbyForces = getForcePresenceNearObjective(state, aiContext, runtime, objective);
    const aiLocalAdvantage = nearbyForces.aiPower - nearbyForces.enemyPower;
    const distanceToBase = runtime.aiBase
      ? Math.hypot(objective.center.x - runtime.aiBase.x, objective.center.y - runtime.aiBase.y)
      : 0;
    let score = 0;

    if (objective.ownerId !== aiContext.playerId) {
      score += 0.55;
    }

    if (objective.ownerId === aiContext.opponentPlayerId) {
      score += 0.18;
    }

    score += Math.max(0, aiLocalAdvantage) / 260;
    score += clamp01((aiArmyPower - playerArmyPower) / Math.max(180, playerArmyPower + 120)) * 0.18;
    score -= Math.max(0, -aiLocalAdvantage) / 320;
    score -= distanceToBase > 0 ? Math.min(distanceToBase / 1200, 0.22) : 0;

    if (score > bestScore) {
      bestScore = score;
      bestTarget = {
        point: clonePoint(objective.center),
        score,
        nearbyForces
      };
    }
  }

  return {
    priority: clamp01(bestScore),
    target: bestTarget
  };
}

function getNextWaypointBuildingIndex(sortedBuildings, aiState, matchTimeSeconds) {
  if (sortedBuildings.length === 0) {
    return -1;
  }

  pruneWaypointBuildingCooldowns(aiState, sortedBuildings);
  const startIndex = aiState.waypointBuildingCursor % sortedBuildings.length;

  for (let offset = 0; offset < sortedBuildings.length; offset += 1) {
    const index = (startIndex + offset) % sortedBuildings.length;
    const building = sortedBuildings[index];
    const nextEligibleAt = aiState.waypointBuildingCooldowns[building.id] ?? 0;
    const missingRoute = building.waypointChain.length === 0;
    if (missingRoute || nextEligibleAt <= matchTimeSeconds) {
      return index;
    }
  }

  return -1;
}

function pruneWaypointBuildingCooldowns(aiState, sortedBuildings) {
  const liveIds = new Set(sortedBuildings.map((building) => building.id));
  for (const buildingId of Object.keys(aiState.waypointBuildingCooldowns)) {
    if (!liveIds.has(buildingId)) {
      delete aiState.waypointBuildingCooldowns[buildingId];
    }
  }
}

function buildRouteForBuilding(index, routePlan) {
  const role = getRouteRoleForBuilding(index, routePlan);
  const route = [];

  if (role === "defense") {
    pushDistinctWaypoint(route, routePlan.defenseAnchor);
    pushDistinctWaypoint(route, routePlan.pressureSupportPoint ?? routePlan.expansionSupportPoint);
    pushDistinctWaypoint(route, routePlan.defensePoint);
    return { role, points: route };
  }

  if (role === "expansion") {
    pushDistinctWaypoint(route, routePlan.expansionSupportPoint);
    pushDistinctWaypoint(route, routePlan.expansionAnchor);
    pushDistinctWaypoint(route, routePlan.expansionPoint);
    return { role, points: route };
  }

  if (role === "objective") {
    pushDistinctWaypoint(route, routePlan.objectiveSupportPoint);
    pushDistinctWaypoint(route, routePlan.objectiveAnchor);
    pushDistinctWaypoint(route, routePlan.objectivePoint);
    return { role, points: route };
  }

  if (role === "support") {
    pushDistinctWaypoint(route, routePlan.pressureSupportPoint);
    pushDistinctWaypoint(route, routePlan.pressureAnchor);
    return { role, points: route };
  }

  pushDistinctWaypoint(route, routePlan.pressureSupportPoint);
  pushDistinctWaypoint(route, routePlan.pressureAnchor);
  pushDistinctWaypoint(route, routePlan.pressurePoint);
  return { role, points: route };
}

function getRouteRoleForBuilding(index, routePlan) {
  const dedicateToDefense = !!routePlan.defensePoint && index < routePlan.defenseBuildingCount;
  if (dedicateToDefense) {
    return "defense";
  }

  const postDefenseIndex = index - routePlan.defenseBuildingCount;
  const prioritizeObjectives = routePlan.strategicPrimary === "objectives";
  const prioritizedPrimaryCount = prioritizeObjectives
    ? routePlan.objectiveBuildingCount
    : routePlan.expansionBuildingCount;
  const prioritizedSecondaryCount = prioritizeObjectives
    ? routePlan.expansionBuildingCount
    : routePlan.objectiveBuildingCount;
  const prioritizedPrimaryRole = prioritizeObjectives ? "objective" : "expansion";
  const prioritizedSecondaryRole = prioritizeObjectives ? "expansion" : "objective";

  if (prioritizedPrimaryCount > 0 && postDefenseIndex < prioritizedPrimaryCount) {
    return prioritizedPrimaryRole;
  }

  if (
    prioritizedSecondaryCount > 0 &&
    postDefenseIndex < prioritizedPrimaryCount + prioritizedSecondaryCount
  ) {
    return prioritizedSecondaryRole;
  }

  if (!routePlan.pressurePoint) {
    return routePlan.expansionPoint ? "expansion" : "objective";
  }

  const dedicateToSupport =
    postDefenseIndex <
    prioritizedPrimaryCount +
      prioritizedSecondaryCount +
      routePlan.supportBuildingCount;
  if (dedicateToSupport) {
    return "support";
  }

  return "pressure";
}

function syncBuildingWaypointChain(state, buildingId, route) {
  const building = getEntityById(state, buildingId);
  if (!building || !isProductionKind(building.kind) || !Array.isArray(building.waypointChain)) {
    return false;
  }

  return syncEntityWaypointChain(state, building, route);
}

function syncMainBaseWaypointChain(state, base, route) {
  if (!base || base.kind !== "base" || !Array.isArray(base.waypointChain)) {
    return false;
  }

  return syncEntityWaypointChain(state, base, route);
}

function syncEntityWaypointChain(state, entity, route) {
  const sanitizedRoute = sanitizeWaypointRoute(
    state,
    route,
    getWaypointRouteResolutionRadius(entity),
    getWaypointRouteResolutionOptions(entity)
  );
  if (entity.kind === "base") {
    const signature = JSON.stringify({
      entityId: entity.id,
      current: summarizeWaypointRoute(entity.waypointChain),
      requested: summarizeWaypointRoute(route),
      sanitized: summarizeWaypointRoute(sanitizedRoute)
    });
    traceAiEvent(state, entity.ownerId, "base_route", signature, {
      entityId: entity.id,
      entityPoint: { x: Math.round(entity.x), y: Math.round(entity.y) },
      currentRoute: entity.waypointChain.map(clonePoint),
      requestedRoute: route.map(clonePoint),
      sanitizedRoute: sanitizedRoute.map(clonePoint)
    });
  }

  if (areWaypointChainsEqual(entity.waypointChain, sanitizedRoute)) {
    return false;
  }

  queueGameplayCommand(state, {
    type: getGameplayCommandTypes().SET_WAYPOINT_CHAIN,
    playerId: entity.ownerId,
    buildingId: entity.id,
    points: sanitizedRoute
  });
  return true;
}

function areWaypointChainsEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index].x !== right[index].x || left[index].y !== right[index].y) {
      return false;
    }
  }

  return true;
}

function summarizeWaypointRoute(route) {
  return (route ?? []).map((point) => ({
    x: Math.round(point.x),
    y: Math.round(point.y)
  }));
}

function clonePoint(point) {
  return point ? { x: point.x, y: point.y } : null;
}

function traceBaseRelocationDecision(state, playerId, payload) {
  const routePoint = payload.route?.[0] ?? null;
  const topCandidates = (payload.candidates ?? [])
    .slice()
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((candidate) => ({
      role: candidate.role,
      score: round2(candidate.score),
      point: clonePoint(candidate.route?.[0] ?? null),
      debug: candidate.debug ?? null
    }));
  const signature = JSON.stringify({
    role: payload.role,
    reason: payload.reason,
    routePoint: routePoint ? { x: Math.round(routePoint.x), y: Math.round(routePoint.y) } : null,
    topCandidates
  });
  traceAiEvent(state, playerId, "base", signature, {
    role: payload.role,
    reason: payload.reason,
    route: payload.route?.map(clonePoint) ?? [],
    topCandidates
  });
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function getBestMainBaseRelocationCandidate(candidates) {
  return candidates
    .slice()
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

function isMainBaseTransitStalled(aiBase) {
  if (!aiBase || aiBase.kind !== "base" || !Array.isArray(aiBase.waypointChain) || aiBase.waypointChain.length === 0) {
    return false;
  }

  if (aiBase.movementPathStatus === "blocked") {
    return true;
  }

  return (aiBase.stuckTimeSeconds ?? 0) >= 1.2;
}

function getDefenseResponsePoint(state, aiContext, runtime) {
  const enemyUnits = runtime.enemyUnits;
  const aiBuildings = runtime.constructedBuildings;
  if (enemyUnits.length === 0 || aiBuildings.length === 0) {
    return null;
  }

  let bestPoint = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const unit of enemyUnits) {
    const nearestDistanceToBuilding = getNearestDistanceToBuildings(unit, aiBuildings);
    const unitCell = getCellAtPoint(state, unit);
    const insideAiTerritory = unitCell?.ownerId === aiContext.playerId;
    let score = 420 - nearestDistanceToBuilding;

    if (insideAiTerritory) {
      score += 180;
    }

    if (nearestDistanceToBuilding <= 240) {
      score += 120;
    }

    if (score > bestScore) {
      bestScore = score;
      bestPoint = { x: Math.round(unit.x), y: Math.round(unit.y) };
    }
  }

  return bestScore >= 40 ? bestPoint : null;
}

function getTerritoryExpansionTargets(state, aiContext, aiBase, enemyBase, maxTargets = 4, waypointAnalysis = null) {
  if (waypointAnalysis?.expansionTargets) {
    return waypointAnalysis.expansionTargets.slice(0, maxTargets);
  }

  const candidates = [];
  const candidateCells = waypointAnalysis?.strategicCandidateCells
    ?? waypointAnalysis?.nonOwnedCells
    ?? state.territory.cells.filter((cell) => cell.ownerId !== aiContext.playerId);

  for (const cell of candidateCells) {
    const cellMetrics = getCachedWaypointCellMetrics(state, aiContext, cell, aiBase, enemyBase, waypointAnalysis);

    const score = scoreTerritoryExpansionCell(state, aiContext, cell, cellMetrics);
    if (score <= 0) {
      continue;
    }

    candidates.push({
      point: { x: cell.centerX, y: cell.centerY },
      score,
      sideSign: cellMetrics.sideSign,
      distanceToBase: cellMetrics.distanceToAiBase
    });
  }

  const prioritizedCandidates = prioritizeExpansionLaneSides(filterCenterlineExpansionCandidates(candidates));
  prioritizedCandidates.sort((left, right) => right.score - left.score);
  const targets = [];
  const minimumTargetSpacing = state.territory.cellSize * 2.75;

  for (const candidate of prioritizedCandidates) {
    const tooCloseToExisting = targets.some((target) => {
      return Math.hypot(target.point.x - candidate.point.x, target.point.y - candidate.point.y) < minimumTargetSpacing;
    });
    if (tooCloseToExisting) {
      continue;
    }

    targets.push(candidate);
    if (targets.length >= maxTargets) {
      break;
    }
  }

  if (waypointAnalysis) {
    waypointAnalysis.expansionTargets = targets;
  }

  return targets.slice(0, maxTargets);
}

function getPressureTargetPoint(state, aiContext, runtime, waypointAnalysis = null) {
  if (waypointAnalysis?.pressureTargetPoint !== undefined) {
    return waypointAnalysis.pressureTargetPoint;
  }

  const enemyBase = runtime.enemyBase;
  let bestCell = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const candidateCells = waypointAnalysis?.pressureCandidateCells
    ?? waypointAnalysis?.strategicCandidateCells
    ?? waypointAnalysis?.nonOwnedCells
    ?? state.territory.cells.filter((cell) => cell.ownerId !== aiContext.playerId);

  for (const cell of candidateCells) {
    const cellMetrics = getCachedWaypointCellMetrics(
      state,
      aiContext,
      cell,
      runtime.aiBase,
      enemyBase,
      waypointAnalysis
    );

    if (cellMetrics.ownedNeighborCount === 0) {
      continue;
    }

    const uncontestedNeutralCell = cell.ownerId === null && Math.abs(cell.control) < 0.12;
    if (uncontestedNeutralCell) {
      continue;
    }

    let score = cellMetrics.ownedNeighborCount * 32 + cellMetrics.captureOpportunity * 22;
    score += cell.ownerId === aiContext.opponentPlayerId ? 48 : 12;
    score += cellMetrics.playerNeighborCount * 10;
    score += enemyBase ? (state.map.width + state.map.height - cellMetrics.distanceToEnemyBase) * 0.02 : 0;

    if (score > bestScore) {
      bestScore = score;
      bestCell = cell;
    }
  }

  const pressureTargetPoint = bestCell ? { x: bestCell.centerX, y: bestCell.centerY } : null;
  if (waypointAnalysis) {
    waypointAnalysis.pressureTargetPoint = pressureTargetPoint;
  }
  return pressureTargetPoint;
}

function getObjectiveTargetPoint(state, aiContext, snapshot, waypointAnalysis = null) {
  const objectiveTarget = snapshot.objectives?.target ?? null;
  const objectiveNeed = snapshot.needs.objectives ?? 0;
  if (!objectiveTarget || objectiveNeed <= 0.18) {
    return null;
  }

  const objectivePoint = objectiveTarget.point;
  const anchorPoint = getOwnedAnchorPointNear(state, aiContext, objectivePoint, waypointAnalysis);
  if (!anchorPoint) {
    return null;
  }

  return {
    point: objectivePoint,
    anchorPoint,
    score: objectiveTarget.score
  };
}

function getForwardSupportPoint(state, aiContext, expansionPoint, aiBase, waypointAnalysis = null) {
  if (!expansionPoint || !aiBase) {
    return expansionPoint;
  }

  const distanceToExpansion = Math.hypot(expansionPoint.x - aiBase.x, expansionPoint.y - aiBase.y);
  if (distanceToExpansion <= state.territory.cellSize * 4) {
    return getOwnedAnchorPointNear(state, aiContext, expansionPoint, waypointAnalysis);
  }

  const supportRatio = 0.72;
  const candidatePoint = {
    x: aiBase.x + (expansionPoint.x - aiBase.x) * supportRatio,
    y: aiBase.y + (expansionPoint.y - aiBase.y) * supportRatio
  };
  return (
    getOwnedAnchorPointNear(state, aiContext, candidatePoint, waypointAnalysis) ??
    getOwnedAnchorPointNear(state, aiContext, expansionPoint, waypointAnalysis)
  );
}

function getMainBaseFlankTarget(state, aiContext, aiBase, enemyBase, waypointAnalysis = null) {
  const expansionTargets = getTerritoryExpansionTargets(state, aiContext, aiBase, enemyBase, 6, waypointAnalysis);
  const flankTargets = expansionTargets
    .filter((target) => Math.abs(target.sideSign ?? 0) === 1)
    .sort((left, right) => {
      const flankDelta = Math.abs(right.sideSign ?? 0) - Math.abs(left.sideSign ?? 0);
      if (flankDelta !== 0) {
        return flankDelta;
      }

      return right.score - left.score;
    });

  return flankTargets[0] ?? null;
}

function getMainBaseMinimumTravelDistance(aiBase, relaxedFilters = false) {
  const radius = aiBase?.radius ?? 0;
  if (relaxedFilters) {
    return Math.max(MAIN_BASE_MIN_TRAVEL_DISTANCE, radius * 1.05);
  }

  return Math.max(120, radius * 1.3);
}

function getExpansionLaneForBuilding(
  state,
  aiContext,
  building,
  expansionTargets,
  aiBase,
  enemyBase,
  waypointAnalysis = null
) {
  if (expansionTargets.length === 0) {
    return null;
  }

  let bestTarget = expansionTargets[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  const buildingSide = getLaneSideSign(aiBase, enemyBase, building);

  for (const target of expansionTargets) {
    let score = target.score;
    score -= Math.hypot(building.x - target.point.x, building.y - target.point.y) * 0.032;

    if (buildingSide !== 0 && target.sideSign === buildingSide) {
      score += 28;
    } else if (buildingSide !== 0 && target.sideSign !== 0 && target.sideSign !== buildingSide) {
      score -= 42;
    } else if (target.sideSign === 0) {
      score -= 12;
    }

    if (score > bestScore) {
      bestScore = score;
      bestTarget = target;
    }
  }

  return {
    point: bestTarget.point,
    anchorPoint: getExpansionAnchorForBuilding(state, aiContext, building, bestTarget.point, waypointAnalysis),
    supportPoint: getExpansionSupportPointForBuilding(
      state,
      aiContext,
      building,
      bestTarget.point,
      aiBase,
      waypointAnalysis
    )
  };
}

function isFrontierStretched(aiBase, supportPoint, expansionPoint) {
  if (!aiBase || !supportPoint || !expansionPoint) {
    return false;
  }

  const supportDistance = Math.hypot(supportPoint.x - aiBase.x, supportPoint.y - aiBase.y);
  const expansionDistance = Math.hypot(expansionPoint.x - aiBase.x, expansionPoint.y - aiBase.y);
  return expansionDistance - supportDistance >= 160 || expansionDistance >= 780;
}

function getDefenseBuildingCount(buildingCount, hasDefensePoint, frontierStretched, strategicIntent, snapshot) {
  if (!hasDefensePoint) {
    return 0;
  }

  if (buildingCount <= 1) {
    return strategicIntent?.primary === "defense" ? 1 : 0;
  }

  if ((snapshot?.needs.defense ?? 0) >= 0.78) {
    return Math.max(1, Math.ceil(buildingCount * 0.7));
  }

  if (strategicIntent?.primary === "defense" && strategicIntent.threatSeverity >= 0.68) {
    return Math.max(1, Math.ceil(buildingCount * 0.6));
  }

  if (strategicIntent?.primary === "defense") {
    return Math.max(1, Math.ceil(buildingCount * 0.4));
  }

  if (frontierStretched) {
    return Math.min(buildingCount - 1, Math.ceil(buildingCount * 0.5));
  }

  return 1;
}

function getFallbackPressurePoint(runtime) {
  const enemyBase = runtime.enemyBase;
  if (!enemyBase) {
    return null;
  }

  return { x: enemyBase.x, y: enemyBase.y };
}

function getOwnedAnchorPointNear(state, aiContext, point, waypointAnalysis = null) {
  const cacheKey = waypointAnalysis ? `${Math.round(point.x)}:${Math.round(point.y)}` : null;
  if (cacheKey && waypointAnalysis.ownedAnchorByPoint.has(cacheKey)) {
    return waypointAnalysis.ownedAnchorByPoint.get(cacheKey);
  }

  let bestCell = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const ownedCells = waypointAnalysis?.ownedCells ?? state.territory.cells.filter((cell) => cell.ownerId === aiContext.playerId);
  for (const cell of ownedCells) {
    const distance = Math.hypot(cell.centerX - point.x, cell.centerY - point.y);
    const edgePenaltyRatio = getMapEdgePenaltyRatio(state, cell);
    const outerLanePenalty = getOuterLaneRatio(state, cell);
    const score =
      -distance -
      edgePenaltyRatio * 260 -
      outerLanePenalty * 160;
    if (score > bestScore) {
      bestScore = score;
      bestCell = cell;
    }
  }

  const anchorPoint = bestCell ? { x: bestCell.centerX, y: bestCell.centerY } : null;
  if (cacheKey) {
    waypointAnalysis.ownedAnchorByPoint.set(cacheKey, anchorPoint);
  }
  return anchorPoint;
}

function getExpansionAnchorForBuilding(state, aiContext, building, targetPoint, waypointAnalysis = null) {
  const midpoint = {
    x: building.x + (targetPoint.x - building.x) * 0.68,
    y: building.y + (targetPoint.y - building.y) * 0.68
  };

  return (
    getOwnedAnchorPointNear(state, aiContext, midpoint, waypointAnalysis) ??
    getOwnedAnchorPointNear(state, aiContext, targetPoint, waypointAnalysis)
  );
}

function getExpansionSupportPointForBuilding(
  state,
  aiContext,
  building,
  targetPoint,
  aiBase,
  waypointAnalysis = null
) {
  if (!targetPoint) {
    return null;
  }

  const origin = building ?? aiBase;
  if (!origin) {
    return targetPoint;
  }

  const distanceToExpansion = Math.hypot(targetPoint.x - origin.x, targetPoint.y - origin.y);
  if (distanceToExpansion <= state.territory.cellSize * 4) {
    return getOwnedAnchorPointNear(state, aiContext, targetPoint, waypointAnalysis);
  }

  const supportRatio = 0.6;
  const candidatePoint = {
    x: origin.x + (targetPoint.x - origin.x) * supportRatio,
    y: origin.y + (targetPoint.y - origin.y) * supportRatio
  };

  return (
    getOwnedAnchorPointNear(state, aiContext, candidatePoint, waypointAnalysis) ??
    getOwnedAnchorPointNear(state, aiContext, targetPoint, waypointAnalysis)
  );
}

function countOwnedNeighborCells(state, cell, playerId) {
  return countNeighborCellsByOwner(state, cell, playerId);
}

function countNeighborCellsByOwner(state, cell, ownerId) {
  let matchingNeighbors = 0;

  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      if (rowOffset === 0 && columnOffset === 0) {
        continue;
      }

      const neighborRow = cell.row + rowOffset;
      const neighborColumn = cell.column + columnOffset;
      if (
        neighborRow < 0 ||
        neighborColumn < 0 ||
        neighborRow >= state.territory.rows ||
        neighborColumn >= state.territory.columns
      ) {
        continue;
      }

      const neighbor = state.territory.cells[neighborRow * state.territory.columns + neighborColumn];
      if (neighbor?.ownerId === ownerId) {
        matchingNeighbors += 1;
      }
    }
  }

  return matchingNeighbors;
}

function getExpansionBuildingCount(
  buildingCount,
  defenseBuildingCount,
  hasExpansionPoint,
  hasPressurePoint,
  territorySummary,
  strategicIntent,
  snapshot
) {
  if (!hasExpansionPoint) {
    return 0;
  }

  const availableBuildings = buildingCount - defenseBuildingCount;
  if (availableBuildings <= 0) {
    return 0;
  }

  if ((snapshot?.needs.defense ?? 0) >= 0.55) {
    return 0;
  }

  if (!hasPressurePoint) {
    return availableBuildings;
  }

  if (strategicIntent?.primary === "expansion") {
    return availableBuildings === 1 ? 1 : Math.max(1, Math.ceil(availableBuildings * 0.65));
  }

  if (strategicIntent?.primary === "defense" && strategicIntent.threatSeverity >= 0.55) {
    return 0;
  }

  const aiBehindOnTerritory = territorySummary.ownCount + 6 < territorySummary.enemyCount;
  const neutralStillOpen = territorySummary.neutralPercent >= 18;
  if (!aiBehindOnTerritory && !neutralStillOpen) {
    return 0;
  }

  if (availableBuildings === 1) {
    return 1;
  }

  if (aiBehindOnTerritory && territorySummary.neutralPercent >= 28 && availableBuildings >= 3) {
    return 2;
  }

  return 1;
}

function getSupportBuildingCount(
  buildingCount,
  frontierStretched,
  defenseBuildingCount,
  expansionBuildingCount,
  objectiveBuildingCount,
  hasPressurePoint
) {
  if (!hasPressurePoint) {
    return 0;
  }

  const availableBuildings = buildingCount - defenseBuildingCount - expansionBuildingCount - objectiveBuildingCount;
  if (availableBuildings <= 1) {
    return 0;
  }

  if (frontierStretched) {
    return 1;
  }

  return 0;
}

function getObjectiveBuildingCount(
  buildingCount,
  defenseBuildingCount,
  expansionBuildingCount,
  hasObjectivePoint,
  strategicIntent,
  snapshot
) {
  if (!hasObjectivePoint) {
    return 0;
  }

  const availableBuildings = buildingCount - defenseBuildingCount - expansionBuildingCount;
  if (availableBuildings <= 0) {
    return 0;
  }

  if ((snapshot?.needs.defense ?? 0) >= 0.58) {
    return 0;
  }

  const objectiveNeed = snapshot?.needs.objectives ?? 0;
  if (objectiveNeed < 0.28) {
    return 0;
  }

  const localAdvantage =
    (snapshot?.objectives?.target?.nearbyForces?.aiPower ?? 0) -
    (snapshot?.objectives?.target?.nearbyForces?.enemyPower ?? 0);
  if (localAdvantage < -110) {
    return 0;
  }

  if (availableBuildings === 1) {
    return strategicIntent?.primary === "objectives" && objectiveNeed >= 0.52 ? 1 : 0;
  }

  const cappedCommitment = Math.min(2, availableBuildings);
  if (strategicIntent?.primary === "objectives" && objectiveNeed >= 0.6 && localAdvantage >= -35) {
    return cappedCommitment;
  }

  return 1;
}

function getNearestDistanceToBuildings(unit, buildings) {
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const building of buildings) {
    const distance = Math.hypot(unit.x - building.x, unit.y - building.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
    }
  }

  return nearestDistance;
}

function getCellAtPoint(state, point) {
  const column = Math.floor(point.x / state.territory.cellSize);
  const row = Math.floor(point.y / state.territory.cellSize);
  if (
    column < 0 ||
    row < 0 ||
    column >= state.territory.columns ||
    row >= state.territory.rows
  ) {
    return null;
  }

  return state.territory.cells[row * state.territory.columns + column] ?? null;
}

function pushDistinctWaypoint(route, point) {
  if (!point) {
    return;
  }

  const lastPoint = route.at(-1);
  if (lastPoint && Math.hypot(lastPoint.x - point.x, lastPoint.y - point.y) < 20) {
    return;
  }

  route.push({ x: Math.round(point.x), y: Math.round(point.y) });
}

function sanitizeWaypointRoute(state, route, resolutionRadius = 12, resolutionOptions = undefined) {
  const sanitizedRoute = [];

  for (const point of route) {
    const snappedPoint = resolvePointToNavigablePosition(state, point, resolutionRadius, resolutionOptions);
    if (!snappedPoint) {
      continue;
    }

    pushDistinctWaypoint(sanitizedRoute, snappedPoint);
  }

  return sanitizedRoute;
}

function getWaypointRouteResolutionRadius(entity) {
  return entity.kind === "base"
    ? Math.max(12, entity.radius ?? 12)
    : 12;
}

function getWaypointRouteResolutionOptions(entity) {
  if (!entity?.id) {
    return undefined;
  }

  return {
    excludedBuildingIds: new Set([entity.id])
  };
}

function countFrontierCells(state, ownerId, adjacentOwnerId) {
  let count = 0;

  for (const cell of state.territory.cells) {
    if (cell.ownerId !== ownerId) {
      continue;
    }

    if (countNeighborCellsByOwner(state, cell, adjacentOwnerId) > 0) {
      count += 1;
    }
  }

  return count;
}

function countHostileFrontierCells(state, aiContext) {
  let count = 0;

  for (const cell of state.territory.cells) {
    if (cell.ownerId === aiContext.playerId) {
      continue;
    }

    if (countNeighborCellsByOwner(state, cell, aiContext.playerId) === 0) {
      continue;
    }

    if (cell.ownerId === aiContext.opponentPlayerId || Math.abs(cell.control) >= 0.12) {
      count += 1;
    }
  }

  return count;
}

function getProducedUnitCounts(state, aiContext) {
  const counts = new Map();

  for (const building of getOwnedBuildings(state, aiContext.playerId)) {
    const producedUnitId = getProducedUnitId(state.catalog.buildings[building.definitionId]);
    if (!producedUnitId || !isUnitUnlocked(state, aiContext.playerId, producedUnitId)) {
      continue;
    }

    counts.set(producedUnitId, (counts.get(producedUnitId) ?? 0) + 1);
  }

  return counts;
}

function getControlForPlayer(cell, playerId) {
  return playerId === 1 ? cell.control : -cell.control;
}

function shouldUseFallbackPressureTarget(territorySummary, ownTerritoryCount, enemyTerritoryCount) {
  if (territorySummary.neutralPercent >= 60) {
    return false;
  }

  return ownTerritoryCount >= enemyTerritoryCount - 6;
}

function getForcePresenceNearObjective(state, aiContext, runtime, objective) {
  let aiPower = 0;
  let enemyPower = 0;
  const radius = objective.radius * 1.5;

  for (const unit of runtime.aiUnits) {
    const distance = Math.hypot(unit.x - objective.center.x, unit.y - objective.center.y);
    if (distance > radius) {
      continue;
    }

    const stats = getUnitStats(state, aiContext.playerId, unit.definitionId);
    aiPower += getLocalizedUnitPower(stats, distance, radius);
  }

  for (const unit of runtime.enemyUnits) {
    const distance = Math.hypot(unit.x - objective.center.x, unit.y - objective.center.y);
    if (distance > radius) {
      continue;
    }

    const stats = getUnitStats(state, aiContext.opponentPlayerId, unit.definitionId);
    enemyPower += getLocalizedUnitPower(stats, distance, radius);
  }

  return {
    aiPower,
    enemyPower
  };
}

function getLocalizedUnitPower(stats, distance, radius) {
  const unitPower = stats.attackDamage / Math.max(0.2, stats.attackCooldown) * 7.5 + stats.maxHealth * 0.1;
  return unitPower * (1 - distance / radius);
}

function scoreTerritoryExpansionCell(state, aiContext, cell, laneMetrics) {
  const minimumDistanceForExpansion = state.territory.cellSize * 3.25;

  let score = laneMetrics.opportunityRegionScore * 14;
  score += laneMetrics.openNeighborCount * 12;
  score += laneMetrics.captureOpportunity * 16;
  score += laneMetrics.frontierReachScore * 24;
  score += laneMetrics.progressBandRatio * 24;
  score += Math.max(0, 0.42 - laneMetrics.flankOffsetRatio) * 26;
  score += Math.max(0, laneMetrics.safetyLead) * 0.018;
  score += cell.ownerId === aiContext.opponentPlayerId ? 30 : 0;
  score -= laneMetrics.playerNeighborCount * 10;
  score -= laneMetrics.ownedNeighborCount * 5;
  score -= laneMetrics.ownUnitPresence * 58;
  score -= laneMetrics.enemyUnitPresence * 70;
  score -= laneMetrics.structureThreat * 34;
  score -= laneMetrics.outerLaneRatio * 34;

  if (laneMetrics.distanceToAiBase > 0) {
    score += Math.min(laneMetrics.distanceToAiBase / (state.territory.cellSize * 8.5), 1) * 20;
  }

  if (laneMetrics.distanceToAiBase < minimumDistanceForExpansion) {
    score -= (minimumDistanceForExpansion - laneMetrics.distanceToAiBase) * 0.26;
  }

  if (Math.abs(laneMetrics.controlForAi) >= 0.12) {
    score -= 14;
  }

  if (laneMetrics.forwardProgressRatio > 0.7) {
    score -= (laneMetrics.forwardProgressRatio - 0.7) * 100;
  }

  if (laneMetrics.flankOffsetRatio > 0.55) {
    score -= (laneMetrics.flankOffsetRatio - 0.55) * 90;
  }

  if (laneMetrics.forwardProgressRatio < 0.16 && laneMetrics.flankOffsetRatio > 0.5) {
    score -= 30;
  }

  if (laneMetrics.outerLaneRatio > 0.45) {
    score -= (laneMetrics.outerLaneRatio - 0.45) * 120;
  }

  if (laneMetrics.frontierReachScore <= 0 && laneMetrics.distanceToNearestOwnedCell > state.territory.cellSize * 3.5) {
    score -= 80;
  }

  return score;
}

function getCachedWaypointCellMetrics(state, aiContext, cell, aiBase, enemyBase, waypointAnalysis) {
  if (!waypointAnalysis) {
    return getTerritoryOpportunityMetrics(state, aiContext, cell, aiBase, enemyBase, waypointAnalysis);
  }

  const cellIndex = cell.row * state.territory.columns + cell.column;
  const cachedMetrics = waypointAnalysis.cellMetricsByIndex[cellIndex];
  if (cachedMetrics) {
    return cachedMetrics;
  }

  const metrics = getTerritoryOpportunityMetrics(state, aiContext, cell, aiBase, enemyBase, waypointAnalysis);
  waypointAnalysis.cellMetricsByIndex[cellIndex] = metrics;
  return metrics;
}

function getTerritoryOpportunityMetrics(state, aiContext, cell, aiBase, enemyBase, waypointAnalysis = null) {
  const neighborCounts = getNeighborOwnershipCounts(state, aiContext, cell, waypointAnalysis);
  const ownedNeighborCount = neighborCounts.own;
  const neutralNeighborCount = neighborCounts.neutral;
  const playerNeighborCount = neighborCounts.enemy;
  const controlForAi = getControlForPlayer(cell, aiContext.playerId);
  const captureOpportunity = 1 - Math.max(-1, Math.min(1, controlForAi));
  const distanceToAiBase = aiBase ? Math.hypot(cell.centerX - aiBase.x, cell.centerY - aiBase.y) : 0;
  const distanceToEnemyBase = enemyBase
    ? Math.hypot(cell.centerX - enemyBase.x, cell.centerY - enemyBase.y)
    : distanceToAiBase;
  const safetyLead = distanceToEnemyBase - distanceToAiBase;
  const opportunityRegionScore = getOpportunityRegionScore(state, aiContext, cell, 4, waypointAnalysis);
  const flankOffsetRatio = getFlankOffsetRatio(aiBase, enemyBase, cell);
  const forwardProgressRatio = getForwardProgressRatio(aiBase, enemyBase, cell);
  const progressBandRatio = getProgressBandRatio(forwardProgressRatio);
  const outerLaneRatio = getOuterLaneRatio(state, cell);
  const unitPresence = getUnitPresenceNearCell(state, aiContext, cell, waypointAnalysis);
  const frontier = getOwnedFrontierReach(state, aiContext, cell, waypointAnalysis);
  const sideSign = getLaneSideSign(aiBase, enemyBase, cell);

  return {
    ownedNeighborCount,
    openNeighborCount: neutralNeighborCount + playerNeighborCount * 0.75,
    playerNeighborCount,
    controlForAi,
    captureOpportunity,
    distanceToAiBase,
    distanceToEnemyBase,
    safetyLead,
    sideSign,
    opportunityRegionScore,
    flankOffsetRatio,
    forwardProgressRatio,
    progressBandRatio,
    outerLaneRatio,
    ownUnitPresence: unitPresence.own,
    enemyUnitPresence: unitPresence.enemy,
    structureThreat: unitPresence.enemyStructure,
    frontierReachScore: frontier.score,
    distanceToNearestOwnedCell: frontier.distance
  };
}

function getOpportunityRegionScore(state, aiContext, startCell, radiusInCells, waypointAnalysis = null) {
  const startCellIndex = startCell.row * state.territory.columns + startCell.column;
  const cachedScores = waypointAnalysis?.opportunityRegionScoreByIndex;
  if (cachedScores?.[startCellIndex] !== undefined) {
    return cachedScores[startCellIndex];
  }

  let score = 0;
  const top = Math.max(0, startCell.row - radiusInCells);
  const bottom = Math.min(state.territory.rows - 1, startCell.row + radiusInCells);
  const left = Math.max(0, startCell.column - radiusInCells);
  const right = Math.min(state.territory.columns - 1, startCell.column + radiusInCells);

  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      const cell = state.territory.cells[row * state.territory.columns + column];
      const rowDistance = Math.abs(cell.row - startCell.row);
      const columnDistance = Math.abs(cell.column - startCell.column);

      if (cell.ownerId === aiContext.playerId) {
        continue;
      }

      const distance = Math.max(rowDistance, columnDistance);
      const distanceMultiplier = 1 - distance / (radiusInCells + 1);
      const currentControlForAi = getControlForPlayer(cell, aiContext.playerId);
      const captureValue = 1 - Math.max(-1, Math.min(1, currentControlForAi));
      const ownershipValue = cell.ownerId === aiContext.opponentPlayerId ? 1.35 : 1;
      const unitPresence = getUnitPresenceNearCell(state, aiContext, cell, waypointAnalysis);
      const vacancyValue = clamp01(1 - unitPresence.own * 0.85 - unitPresence.enemy * 1.05);

      score += ownershipValue * captureValue * vacancyValue * distanceMultiplier;
    }
  }

  if (cachedScores) {
    cachedScores[startCellIndex] = score;
  }

  return score;
}

function getOwnedFrontierReach(state, aiContext, targetCell, waypointAnalysis = null) {
  const targetCellIndex = targetCell.row * state.territory.columns + targetCell.column;
  const cachedFrontierReach = waypointAnalysis?.frontierReachByIndex?.[targetCellIndex];
  if (cachedFrontierReach) {
    return cachedFrontierReach;
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  let ownedCellsInRange = 0;
  const maxDistance = state.territory.cellSize * 4.25;
  const ownedCells = waypointAnalysis?.ownedCells ?? state.territory.cells.filter((cell) => cell.ownerId === aiContext.playerId);

  for (const cell of ownedCells) {
    const distance = Math.hypot(cell.centerX - targetCell.centerX, cell.centerY - targetCell.centerY);
    if (distance < bestDistance) {
      bestDistance = distance;
    }

    if (distance <= maxDistance) {
      ownedCellsInRange += 1;
    }
  }

  if (bestDistance === Number.POSITIVE_INFINITY) {
    const emptyResult = { score: 0, distance: bestDistance };
    if (waypointAnalysis?.frontierReachByIndex) {
      waypointAnalysis.frontierReachByIndex[targetCellIndex] = emptyResult;
    }
    return emptyResult;
  }

  const proximityScore = clamp01(1 - bestDistance / maxDistance);
  const result = {
    score: proximityScore + Math.min(ownedCellsInRange, 8) * 0.1,
    distance: bestDistance
  };
  if (waypointAnalysis?.frontierReachByIndex) {
    waypointAnalysis.frontierReachByIndex[targetCellIndex] = result;
  }
  return result;
}

function getUnitPresenceNearCell(state, aiContext, cell, waypointAnalysis = null) {
  if (waypointAnalysis?.cellPresenceByIndex) {
    return waypointAnalysis.cellPresenceByIndex[cell.row * state.territory.columns + cell.column];
  }

  let own = 0;
  let enemy = 0;
  let enemyStructure = 0;
  const unitRadius = state.territory.cellSize * 1.75;
  const structureRadius = state.territory.cellSize * 2.75;
  const spatialIndex = getEntitySpatialIndex(state);
  const centerPoint = { x: cell.centerX, y: cell.centerY };

  for (const entity of queryEntitySpatialIndex(spatialIndex, "unit", centerPoint, unitRadius)) {
    const distance = Math.hypot(entity.x - cell.centerX, entity.y - cell.centerY);
    if (distance > unitRadius) {
      continue;
    }

    const contribution = 1 - distance / unitRadius;
    if (entity.ownerId === aiContext.playerId) {
      own += contribution;
    } else if (entity.ownerId === aiContext.opponentPlayerId) {
      enemy += contribution;
    }
  }

  for (const entity of queryEntitySpatialIndex(spatialIndex, "building", centerPoint, structureRadius)) {
    if (entity.ownerId !== aiContext.opponentPlayerId || !entity.isConstructed) {
      continue;
    }

    const distance = Math.hypot(entity.x - cell.centerX, entity.y - cell.centerY);
    if (distance <= structureRadius) {
      enemyStructure += 1 - distance / structureRadius;
    }
  }

  return {
    own: clamp01(own),
    enemy: clamp01(enemy),
    enemyStructure: clamp01(enemyStructure)
  };
}

function getNeighborOwnershipCounts(state, aiContext, cell, waypointAnalysis = null) {
  if (!waypointAnalysis?.neighborCountsByIndex) {
    return {
      own: countOwnedNeighborCells(state, cell, aiContext.playerId),
      neutral: countNeighborCellsByOwner(state, cell, null),
      enemy: countNeighborCellsByOwner(state, cell, aiContext.opponentPlayerId)
    };
  }

  const cellIndex = cell.row * state.territory.columns + cell.column;
  const cachedCounts = waypointAnalysis.neighborCountsByIndex[cellIndex];
  if (cachedCounts) {
    return cachedCounts;
  }

  const counts = {
    own: countOwnedNeighborCells(state, cell, aiContext.playerId),
    neutral: countNeighborCellsByOwner(state, cell, null),
    enemy: countNeighborCellsByOwner(state, cell, aiContext.opponentPlayerId)
  };
  waypointAnalysis.neighborCountsByIndex[cellIndex] = counts;
  return counts;
}

function getWaypointAnalysis(runtime, state, aiContext) {
  runtime.waypointAnalysis ??= createWaypointAnalysisContext(state, aiContext, runtime);
  return runtime.waypointAnalysis;
}

function createWaypointAnalysisContext(state, aiContext, runtime = null) {
  const ownedCells = runtime?.territory.ownedCells ?? [];
  const nonOwnedCells = runtime?.territory.nonOwnedCells ?? state.territory.cells.filter((cell) => cell.ownerId !== aiContext.playerId);
  const waypointAnalysis = {
    ownedCells,
    nonOwnedCells,
    strategicCandidateCells: [],
    pressureCandidateCells: [],
    cellPresenceByIndex: state.territory.cells.map(() => ({
      own: 0,
      enemy: 0,
      enemyStructure: 0
    })),
    neighborCountsByIndex: new Array(state.territory.cells.length),
    frontierReachByIndex: new Array(state.territory.cells.length),
    opportunityRegionScoreByIndex: new Array(state.territory.cells.length),
    cellMetricsByIndex: new Array(state.territory.cells.length),
    ownedAnchorByPoint: new Map(),
    pressureTargetPoint: undefined,
    expansionTargets: null
  };
  const cellPresenceByIndex = waypointAnalysis.cellPresenceByIndex;
  const unitRadius = state.territory.cellSize * 1.75;
  const structureRadius = state.territory.cellSize * 2.75;

  for (const entity of runtime?.aiUnits ?? getOwnedUnits(state, aiContext.playerId)) {
    if (entity.health <= 0) {
      continue;
    }

    applyPresenceToCells(state, entity, unitRadius, (presence, distance) => {
      presence.own += 1 - distance / unitRadius;
    }, cellPresenceByIndex);
  }

  for (const entity of runtime?.enemyUnits ?? getOwnedUnits(state, aiContext.opponentPlayerId)) {
    if (entity.health <= 0) {
      continue;
    }

    applyPresenceToCells(state, entity, unitRadius, (presence, distance) => {
      presence.enemy += 1 - distance / unitRadius;
    }, cellPresenceByIndex);
  }

  for (const entity of runtime?.enemyConstructedBuildings ?? getOwnedBuildings(state, aiContext.opponentPlayerId)) {
    if (entity.type !== "building" || entity.ownerId !== aiContext.opponentPlayerId || !entity.isConstructed) {
      continue;
    }

    applyPresenceToCells(state, entity, structureRadius, (presence, distance) => {
      presence.enemyStructure += 1 - distance / structureRadius;
    }, cellPresenceByIndex);
  }

  for (const presence of cellPresenceByIndex) {
    presence.own = clamp01(presence.own);
    presence.enemy = clamp01(presence.enemy);
    presence.enemyStructure = clamp01(presence.enemyStructure);
  }

  buildStrategicWaypointCandidateSets(state, aiContext, runtime, waypointAnalysis);
  return waypointAnalysis;
}

function applyPresenceToCells(state, point, radius, assignContribution, cellPresenceByIndex) {
  const minColumn = clamp(Math.floor((point.x - radius) / state.territory.cellSize), 0, state.territory.columns - 1);
  const maxColumn = clamp(Math.floor((point.x + radius) / state.territory.cellSize), 0, state.territory.columns - 1);
  const minRow = clamp(Math.floor((point.y - radius) / state.territory.cellSize), 0, state.territory.rows - 1);
  const maxRow = clamp(Math.floor((point.y + radius) / state.territory.cellSize), 0, state.territory.rows - 1);

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const cellIndex = row * state.territory.columns + column;
      const cell = state.territory.cells[cellIndex];
      const distance = Math.hypot(point.x - cell.centerX, point.y - cell.centerY);
      if (distance > radius) {
        continue;
      }

      assignContribution(cellPresenceByIndex[cellIndex], distance);
    }
  }
}

function buildStrategicWaypointCandidateSets(state, aiContext, runtime, waypointAnalysis) {
  const aiBase = runtime?.aiBase ?? null;
  const enemyBase = runtime?.enemyBase ?? null;
  const strategicCandidateCells = [];
  const pressureCandidateCells = [];

  for (const cell of waypointAnalysis.nonOwnedCells) {
    const neighborCounts = getNeighborOwnershipCounts(state, aiContext, cell, waypointAnalysis);
    const adjacentToOwned = neighborCounts.own > 0;
    const adjacentToEnemy = neighborCounts.enemy > 0;
    const forwardProgressRatio = getForwardProgressRatio(aiBase, enemyBase, cell);
    const flankOffsetRatio = getFlankOffsetRatio(aiBase, enemyBase, cell);
    const inStrategicCorridor =
      forwardProgressRatio >= 0.08 &&
      forwardProgressRatio <= 0.92 &&
      flankOffsetRatio <= 0.42;
    const activeControl = Math.abs(cell.control) >= 0.08;
    const enemyOwned = cell.ownerId === aiContext.opponentPlayerId;
    const candidateForExpansion = adjacentToOwned || (inStrategicCorridor && (activeControl || enemyOwned));
    if (candidateForExpansion) {
      strategicCandidateCells.push(cell);
    }

    const candidateForPressure =
      adjacentToOwned &&
      !(
        cell.ownerId === null &&
        Math.abs(cell.control) < 0.12 &&
        !adjacentToEnemy
      );
    if (candidateForPressure) {
      pressureCandidateCells.push(cell);
    }
  }

  waypointAnalysis.strategicCandidateCells = strategicCandidateCells.length > 0
    ? strategicCandidateCells
    : waypointAnalysis.nonOwnedCells;
  waypointAnalysis.pressureCandidateCells = pressureCandidateCells.length > 0
    ? pressureCandidateCells
    : waypointAnalysis.strategicCandidateCells;
}

function prioritizeExpansionLaneSides(candidates) {
  const bestBySide = new Map();

  for (const candidate of candidates) {
    const sideKey = candidate.sideSign;
    const currentBest = bestBySide.get(sideKey);
    if (!currentBest || candidate.score > currentBest.score) {
      bestBySide.set(sideKey, candidate);
    }
  }

  const prioritized = [];
  const centerCandidate = bestBySide.get(0);
  if (centerCandidate) {
    prioritized.push(centerCandidate);
  }

  const nonZeroSideCandidates = [...bestBySide.entries()]
    .filter(([sideKey]) => sideKey !== 0)
    .map(([, candidate]) => candidate)
    .sort((left, right) => right.score - left.score);
  prioritized.push(...nonZeroSideCandidates);

  const usedCandidates = new Set(prioritized);

  for (const candidate of candidates) {
    if (usedCandidates.has(candidate)) {
      continue;
    }

    prioritized.push(candidate);
  }

  return prioritized;
}

function filterCenterlineExpansionCandidates(candidates) {
  return candidates;
}

function getLaneSideSign(aiBase, enemyBase, point) {
  if (!aiBase || !enemyBase || !point) {
    return 0;
  }

  const axisX = enemyBase.x - aiBase.x;
  const axisY = enemyBase.y - aiBase.y;
  const axisLength = Math.hypot(axisX, axisY);
  if (axisLength === 0) {
    return 0;
  }

  const perpendicularX = -axisY / axisLength;
  const perpendicularY = axisX / axisLength;
  const lateralOffset =
    (point.x - aiBase.x) * perpendicularX +
    (point.y - aiBase.y) * perpendicularY;

  if (Math.abs(lateralOffset) < 12) {
    return 0;
  }

  return lateralOffset > 0 ? 1 : -1;
}

function getFlankOffsetRatio(aiBase, enemyBase, point) {
  if (!aiBase || !enemyBase || !point) {
    return 0;
  }

  const axisX = enemyBase.x - aiBase.x;
  const axisY = enemyBase.y - aiBase.y;
  const axisLength = Math.hypot(axisX, axisY);
  if (axisLength === 0) {
    return 0;
  }

  const perpendicularX = -axisY / axisLength;
  const perpendicularY = axisX / axisLength;
  const lateralOffset =
    Math.abs((point.x - aiBase.x) * perpendicularX + (point.y - aiBase.y) * perpendicularY);

  return clamp01(lateralOffset / (statefulCellDistance(aiBase, enemyBase) * 0.35));
}

function getOuterLaneRatio(state, point) {
  const distanceToNearestHorizontalEdge = Math.min(point.centerY ?? point.y, state.map.height - (point.centerY ?? point.y));
  return 1 - clamp01(distanceToNearestHorizontalEdge / (state.map.height * 0.35));
}

function getOuterLaneRatioFromPoint(state, point) {
  if (!state?.map || !point) {
    return 0;
  }

  const mapHeight = state.map.height;
  const y = point.centerY ?? point.y;
  const distanceToNearestHorizontalEdge = Math.min(y, mapHeight - y);
  return 1 - clamp01(distanceToNearestHorizontalEdge / (mapHeight * 0.35));
}

function getMapEdgePenaltyRatio(state, point) {
  if (!state?.map || !point) {
    return 0;
  }

  const x = point.centerX ?? point.x;
  const y = point.centerY ?? point.y;
  const distanceToNearestEdge = Math.min(
    x,
    y,
    state.map.width - x,
    state.map.height - y
  );
  const safeBand = Math.min(state.map.width, state.map.height) * 0.18;
  return 1 - clamp01(distanceToNearestEdge / safeBand);
}

function getPointEdgeClearance(state, point) {
  if (!state?.map || !point) {
    return Number.POSITIVE_INFINITY;
  }

  const x = point.centerX ?? point.x;
  const y = point.centerY ?? point.y;
  return Math.min(
    x,
    y,
    state.map.width - x,
    state.map.height - y
  );
}

function getForwardProgressRatio(aiBase, enemyBase, point) {
  if (!aiBase || !enemyBase || !point) {
    return 0;
  }

  const axisX = enemyBase.x - aiBase.x;
  const axisY = enemyBase.y - aiBase.y;
  const axisLength = Math.hypot(axisX, axisY);
  if (axisLength === 0) {
    return 0;
  }

  const forwardProgress =
    ((point.x - aiBase.x) * axisX + (point.y - aiBase.y) * axisY) / (axisLength * axisLength);

  return clamp01(forwardProgress);
}

function getProgressBandRatio(forwardProgressRatio) {
  const idealProgress = 0.34;
  const allowedDeviation = 0.22;
  return clamp01(1 - Math.abs(forwardProgressRatio - idealProgress) / allowedDeviation);
}

function statefulCellDistance(aiBase, enemyBase) {
  return Math.max(1, Math.hypot(enemyBase.x - aiBase.x, enemyBase.y - aiBase.y));
}

function getOpponentPlayerId(state, playerId) {
  return state.players.find((player) => player.id !== playerId)?.id ?? null;
}

function hasConstructedBuildingKind(state, playerId, kind) {
  return getOwnedBuildings(state, playerId, kind).some((building) => building.isConstructed);
}

function randomRange([min, max]) {
  return min + Math.random() * (max - min);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
