import { pushLog } from "../gameState.js";
import { markPlayerDirty } from "../multiplayer/replicationDirtyState.js";
import { markEntityDirty } from "../multiplayer/replicationDirtyState.js";
import { getEntityById, getPlayerById } from "../state/entities.js";
import { applyBaseTierStatsToBaseEntity } from "./baseTierState.js";

export function updateBaseUpgrades(state, dt) {
  for (const player of state.players) {
    if (!player.activeBaseUpgrade) {
      continue;
    }

    const upgrade = player.activeBaseUpgrade;
    const definition = state.catalog.baseTiers[upgrade.targetTier];
    const spendPerSecond = getBaseUpgradeCostPerSecond(definition);
    const remainingUpgradeTime = definition.upgradeTime - upgrade.progressSeconds;
    if (remainingUpgradeTime <= 0) {
      completeBaseUpgrade(state, player, definition);
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

    completeBaseUpgrade(state, player, definition);
  }
}

export function getBaseUpgradeCostPerSecond(definition) {
  if (definition.upgradeTime <= 0) {
    return 0;
  }

  return definition.cost / definition.upgradeTime;
}

function completeBaseUpgrade(state, player, definition) {
  const base = getEntityById(state, player.startingBaseId);
  if (!base) {
    throw new Error(`Missing starting base for player ${player.id}.`);
  }

  player.baseTier = definition.tier;
  player.activeBaseUpgrade = null;
  applyBaseTierStatsToBaseEntity(base, definition, { preserveHealthDelta: true });
  markEntityDirty(state, base.id);
  markPlayerDirty(state, player.id);
  pushLog(state, `${player.name} upgraded main base to ${definition.displayName}.`);
}
