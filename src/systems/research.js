import { clearStoredResearchProgress, pushLog, tryStartQueuedResearch } from "../gameState.js";
import { markPlayerDirty } from "../multiplayer/replicationDirtyState.js";
import { getResearchCost } from "../rules/catalogRules.js";

export function updateResearch(state, dt) {
  for (const player of state.players) {
    if (!player.activeResearch) {
      tryStartQueuedResearch(state, player.id);
    }

    if (!player.activeResearch) {
      continue;
    }

    const research = player.activeResearch;
    if (research.isPaused) {
      continue;
    }

    const definition = state.catalog.tech[research.techId];
    const spendPerSecond = getResearchCostPerSecond(definition, getResearchCost(state, player.id, research.techId));
    const remainingResearchTime = definition.researchTime - research.progressSeconds;
    if (remainingResearchTime <= 0) {
      completeResearch(state, player, definition);
      continue;
    }

    const affordableSeconds = spendPerSecond > 0 ? player.resources / spendPerSecond : dt;
    const progressedSeconds = Math.max(0, Math.min(dt, remainingResearchTime, affordableSeconds));
    if (progressedSeconds <= 0) {
      continue;
    }

    research.progressSeconds += progressedSeconds;
    player.resources = Math.max(0, player.resources - progressedSeconds * spendPerSecond);
    markPlayerDirty(state, player.id);

    if (research.progressSeconds + 0.0001 < definition.researchTime) {
      continue;
    }

    completeResearch(state, player, definition);
  }
}

export function getResearchCostPerSecond(definition, cost = definition.cost) {
  if (definition.researchTime <= 0) {
    return 0;
  }

  return cost / definition.researchTime;
}

function completeResearch(state, player, definition) {
  player.researchedTechIds.push(definition.id);
  clearStoredResearchProgress(player, definition.id);
  player.activeResearch = null;
  markPlayerDirty(state, player.id);
  pushLog(state, `${player.name} completed research: ${definition.displayName}.`);
  tryStartQueuedResearch(state, player.id);
}
