import { getBuildingAvailability, getBuildingCost } from "../rules/catalogRules.js";
import { traceAiEvent } from "../debug/aiTrace.js";
import {
  getEnemyBase,
  getEntitySpatialIndex,
  getEntityById,
  getOwnedBuildings,
  getPlayerById,
  queryEntitySpatialIndex
} from "../state/entities.js";
import { markEntityDirty, markPlayerDirty } from "../multiplayer/replicationDirtyState.js";
import { spawnBuilding } from "../state/spawn.js";
import { doesCircleOverlapTerrain } from "./navigation.js";
import {
  getClaimableCellsNearPoint,
  isCircleInOwnedTerritory,
  markTerritoryInfluencerDirty
} from "./territory.js";

export function updateConstructionProgress(state, dt) {
  for (const player of state.players) {
    const buildings = getOwnedBuildings(state, player.id).filter((building) => !building.isConstructed);

    if (buildings.length === 0) {
      player.constructionPriorityIndex = 0;
      continue;
    }

    const orderedBuildings = rotateBuildings(buildings, player.constructionPriorityIndex ?? 0);
    let remainingResources = player.resources;

    for (const building of orderedBuildings) {
      remainingResources = updateConstructionBuilding(state, building, dt, remainingResources);
    }

    player.resources = Math.max(0, remainingResources);
    player.constructionPriorityIndex = (player.constructionPriorityIndex + 1) % orderedBuildings.length;
    markPlayerDirty(state, player.id);
  }
}

export function getBuildingConstructionCost(building, buildingDefinition) {
  return building.constructionCost ?? buildingDefinition.cost;
}

export function getBuildingConstructionCostPerSecond(building, buildingDefinition) {
  if (buildingDefinition.buildTime <= 0) {
    return 0;
  }

  return getBuildingConstructionCost(building, buildingDefinition) / buildingDefinition.buildTime;
}

function updateConstructionBuilding(state, building, dt, remainingResources) {
  const definition = state.catalog.buildings[building.definitionId];
  const remainingBuildTime = definition.buildTime - building.constructionProgressSeconds;
  if (remainingBuildTime <= 0) {
    building.constructionProgressSeconds = definition.buildTime;
    building.isConstructed = true;
    markEntityDirty(state, building.id);
    markTerritoryInfluencerDirty(state, building.id);
    return remainingResources;
  }

  const spendPerSecond = getBuildingConstructionCostPerSecond(building, definition);
  const affordableSeconds = spendPerSecond > 0 ? remainingResources / spendPerSecond : dt;
  const progressedSeconds = Math.max(0, Math.min(dt, remainingBuildTime, affordableSeconds));
  if (progressedSeconds <= 0) {
    return remainingResources;
  }

  building.constructionProgressSeconds += progressedSeconds;
  remainingResources -= progressedSeconds * spendPerSecond;
  markEntityDirty(state, building.id);

  if (building.constructionProgressSeconds + 0.0001 < definition.buildTime) {
    return remainingResources;
  }

  building.constructionProgressSeconds = definition.buildTime;
  building.isConstructed = true;
  markEntityDirty(state, building.id);
  markTerritoryInfluencerDirty(state, building.id);
  return remainingResources;
}

export function canPlaceBuildingAt(state, playerId, buildingId, point) {
  const buildingDefinition = state.catalog.buildings[buildingId];
  if (!buildingDefinition) {
    return { ok: false, reason: "Locked." };
  }

  const availability = getBuildingAvailability(state, playerId, buildingId);
  if (!availability.unlocked) {
    return { ok: false, reason: availability.reason };
  }

  if (
    point.x < buildingDefinition.radius ||
    point.x > state.map.width - buildingDefinition.radius ||
    point.y < buildingDefinition.radius ||
    point.y > state.map.height - buildingDefinition.radius
  ) {
    return { ok: false, reason: "Out of bounds." };
  }

  if (!isCircleInOwnedTerritory(state, playerId, point, buildingDefinition.radius)) {
    return { ok: false, reason: "Must be placed in owned territory." };
  }

  if (doesCircleOverlapTerrain(state, point, buildingDefinition.radius + 6)) {
    return { ok: false, reason: "Blocked by terrain." };
  }

  const spatialIndex = getEntitySpatialIndex(state);
  const maxBuildingRadius = getMaximumBuildingRadius(state);
  for (const entity of queryEntitySpatialIndex(
    spatialIndex,
    "building",
    point,
    buildingDefinition.radius + maxBuildingRadius + 14
  )) {
    const dx = entity.x - point.x;
    const dy = entity.y - point.y;
    const distance = Math.hypot(dx, dy);
    if (distance < entity.radius + buildingDefinition.radius + 14) {
      return { ok: false, reason: "Too close to another building." };
    }
  }

  return { ok: true };
}

export function placeBuildingAt(state, playerId, buildingId, point) {
  const placement = canPlaceBuildingAt(state, playerId, buildingId, point);

  if (!placement.ok) {
    return placement;
  }

  const constructionCost = getBuildingCost(state, playerId, buildingId);

  const building = spawnBuilding(state, {
    ownerId: playerId,
    definitionId: buildingId,
    constructionCost,
    x: point.x,
    y: point.y
  });

  return { ok: true, buildingId: building.id };
}

export function getSuggestedBuildPoint(state, playerId, buildingId, planningContext = null) {
  const buildingDefinition = state.catalog.buildings[buildingId];
  const ownedBuildings = planningContext?.ownedBuildings ?? getOwnedBuildings(state, playerId).filter((building) => building.isConstructed);
  const anchor = planningContext?.anchor ?? ownedBuildings[0] ?? getEntityById(state, getPlayerById(state, playerId).startingBaseId);
  if (!anchor) {
    return null;
  }

  const enemyBase = planningContext?.enemyBase ?? getEnemyBase(state, playerId);
  const candidateAnchors = getCandidateAnchors(state, playerId, buildingDefinition, ownedBuildings, anchor);
  const candidatePoints = getCandidateBuildPoints(state, buildingDefinition, candidateAnchors, enemyBase);

  let bestPoint = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestEvaluation = null;
  const scoredCandidates = [];
  const blockedCounts = {};

  for (const point of candidatePoints) {
    const placement = canPlaceBuildingAt(state, playerId, buildingId, point);
    if (!placement.ok) {
      blockedCounts[placement.reason] = (blockedCounts[placement.reason] ?? 0) + 1;
      continue;
    }

    const evaluation = evaluateBuildPointScore(
      state,
      playerId,
      buildingDefinition,
      point,
      enemyBase,
      ownedBuildings
    );
    scoredCandidates.push(evaluation);
    if (evaluation.score > bestScore) {
      bestScore = evaluation.score;
      bestPoint = point;
      bestEvaluation = evaluation;
    }
  }

  traceBuildPlacementDecision(
    state,
    playerId,
    buildingDefinition,
    candidateAnchors,
    scoredCandidates,
    blockedCounts,
    bestEvaluation
  );

  return bestPoint;
}

export function evaluateBuildPointOpportunity(state, playerId, buildingId, point) {
  const buildingDefinition = state.catalog.buildings[buildingId];
  if (!buildingDefinition || !point) {
    return null;
  }

  const claim = getClaimableCellsNearPoint(state, playerId, point, buildingDefinition.radius + 300);
  const risk = getBuildPointRiskMetrics(state, playerId, point, buildingDefinition.radius);

  return {
    claim,
    risk
  };
}

function getCandidateAnchors(state, playerId, buildingDefinition, ownedBuildings, fallbackAnchor) {
  if (ownedBuildings.length === 0) {
    return [fallbackAnchor];
  }

  if (buildingDefinition.kind !== "tech_structure") {
    return ownedBuildings;
  }

  const anchors = ownedBuildings
    .map((building) => ({
      building,
      safetyScore: scoreTechAnchorSafety(state, playerId, building)
    }))
    .sort((left, right) => right.safetyScore - left.safetyScore)
    .slice(0, 4)
    .map((entry) => entry.building);

  return anchors.length > 0 ? anchors : [fallbackAnchor];
}

function getCandidateBuildPoints(state, buildingDefinition, anchors, enemyBase) {
  const distances = getCandidateDistances(buildingDefinition.kind);
  const angleCount = 16;
  const points = [];
  const seen = new Set();

  for (const anchor of anchors) {
    for (const distance of distances) {
      for (let index = 0; index < angleCount; index += 1) {
        const angle = (Math.PI * 2 * index) / angleCount;
        const point = {
          x: anchor.x + Math.cos(angle) * distance,
          y: anchor.y + Math.sin(angle) * distance
        };
        pushUniquePoint(points, seen, point);
      }
    }

    if (enemyBase && buildingDefinition.kind !== "tech_structure") {
      const dx = enemyBase.x - anchor.x;
      const dy = enemyBase.y - anchor.y;
      const length = Math.hypot(dx, dy) || 1;
      const directionX = dx / length;
      const directionY = dy / length;
      const perpendicularX = -directionY;
      const perpendicularY = directionX;

      for (const distance of distances) {
        pushUniquePoint(points, seen, {
          x: anchor.x + directionX * distance,
          y: anchor.y + directionY * distance
        });
        pushUniquePoint(points, seen, {
          x: anchor.x + directionX * distance + perpendicularX * distance * 0.45,
          y: anchor.y + directionY * distance + perpendicularY * distance * 0.45
        });
        pushUniquePoint(points, seen, {
          x: anchor.x + directionX * distance - perpendicularX * distance * 0.45,
          y: anchor.y + directionY * distance - perpendicularY * distance * 0.45
        });
      }
    }
  }

  return points;
}

function getCandidateDistances(kind) {
  if (kind === "tech_structure") {
    return [70, 100, 130, 160];
  }

  if (kind === "advanced_production") {
    return [110, 170, 240, 320];
  }

  return [75, 110, 160, 220, 300];
}

function evaluateBuildPointScore(state, playerId, buildingDefinition, point, enemyBase, ownedBuildings = null) {
  const analysis = evaluateBuildPointOpportunity(state, playerId, buildingDefinition.id, point);
  const claim = analysis.claim;
  const risk = analysis.risk;
  const nearestOwnedDistance = getNearestOwnedBuildingDistance(state, playerId, point, ownedBuildings);
  const base = getEntityById(state, getPlayerById(state, playerId).startingBaseId);
  const distanceFromBase = base ? Math.hypot(point.x - base.x, point.y - base.y) : 0;
  const enemyDistance = enemyBase ? Math.hypot(point.x - enemyBase.x, point.y - enemyBase.y) : 0;
  const localSupport = getLocalOwnedBuildingSupport(point, ownedBuildings);
  const enemyDistanceValue = enemyBase ? getEnemyDistanceValue(state, enemyDistance) : 0;

  let score = claim.claimableCells * 10 + claim.pressureScore * 4;
  score += risk.richClaimCount * 14;
  score += risk.safeClaimableCells * 6;
  score -= nearestOwnedDistance * 0.015;
  score -= risk.enemyUnitPressure * 120;
  score -= risk.enemyBuildingPressure * 70;
  score -= risk.contestedControl * 52;
  score -= risk.enemyOwnedCells * 18;
  score -= risk.frontlineExposure * 28;

  if (buildingDefinition.kind === "core_production") {
    score += enemyBase ? (state.map.width + state.map.height - enemyDistance) * 0.008 : 0;
    score += distanceFromBase * 0.0035;
  } else if (buildingDefinition.kind === "advanced_production") {
    score += enemyBase ? (state.map.width + state.map.height - enemyDistance) * 0.012 : 0;
    score -= distanceFromBase * 0.004;
  } else if (buildingDefinition.kind === "tech_structure") {
    score = 0;
    score += enemyDistanceValue * 70;
    score += risk.friendlyOwnedCells * 28;
    score += risk.friendlyControl * 18;
    score += localSupport * 18;
    score -= nearestOwnedDistance * 0.03;
    score -= risk.safeClaimableCells * 14;
    score -= risk.richClaimCount * 20;
    score -= risk.contestedControl * 180;
    score -= risk.enemyOwnedCells * 120;
    score -= risk.enemyUnitPressure * 280;
    score -= risk.enemyBuildingPressure * 220;
    score -= risk.frontlineExposure * 220;
    score -= Math.max(0, risk.frontlineExposure - 0.35) * 420;
  }

  if (risk.imminentDanger) {
    score -= 220;
  }

  if (risk.frontlineExposure > 0.8 && buildingDefinition.kind !== "advanced_production") {
    score -= 90;
  }

  if (buildingDefinition.kind === "tech_structure" && risk.frontlineExposure > 0.55) {
    score -= 220;
  }

  return {
    point,
    score,
    claim,
    risk,
    metrics: {
      enemyDistance,
      enemyDistanceValue,
      nearestOwnedDistance,
      localSupport
    }
  };
}

function getBuildPointRiskMetrics(state, playerId, point, buildingRadius) {
  const opponentPlayerId = playerId === 1 ? 2 : 1;
  const spatialIndex = getEntitySpatialIndex(state);
  const enemyUnitRadius = Math.max(160, buildingRadius + 140);
  const enemyBuildingRadius = Math.max(240, buildingRadius + 220);
  let enemyUnitPressure = 0;
  let enemyBuildingPressure = 0;

  for (const entity of queryEntitySpatialIndex(spatialIndex, "unit", point, enemyUnitRadius)) {
    if (entity.ownerId !== opponentPlayerId || entity.health <= 0) {
      continue;
    }

    const distance = Math.hypot(entity.x - point.x, entity.y - point.y);
    if (distance > enemyUnitRadius) {
      continue;
    }

    enemyUnitPressure += 1 - distance / enemyUnitRadius;
  }

  for (const entity of queryEntitySpatialIndex(spatialIndex, "building", point, enemyBuildingRadius)) {
    if (entity.ownerId !== opponentPlayerId || !entity.isConstructed) {
      continue;
    }

    const distance = Math.hypot(entity.x - point.x, entity.y - point.y);
    if (distance > enemyBuildingRadius) {
      continue;
    }

    enemyBuildingPressure += 1 - distance / enemyBuildingRadius;
  }

  const territoryRadius = buildingRadius + state.territory.cellSize * 3;
  const territoryRadiusSquared = territoryRadius * territoryRadius;
  let contestedControl = 0;
  let enemyOwnedCells = 0;
  let friendlyOwnedCells = 0;
  let friendlyControl = 0;
  let safeClaimableCells = 0;
  let richClaimCount = 0;

  for (const cell of state.territory.cells) {
    const dx = cell.centerX - point.x;
    const dy = cell.centerY - point.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > territoryRadiusSquared) {
      continue;
    }

    const controlForPlayer = playerId === 1 ? cell.control : -cell.control;
    if (cell.ownerId === playerId) {
      friendlyOwnedCells += 1;
      friendlyControl += Math.max(0, controlForPlayer);
      continue;
    }

    if (cell.ownerId !== playerId) {
      contestedControl += Math.max(0, controlForPlayer * -1);
      if (cell.ownerId === opponentPlayerId) {
        enemyOwnedCells += 1;
      } else {
        safeClaimableCells += 1;
      }

      if (cell.incomeValue > 1) {
        richClaimCount += cell.incomeValue - 1;
      }
    }
  }

  const frontlineExposure = enemyDistanceRatio(state, point, playerId);
  const imminentDanger =
    enemyUnitPressure >= 1.05 ||
    enemyBuildingPressure >= 0.85 ||
    contestedControl >= 1.6;

  return {
    enemyUnitPressure,
    enemyBuildingPressure,
    contestedControl,
    enemyOwnedCells,
    friendlyOwnedCells,
    friendlyControl,
    safeClaimableCells,
    richClaimCount,
    frontlineExposure,
    imminentDanger
  };
}

function enemyDistanceRatio(state, point, playerId) {
  const enemyBase = getEnemyBase(state, playerId);
  const ownBase = getEntityById(state, getPlayerById(state, playerId).startingBaseId);
  if (!enemyBase || !ownBase) {
    return 0;
  }

  const ownDistance = Math.hypot(point.x - ownBase.x, point.y - ownBase.y);
  const enemyDistance = Math.hypot(point.x - enemyBase.x, point.y - enemyBase.y);
  const totalDistance = Math.max(1, ownDistance + enemyDistance);
  return clamp01(ownDistance / totalDistance);
}

function getNearestOwnedBuildingDistance(state, playerId, point, ownedBuildings = null) {
  const candidateBuildings = ownedBuildings ?? getOwnedBuildings(state, playerId).filter((building) => building.isConstructed);
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const building of candidateBuildings) {
    const distance = Math.hypot(point.x - building.x, point.y - building.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
    }
  }

  return Number.isFinite(nearestDistance) ? nearestDistance : 0;
}

function getLocalOwnedBuildingSupport(point, ownedBuildings = null) {
  if (!ownedBuildings || ownedBuildings.length === 0) {
    return 0;
  }

  let support = 0;

  for (const building of ownedBuildings) {
    const distance = Math.hypot(point.x - building.x, point.y - building.y);
    if (distance > 190) {
      continue;
    }

    support += 1 - distance / 190;
  }

  return support;
}

function scoreTechAnchorSafety(state, playerId, building) {
  const risk = getBuildPointRiskMetrics(state, playerId, building, building.radius ?? 20);
  const enemyBase = getEnemyBase(state, playerId);
  const enemyDistance = enemyBase ? Math.hypot(building.x - enemyBase.x, building.y - enemyBase.y) : 0;
  const enemyDistanceValue = enemyBase ? getEnemyDistanceValue(state, enemyDistance) : 0;

  return enemyDistanceValue * 55 +
    risk.friendlyOwnedCells * 20 +
    risk.friendlyControl * 12 -
    risk.safeClaimableCells * 10 -
    risk.contestedControl * 150 -
    risk.enemyOwnedCells * 100 -
    risk.enemyUnitPressure * 220 -
    risk.enemyBuildingPressure * 180 -
    risk.frontlineExposure * 180;
}

function getEnemyDistanceValue(state, enemyDistance) {
  const maxDistance = Math.max(1, Math.hypot(state.map.width, state.map.height));
  return clamp01(enemyDistance / maxDistance);
}

function traceBuildPlacementDecision(
  state,
  playerId,
  buildingDefinition,
  candidateAnchors,
  scoredCandidates,
  blockedCounts,
  chosenCandidate
) {
  const topCandidates = [...scoredCandidates]
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(summarizePlacementCandidate);
  const signature = JSON.stringify({
    buildingId: buildingDefinition.id,
    chosenX: chosenCandidate ? Math.round(chosenCandidate.point.x) : null,
    chosenY: chosenCandidate ? Math.round(chosenCandidate.point.y) : null,
    chosenScore: round2(chosenCandidate?.score ?? -999),
    topScore: round2(topCandidates[0]?.score ?? -999)
  });

  traceAiEvent(state, playerId, "placement", signature, {
    buildingId: buildingDefinition.id,
    buildingKind: buildingDefinition.kind,
    chosenCandidate: chosenCandidate ? summarizePlacementCandidate(chosenCandidate) : null,
    candidateAnchorCount: candidateAnchors.length,
    candidateAnchors: candidateAnchors.slice(0, 5).map((anchor) => ({
      id: anchor.id ?? null,
      definitionId: anchor.definitionId ?? null,
      kind: anchor.kind ?? null,
      x: round2(anchor.x),
      y: round2(anchor.y)
    })),
    validCandidateCount: scoredCandidates.length,
    blockedCounts,
    topCandidates
  });
}

function summarizePlacementCandidate(candidate) {
  return {
    point: {
      x: round2(candidate.point.x),
      y: round2(candidate.point.y)
    },
    score: round2(candidate.score),
    claimableCells: candidate.claim.claimableCells,
    pressureScore: round2(candidate.claim.pressureScore),
    enemyDistance: round2(candidate.metrics.enemyDistance),
    enemyDistanceValue: round2(candidate.metrics.enemyDistanceValue),
    nearestOwnedDistance: round2(candidate.metrics.nearestOwnedDistance),
    localSupport: round2(candidate.metrics.localSupport),
    enemyUnitPressure: round2(candidate.risk.enemyUnitPressure),
    enemyBuildingPressure: round2(candidate.risk.enemyBuildingPressure),
    contestedControl: round2(candidate.risk.contestedControl),
    enemyOwnedCells: candidate.risk.enemyOwnedCells,
    friendlyOwnedCells: candidate.risk.friendlyOwnedCells,
    friendlyControl: round2(candidate.risk.friendlyControl),
    safeClaimableCells: candidate.risk.safeClaimableCells,
    richClaimCount: candidate.risk.richClaimCount,
    frontlineExposure: round2(candidate.risk.frontlineExposure),
    imminentDanger: candidate.risk.imminentDanger
  };
}

function round2(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

function pushUniquePoint(points, seen, point) {
  const roundedX = Math.round(point.x);
  const roundedY = Math.round(point.y);
  const key = `${roundedX}:${roundedY}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  points.push({ x: roundedX, y: roundedY });
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function rotateBuildings(buildings, startIndex) {
  if (buildings.length === 0) {
    return buildings;
  }

  const normalizedIndex = startIndex % buildings.length;
  return [
    ...buildings.slice(normalizedIndex),
    ...buildings.slice(0, normalizedIndex)
  ];
}

function getMaximumBuildingRadius(state) {
  state.maximumBuildingRadius ??= Math.max(
    0,
    ...state.catalog.buildingDefinitions.map((definition) => definition.radius ?? 0)
  );
  return state.maximumBuildingRadius;
}
