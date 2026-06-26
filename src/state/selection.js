import { getEntityById } from "./entities.js";

export function getSelectedEntities(state) {
  if (state.selectedEntityIds.length === 0) {
    return [];
  }

  return state.selectedEntityIds
    .map((entityId) => getEntityById(state, entityId))
    .filter(Boolean);
}

export function setSelectedEntities(state, entityIds, primaryEntityId = entityIds[0] ?? null) {
  const seen = new Set();
  const nextSelectedEntityIds = [];

  for (const entityId of entityIds) {
    if (!entityId || seen.has(entityId)) {
      continue;
    }

    seen.add(entityId);
    nextSelectedEntityIds.push(entityId);
  }

  state.selectedEntityIds = nextSelectedEntityIds;
  state.selectedEntityId = primaryEntityId && seen.has(primaryEntityId)
    ? primaryEntityId
    : nextSelectedEntityIds[0] ?? null;
}

export function addSelectedEntity(state, entityId) {
  if (!entityId) {
    return false;
  }

  if (state.selectedEntityIds.includes(entityId)) {
    state.selectedEntityId = entityId;
    return true;
  }

  setSelectedEntities(state, [...state.selectedEntityIds, entityId], entityId);
  return true;
}
