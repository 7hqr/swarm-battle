export function createReplicationDirtyState() {
  return {
    createdEntityIds: new Set(),
    dirtyEntityIds: new Set(),
    destroyedEntityIds: new Set(),
    dirtyPlayerIds: new Set(),
    dirtyTerritoryCellIndexes: new Set(),
    dirtyMapObjectiveIds: new Set(),
    matchDirty: false
  };
}

export function markMatchDirty(state) {
  state.replicationDirty.matchDirty = true;
}

export function markPlayerDirty(state, playerId) {
  if (!playerId) {
    return;
  }

  state.replicationDirty.dirtyPlayerIds.add(playerId);
  markMatchDirty(state);
}

export function markEntityDirty(state, entityId) {
  if (!entityId) {
    return;
  }

  if (!state.replicationDirty.createdEntityIds.has(entityId)) {
    state.replicationDirty.dirtyEntityIds.add(entityId);
  }
  markMatchDirty(state);
}

export function markEntityCreated(state, entityId) {
  if (!entityId) {
    return;
  }

  state.replicationDirty.createdEntityIds.add(entityId);
  state.replicationDirty.dirtyEntityIds.delete(entityId);
  state.replicationDirty.destroyedEntityIds.delete(entityId);
  markMatchDirty(state);
}

export function markEntityDestroyed(state, entityId) {
  if (!entityId) {
    return;
  }

  if (state.replicationDirty.createdEntityIds.has(entityId)) {
    state.replicationDirty.createdEntityIds.delete(entityId);
    state.replicationDirty.dirtyEntityIds.delete(entityId);
    return;
  }

  state.replicationDirty.dirtyEntityIds.delete(entityId);
  state.replicationDirty.destroyedEntityIds.add(entityId);
  markMatchDirty(state);
}

export function markTerritoryCellDirty(state, cellIndex) {
  if (cellIndex < 0) {
    return;
  }

  state.replicationDirty.dirtyTerritoryCellIndexes.add(cellIndex);
  markMatchDirty(state);
}

export function markMapObjectiveDirty(state, objectiveId) {
  if (!objectiveId) {
    return;
  }

  state.replicationDirty.dirtyMapObjectiveIds.add(objectiveId);
  markMatchDirty(state);
}

export function clearReplicationDirtyState(state) {
  state.replicationDirty.createdEntityIds.clear();
  state.replicationDirty.dirtyEntityIds.clear();
  state.replicationDirty.destroyedEntityIds.clear();
  state.replicationDirty.dirtyPlayerIds.clear();
  state.replicationDirty.dirtyTerritoryCellIndexes.clear();
  state.replicationDirty.dirtyMapObjectiveIds.clear();
  state.replicationDirty.matchDirty = false;
}
