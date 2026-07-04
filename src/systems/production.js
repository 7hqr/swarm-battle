import {
  getProducedUnitId,
  getProductionBatchSize,
  getProductionCycleTime,
  isUnitUnlocked
} from "../rules/catalogRules.js";
import { markEntityDirty, markPlayerDirty } from "../multiplayer/replicationDirtyState.js";
import { getEntityById, getOwnedBuildings } from "../state/entities.js";
import { spawnUnit } from "../state/spawn.js";

export function updateProduction(state, dt) {
  for (const player of state.players) {
    const buildings = getOwnedBuildings(state, player.id).filter((entity) => {
      return state.catalog.buildings[entity.definitionId].producedUnitIds.length > 0;
    });

    if (buildings.length === 0) {
      player.productionPriorityIndex = 0;
      continue;
    }

    const orderedBuildings = rotateBuildings(buildings, player.productionPriorityIndex ?? 0);
    let remainingResources = player.resources;

    for (const building of orderedBuildings) {
      remainingResources = updateProductionBuilding(state, building, dt, remainingResources);
    }

    player.resources = Math.max(0, remainingResources);
    player.productionPriorityIndex = (player.productionPriorityIndex + 1) % orderedBuildings.length;
    markPlayerDirty(state, player.id);
  }
}

export function getUnitProductionCostPerSecond(buildingDefinition, unitDefinition) {
  const cycleTime = getProductionCycleTime(buildingDefinition, unitDefinition);
  const batchSize = getProductionBatchSize(buildingDefinition);
  return (unitDefinition.cost * batchSize) / cycleTime;
}

function updateProductionBuilding(state, building, dt, remainingResources) {
  const buildingDefinition = state.catalog.buildings[building.definitionId];
  const producedUnitId = getProducedUnitId(buildingDefinition);
  if (
    !building.isConstructed ||
    !building.enabled ||
    !producedUnitId ||
    !isUnitUnlocked(state, building.ownerId, producedUnitId)
  ) {
    return remainingResources;
  }

  const unitStats = state.catalog.units[producedUnitId];
  const productionCycleTime = getProductionCycleTime(buildingDefinition, unitStats);
  const remainingBuildTime = productionCycleTime - building.productionProgressSeconds;
  if (remainingBuildTime <= 0) {
    spawnCompletedUnit(state, building, producedUnitId, getProductionBatchSize(buildingDefinition));
    return remainingResources;
  }

  const spendPerSecond = getUnitProductionCostPerSecond(buildingDefinition, unitStats);
  const affordableSeconds = spendPerSecond > 0 ? remainingResources / spendPerSecond : dt;
  const progressedSeconds = Math.max(0, Math.min(dt, remainingBuildTime, affordableSeconds));
  if (progressedSeconds <= 0) {
    return remainingResources;
  }

  building.productionProgressSeconds += progressedSeconds;
  remainingResources -= progressedSeconds * spendPerSecond;
  markEntityDirty(state, building.id);

  if (building.productionProgressSeconds + 0.0001 < productionCycleTime) {
    return remainingResources;
  }

  spawnCompletedUnit(state, building, producedUnitId, getProductionBatchSize(buildingDefinition));
  return remainingResources;
}

function spawnCompletedUnit(state, building, unitId, batchSize) {
  const originBuilding = getEntityById(state, building.id);
  if (!originBuilding) {
    return;
  }

  for (let index = 0; index < batchSize; index += 1) {
    spawnUnit(state, building.ownerId, unitId, originBuilding);
  }
  building.productionProgressSeconds = 0;
  markEntityDirty(state, building.id);
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
