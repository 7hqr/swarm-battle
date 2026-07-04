import { getProducedUnitId, isUnitUnlocked } from "../../rules/catalogRules.js";
import { getOwnedBuildings, getOwnedUnits } from "../../state/entities.js";
import { getUnitProductionCostPerSecond } from "../production.js";
import { getResourceIncomePerSecond } from "../resources.js";
import { getOwnedTerritoryCellCount } from "../territory.js";
export function rebalanceProduction(state, aiContext, aiState) {
  let economy = evaluateEconomy(state, aiContext);
  let changed = false;
  const managedBuildings = getManagedProductionBuildings(state, aiContext);
  const guardrails = getProductionGuardrails(state, aiContext, managedBuildings);
  let activeCoreBuildings = guardrails.activeCoreBuildings;

  const disableOrder = [...managedBuildings].sort(compareDisablePriority);
  for (const building of disableOrder) {
    if (economy.netIncomePerSecond >= aiState.targetNetIncome) {
      break;
    }

    if (!building.enabled) {
      continue;
    }

    if (building.kind === "core_production" && activeCoreBuildings <= guardrails.minimumActiveCoreBuildings) {
      continue;
    }

    building.enabled = false;
    if (building.kind === "core_production") {
      activeCoreBuildings -= 1;
    }
    changed = true;
    economy = evaluateEconomy(state, aiContext);
  }

  const enableOrder = [...managedBuildings].sort(compareEnablePriority);
  for (const building of enableOrder) {
    if (building.enabled) {
      continue;
    }

    if (building.kind === "core_production" && activeCoreBuildings < guardrails.minimumActiveCoreBuildings) {
      building.enabled = true;
      activeCoreBuildings += 1;
      changed = true;
      economy = evaluateEconomy(state, aiContext);
      continue;
    }

    const addedSpendPerSecond = getBuildingSpendPerSecond(state, aiContext, building);
    if (addedSpendPerSecond === 0) {
      continue;
    }

    if (economy.incomePerSecond - (economy.spendPerSecond + addedSpendPerSecond) < aiState.targetNetIncome) {
      continue;
    }

    building.enabled = true;
    changed = true;
    economy = evaluateEconomy(state, aiContext);
  }

  return changed;
}

export function evaluateEconomy(state, aiContext) {
  const incomePerSecond = getResourceIncomePerSecond(state, aiContext.playerId);
  const allProductionBuildings = getOwnedBuildings(state, aiContext.playerId).filter((building) => {
    return state.catalog.buildings[building.definitionId].producedUnitIds.length > 0;
  });

  let spendPerSecond = 0;
  let disabledProductionCount = 0;

  for (const building of allProductionBuildings) {
    if (!building.enabled) {
      disabledProductionCount += 1;
      continue;
    }

    spendPerSecond += getBuildingSpendPerSecond(state, aiContext, building);
  }

  return {
    incomePerSecond,
    spendPerSecond,
    netIncomePerSecond: incomePerSecond - spendPerSecond,
    disabledProductionCount,
    totalProductionBuildingCount: allProductionBuildings.length
  };
}

function getProductionGuardrails(state, aiContext, managedBuildings) {
  const coreBuildings = managedBuildings.filter((building) => building.kind === "core_production");
  const activeCoreBuildings = coreBuildings.filter((building) => building.enabled).length;
  const controlledCells = getOwnedTerritoryCellCount(state, aiContext.playerId);
  const enemyControlledCells = getOwnedTerritoryCellCount(state, aiContext.opponentPlayerId);
  const armyCount = getOwnedUnits(state, aiContext.playerId).length;

  let minimumActiveCoreBuildings = 0;
  if (coreBuildings.length > 0) {
    minimumActiveCoreBuildings = 1;
  }

  if (coreBuildings.length > 1 && controlledCells + 10 < enemyControlledCells && armyCount >= 8) {
    minimumActiveCoreBuildings = 2;
  }

  return {
    minimumActiveCoreBuildings,
    activeCoreBuildings
  };
}

function getManagedProductionBuildings(state, aiContext) {
  return getOwnedBuildings(state, aiContext.playerId).filter((building) => {
    return (
      state.catalog.buildings[building.definitionId].producedUnitIds.length > 0 &&
      building.isConstructed &&
      !!getAssignedProductionUnitId(state, aiContext, building)
    );
  });
}

function getAssignedProductionUnitId(state, aiContext, building) {
  const unitId = getProducedUnitId(state.catalog.buildings[building.definitionId]);
  if (!unitId || !isUnitUnlocked(state, aiContext.playerId, unitId)) {
    return null;
  }

  return unitId;
}

function getBuildingSpendPerSecond(state, aiContext, building) {
  const unitId = getAssignedProductionUnitId(state, aiContext, building);
  if (!unitId) {
    return 0;
  }

  return getUnitSpendPerSecond(
    state.catalog.buildings[building.definitionId],
    state.catalog.units[unitId]
  );
}

export function getUnitSpendPerSecond(buildingDefinition, unitDefinition) {
  return getUnitProductionCostPerSecond(buildingDefinition, unitDefinition);
}

function compareDisablePriority(left, right) {
  return getDisablePriority(left) - getDisablePriority(right);
}

function compareEnablePriority(left, right) {
  return getEnablePriority(left) - getEnablePriority(right);
}

function getDisablePriority(building) {
  if (building.kind === "advanced_production") {
    return 0;
  }

  return 1;
}

function getEnablePriority(building) {
  if (building.kind === "core_production") {
    return 0;
  }

  return 1;
}
