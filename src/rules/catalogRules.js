import { getOwnedBuildings, getPlayerById } from "../state/entities.js";
import { getPlayerMoveSpeedMultiplier } from "../systems/mapObjectives.js";

export function getConstructedTechCenterLevel(state, playerId) {
  const player = getPlayerById(state, playerId);
  if (!player) {
    return 0;
  }

  const hasConstructedTechCenter = getOwnedBuildings(state, playerId, "tech_structure").some(
    (building) => building.isConstructed
  );

  return hasConstructedTechCenter ? player.techTier : 0;
}

export function getResearchRequiredTechCenterLevel(techDefinition) {
  const row = techDefinition?.layout?.row;
  if (!Number.isInteger(row) || row < 0) {
    throw new Error(`Tech ${techDefinition?.id ?? "unknown"} must define a non-negative integer layout.row.`);
  }

  return row + 1;
}

export function getBuildingCost(state, playerId, buildingId) {
  const definition = state.catalog.buildings[buildingId];
  if (!definition) {
    throw new Error(`Unknown building definition: ${buildingId}`);
  }

  const ownedCount = getOwnedBuildingCount(state, playerId, buildingId);

  return definition.cost + definition.costIncreasePerOwned * ownedCount;
}

export function getOwnedBuildingCount(state, playerId, buildingId) {
  return getOwnedBuildings(state, playerId).filter((entity) => entity.definitionId === buildingId).length;
}

export function isProductionKind(kind) {
  return kind === "core_production" || kind === "advanced_production";
}

export function supportsWaypointChain(kind) {
  return kind === "base" || isProductionKind(kind);
}

export function getProducedUnitId(buildingDefinition) {
  if (!isProductionKind(buildingDefinition.kind)) {
    return null;
  }

  if (buildingDefinition.producedUnitIds.length !== 1) {
    throw new Error(`Production building ${buildingDefinition.id} must define exactly one produced unit.`);
  }

  return buildingDefinition.producedUnitIds[0];
}

export function getProductionBatchSize(buildingDefinition) {
  if (!isProductionKind(buildingDefinition.kind)) {
    return 0;
  }

  return buildingDefinition.productionBatchSize ?? 1;
}

export function getProductionCycleTime(buildingDefinition, unitDefinition) {
  if (!isProductionKind(buildingDefinition.kind)) {
    return 0;
  }

  return buildingDefinition.productionCycleTime ?? unitDefinition.buildTime;
}

export function isTechUnlocked(state, playerId, techId) {
  return getPlayerById(state, playerId).researchedTechIds.includes(techId);
}

export function getBuildingAvailability(state, playerId, buildingId) {
  const definition = state.catalog.buildings[buildingId];
  if (!definition) {
    throw new Error(`Unknown building definition: ${buildingId}`);
  }

  if (getConstructedTechCenterLevel(state, playerId) < definition.requiredTechCenterLevel) {
    return {
      unlocked: false,
      reason: definition.requiredTechCenterLevel <= 0
        ? "Unavailable"
        : `Needs Tech Center Lv. ${definition.requiredTechCenterLevel}`
    };
  }

  if (Number.isInteger(definition.maxOwned) && definition.maxOwned >= 0) {
    const ownedCount = getOwnedBuildingCount(state, playerId, buildingId);
    if (ownedCount >= definition.maxOwned) {
      return {
        unlocked: false,
        reason: definition.maxOwned === 1
          ? "Limit reached"
          : `Limit ${definition.maxOwned}`
      };
    }
  }

  return {
    unlocked: true,
    reason: "Available"
  };
}

export function isBuildingUnlocked(state, playerId, buildingId) {
  return getBuildingAvailability(state, playerId, buildingId).unlocked;
}

export function isProductionKindUnlocked(state, playerId, kind) {
  return state.catalog.buildingDefinitions.some((definition) => {
    return definition.kind === kind && isBuildingUnlocked(state, playerId, definition.id);
  });
}

export function isUnitUnlocked(state, playerId, unitId) {
  const definition = state.catalog.units[unitId];
  return getConstructedTechCenterLevel(state, playerId) >= definition.requiredTechCenterLevel;
}

export function getResearchCost(state, playerId, techId) {
  const definition = state.catalog.tech[techId];
  if (!definition) {
    throw new Error(`Unknown tech definition: ${techId}`);
  }

  return definition.cost;
}

export function getUnitStats(state, playerId, unitId) {
  const baseStats = state.catalog.units[unitId];
  const player = getPlayerById(state, playerId);
  const modifiedStats = {
    ...baseStats,
    behaviorTags: [...(baseStats.behaviorTags ?? [])]
  };

  for (const techId of player.researchedTechIds) {
    const techDefinition = state.catalog.tech[techId];
    for (const effect of techDefinition.effects) {
      const targetUnitIds = effect.target?.unitIds ?? [];
      if (!targetUnitIds.includes(unitId)) {
        continue;
      }

      if (effect.kind === "modify_unit_stat" && effect.operation === "add") {
        modifiedStats[effect.stat] += effect.value;
        continue;
      }

      if (effect.kind === "add_unit_behavior") {
        if (!modifiedStats.behaviorTags.includes(effect.behaviorId)) {
          modifiedStats.behaviorTags.push(effect.behaviorId);
        }
      }
    }
  }

  modifiedStats.moveSpeed *= getPlayerMoveSpeedMultiplier(state, playerId);

  return modifiedStats;
}
