import { getOwnedBuildings, getPlayerById } from "../state/entities.js";
import { getPlayerMoveSpeedMultiplier } from "../systems/mapObjectives.js";

export function getBuildingCost(state, playerId, buildingId) {
  const definition = state.catalog.buildings[buildingId];
  if (!definition) {
    throw new Error(`Unknown building definition: ${buildingId}`);
  }

  const ownedCount = getOwnedBuildings(state, playerId).filter((entity) => entity.definitionId === buildingId).length;

  return definition.cost + definition.costIncreasePerOwned * ownedCount;
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

export function isTechUnlocked(state, playerId, techId) {
  return getPlayerById(state, playerId).researchedTechIds.includes(techId);
}

export function isBuildingUnlocked(state, playerId, buildingId) {
  const definition = state.catalog.buildings[buildingId];
  return getPlayerById(state, playerId).techTier >= definition.requiredTechTier;
}

export function isProductionKindUnlocked(state, playerId, kind) {
  return state.catalog.buildingDefinitions.some((definition) => {
    return definition.kind === kind && isBuildingUnlocked(state, playerId, definition.id);
  });
}

export function isUnitUnlocked(state, playerId, unitId) {
  const definition = state.catalog.units[unitId];
  return getPlayerById(state, playerId).techTier >= definition.requiredTechTier;
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
