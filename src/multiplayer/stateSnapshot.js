import { setSelectedEntities } from "../state/selection.js";
import { rebuildTerritoryDerivedState } from "../systems/territory.js";
import { clearReplicationDirtyState } from "./replicationDirtyState.js";
import {
  getEntityById,
  replaceEntityCollection,
  upsertEntity
} from "../state/entities.js";

export function createReplicationBaseline(state) {
  return {
    tick: state.simulation.currentTick,
    matchTimeSeconds: state.matchTimeSeconds,
    matchEnded: state.matchEnded,
    winnerId: state.winnerId,
    players: state.players.map(clonePlayer),
    entities: state.entities.map(cloneEntity),
    mapObjectives: {
      controlStructures: state.mapObjectives.controlStructures.map(cloneControlStructureState)
    },
    territory: {
      cells: state.territory.cells.map(cloneTerritoryCellState)
    },
    log: state.log.map((entry) => ({ ...entry }))
  };
}

export function createReplicationDelta(state, replicationState) {
  const entityCreates = [];
  const entityUpdates = [];
  const entityDeletes = [...state.replicationDirty.destroyedEntityIds];

  for (const entityId of state.replicationDirty.createdEntityIds) {
    const entity = getEntityById(state, entityId);
    if (entity) {
      entityCreates.push(cloneEntity(entity));
    }
  }

  for (const entityId of state.replicationDirty.dirtyEntityIds) {
    const entity = getEntityById(state, entityId);
    if (entity) {
      entityUpdates.push(cloneEntity(entity));
    }
  }

  const playerUpdates = [];
  for (const playerId of state.replicationDirty.dirtyPlayerIds) {
    const player = state.players.find((candidate) => candidate.id === playerId);
    if (player) {
      playerUpdates.push(clonePlayer(player));
    }
  }

  const territoryDiffs = [];
  for (const index of state.replicationDirty.dirtyTerritoryCellIndexes) {
    const nextCell = state.territory.cells[index];
    if (nextCell) {
      territoryDiffs.push({
        index,
        ownerId: nextCell.ownerId,
        control: nextCell.control
      });
    }
  }

  const mapObjectiveDiffs = [];
  for (const objectiveId of state.replicationDirty.dirtyMapObjectiveIds) {
    const objective = state.mapObjectives.controlStructures.find((candidate) => candidate.id === objectiveId);
    if (objective) {
      mapObjectiveDiffs.push(cloneControlStructureState(objective));
    }
  }

  const match = {
    tick: state.simulation.currentTick,
    matchTimeSeconds: state.matchTimeSeconds,
    matchEnded: state.matchEnded,
    winnerId: state.winnerId,
    log: state.log.map((entry) => ({ ...entry }))
  };

  return {
    type: "replication_delta",
    match,
    players: playerUpdates,
    entities: {
      create: entityCreates,
      update: entityUpdates,
      destroy: entityDeletes
    },
    mapObjectives: mapObjectiveDiffs,
    territory: territoryDiffs
  };
}

export function applyReplicationBaseline(state, baseline) {
  applyMatchEnvelope(state, baseline);
  state.players = baseline.players.map(clonePlayer);
  replaceEntityCollection(state, baseline.entities.map(cloneEntity));
  applyMapObjectiveBaseline(state, baseline.mapObjectives);
  let territoryChanged = false;

  for (let index = 0; index < state.territory.cells.length; index += 1) {
    const nextCellState = baseline.territory.cells[index];
    if (!nextCellState) {
      continue;
    }

    const cell = state.territory.cells[index];
    if (cell.ownerId !== nextCellState.ownerId || cell.control !== nextCellState.control) {
      territoryChanged = true;
    }

    cell.ownerId = nextCellState.ownerId;
    cell.control = nextCellState.control;
  }

  if (territoryChanged) {
    state.territory.visualRevision += 1;
  }
  rebuildTerritoryDerivedState(state, { rebuildInfluence: false });

  reconcileSelection(state);
}

export function applyReplicationDelta(state, delta) {
  applyMatchEnvelope(state, delta.match);
  let territoryChanged = false;

  for (const playerUpdate of delta.players) {
    const playerIndex = state.players.findIndex((player) => player.id === playerUpdate.id);
    if (playerIndex === -1) {
      state.players.push(clonePlayer(playerUpdate));
      continue;
    }

    state.players[playerIndex] = clonePlayer(playerUpdate);
  }

  for (const entity of delta.entities.create) {
    upsertEntity(state, cloneEntity(entity));
  }

  for (const entity of delta.entities.update) {
    upsertEntity(state, cloneEntity(entity));
  }

  if (delta.entities.destroy.length > 0) {
    const destroyedIds = new Set(delta.entities.destroy);
    replaceEntityCollection(state, state.entities.filter((entity) => !destroyedIds.has(entity.id)));
  }

  applyMapObjectiveDelta(state, delta.mapObjectives ?? []);

  for (const cellUpdate of delta.territory) {
    const cell = state.territory.cells[cellUpdate.index];
    if (!cell) {
      continue;
    }

    if (cell.ownerId !== cellUpdate.ownerId || cell.control !== cellUpdate.control) {
      territoryChanged = true;
    }

    cell.ownerId = cellUpdate.ownerId;
    cell.control = cellUpdate.control;
  }

  if (territoryChanged) {
    state.territory.visualRevision += 1;
  }
  rebuildTerritoryDerivedState(state, { rebuildInfluence: false });

  reconcileSelection(state);
}

export function createReplicationStateTracker(state) {
  return {
    entityById: new Map(state.entities.map((entity) => [entity.id, cloneEntity(entity)])),
    playerById: new Map(state.players.map((player) => [player.id, clonePlayer(player)])),
    mapObjectives: state.mapObjectives.controlStructures.map(cloneControlStructureState),
    territoryCells: state.territory.cells.map(cloneTerritoryCellState)
  };
}

export function updateReplicationStateTracker(state, replicationState) {
  replicationState.entityById = new Map(state.entities.map((entity) => [entity.id, cloneEntity(entity)]));
  replicationState.playerById = new Map(state.players.map((player) => [player.id, clonePlayer(player)]));
  replicationState.mapObjectives = state.mapObjectives.controlStructures.map(cloneControlStructureState);
  replicationState.territoryCells = state.territory.cells.map(cloneTerritoryCellState);
  clearReplicationDirtyState(state);
}

function applyMatchEnvelope(state, match) {
  state.simulation.currentTick = match.tick;
  state.matchTimeSeconds = match.matchTimeSeconds;
  state.matchEnded = match.matchEnded;
  state.winnerId = match.winnerId;
  state.log = match.log.map((entry) => ({ ...entry }));
  state.uiScreen = match.matchEnded ? "post_match" : "playing";
}

function reconcileSelection(state) {
  const survivingSelectedEntityIds = state.selectedEntityIds.filter((entityId) => {
    return state.entities.some((entity) => entity.id === entityId);
  });

  setSelectedEntities(state, survivingSelectedEntityIds, state.selectedEntityId);
}

function clonePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    resources: player.resources,
    cumulativeResourceGain: player.cumulativeResourceGain,
    resourceMultiplier: player.resourceMultiplier,
    constructionPriorityIndex: player.constructionPriorityIndex,
    productionPriorityIndex: player.productionPriorityIndex,
    baseTier: player.baseTier,
    activeBaseUpgrade: player.activeBaseUpgrade ? { ...player.activeBaseUpgrade } : null,
    techTier: player.techTier,
    activeTechUpgrade: player.activeTechUpgrade ? { ...player.activeTechUpgrade } : null,
    researchedTechIds: [...player.researchedTechIds],
    researchProgressByTechId: { ...player.researchProgressByTechId },
    researchQueue: [...player.researchQueue],
    activeResearch: player.activeResearch ? { ...player.activeResearch } : null,
    notifications: [...player.notifications],
    startingBaseId: player.startingBaseId,
    aiState: null
  };
}

function cloneEntity(entity) {
  return {
    ...entity,
    defense: entity.defense ? { ...entity.defense } : entity.defense,
    waypointChain: Array.isArray(entity.waypointChain) ? entity.waypointChain.map(clonePoint) : entity.waypointChain,
    waypoints: Array.isArray(entity.waypoints) ? entity.waypoints.map(clonePoint) : entity.waypoints,
    movementGoal: entity.movementGoal ? { ...entity.movementGoal } : entity.movementGoal,
    movementCorridor: Array.isArray(entity.movementCorridor) ? entity.movementCorridor.map(clonePoint) : entity.movementCorridor,
    movementPathValidity: cloneNavigationPathValidity(entity.movementPathValidity),
    leashAnchorPosition: entity.leashAnchorPosition ? clonePoint(entity.leashAnchorPosition) : entity.leashAnchorPosition,
    spawnExitPoint: entity.spawnExitPoint ? clonePoint(entity.spawnExitPoint) : entity.spawnExitPoint
  };
}

function cloneTerritoryCellState(cell) {
  return {
    ownerId: cell.ownerId,
    control: cell.control
  };
}

function cloneControlStructureState(structure) {
  return {
    id: structure.id,
    control: structure.control,
    ownerId: structure.ownerId
  };
}

function applyMapObjectiveBaseline(state, baselineObjectives) {
  if (!baselineObjectives?.controlStructures || !state.mapObjectives) {
    return;
  }

  for (const nextObjectiveState of baselineObjectives.controlStructures) {
    const objective = state.mapObjectives.controlStructures.find((candidate) => candidate.id === nextObjectiveState.id);
    if (!objective) {
      continue;
    }

    objective.control = nextObjectiveState.control;
    objective.ownerId = nextObjectiveState.ownerId ?? null;
  }
}

function applyMapObjectiveDelta(state, objectiveDiffs) {
  if (!state.mapObjectives) {
    return;
  }

  for (const objectiveUpdate of objectiveDiffs) {
    const objective = state.mapObjectives.controlStructures.find((candidate) => candidate.id === objectiveUpdate.id);
    if (!objective) {
      continue;
    }

    objective.control = objectiveUpdate.control;
    objective.ownerId = objectiveUpdate.ownerId ?? null;
  }
}

function clonePoint(point) {
  return {
    x: point.x,
    y: point.y
  };
}

function cloneNavigationPathValidity(validity) {
  if (!validity) {
    return validity;
  }

  return {
    staticNavRevision: validity.staticNavRevision,
    regionIndexes: Array.isArray(validity.regionIndexes) ? [...validity.regionIndexes] : [],
    regionRevisions: Array.isArray(validity.regionRevisions) ? [...validity.regionRevisions] : []
  };
}
