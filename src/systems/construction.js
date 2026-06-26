import { getBuildingCost, isBuildingUnlocked } from "../rules/catalogRules.js";
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
  if (!buildingDefinition || !isBuildingUnlocked(state, playerId, buildingId)) {
    return { ok: false, reason: "Locked." };
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
  const candidatePoints = getCandidateBuildPoints(state, playerId, buildingDefinition, ownedBuildings, anchor, enemyBase);

  let bestPoint = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const point of candidatePoints) {
    if (!canPlaceBuildingAt(state, playerId, buildingId, point).ok) {
      continue;
    }

    const score = scoreBuildPoint(state, playerId, buildingDefinition, point, anchor, enemyBase, ownedBuildings);
    if (score > bestScore) {
      bestScore = score;
      bestPoint = point;
    }
  }

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

function getCandidateBuildPoints(state, playerId, buildingDefinition, ownedBuildings, fallbackAnchor, enemyBase) {
  const anchors = ownedBuildings.length > 0 ? ownedBuildings : [fallbackAnchor];
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

    if (enemyBase) {
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
    return [70, 110, 160, 220];
  }

  if (kind === "advanced_production") {
    return [110, 170, 240, 320];
  }

  return [75, 110, 160, 220, 300];
}

function scoreBuildPoint(state, playerId, buildingDefinition, point, fallbackAnchor, enemyBase, ownedBuildings = null) {
  const analysis = evaluateBuildPointOpportunity(state, playerId, buildingDefinition.id, point);
  const claim = analysis.claim;
  const risk = analysis.risk;
  const nearestOwnedDistance = getNearestOwnedBuildingDistance(state, playerId, point, ownedBuildings);
  const base = getEntityById(state, getPlayerById(state, playerId).startingBaseId) ?? fallbackAnchor;
  const distanceFromBase = Math.hypot(point.x - base.x, point.y - base.y);
  const enemyDistance = enemyBase ? Math.hypot(point.x - enemyBase.x, point.y - enemyBase.y) : 0;

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
    score -= distanceFromBase * 0.01;
  }

  if (risk.imminentDanger) {
    score -= 220;
  }

  if (risk.frontlineExposure > 0.8 && buildingDefinition.kind !== "advanced_production") {
    score -= 90;
  }

  return score;
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
  let safeClaimableCells = 0;
  let richClaimCount = 0;

  for (const cell of state.territory.cells) {
    const dx = cell.centerX - point.x;
    const dy = cell.centerY - point.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > territoryRadiusSquared) {
      continue;
    }

    if (cell.ownerId !== playerId) {
      const controlForPlayer = playerId === 1 ? cell.control : -cell.control;
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
