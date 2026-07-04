import {
  canResearchTech,
  canUpgradeBase,
  canUpgradeTech
} from "../../gameState.js";
import { traceAiEvent } from "../../debug/aiTrace.js";
import { getGameplayCommandTypes, queueGameplayCommand } from "../../gameplayCommands.js";
import {
  getBuildingCost,
  getResearchCost,
  getProducedUnitId,
  isBuildingUnlocked,
  isProductionKindUnlocked
} from "../../rules/catalogRules.js";
import { getBaseUpgradeCostPerSecond } from "../baseUpgrades.js";
import { evaluateBuildPointOpportunity, getSuggestedBuildPoint } from "../construction.js";
import { getUnitProductionCostPerSecond } from "../production.js";
import { getResearchCostPerSecond } from "../research.js";
import { getTechUpgradeCostPerSecond } from "../techUpgrades.js";

const MAX_TECH_STRUCTURES = 1;
const MACRO_PIPELINE_STAGES = {
  CORE_POINT: 0,
  TECH_POINT: 1,
  ADVANCED_POINT: 2,
  EXECUTE: 3
};

export function advanceStrategicActionPipeline(state, aiContext, aiPlayer, aiState, snapshot) {
  aiState.macroActionPipeline ??= createMacroActionPipeline(state, aiContext, aiPlayer, aiState, snapshot);
  const pipeline = aiState.macroActionPipeline;

  if (pipeline.stage === MACRO_PIPELINE_STAGES.CORE_POINT) {
    pipeline.coreBuildingId = pipeline.coreCount < pipeline.desiredCoreCount
      ? chooseProductionBuildingId(state, aiContext.playerId, snapshot, "core_production")
      : null;
    pipeline.corePoint = pipeline.coreBuildingId
      ? getSuggestedBuildPoint(state, aiContext.playerId, pipeline.coreBuildingId, snapshot.runtime.buildPlanning)
      : null;
    pipeline.stage = MACRO_PIPELINE_STAGES.TECH_POINT;
    return false;
  }

  if (pipeline.stage === MACRO_PIPELINE_STAGES.TECH_POINT) {
    pipeline.techPoint = pipeline.techCount < pipeline.desiredTechCenterCount
      ? getSuggestedBuildPoint(state, aiContext.playerId, "tech_nexus", snapshot.runtime.buildPlanning)
      : null;
    pipeline.stage = MACRO_PIPELINE_STAGES.ADVANCED_POINT;
    return false;
  }

  if (pipeline.stage === MACRO_PIPELINE_STAGES.ADVANCED_POINT) {
    pipeline.advancedBuildingId = pipeline.advancedCount < pipeline.desiredAdvancedCount
      ? chooseProductionBuildingId(state, aiContext.playerId, snapshot, "advanced_production")
      : null;
    pipeline.advancedPoint = pipeline.advancedBuildingId
      ? getSuggestedBuildPoint(state, aiContext.playerId, pipeline.advancedBuildingId, snapshot.runtime.buildPlanning)
      : null;
    pipeline.stage = MACRO_PIPELINE_STAGES.EXECUTE;
    return false;
  }

  const actions = getStrategicActions(state, aiContext, aiPlayer, aiState, snapshot, pipeline)
    .filter((action) => action.score > 0)
    .sort((left, right) => right.score - left.score);
  aiState.macroActionPipeline = null;

  if (actions.length === 0) {
    return false;
  }

  return actions[0].execute();
}

function createMacroActionPipeline(state, aiContext, aiPlayer, aiState, snapshot) {
  return {
    stage: MACRO_PIPELINE_STAGES.CORE_POINT,
    desiredReserve: getDesiredReserve(aiState, snapshot),
    coreCount: snapshot.production.coreBuildings.length,
    techCount: snapshot.production.techStructures.length,
    advancedCount: snapshot.production.advancedBuildings.length,
    nextBaseTier: state.catalog.baseTiers[aiPlayer.baseTier + 1] ?? null,
    nextTechTier: state.catalog.techTiers[aiPlayer.techTier + 1] ?? null,
    desiredCoreCount: getDesiredCoreProductionCount(state, aiContext, aiState, snapshot),
    desiredTechCenterCount: getDesiredTechCenterCount(state, aiState, snapshot),
    desiredAdvancedCount: getDesiredAdvancedProductionCount(state, aiContext, aiState, snapshot),
    coreBuildingId: null,
    advancedBuildingId: null,
    corePoint: null,
    techPoint: null,
    advancedPoint: null
  };
}

function getStrategicActions(state, aiContext, aiPlayer, aiState, snapshot, pipeline) {
  const actions = [];
  const candidateSummaries = [];
  const rejectedCandidates = [];
  const desiredReserve = pipeline.desiredReserve;
  const coreCount = pipeline.coreCount;
  const techCount = pipeline.techCount;
  const advancedCount = pipeline.advancedCount;
  const nextBaseTier = pipeline.nextBaseTier;
  const nextTechTier = pipeline.nextTechTier;
  const desiredCoreCount = pipeline.desiredCoreCount;
  const desiredTechCenterCount = pipeline.desiredTechCenterCount;
  const desiredAdvancedCount = pipeline.desiredAdvancedCount;
  const coreBuildingId = pipeline.coreBuildingId;
  const advancedBuildingId = pipeline.advancedBuildingId;
  const corePoint = pipeline.corePoint;
  const techPoint = pipeline.techPoint;
  const advancedPoint = pipeline.advancedPoint;

  if (
    coreCount < desiredCoreCount &&
    coreBuildingId &&
    corePoint
  ) {
    const investment = evaluateProductionBuildingInvestment(
      state,
      aiContext,
      aiPlayer,
      aiState,
      snapshot,
      coreBuildingId,
      corePoint,
      desiredReserve
    );
    if (investment.approved) {
      const timingReadiness = getTimingReadiness(state.matchTimeSeconds, aiState.coreExpansionTargetTime);
      const score =
        aiState.actionWeights.build_core * 0.45 +
        snapshot.needs.economy * aiState.economyBias * 0.9 +
        snapshot.needs.expansion * aiState.expansionBias * 1.05 +
        snapshot.needs.pressure * aiState.pressureBias * 0.2 +
        timingReadiness * 0.4 +
        investment.score * 0.18 -
        coreCount * 0.35;
      actions.push({
        id: "build_core",
        score,
        execute: () => tryPlaceSuggestedBuilding(state, aiContext, coreBuildingId, corePoint)
      });
    } else {
      pushRejectedCandidate(rejectedCandidates, "build_core", investment);
    }
    candidateSummaries.push({
      id: "build_core",
      score: getMacroCandidateDisplayScore(
        investment.approved
          ? actions[actions.length - 1]?.score ?? investment.score
          : investment.score
      ),
      investment: investment.summary,
      approved: investment.approved
    });
  }

  if (
    techCount < desiredTechCenterCount &&
    techPoint
  ) {
    const investment = evaluateInfrastructureBuildingInvestment(
      state,
      aiContext,
      aiPlayer,
      aiState,
      snapshot,
      "tech_nexus",
      techPoint,
      desiredReserve
    );
    if (investment.approved) {
      const timingReadiness = getTimingReadiness(state.matchTimeSeconds, aiState.techTargetTime);
      const score =
        aiState.actionWeights.build_tech * 0.52 +
        snapshot.needs.tech * aiState.techBias * 1.18 +
        snapshot.needs.counterComposition * 0.42 +
        timingReadiness * 0.62 +
        snapshot.production.coreBuildings.length * 0.08 +
        investment.score * 0.14;
      actions.push({
        id: "build_tech",
        score,
        execute: () => tryPlaceSuggestedBuilding(state, aiContext, "tech_nexus", techPoint)
      });
    } else {
      pushRejectedCandidate(rejectedCandidates, "build_tech", investment);
    }
    candidateSummaries.push({
      id: "build_tech",
      score: getMacroCandidateDisplayScore(
        investment.approved
          ? actions[actions.length - 1]?.score ?? investment.score
          : investment.score
      ),
      investment: investment.summary,
      approved: investment.approved
    });
  }

  if (
    nextTechTier &&
    canUpgradeTech(state, aiContext.playerId)
  ) {
    const investment = evaluateTimedCommitmentInvestment(
      state,
      aiPlayer,
      aiState,
      snapshot,
      {
        id: `upgrade_tech:${nextTechTier.tier}`,
        costPerSecond: getTechUpgradeCostPerSecond(nextTechTier),
        durationSeconds: nextTechTier.upgradeTime,
        desiredReserve,
        strategicValue:
          snapshot.needs.tech * aiState.techBias * 1.16 +
          snapshot.needs.advancedProduction * aiState.techBias * 0.88 +
          snapshot.needs.counterComposition * 0.45,
        riskPenalty: snapshot.needs.defense * 0.28
      }
    );
    if (investment.approved) {
      const targetTime = nextTechTier.tier === 2 ? aiState.techTargetTime : aiState.advancedTargetTime;
      const timingReadiness = getTimingReadiness(state.matchTimeSeconds, targetTime);
      const score =
        aiState.actionWeights.build_tech * 0.3 +
        aiState.actionWeights.upgrade_base * 0.22 +
        snapshot.needs.tech * aiState.techBias * 1.16 +
        snapshot.needs.advancedProduction * aiState.techBias * 0.88 +
        snapshot.needs.counterComposition * 0.45 +
        timingReadiness * 0.72 +
        investment.score * 0.18;
      actions.push({
        id: `upgrade_tech:${nextTechTier.tier}`,
        score,
        execute: () => {
          queueGameplayCommand(state, {
            type: getGameplayCommandTypes().START_TECH_UPGRADE,
            playerId: aiContext.playerId
          });
          return true;
        }
      });
    } else {
      pushRejectedCandidate(rejectedCandidates, `upgrade_tech:${nextTechTier.tier}`, investment);
    }
    candidateSummaries.push({
      id: `upgrade_tech:${nextTechTier.tier}`,
      score: getMacroCandidateDisplayScore(
        investment.approved
          ? actions[actions.length - 1]?.score ?? investment.score
          : investment.score
      ),
      investment: investment.summary,
      approved: investment.approved
    });
  }

  if (
    nextBaseTier &&
    canUpgradeBase(state, aiContext.playerId)
  ) {
    const investment = evaluateTimedCommitmentInvestment(
      state,
      aiPlayer,
      aiState,
      snapshot,
      {
        id: `upgrade_base:${nextBaseTier.tier}`,
        costPerSecond: getBaseUpgradeCostPerSecond(nextBaseTier),
        durationSeconds: nextBaseTier.upgradeTime,
        desiredReserve,
        strategicValue:
          snapshot.needs.defense * aiState.defenseBias * 0.74 +
          snapshot.needs.pressure * aiState.pressureBias * 0.3 +
          aiState.baseForwardBias * 0.18,
        riskPenalty: snapshot.needs.economy * 0.22
      }
    );
    if (investment.approved) {
      const targetTime = nextBaseTier.tier === 2 ? aiState.coreExpansionTargetTime : aiState.advancedTargetTime;
      const timingReadiness = getTimingReadiness(state.matchTimeSeconds, targetTime);
      const score =
        aiState.actionWeights.upgrade_base * 0.5 +
        snapshot.needs.defense * aiState.defenseBias * 0.74 +
        snapshot.needs.pressure * aiState.pressureBias * 0.3 +
        aiState.baseForwardBias * 0.18 +
        timingReadiness * 0.62 +
        investment.score * 0.18;
      actions.push({
        id: `upgrade_base:${nextBaseTier.tier}`,
        score,
        execute: () => {
          queueGameplayCommand(state, {
            type: getGameplayCommandTypes().START_BASE_UPGRADE,
            playerId: aiContext.playerId
          });
          return true;
        }
      });
    } else {
      pushRejectedCandidate(rejectedCandidates, `upgrade_base:${nextBaseTier.tier}`, investment);
    }
    candidateSummaries.push({
      id: `upgrade_base:${nextBaseTier.tier}`,
      score: getMacroCandidateDisplayScore(
        investment.approved
          ? actions[actions.length - 1]?.score ?? investment.score
          : investment.score
      ),
      investment: investment.summary,
      approved: investment.approved
    });
  }

  if (
    desiredAdvancedCount > 0 &&
    advancedCount < desiredAdvancedCount &&
    advancedBuildingId &&
    advancedPoint
  ) {
    const investment = evaluateProductionBuildingInvestment(
      state,
      aiContext,
      aiPlayer,
      aiState,
      snapshot,
      advancedBuildingId,
      advancedPoint,
      desiredReserve
    );
    if (investment.approved) {
      const timingReadiness = getTimingReadiness(state.matchTimeSeconds, aiState.advancedTargetTime);
      const score =
        aiState.actionWeights.build_advanced * 0.45 +
        snapshot.needs.advancedProduction * aiState.techBias * 1.05 +
        snapshot.needs.counterComposition * 0.45 +
        timingReadiness * 0.35 +
        investment.score * 0.16;
      actions.push({
        id: "build_advanced",
        score,
        execute: () => tryPlaceSuggestedBuilding(state, aiContext, advancedBuildingId, advancedPoint)
      });
    } else {
      pushRejectedCandidate(rejectedCandidates, "build_advanced", investment);
    }
    candidateSummaries.push({
      id: "build_advanced",
      score: getMacroCandidateDisplayScore(
        investment.approved
          ? actions[actions.length - 1]?.score ?? investment.score
          : investment.score
      ),
      investment: investment.summary,
      approved: investment.approved
    });
  }

  for (const techId of aiState.researchPlan) {
    if (!canResearchTech(state, aiContext.playerId, techId)) {
      continue;
    }

    const investment = evaluateTimedCommitmentInvestment(
      state,
      aiPlayer,
      aiState,
      snapshot,
      {
        id: `research:${techId}`,
        costPerSecond: getResearchCostPerSecond(state.catalog.tech[techId], getResearchCost(state, aiContext.playerId, techId)),
        durationSeconds: state.catalog.tech[techId].researchTime,
        desiredReserve,
        strategicValue: getResearchNeedScore(aiState, snapshot, techId) + getResearchPlanBias(aiState, techId) * 0.28,
        riskPenalty: snapshot.needs.economy * 0.18
      }
    );
    if (investment.approved) {
      const score = scoreResearchAction(state, aiState, snapshot, techId) + investment.score * 0.16;
      actions.push({
        id: `research:${techId}`,
        score,
        execute: () => {
          queueGameplayCommand(state, {
            type: getGameplayCommandTypes().START_RESEARCH,
            playerId: aiContext.playerId,
            techId
          });
          return true;
        }
      });
      candidateSummaries.push({ id: `research:${techId}`, score, investment: investment.summary, approved: true });
    } else {
      pushRejectedCandidate(rejectedCandidates, `research:${techId}`, investment);
      candidateSummaries.push({
        id: `research:${techId}`,
        score: getMacroCandidateDisplayScore(investment.score),
        investment: investment.summary,
        approved: false
      });
    }
  }

  candidateSummaries.sort((left, right) => {
    const approvalDelta = Number(!!right.approved) - Number(!!left.approved);
    if (approvalDelta !== 0) {
      return approvalDelta;
    }

    return right.score - left.score;
  });
  rejectedCandidates.sort((left, right) => right.score - left.score);
  aiState.debugMacroDecision = {
    lastUpdatedAtSeconds: state.matchTimeSeconds,
    topCandidate: candidateSummaries[0] ?? null,
    topRejected: rejectedCandidates[0] ?? null
  };
  traceMacroDecision(state, aiContext.playerId, aiState.debugMacroDecision);
  traceMacroAudit(state, aiContext.playerId, aiPlayer, aiState, snapshot, pipeline, candidateSummaries, rejectedCandidates);

  return actions;
}

function scoreResearchAction(state, aiState, snapshot, techId) {
  const planBias = getResearchPlanBias(aiState, techId);
  const timingMultiplier = 0.45 + getTimingReadiness(state.matchTimeSeconds, aiState.techTargetTime) * 0.55;

  let score = aiState.actionWeights.research * 0.4 + planBias * 0.28;
  score += getResearchNeedScore(aiState, snapshot, techId);

  if (snapshot.composition.missingCounterTechIds.includes(techId)) {
    score += 0.55;
  }

  return score * timingMultiplier;
}

export function getDesiredReserve(aiState, snapshot) {
  const pressureAdjustment = 1 - (aiState.riskTolerance - 1) * 0.55;
  const defenseAdjustment = 1 + snapshot.needs.defense * 0.25;
  const incomeAdjustment = Math.max(0.45, 1 - snapshot.economy.incomePerSecond / 24);
  return Math.max(6, aiState.strategicReserve * pressureAdjustment * defenseAdjustment * incomeAdjustment);
}

function getDesiredCoreProductionCount(state, aiContext, aiState, snapshot) {
  let desired = 1;

  if (
    snapshot.needs.expansion * aiState.expansionBias + snapshot.needs.economy * aiState.economyBias > 0.72 ||
    state.matchTimeSeconds >= aiState.coreExpansionTargetTime * 0.92
  ) {
    desired = 2;
  }

  if (
    desired === 2 &&
    snapshot.needs.pressure * aiState.pressureBias > 0.64 &&
    snapshot.economy.incomePerSecond >= 7.5 &&
    snapshot.territory.ownCount >= snapshot.territory.enemyCount
  ) {
    desired = 3;
  }

  if (snapshot.needs.defense * aiState.defenseBias >= 0.72) {
    desired = Math.min(desired, Math.max(1, snapshot.production.coreBuildings.length + 1));
  }

  desired += Math.max(0, Math.floor((state.matchTimeSeconds - aiState.coreExpansionTargetTime * 1.25) / 110));

  const supportableCount = getSupportableProductionCount(
    state,
    aiContext.playerId,
    "core_production",
    snapshot.economy.incomePerSecond,
    aiState.targetNetIncome,
    snapshot.needs.expansion
  );

  return Math.min(desired, supportableCount);
}

function getDesiredTechCenterCount(state, aiState, snapshot) {
  if (
    snapshot.needs.tech * aiState.techBias >= 0.24 ||
    snapshot.needs.counterComposition >= 0.28 ||
    snapshot.production.coreBuildings.length >= 2 ||
    state.matchTimeSeconds >= aiState.techTargetTime * 0.72
  ) {
    return MAX_TECH_STRUCTURES;
  }

  return 0;
}

function getDesiredAdvancedProductionCount(state, aiContext, aiState, snapshot) {
  if (!isProductionKindUnlocked(state, aiContext.playerId, "advanced_production")) {
    return 0;
  }

  let desired = 0;
  if (
    snapshot.needs.advancedProduction * aiState.techBias >= 0.38 ||
    snapshot.needs.counterComposition >= 0.4 ||
    state.matchTimeSeconds >= aiState.advancedTargetTime * 0.88
  ) {
    desired = 1;
  }

  if (desired > 0) {
    desired += Math.max(0, Math.floor((state.matchTimeSeconds - aiState.advancedTargetTime * 0.9) / 130));
  }

  const supportableCount = getSupportableProductionCount(
    state,
    aiContext.playerId,
    "advanced_production",
    snapshot.economy.incomePerSecond,
    aiState.targetNetIncome,
    snapshot.needs.pressure
  );

  return Math.min(desired, supportableCount);
}

function getSupportableProductionCount(state, playerId, kind, incomePerSecond, targetNetIncome, expansionPressure = 0) {
  const spendPerSecond = getAverageProductionSpendPerSecond(state, playerId, kind);
  if (spendPerSecond <= 0) {
    return 1;
  }

  const reservedNet = Math.max(-0.5, targetNetIncome);
  const productiveIncome = Math.max(0, incomePerSecond - reservedNet);
  const supportableFromIncome = 1 + Math.floor(productiveIncome / spendPerSecond);
  const pressureBuffer = expansionPressure >= 0.72 ? 1 : 0;

  return Math.max(1, supportableFromIncome + pressureBuffer);
}

function getAverageProductionSpendPerSecond(state, playerId, kind) {
  const spendRates = state.catalog.buildingDefinitions
    .filter((definition) => definition.kind === kind && isBuildingUnlocked(state, playerId, definition.id))
    .map((definition) => {
      const producedUnitId = getProducedUnitId(definition);
      const unitDefinition = producedUnitId ? state.catalog.units[producedUnitId] : null;
      return unitDefinition ? getUnitProductionCostPerSecond(definition, unitDefinition) : 0;
    })
    .filter((value) => value > 0);

  if (spendRates.length === 0) {
    return 0;
  }

  return spendRates.reduce((sum, value) => sum + value, 0) / spendRates.length;
}

function evaluateProductionBuildingInvestment(
  state,
  aiContext,
  aiPlayer,
  aiState,
  snapshot,
  buildingId,
  point,
  desiredReserve
) {
  const definition = state.catalog.buildings[buildingId];
  const producedUnitId = getProducedUnitId(definition);
  if (!producedUnitId) {
    return {
      approved: false,
      score: Number.NEGATIVE_INFINITY,
      reason: "no produced unit",
      summary: null
    };
  }

  const buildCost = getBuildingCost(state, aiContext.playerId, buildingId);
  const unitDefinition = state.catalog.units[producedUnitId];
  const buildTime = Math.max(0.1, definition.buildTime);
  const constructionSpendPerSecond = buildCost / buildTime;
  const productionSpendPerSecond = getUnitProductionCostPerSecond(definition, unitDefinition);
  const analysis = evaluateBuildPointOpportunity(state, aiContext.playerId, buildingId, point);
  const expectedIncomeLift = estimateBuildPointIncomeLift(state, analysis);
  const currentNetIncome = snapshot.economy.netIncomePerSecond;
  const rampNetIncome = currentNetIncome - constructionSpendPerSecond;
  const steadyStateNetIncome = currentNetIncome - productionSpendPerSecond + expectedIncomeLift;
  const baseSustainFloor = Math.max(
    aiState.targetNetIncome,
    snapshot.needs.defense * 0.6 + snapshot.needs.economy * 0.45 - 0.25
  );
  const availableRunwayResources = Math.max(0, aiPlayer.resources - Math.min(desiredReserve * 0.35, buildCost * 0.2));
  const rampRunwaySeconds = getRunwaySeconds(availableRunwayResources, rampNetIncome);
  const steadyStateRunwaySeconds = getRunwaySeconds(availableRunwayResources, steadyStateNetIncome);
  const siteRisk = analysis.risk.enemyUnitPressure * 1.2 +
    analysis.risk.enemyBuildingPressure * 0.9 +
    analysis.risk.contestedControl * 0.45 +
    analysis.risk.frontlineExposure * 0.35;
  const opportunityStrength = getExpansionOpportunityStrength(state, snapshot, analysis, expectedIncomeLift);
  const sustainFloor = getInvestmentSustainFloor(
    state,
    aiState,
    snapshot,
    baseSustainFloor,
    opportunityStrength,
    siteRisk
  );
  const breakEvenGap = Math.max(0, sustainFloor - steadyStateNetIncome);
  const breakEvenPressure = breakEvenGap / Math.max(0.25, expectedIncomeLift + 0.35);
  const score =
    expectedIncomeLift * 2.2 +
    Math.min(rampRunwaySeconds, 45) * 0.055 +
    Math.min(steadyStateRunwaySeconds, 60) * 0.04 +
    opportunityStrength * 0.95 +
    Math.max(0, steadyStateNetIncome) * 0.2 -
    breakEvenGap * 0.8 -
    breakEvenPressure * 0.7 -
    siteRisk * 0.9;
  const approved =
    !analysis.risk.imminentDanger &&
    rampRunwaySeconds >= buildTime + 1.5 &&
    (
      steadyStateNetIncome >= sustainFloor ||
      (
        expectedIncomeLift >= breakEvenGap * 0.28 &&
        steadyStateRunwaySeconds >= getMinimumInvestmentRunwaySeconds(state, aiState, opportunityStrength, siteRisk)
      ) ||
      (
        definition.kind === "core_production" &&
        score > -0.15 &&
        (
          analysis.claim.claimableCells >= 16 ||
          analysis.risk.safeClaimableCells >= 10 ||
          snapshot.territory.neutralPercent >= 18
        )
      ) ||
      (
        aiPlayer.resources >= buildCost * 2.2 &&
        score > 0.1
      )
    ) &&
    score > -0.55;
  const reason = approved
    ? null
    : getInvestmentRejectionReason({
        analysis,
        rampRunwaySeconds,
        buildTime,
        steadyStateNetIncome,
        sustainFloor,
        expectedIncomeLift,
        breakEvenGap,
        steadyStateRunwaySeconds,
        minimumRunwaySeconds: getMinimumInvestmentRunwaySeconds(state, aiState, opportunityStrength, siteRisk),
        score
      });

  return {
    approved,
    score,
    reason,
    summary: {
      buildCost,
      buildTime,
      expectedIncomeLift,
      rampRunwaySeconds,
      steadyStateRunwaySeconds,
      steadyStateNetIncome,
      sustainFloor,
      score,
      claimableCells: analysis.claim.claimableCells,
      richCells: analysis.risk.richClaimCount,
      enemyUnitPressure: analysis.risk.enemyUnitPressure,
      contestedControl: analysis.risk.contestedControl,
      imminentDanger: analysis.risk.imminentDanger
    }
  };
}

function pushRejectedCandidate(rejectedCandidates, id, investment) {
  if (!investment.reason) {
    return;
  }

  rejectedCandidates.push({
    id,
    score: Number.isFinite(investment.score) ? investment.score : -999,
    reason: investment.reason,
    investment: investment.summary
  });
}

function getMacroCandidateDisplayScore(score) {
  if (!Number.isFinite(score)) {
    return -999;
  }

  return score;
}

function getInvestmentRejectionReason(context) {
  if (context.analysis.risk.imminentDanger) {
    return "imminent danger";
  }

  if (context.rampRunwaySeconds < context.buildTime + 3) {
    return "insufficient ramp runway";
  }

  if (context.steadyStateNetIncome >= context.sustainFloor) {
    return "score too low";
  }

  if (context.expectedIncomeLift < context.breakEvenGap * 0.55) {
    return "income lift too low";
  }

  if (context.steadyStateRunwaySeconds < context.minimumRunwaySeconds) {
    return "insufficient steady runway";
  }

  return "steady-state too negative";
}

function evaluateInfrastructureBuildingInvestment(
  state,
  aiContext,
  aiPlayer,
  aiState,
  snapshot,
  buildingId,
  point,
  desiredReserve
) {
  const definition = state.catalog.buildings[buildingId];
  const buildCost = getBuildingCost(state, aiContext.playerId, buildingId);
  const buildTime = Math.max(0.1, definition.buildTime);
  const analysis = evaluateBuildPointOpportunity(state, aiContext.playerId, buildingId, point);
  const siteRisk = analysis.risk.enemyUnitPressure * 1.1 +
    analysis.risk.enemyBuildingPressure * 0.95 +
    analysis.risk.contestedControl * 0.5 +
    analysis.risk.frontlineExposure * 0.4;
  const strategicValue =
    snapshot.needs.tech * aiState.techBias * 1.18 +
    snapshot.needs.counterComposition * 0.42 +
    snapshot.production.coreBuildings.length * 0.08 +
    Math.max(0, 0.35 - snapshot.needs.economy * 0.2);

  return evaluateTimedCommitmentInvestment(state, aiPlayer, aiState, snapshot, {
    id: `build:${buildingId}`,
    costPerSecond: buildCost / buildTime,
    durationSeconds: buildTime,
    desiredReserve,
    strategicValue,
    riskPenalty: siteRisk,
    imminentDanger: analysis.risk.imminentDanger,
    extraSummary: {
      buildCost,
      buildTime,
      claimableCells: analysis.claim.claimableCells,
      contestedControl: analysis.risk.contestedControl,
      enemyUnitPressure: analysis.risk.enemyUnitPressure,
      imminentDanger: analysis.risk.imminentDanger
    }
  });
}

function evaluateTimedCommitmentInvestment(state, aiPlayer, aiState, snapshot, context) {
  const costPerSecond = Math.max(0, context.costPerSecond ?? 0);
  const durationSeconds = Math.max(0.1, context.durationSeconds ?? 0.1);
  const totalCommitmentCost = costPerSecond * durationSeconds;
  const desiredReserve = Math.max(0, context.desiredReserve ?? 0);
  const strategicValue = context.strategicValue ?? 0;
  const riskPenalty = context.riskPenalty ?? 0;
  const currentNetIncome = snapshot.economy.netIncomePerSecond;
  const projectedNetIncome = currentNetIncome - costPerSecond;
  const availableRunwayResources = Math.max(0, aiPlayer.resources - Math.min(desiredReserve * 0.55, costPerSecond * durationSeconds * 0.35));
  const runwaySeconds = getRunwaySeconds(availableRunwayResources, projectedNetIncome);
  const completionCoverageRatio = runwaySeconds / durationSeconds;
  const reserveCoverageRatio = availableRunwayResources / Math.max(1, totalCommitmentCost);
  const baseSustainFloor = Math.max(
    aiState.targetNetIncome,
    snapshot.needs.defense * 0.55 + snapshot.needs.economy * 0.5 - 0.2
  );
  const sustainFloor = Math.max(
    Math.max(-0.35, snapshot.needs.defense * 0.16 - 0.18),
    baseSustainFloor * (1 - clamp01(strategicValue / 4.5) * 0.4)
  );
  const commitmentPenalty = getActiveCommitmentLoad(snapshot, aiPlayer) * 0.42;
  const netGap = Math.max(0, sustainFloor - projectedNetIncome);
  const score =
    strategicValue * 1.05 +
    Math.min(2.5, completionCoverageRatio) * 1.15 +
    Math.min(1.75, reserveCoverageRatio) * 0.65 +
    Math.max(0, projectedNetIncome) * 0.1 -
    netGap * 0.2 -
    riskPenalty * 0.8 -
    commitmentPenalty * 0.55;
  const minimumRunwaySeconds = Math.max(
    durationSeconds * 0.95,
    8 + getCommitmentCaution(aiState) * 4 + riskPenalty * 1.2
  );
  const approved =
    !context.imminentDanger &&
    (
      runwaySeconds >= minimumRunwaySeconds ||
      (
        completionCoverageRatio >= 0.82 &&
        reserveCoverageRatio >= 0.9 &&
        strategicValue >= 1.75
      )
    ) &&
    score > -0.35;
  const reason = approved
    ? null
    : getTimedCommitmentRejectionReason({
        imminentDanger: !!context.imminentDanger,
        runwaySeconds,
        minimumRunwaySeconds,
        completionCoverageRatio,
        projectedNetIncome,
        sustainFloor,
        score
      });

  return {
    approved,
    score,
    reason,
    summary: {
      costPerSecond,
      durationSeconds,
      totalCommitmentCost,
      runwaySeconds,
      completionCoverageRatio,
      reserveCoverageRatio,
      projectedNetIncome,
      sustainFloor,
      strategicValue,
      riskPenalty,
      commitmentPenalty,
      score,
      ...(context.extraSummary ?? {})
    }
  };
}

function getActiveCommitmentLoad(snapshot, aiPlayer) {
  const allBuildings = snapshot.runtime.allBuildings ?? [];
  const pendingBuildings = allBuildings.filter((building) => !building.isConstructed);
  return pendingBuildings.length +
    Number(!!aiPlayer.activeBaseUpgrade) +
    Number(!!aiPlayer.activeTechUpgrade) +
    Number(!!aiPlayer.activeResearch);
}

function getTimedCommitmentRejectionReason(context) {
  if (context.imminentDanger) {
    return "imminent danger";
  }

  if (context.runwaySeconds < context.minimumRunwaySeconds) {
    return "insufficient runway";
  }

  if (context.completionCoverageRatio < 0.82) {
    return "insufficient completion coverage";
  }

  if (context.projectedNetIncome < context.sustainFloor && context.score < 0) {
    return "projected net too low";
  }

  return "score too low";
}

function estimateBuildPointIncomeLift(state, analysis) {
  const incomePerCell = state.territory.incomePerOwnedCell;
  const claim = analysis?.claim;
  const risk = analysis?.risk;
  if (!claim || !risk) {
    return 0;
  }

  const expectedOwnedCellGain = clampMin(
    Math.min(
      18,
      claim.claimableCells * 0.18 +
        claim.pressureScore * 0.24 +
        risk.safeClaimableCells * 0.38 +
        risk.richClaimCount * 0.92 -
        risk.enemyOwnedCells * 0.2 -
        risk.contestedControl * 0.7 -
        risk.enemyUnitPressure * 1.35 -
        risk.enemyBuildingPressure * 0.9
    ),
    0
  );

  return expectedOwnedCellGain * incomePerCell;
}

function getExpansionOpportunityStrength(state, snapshot, analysis, expectedIncomeLift) {
  const claim = analysis?.claim;
  const risk = analysis?.risk;
  if (!claim || !risk) {
    return 0;
  }

  const mapIncomeScalar = Math.max(0.01, state.territory.incomePerOwnedCell);
  const incomeLiftStrength = expectedIncomeLift / mapIncomeScalar;
  const claimStrength = claim.claimableCells * 0.18 + claim.pressureScore * 0.16 + risk.richClaimCount * 0.4;
  const dangerPenalty = risk.enemyUnitPressure * 1.5 + risk.enemyBuildingPressure + risk.contestedControl * 0.35;
  const earlyWindowBonus = clamp01(1 - state.matchTimeSeconds / 40) * 2.4;
  const expansionNeedBonus = snapshot.needs.expansion * 1.8;
  const pressurePenalty = snapshot.needs.defense * 1.35;

  return Math.max(
    0,
    incomeLiftStrength * 0.12 +
      claimStrength * 0.08 +
      earlyWindowBonus +
      expansionNeedBonus -
      dangerPenalty -
      pressurePenalty
  );
}

function getInvestmentSustainFloor(state, aiState, snapshot, baseSustainFloor, opportunityStrength, siteRisk) {
  const commitmentCaution = getCommitmentCaution(aiState);
  const earlyMatchLeniency = clamp01(1 - state.matchTimeSeconds / 45);
  const opportunityLeniency = clamp01(opportunityStrength / 3.2);
  const riskPenalty = clamp01(siteRisk / 2.2);
  const leniency = Math.max(0, earlyMatchLeniency * 0.55 + opportunityLeniency * 0.7 - riskPenalty * 0.45);
  const minimumFloor = Math.max(-0.5, snapshot.needs.defense * 0.18 - 0.24);
  const cautionAdjustedFloor = baseSustainFloor * (1 - leniency * (0.7 - commitmentCaution * 0.25));

  return Math.max(minimumFloor, cautionAdjustedFloor);
}

function getMinimumInvestmentRunwaySeconds(state, aiState, opportunityStrength, siteRisk) {
  const commitmentCaution = getCommitmentCaution(aiState);
  const earlyMatchLeniency = clamp01(1 - state.matchTimeSeconds / 40);
  const opportunityLeniency = clamp01(opportunityStrength / 3);
  const riskPenalty = clamp01(siteRisk / 2);
  const baseline = 10 + commitmentCaution * 7;
  const adjustment = earlyMatchLeniency * 5 + opportunityLeniency * 6 - riskPenalty * 5;

  return Math.max(5, baseline - adjustment);
}

function getRunwaySeconds(availableResources, netIncomePerSecond) {
  if (netIncomePerSecond >= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return availableResources / Math.max(0.1, -netIncomePerSecond);
}

function getResearchNeedScore(aiState, snapshot, techId) {
  if (techId.startsWith("basic_")) {
    return getBasicResearchScore(aiState, snapshot, techId);
  }

  if (techId.startsWith("swarm_")) {
    return getSwarmResearchScore(aiState, snapshot, techId);
  }

  if (techId.startsWith("ranged_")) {
    return getRangedResearchScore(aiState, snapshot, techId);
  }

  if (techId.startsWith("frontline_")) {
    return getFrontlineResearchScore(aiState, snapshot, techId);
  }

  if (techId.startsWith("anti_swarm_")) {
    return getAntiSwarmResearchScore(aiState, snapshot, techId);
  }

  if (techId.startsWith("anti_tank_")) {
    return getAntiTankResearchScore(aiState, snapshot, techId);
  }

  return 0;
}

function getBasicResearchScore(aiState, snapshot, techId) {
  let score =
    snapshot.needs.pressure * 0.16 +
    snapshot.needs.defense * 0.16 +
    snapshot.composition.ownComposition.frontline * 0.12;

  if (techId.includes("pressure")) {
    score += snapshot.needs.pressure * 0.3 + snapshot.needs.expansion * 0.18;
  } else if (techId.includes("line")) {
    score += snapshot.needs.defense * 0.3 + snapshot.composition.enemyComposition.ranged * 0.16;
  } else if (techId.includes("attack_cooldown")) {
    score += snapshot.needs.pressure * 0.18;
  } else if (techId.includes("health")) {
    score += snapshot.needs.defense * 0.2;
  }

  if (techId.includes("follow_up")) {
    score += 0.08;
  }

  return score;
}

function getSwarmResearchScore(aiState, snapshot, techId) {
  let score =
    snapshot.needs.expansion * aiState.expansionBias * 0.28 +
    snapshot.needs.pressure * aiState.pressureBias * 0.2 +
    snapshot.composition.ownComposition.swarm * 0.2;

  if (techId.includes("surround")) {
    score += snapshot.needs.pressure * 0.26 + snapshot.needs.expansion * 0.12;
  } else if (techId.includes("approach")) {
    score += snapshot.needs.defense * 0.2 + snapshot.composition.enemyComposition.ranged * 0.15;
  } else if (techId.includes("build_time")) {
    score += snapshot.needs.economy * 0.18 + snapshot.needs.pressure * 0.12;
  } else if (techId.includes("move_speed")) {
    score += snapshot.needs.expansion * 0.2;
  }

  if (techId.includes("follow_up")) {
    score += 0.08;
  }

  return score;
}

function getRangedResearchScore(aiState, snapshot, techId) {
  let score =
    snapshot.composition.enemyComposition.frontline * 0.22 +
    snapshot.composition.enemyComposition.durable * 0.18 +
    snapshot.needs.tech * 0.1;

  if (techId.includes("fire_lane")) {
    score += snapshot.needs.pressure * 0.28 + snapshot.composition.enemyComposition.frontline * 0.18;
  } else if (techId.includes("self_preservation")) {
    score += snapshot.needs.defense * 0.25 + snapshot.composition.enemyComposition.ranged * 0.14;
  } else if (techId.includes("attack_damage")) {
    score += snapshot.needs.pressure * 0.12;
  } else if (techId.includes("mobility")) {
    score += snapshot.needs.expansion * 0.12 + snapshot.needs.pressure * 0.1;
  }

  if (techId.includes("follow_up")) {
    score += 0.08;
  }

  return score;
}

function getFrontlineResearchScore(aiState, snapshot, techId) {
  let score =
    snapshot.needs.defense * 0.26 +
    snapshot.needs.pressure * 0.12 +
    (snapshot.production.producedUnitCounts.get("tanky_frontline") ?? 0) * 0.04;

  if (techId.includes("wall")) {
    score += snapshot.needs.defense * 0.28 + snapshot.composition.enemyComposition.ranged * 0.14;
  } else if (techId.includes("pressure")) {
    score += snapshot.needs.pressure * 0.26 + snapshot.composition.enemyComposition.frontline * 0.12;
  } else if (techId.includes("health")) {
    score += snapshot.needs.defense * 0.16;
  } else if (techId.includes("move_speed")) {
    score += snapshot.needs.pressure * 0.12 + snapshot.needs.expansion * 0.08;
  }

  if (techId.includes("follow_up")) {
    score += 0.08;
  }

  return score;
}

function getAntiSwarmResearchScore(aiState, snapshot, techId) {
  let score =
    snapshot.composition.enemyComposition.swarm * 0.28 +
    snapshot.needs.counterComposition * 0.18 +
    (snapshot.production.producedUnitCounts.get("anti_swarm") ?? 0) * 0.04;

  if (techId.includes("coverage")) {
    score += snapshot.composition.enemyComposition.swarm * 0.2 + snapshot.needs.defense * 0.12;
  } else if (techId.includes("burst")) {
    score += snapshot.needs.pressure * 0.18 + snapshot.composition.enemyComposition.swarm * 0.18;
  } else if (techId.includes("attack_cooldown")) {
    score += snapshot.needs.pressure * 0.08;
  } else if (techId.includes("chain_range")) {
    score += snapshot.needs.defense * 0.08;
  }

  if (techId.includes("follow_up")) {
    score += 0.08;
  }

  return score;
}

function getAntiTankResearchScore(aiState, snapshot, techId) {
  let score =
    snapshot.composition.enemyComposition.durable * 0.28 +
    snapshot.composition.enemyComposition.frontline * 0.14 +
    snapshot.needs.counterComposition * 0.18 +
    (snapshot.production.producedUnitCounts.get("anti_tank") ?? 0) * 0.04;

  if (techId.includes("heavy")) {
    score += snapshot.needs.defense * 0.12 + snapshot.composition.enemyComposition.durable * 0.18;
  } else if (techId.includes("tracking")) {
    score += snapshot.needs.pressure * 0.18 + snapshot.needs.objectives * 0.12;
  } else if (techId.includes("attack_damage")) {
    score += snapshot.composition.enemyComposition.durable * 0.1;
  } else if (techId.includes("projectile_speed")) {
    score += snapshot.needs.pressure * 0.08;
  }

  if (techId.includes("follow_up")) {
    score += 0.08;
  }

  return score;
}

function getCommitmentCaution(aiState) {
  return clamp01(aiState.commitmentCaution ?? 0.35);
}

function chooseProductionBuildingId(state, playerId, snapshot, kind) {
  const candidates = state.catalog.buildingDefinitions.filter((definition) => {
    return definition.kind === kind && isBuildingUnlocked(state, playerId, definition.id);
  });
  let bestBuildingId = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const definition of candidates) {
    const unitId = getProducedUnitId(definition);
    const demand = snapshot.composition.desiredUnitDemand[unitId] ?? 0;
    const existingCount = snapshot.production.producedUnitCounts.get(unitId) ?? 0;
    const score = demand - existingCount * 0.32;
    if (score > bestScore) {
      bestScore = score;
      bestBuildingId = definition.id;
    }
  }

  return bestBuildingId;
}

function getResearchPlanBias(aiState, techId) {
  const index = aiState.researchPlan.indexOf(techId);
  if (index === -1) {
    return 0;
  }

  return (aiState.researchPlan.length - index) / aiState.researchPlan.length;
}

function getTimingReadiness(matchTimeSeconds, targetTimeSeconds) {
  if (targetTimeSeconds <= 0) {
    return 1;
  }

  return clamp01(matchTimeSeconds / targetTimeSeconds);
}

function tryPlaceSuggestedBuilding(state, aiContext, buildingId, point) {
  if (!point) {
    return false;
  }

  queueGameplayCommand(state, {
    type: getGameplayCommandTypes().PLACE_BUILDING,
    playerId: aiContext.playerId,
    buildingId,
    point
  });
  return true;
}

function clampMin(value, min) {
  return Math.max(min, value);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function traceMacroDecision(state, playerId, decision) {
  const topCandidate = decision?.topCandidate ?? null;
  const topRejected = decision?.topRejected ?? null;
  const signature = JSON.stringify({
    topCandidateId: topCandidate?.id ?? null,
    topCandidateApproved: topCandidate?.approved ?? null,
    topCandidateScore: round2(topCandidate?.score ?? -999),
    topRejectedId: topRejected?.id ?? null,
    topRejectedReason: topRejected?.reason ?? null,
    topRejectedScore: round2(topRejected?.score ?? -999)
  });
  traceAiEvent(state, playerId, "macro", signature, {
    topCandidate,
    topRejected
  });
}

function traceMacroAudit(state, playerId, aiPlayer, aiState, snapshot, pipeline, candidateSummaries, rejectedCandidates) {
  const topCandidates = candidateSummaries.slice(0, 6).map((candidate) => ({
    id: candidate.id,
    score: round2(candidate.score ?? -999),
    approved: !!candidate.approved,
    investment: summarizeInvestment(candidate.investment)
  }));
  const topRejected = rejectedCandidates.slice(0, 6).map((candidate) => ({
    id: candidate.id,
    score: round2(candidate.score ?? -999),
    reason: candidate.reason ?? null,
    investment: summarizeInvestment(candidate.investment)
  }));
  const signature = JSON.stringify({
    resources: round2(aiPlayer.resources),
    net: round2(snapshot.economy.netIncomePerSecond),
    topCandidateId: topCandidates[0]?.id ?? null,
    topRejectedId: topRejected[0]?.id ?? null,
    topRejectedReason: topRejected[0]?.reason ?? null
  });
  traceAiEvent(state, playerId, "macro_audit", signature, {
    resources: aiPlayer.resources,
    incomePerSecond: snapshot.economy.incomePerSecond,
    spendingPerSecond: snapshot.economy.spendPerSecond,
    netIncomePerSecond: snapshot.economy.netIncomePerSecond,
    targetNetIncome: aiState.targetNetIncome,
    desiredReserve: pipeline?.desiredReserve ?? null,
    counts: {
      core: pipeline?.coreCount ?? null,
      tech: pipeline?.techCount ?? null,
      advanced: pipeline?.advancedCount ?? null,
      desiredCore: pipeline?.desiredCoreCount ?? null,
      desiredTech: pipeline?.desiredTechCenterCount ?? null,
      desiredAdvanced: pipeline?.desiredAdvancedCount ?? null
    },
    activeCommitments: {
      pendingBuildings: (snapshot.runtime.allBuildings ?? []).filter((building) => !building.isConstructed).map((building) => ({
        id: building.id,
        definitionId: building.definitionId,
        kind: building.kind,
        progressSeconds: round2(building.constructionProgressSeconds ?? 0)
      })),
      activeBaseUpgrade: aiPlayer.activeBaseUpgrade
        ? {
            targetTier: aiPlayer.activeBaseUpgrade.targetTier,
            progressSeconds: round2(aiPlayer.activeBaseUpgrade.progressSeconds ?? 0)
          }
        : null,
      activeTechUpgrade: aiPlayer.activeTechUpgrade
        ? {
            targetTier: aiPlayer.activeTechUpgrade.targetTier,
            progressSeconds: round2(aiPlayer.activeTechUpgrade.progressSeconds ?? 0)
          }
        : null,
      activeResearch: aiPlayer.activeResearch
        ? {
            techId: aiPlayer.activeResearch.techId,
            progressSeconds: round2(aiPlayer.activeResearch.progressSeconds ?? 0)
          }
        : null,
      researchQueue: [...(aiPlayer.researchQueue ?? [])]
    },
    topCandidates,
    topRejected
  });
}

function summarizeInvestment(investment) {
  if (!investment) {
    return null;
  }

  return {
    buildCost: round2OrNull(investment.buildCost),
    buildTime: round2OrNull(investment.buildTime),
    expectedIncomeLift: round2OrNull(investment.expectedIncomeLift),
    rampRunwaySeconds: round2OrNull(investment.rampRunwaySeconds),
    steadyStateRunwaySeconds: round2OrNull(investment.steadyStateRunwaySeconds),
    steadyStateNetIncome: round2OrNull(investment.steadyStateNetIncome),
    costPerSecond: round2OrNull(investment.costPerSecond),
    durationSeconds: round2OrNull(investment.durationSeconds),
    runwaySeconds: round2OrNull(investment.runwaySeconds),
    projectedNetIncome: round2OrNull(investment.projectedNetIncome),
    sustainFloor: round2OrNull(investment.sustainFloor),
    strategicValue: round2OrNull(investment.strategicValue),
    riskPenalty: round2OrNull(investment.riskPenalty),
    commitmentPenalty: round2OrNull(investment.commitmentPenalty),
    claimableCells: investment.claimableCells ?? null,
    richCells: investment.richCells ?? null,
    enemyUnitPressure: round2OrNull(investment.enemyUnitPressure),
    contestedControl: round2OrNull(investment.contestedControl),
    imminentDanger: investment.imminentDanger ?? null
  };
}

function round2OrNull(value) {
  return Number.isFinite(value) ? round2(value) : null;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
