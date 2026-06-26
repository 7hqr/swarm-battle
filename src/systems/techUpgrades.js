import { pushLog } from "../gameState.js";
import { markPlayerDirty } from "../multiplayer/replicationDirtyState.js";
import { getPlayerById } from "../state/entities.js";

export function updateTechUpgrades(state, dt) {
  for (const player of state.players) {
    if (!player.activeTechUpgrade) {
      continue;
    }

    const upgrade = player.activeTechUpgrade;
    const definition = state.catalog.techTiers[upgrade.targetTier];
    const spendPerSecond = getTechUpgradeCostPerSecond(definition);
    const remainingUpgradeTime = definition.upgradeTime - upgrade.progressSeconds;
    if (remainingUpgradeTime <= 0) {
      completeTechUpgrade(state, player.id, definition);
      continue;
    }

    const affordableSeconds = spendPerSecond > 0 ? player.resources / spendPerSecond : dt;
    const progressedSeconds = Math.max(0, Math.min(dt, remainingUpgradeTime, affordableSeconds));
    if (progressedSeconds <= 0) {
      continue;
    }

    upgrade.progressSeconds += progressedSeconds;
    player.resources = Math.max(0, player.resources - progressedSeconds * spendPerSecond);
    markPlayerDirty(state, player.id);

    if (upgrade.progressSeconds + 0.0001 < definition.upgradeTime) {
      continue;
    }

    completeTechUpgrade(state, player.id, definition);
  }
}

export function getTechUpgradeCostPerSecond(definition) {
  if (definition.upgradeTime <= 0) {
    return 0;
  }

  return definition.cost / definition.upgradeTime;
}

function completeTechUpgrade(state, playerId, definition) {
  const player = getPlayerById(state, playerId);
  player.techTier = definition.tier;
  player.activeTechUpgrade = null;
  markPlayerDirty(state, player.id);
  pushLog(state, `${player.name} upgraded Tech Center to ${definition.displayName}.`);
}
