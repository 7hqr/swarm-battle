import {
  getProducedUnitId,
  getResearchCost,
  isProductionKind,
  isUnitUnlocked
} from "../rules/catalogRules.js";
import { getOwnedBuildings, getPlayerById } from "../state/entities.js";
import { getBuildingConstructionCostPerSecond } from "./construction.js";
import { getBaseUpgradeCostPerSecond } from "./baseUpgrades.js";
import { getUnitProductionCostPerSecond } from "./production.js";
import { getResearchCostPerSecond } from "./research.js";
import { getTechUpgradeCostPerSecond } from "./techUpgrades.js";
import { getTerritoryIncomeBreakdown } from "./territory.js";
import { markPlayerDirty } from "../multiplayer/replicationDirtyState.js";

export function updateResources(state, dt) {
  for (const player of state.players) {
    const income = getResourceIncomePerSecond(state, player.id) * dt;
    const resolvedPlayer = getPlayerById(state, player.id);
    resolvedPlayer.resources += income;
    resolvedPlayer.cumulativeResourceGain += income;
    markPlayerDirty(state, resolvedPlayer.id);
  }
}

export function getResourceIncomePerSecond(state, playerId) {
  return getResourceIncomeBreakdown(state, playerId).total;
}

export function getResourceIncomeBreakdown(state, playerId) {
  const player = getPlayerById(state, playerId);
  if (!player) {
    return { entries: [], total: 0 };
  }

  const territoryIncome = getTerritoryIncomeBreakdown(state, playerId);
  const resourceMultiplier = player.resourceMultiplier ?? 1;
  const entries = [];

  if (territoryIncome.baseIncome > 0) {
    entries.push({
      id: "territory",
      label: "Territory",
      amount: territoryIncome.baseIncome * resourceMultiplier
    });
  }

  if (territoryIncome.richBonusIncome > 0) {
    entries.push({
      id: "rich_territory",
      label: "Rich Cells",
      amount: territoryIncome.richBonusIncome * resourceMultiplier
    });
  }

  return {
    entries,
    total: entries.reduce((sum, entry) => sum + entry.amount, 0)
  };
}

export function getResourceSpendingBreakdown(state, playerId) {
  const entries = [];
  const constructionSpendingPerSecond = getConstructionSpendingPerSecond(state, playerId);
  const baseUpgradeSpendingPerSecond = getBaseUpgradeSpendingPerSecond(state, playerId);
  const techUpgradeSpendingPerSecond = getTechUpgradeSpendingPerSecond(state, playerId);
  const researchSpendingPerSecond = getResearchSpendingPerSecond(state, playerId);
  const productionSpendingPerSecond = getProductionSpendingPerSecond(state, playerId);

  if (constructionSpendingPerSecond > 0) {
    entries.push({ id: "construction", label: "Construction", amount: constructionSpendingPerSecond });
  }

  if (baseUpgradeSpendingPerSecond > 0) {
    entries.push({ id: "base_upgrade", label: "Base Upgrade", amount: baseUpgradeSpendingPerSecond });
  }

  if (techUpgradeSpendingPerSecond > 0) {
    entries.push({ id: "tech_upgrade", label: "Tech Upgrade", amount: techUpgradeSpendingPerSecond });
  }

  if (researchSpendingPerSecond > 0) {
    entries.push({ id: "research", label: "Research", amount: researchSpendingPerSecond });
  }

  if (productionSpendingPerSecond > 0) {
    entries.push({ id: "production", label: "Production", amount: productionSpendingPerSecond });
  }

  return {
    entries,
    total: entries.reduce((sum, entry) => sum + entry.amount, 0)
  };
}

function getConstructionSpendingPerSecond(state, playerId) {
  const buildingsUnderConstruction = getOwnedBuildings(state, playerId).filter((building) => !building.isConstructed);
  let spendingPerSecond = 0;

  for (const building of buildingsUnderConstruction) {
    spendingPerSecond += getBuildingConstructionCostPerSecond(
      building,
      state.catalog.buildings[building.definitionId]
    );
  }

  return spendingPerSecond;
}

function getProductionSpendingPerSecond(state, playerId) {
  const productionBuildings = getOwnedBuildings(state, playerId).filter((building) => {
    return building.isConstructed && building.enabled && isProductionKind(building.kind);
  });

  let spendingPerSecond = 0;

  for (const building of productionBuildings) {
    const unitId = getProducedUnitId(state.catalog.buildings[building.definitionId]);
    if (!unitId || !isUnitUnlocked(state, playerId, unitId)) {
      continue;
    }

    spendingPerSecond += getUnitProductionCostPerSecond(state.catalog.units[unitId]);
  }

  return spendingPerSecond;
}

function getBaseUpgradeSpendingPerSecond(state, playerId) {
  const player = getPlayerById(state, playerId);
  if (!player?.activeBaseUpgrade) {
    return 0;
  }

  const definition = state.catalog.baseTiers[player.activeBaseUpgrade.targetTier];
  return definition ? getBaseUpgradeCostPerSecond(definition) : 0;
}

function getResearchSpendingPerSecond(state, playerId) {
  const player = getPlayerById(state, playerId);
  if (!player?.activeResearch) {
    return 0;
  }

  const definition = state.catalog.tech[player.activeResearch.techId];
  return definition ? getResearchCostPerSecond(definition, getResearchCost(state, playerId, player.activeResearch.techId)) : 0;
}

function getTechUpgradeSpendingPerSecond(state, playerId) {
  const player = getPlayerById(state, playerId);
  if (!player?.activeTechUpgrade) {
    return 0;
  }

  const definition = state.catalog.techTiers[player.activeTechUpgrade.targetTier];
  return definition ? getTechUpgradeCostPerSecond(definition) : 0;
}
