const ENTITY_SPATIAL_CELL_SIZE = 120;

export function getPlayerById(state, playerId) {
  return state.players.find((player) => player.id === playerId) ?? null;
}

export function isPlayerAiControlled(state, playerId) {
  return !!getPlayerById(state, playerId)?.aiState;
}

export function getEntityById(state, entityId) {
  if (!entityId) {
    return null;
  }

  return getEntityIndexes(state).byId.get(entityId) ?? null;
}

export function getEnemyBase(state, playerId) {
  const enemyBaseByOwnerId = getEntityIndexes(state).enemyBaseByOwnerId;
  for (const [ownerId, entity] of enemyBaseByOwnerId) {
    if (ownerId !== playerId) {
      return entity;
    }
  }

  return null;
}

export function getEntitiesByType(state, type) {
  return getEntityIndexes(state).byType.get(type) ?? [];
}

export function getOwnedBuildings(state, playerId, kind = null) {
  const playerBuckets = getEntityIndexes(state).byOwnerId.get(playerId);
  if (!playerBuckets) {
    return [];
  }

  if (!kind) {
    return playerBuckets.buildings;
  }

  return playerBuckets.buildingsByKind.get(kind) ?? [];
}

export function getOwnedUnits(state, playerId) {
  return getEntityIndexes(state).byOwnerId.get(playerId)?.units ?? [];
}

export function getEntitySpatialIndex(state) {
  state.entitySpatialIndex ??= {
    revision: -1,
    index: null
  };

  const revision = state.entitySpatialIndexRevision ?? 0;
  if (state.entitySpatialIndex.revision === revision && state.entitySpatialIndex.index) {
    return state.entitySpatialIndex.index;
  }

  const index = createEntitySpatialIndexSnapshot(state.entities);
  state.entitySpatialIndex = {
    revision,
    index
  };
  return index;
}

export function createEntitySpatialIndexSnapshot(entities) {
  const byType = new Map([
    ["unit", new Map()],
    ["building", new Map()],
    ["projectile", new Map()],
    ["all", new Map()]
  ]);

  for (const entity of entities) {
    if (entity.health <= 0) {
      continue;
    }

    addEntityToSpatialBuckets(byType.get("all"), entity);
    const typeBuckets = byType.get(entity.type);
    if (typeBuckets) {
      addEntityToSpatialBuckets(typeBuckets, entity);
    }
  }

  return {
    cellSize: ENTITY_SPATIAL_CELL_SIZE,
    byType
  };
}

export function queryEntitySpatialIndex(index, type, point, radius) {
  const buckets = index.byType.get(type);
  if (!buckets) {
    return [];
  }

  const results = [];
  const seen = new Set();
  const minColumn = Math.floor((point.x - radius) / index.cellSize);
  const maxColumn = Math.floor((point.x + radius) / index.cellSize);
  const minRow = Math.floor((point.y - radius) / index.cellSize);
  const maxRow = Math.floor((point.y + radius) / index.cellSize);

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const bucket = buckets.get(`${column},${row}`);
      if (!bucket) {
        continue;
      }

      for (const entity of bucket) {
        if (seen.has(entity.id)) {
          continue;
        }

        seen.add(entity.id);
        results.push(entity);
      }
    }
  }

  return results;
}

export function isPlayerOwnedEntity(state, entityId, playerId) {
  const entity = getEntityById(state, entityId);
  return !!entity && entity.ownerId === playerId;
}

export function isBuildingOperational(entity) {
  return entity.type === "building" && entity.isConstructed;
}

export function getAllHostileTargets(state, ownerId) {
  const indexes = getEntityIndexes(state);
  const hostileUnits = indexes.byType.get("unit")?.filter((entity) => entity.ownerId !== ownerId) ?? [];
  const hostileBuildings = indexes.byType.get("building")?.filter((entity) => entity.ownerId !== ownerId) ?? [];
  return [...hostileUnits, ...hostileBuildings];
}

export function addEntity(state, entity) {
  state.entities.push(entity);
  invalidateEntityIndexes(state);
}

export function replaceEntityCollection(state, entities) {
  state.entities = entities;
  invalidateEntityIndexes(state);
}

export function upsertEntity(state, entity) {
  const entityIndexes = getEntityIndexes(state);
  const existingIndex = entityIndexes.arrayIndexById.get(entity.id);
  if (existingIndex === undefined) {
    state.entities.push(entity);
  } else {
    state.entities[existingIndex] = entity;
  }
  invalidateEntityIndexes(state);
}

export function invalidateEntityIndexes(state) {
  state.entityIndexRevision = (state.entityIndexRevision ?? 0) + 1;
  invalidateEntitySpatialIndex(state);
}

export function invalidateEntitySpatialIndex(state) {
  state.entitySpatialIndexRevision = (state.entitySpatialIndexRevision ?? 0) + 1;
}

function getEntityIndexes(state) {
  state.entityIndexes ??= {
    revision: -1,
    byId: new Map(),
    arrayIndexById: new Map(),
    byType: new Map(),
    byOwnerId: new Map(),
    enemyBaseByOwnerId: new Map()
  };

  if (state.entityIndexes.revision === (state.entityIndexRevision ?? 0)) {
    return state.entityIndexes;
  }

  const byId = new Map();
  const arrayIndexById = new Map();
  const byType = new Map([
    ["unit", []],
    ["building", []],
    ["projectile", []]
  ]);
  const byOwnerId = new Map();
  const enemyBaseByOwnerId = new Map();

  for (let index = 0; index < state.entities.length; index += 1) {
    const entity = state.entities[index];
    byId.set(entity.id, entity);
    arrayIndexById.set(entity.id, index);

    const typeBucket = byType.get(entity.type);
    if (typeBucket) {
      typeBucket.push(entity);
    }

    let ownerBuckets = byOwnerId.get(entity.ownerId);
    if (!ownerBuckets) {
      ownerBuckets = {
        units: [],
        buildings: [],
        buildingsByKind: new Map()
      };
      byOwnerId.set(entity.ownerId, ownerBuckets);
    }

    if (entity.type === "unit") {
      ownerBuckets.units.push(entity);
      continue;
    }

    if (entity.type !== "building") {
      continue;
    }

    ownerBuckets.buildings.push(entity);
    const kindBucket = ownerBuckets.buildingsByKind.get(entity.kind);
    if (kindBucket) {
      kindBucket.push(entity);
    } else {
      ownerBuckets.buildingsByKind.set(entity.kind, [entity]);
    }

    if (entity.kind === "base") {
      enemyBaseByOwnerId.set(entity.ownerId, entity);
    }
  }

  state.entityIndexes = {
    revision: state.entityIndexRevision ?? 0,
    byId,
    arrayIndexById,
    byType,
    byOwnerId,
    enemyBaseByOwnerId
  };

  return state.entityIndexes;
}

function addEntityToSpatialBuckets(spatialIndex, entity) {
  const radius = entity.radius ?? 0;
  const minColumn = Math.floor((entity.x - radius) / ENTITY_SPATIAL_CELL_SIZE);
  const maxColumn = Math.floor((entity.x + radius) / ENTITY_SPATIAL_CELL_SIZE);
  const minRow = Math.floor((entity.y - radius) / ENTITY_SPATIAL_CELL_SIZE);
  const maxRow = Math.floor((entity.y + radius) / ENTITY_SPATIAL_CELL_SIZE);

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const key = `${column},${row}`;
      const bucket = spatialIndex.get(key);
      if (bucket) {
        bucket.push(entity);
      } else {
        spatialIndex.set(key, [entity]);
      }
    }
  }
}
