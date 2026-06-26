import {
  getEntityById,
  getPlayerById,
  isPlayerAiControlled
} from "./entities.js";

export function getLocalPlayerId(state) {
  return state.localPlayerId ?? null;
}

export function getLocalPlayer(state) {
  const localPlayerId = getLocalPlayerId(state);
  return localPlayerId ? getPlayerById(state, localPlayerId) : null;
}

export function hasLocalPlayer(state) {
  return !!getLocalPlayerId(state);
}

export function isObserverMode(state) {
  const localPlayerId = getLocalPlayerId(state);
  if (!localPlayerId) {
    return true;
  }

  return isPlayerAiControlled(state, localPlayerId);
}

export function canLocalPlayerIssueCommands(state) {
  return state.hasActiveMatch && state.uiScreen === "playing" && !state.matchEnded && !isObserverMode(state);
}

export function isLocalPlayerEntity(state, entityId) {
  const localPlayerId = getLocalPlayerId(state);
  const entity = getEntityById(state, entityId);
  return !!localPlayerId && !!entity && entity.ownerId === localPlayerId;
}
