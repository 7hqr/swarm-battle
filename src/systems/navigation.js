export const DEFAULT_NAVIGATION_CELL_SIZE = 48;

const DEFAULT_NAVIGATION_REGION_CELL_SPAN = 6;

export function createNavigationState(map) {
  const cellSize = map.terrain?.navigationCellSize ?? DEFAULT_NAVIGATION_CELL_SIZE;
  const columns = Math.ceil(map.width / cellSize);
  const rows = Math.ceil(map.height / cellSize);
  const blockers = map.terrain?.blockers ?? [];
  const blockedCells = new Array(columns * rows).fill(false);
  const blockerPaddingRadius = cellSize * 0.35;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cellCenter = {
        x: column * cellSize + Math.min(cellSize, map.width - column * cellSize) * 0.5,
        y: row * cellSize + Math.min(cellSize, map.height - row * cellSize) * 0.5
      };
      if (doesCircleOverlapTerrainBlockers({ blockers }, cellCenter, blockerPaddingRadius)) {
        blockedCells[row * columns + column] = true;
      }
    }
  }

  const regionCellSpan = DEFAULT_NAVIGATION_REGION_CELL_SPAN;
  const regionColumns = Math.ceil(columns / regionCellSpan);
  const regionRows = Math.ceil(rows / regionCellSpan);

  return {
    cellSize,
    columns,
    rows,
    width: map.width,
    height: map.height,
    blockers,
    blockedCells,
    regionCellSpan,
    regionColumns,
    regionRows,
    staticNavRevision: 1,
    dynamicOccupancyRevision: 0,
    dynamicOccupancyGrid: new Uint16Array(columns * rows),
    regionRevisions: new Uint32Array(regionColumns * regionRows),
    pathCacheByRegion: new Map(),
    dirtyRegions: new Set(),
    pathing: createPathingState()
  };
}

export function processPathfindingQueue(state, budgetMs) {
  const navigation = state.navigation;
  if (!navigation?.pathing) {
    return 0;
  }

  const queue = navigation.pathing.queue;
  const queuedKeys = navigation.pathing.queuedKeys;
  const startedAtMs = performance.now();
  let processedCount = 0;

  while (queue.length > 0 && performance.now() - startedAtMs < budgetMs) {
    const job = queue.shift();
    queuedKeys.delete(job.requestKey);
    const pathResult = findPathResultToPoint(state, navigation, job.startPoint, job.endPoint, job.options);

    if (pathResult) {
      cacheNavigationPath(navigation, job.requestKey, {
        status: "ready",
        path: pathResult.path,
        validity: pathResult.validity
      });
    } else {
      navigation.pathing.cache.delete(job.requestKey);
    }

    processedCount += 1;
  }

  return processedCount;
}

export function requestNavigationPath(state, startPoint, endPoint, navigationKey, options = {}) {
  const navigation = state.navigation;
  if (!navigation?.pathing) {
    return {
      status: "failed",
      requestKey: null,
      path: null,
      validity: null
    };
  }

  const normalizedOptions = normalizePathRequestOptions(options);
  const requestKey = buildPathRequestKey(navigation, startPoint, endPoint, navigationKey, normalizedOptions);
  const cachedEntry = navigation.pathing.cache.get(requestKey);
  if (cachedEntry) {
    if (cachedEntry.status === "pending" || isNavigationPathValid(state, cachedEntry.validity)) {
      return {
        status: cachedEntry.status,
        requestKey,
        path: cachedEntry.path,
        validity: cachedEntry.validity
      };
    }

    uncacheNavigationPath(navigation, requestKey, cachedEntry.validity);
  }

  if (!navigation.pathing.queuedKeys.has(requestKey)) {
    navigation.pathing.queue.push({
      requestKey,
      startPoint: clonePoint(startPoint),
      endPoint: clonePoint(endPoint),
      options: normalizedOptions
    });
    navigation.pathing.queuedKeys.add(requestKey);
  }

  navigation.pathing.cache.set(requestKey, {
    status: "pending",
    path: null,
    validity: null
  });

  return {
    status: "pending",
    requestKey,
    path: null,
    validity: null
  };
}

export function invalidateNavigationBlockers(state, dirtyBlockers = null) {
  const navigation = state.navigation;
  if (!navigation?.pathing) {
    return;
  }

  rebuildDynamicOccupancyGrid(state, navigation);
  navigation.dynamicOccupancyRevision = (navigation.dynamicOccupancyRevision ?? 0) + 1;

  const dirtyRegionIndexes = resolveDirtyRegionIndexes(navigation, dirtyBlockers);
  navigation.dirtyRegions = new Set(dirtyRegionIndexes.map((regionIndex) => getRegionKey(navigation, regionIndex)));

  for (const regionIndex of dirtyRegionIndexes) {
    navigation.regionRevisions[regionIndex] += 1;
  }

  evictNavigationPathsForDirtyRegions(navigation, dirtyRegionIndexes);
}

export function doesCircleOverlapTerrain(state, point, radius) {
  return doesCircleOverlapTerrainBlockers(state.navigation, point, radius);
}

export function doesCircleOverlapBlockers(state, point, radius, options = {}) {
  const navigation = state?.navigation ?? state;
  if (!navigation) {
    return false;
  }

  return (
    doesCircleOverlapTerrainBlockers(navigation, point, radius) ||
    (state?.navigation ? doesCircleOverlapBlockingBuildings(state, point, radius, options) : false)
  );
}

export function isPointInsideAnyBlocker(point, blockers) {
  return blockers.some((blocker) => isPointInsideBlocker(point, blocker));
}

export function canMoveDirectlyToPoint(state, startPoint, endPoint, radius = 0, options = {}) {
  const navigation = state.navigation;
  if (!navigation) {
    return true;
  }

  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) {
    return !doesCircleOverlapBlockers(state, startPoint, radius, options);
  }

  const sampleStep = Math.max(16, navigation.cellSize * 0.5);
  const sampleCount = Math.max(1, Math.ceil(distance / sampleStep));

  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    const samplePoint = {
      x: startPoint.x + dx * t,
      y: startPoint.y + dy * t
    };
    if (doesCircleOverlapBlockers(state, samplePoint, radius, options)) {
      return false;
    }
  }

  return true;
}

export function findPathToPoint(state, navigation, startPoint, endPoint, options = {}) {
  return findPathResultToPoint(state, navigation, startPoint, endPoint, options)?.path ?? null;
}

export function resolvePointToNavigablePosition(navigation, point, radius = 0, options = {}) {
  const state = navigation?.navigation ? navigation : null;
  const resolvedNavigation = state?.navigation ?? navigation;
  if (!resolvedNavigation) {
    return null;
  }

  const clampedPoint = {
    x: clamp(point.x, radius, resolvedNavigation.width - radius),
    y: clamp(point.y, radius, resolvedNavigation.height - radius)
  };

  if (!doesCircleOverlapBlockers(state ?? resolvedNavigation, clampedPoint, radius, options)) {
    return clampedPoint;
  }

  const searchStep = Math.max(12, resolvedNavigation.cellSize * 0.5);
  const maxSearchRadius = Math.max(resolvedNavigation.cellSize * 10, 240);

  for (let searchRadius = searchStep; searchRadius <= maxSearchRadius; searchRadius += searchStep) {
    const sampleCount = Math.max(12, Math.ceil((Math.PI * 2 * searchRadius) / searchStep));

    for (let index = 0; index < sampleCount; index += 1) {
      const angle = (Math.PI * 2 * index) / sampleCount;
      const candidate = {
        x: clamp(clampedPoint.x + Math.cos(angle) * searchRadius, radius, resolvedNavigation.width - radius),
        y: clamp(clampedPoint.y + Math.sin(angle) * searchRadius, radius, resolvedNavigation.height - radius)
      };

      if (!doesCircleOverlapBlockers(state ?? resolvedNavigation, candidate, radius, options)) {
        return candidate;
      }
    }
  }

  return null;
}

export function resolveCircleOutsideBlockers(navigation, point, radius, options = {}) {
  const state = navigation?.navigation ? navigation : null;
  const resolvedNavigation = state?.navigation ?? navigation;
  if (!resolvedNavigation) {
    return false;
  }

  const maxIterations = options.maxIterations ?? 6;
  let moved = false;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let overlapped = false;

    for (const blocker of resolvedNavigation.blockers) {
      const correction = getBlockerSeparationVector(point, radius, blocker);
      if (!correction) {
        continue;
      }

      point.x += correction.x;
      point.y += correction.y;
      moved = true;
      overlapped = true;
    }

    if (state) {
      const excludedBuildingIds = options.excludedBuildingIds ?? null;
      for (const building of getBlockingBuildings(state, point, radius + getMaximumBuildingRadius(state))) {
        if (excludedBuildingIds?.has(building.id)) {
          continue;
        }

        const correction = getCircleSeparationVector(point, radius, building);
        if (!correction) {
          continue;
        }

        point.x += correction.x;
        point.y += correction.y;
        moved = true;
        overlapped = true;
      }
    }

    point.x = clamp(point.x, radius, resolvedNavigation.width - radius);
    point.y = clamp(point.y, radius, resolvedNavigation.height - radius);

    if (!overlapped) {
      break;
    }
  }

  return moved;
}

export function isNavigationPathValid(state, validity) {
  if (!validity) {
    return false;
  }

  const navigation = state.navigation;
  if (!navigation) {
    return false;
  }

  if ((navigation.staticNavRevision ?? 0) !== (validity.staticNavRevision ?? -1)) {
    return false;
  }

  const regionIndexes = validity.regionIndexes ?? [];
  const regionRevisions = validity.regionRevisions ?? [];
  for (let index = 0; index < regionIndexes.length; index += 1) {
    if ((navigation.regionRevisions[regionIndexes[index]] ?? 0) !== (regionRevisions[index] ?? -1)) {
      return false;
    }
  }

  return true;
}

export function createDirectPathValidity(state, startPoint, endPoint, radius = 0) {
  const navigation = state.navigation;
  if (!navigation) {
    return null;
  }

  const minX = Math.min(startPoint.x, endPoint.x) - radius;
  const maxX = Math.max(startPoint.x, endPoint.x) + radius;
  const minY = Math.min(startPoint.y, endPoint.y) - radius;
  const maxY = Math.max(startPoint.y, endPoint.y) + radius;
  const regionIndexes = collectRegionIndexesForBounds(navigation, {
    left: clamp(minX, 0, navigation.width),
    right: clamp(maxX, 0, navigation.width),
    top: clamp(minY, 0, navigation.height),
    bottom: clamp(maxY, 0, navigation.height)
  });

  return buildPathValidity(navigation, regionIndexes);
}

function doesCircleOverlapTerrainBlockers(navigation, point, radius) {
  if (!navigation || navigation.blockers.length === 0) {
    return false;
  }

  if (!Array.isArray(navigation.blockedCells) || navigation.columns === undefined || navigation.rows === undefined) {
    for (const blocker of navigation.blockers) {
      if (doesCircleOverlapBlocker(point, radius, blocker)) {
        return true;
      }
    }

    return false;
  }

  const bounds = getNavigationBoundsForCircle(navigation, point, radius);

  for (let row = bounds.top; row <= bounds.bottom; row += 1) {
    for (let column = bounds.left; column <= bounds.right; column += 1) {
      const index = row * navigation.columns + column;
      if (!navigation.blockedCells[index]) {
        continue;
      }

      for (const blocker of navigation.blockers) {
        if (doesCircleOverlapBlocker(point, radius, blocker)) {
          return true;
        }
      }
    }
  }

  return false;
}

function findPathResultToPoint(state, navigation, startPoint, endPoint, options = {}) {
  if (!navigation) {
    return {
      path: [],
      validity: null
    };
  }

  const normalizedOptions = normalizePathRequestOptions(options);
  const blockedCellCache = new Map();
  const startCell = findNearestOpenCell(
    state,
    navigation,
    getCellFromWorldPoint(navigation, startPoint),
    blockedCellCache,
    normalizedOptions
  );
  const goalCell = findNearestOpenCell(
    state,
    navigation,
    getCellFromWorldPoint(navigation, endPoint),
    blockedCellCache,
    normalizedOptions
  );
  if (!startCell || !goalCell) {
    return null;
  }

  if (startCell.column === goalCell.column && startCell.row === goalCell.row) {
    return {
      path: [],
      validity: createDirectPathValidity(state, startPoint, endPoint, normalizedOptions.radius ?? 0)
    };
  }

  const startKey = getCellKey(startCell.column, startCell.row);
  const openSet = [startKey];
  const openSetKeys = new Set(openSet);
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const fScore = new Map([[startKey, getOctileDistance(startCell, goalCell)]]);

  while (openSet.length > 0) {
    let currentIndex = 0;
    let currentKey = openSet[0];
    let currentScore = fScore.get(currentKey) ?? Number.POSITIVE_INFINITY;

    for (let index = 1; index < openSet.length; index += 1) {
      const candidateKey = openSet[index];
      const candidateScore = fScore.get(candidateKey) ?? Number.POSITIVE_INFINITY;
      if (candidateScore < currentScore) {
        currentIndex = index;
        currentKey = candidateKey;
        currentScore = candidateScore;
      }
    }

    openSet.splice(currentIndex, 1);
    openSetKeys.delete(currentKey);
    const currentCell = parseCellKey(currentKey);

    if (currentCell.column === goalCell.column && currentCell.row === goalCell.row) {
      const cellPath = reconstructCellPath(cameFrom, currentKey);
      return {
        path: buildWorldPath(
          state,
          navigation,
          cellPath,
          startPoint,
          endPoint,
          normalizedOptions
        ),
        validity: buildPathValidityForCellPath(navigation, cellPath)
      };
    }

    for (const neighbor of getNeighborCells(navigation, currentCell)) {
      if (isBlockedCell(state, navigation, neighbor.column, neighbor.row, blockedCellCache, normalizedOptions)) {
        continue;
      }

      if (
        neighbor.column !== currentCell.column &&
        neighbor.row !== currentCell.row &&
        (
          isBlockedCell(state, navigation, currentCell.column, neighbor.row, blockedCellCache, normalizedOptions) ||
          isBlockedCell(state, navigation, neighbor.column, currentCell.row, blockedCellCache, normalizedOptions)
        )
      ) {
        continue;
      }

      const neighborKey = getCellKey(neighbor.column, neighbor.row);
      const tentativeGScore = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + neighbor.cost;
      if (tentativeGScore >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(neighborKey, currentKey);
      gScore.set(neighborKey, tentativeGScore);
      fScore.set(neighborKey, tentativeGScore + getOctileDistance(neighbor, goalCell));

      if (!openSetKeys.has(neighborKey)) {
        openSet.push(neighborKey);
        openSetKeys.add(neighborKey);
      }
    }
  }

  return null;
}

function getNavigationBoundsForCircle(navigation, point, radius) {
  const maxColumn = navigation.columns - 1;
  const maxRow = navigation.rows - 1;

  return {
    left: clamp(Math.floor((point.x - radius) / navigation.cellSize), 0, maxColumn),
    right: clamp(Math.floor((point.x + radius) / navigation.cellSize), 0, maxColumn),
    top: clamp(Math.floor((point.y - radius) / navigation.cellSize), 0, maxRow),
    bottom: clamp(Math.floor((point.y + radius) / navigation.cellSize), 0, maxRow)
  };
}

function doesCircleOverlapBlocker(point, radius, blocker) {
  if (blocker.kind === "circle") {
    const distance = Math.hypot(point.x - blocker.x, point.y - blocker.y);
    return distance < radius + blocker.radius;
  }

  if (blocker.kind === "rect") {
    const nearestX = clamp(point.x, blocker.x, blocker.x + blocker.width);
    const nearestY = clamp(point.y, blocker.y, blocker.y + blocker.height);
    const distance = Math.hypot(point.x - nearestX, point.y - nearestY);
    return distance < radius;
  }

  throw new Error(`Unsupported terrain blocker kind: ${blocker.kind}`);
}

function getBlockerSeparationVector(point, radius, blocker) {
  if (blocker.kind === "circle") {
    const dx = point.x - blocker.x;
    const dy = point.y - blocker.y;
    const distance = Math.hypot(dx, dy);
    const minimumDistance = radius + blocker.radius;
    if (distance >= minimumDistance) {
      return null;
    }

    if (distance === 0) {
      return { x: minimumDistance, y: 0 };
    }

    const overlap = minimumDistance - distance;
    return {
      x: (dx / distance) * overlap,
      y: (dy / distance) * overlap
    };
  }

  if (blocker.kind === "rect") {
    const nearestX = clamp(point.x, blocker.x, blocker.x + blocker.width);
    const nearestY = clamp(point.y, blocker.y, blocker.y + blocker.height);
    const dx = point.x - nearestX;
    const dy = point.y - nearestY;
    const distance = Math.hypot(dx, dy);

    if (distance > 0 && distance >= radius) {
      return null;
    }

    if (distance > 0) {
      const overlap = radius - distance;
      return {
        x: (dx / distance) * overlap,
        y: (dy / distance) * overlap
      };
    }

    const leftEscape = Math.abs(point.x - blocker.x);
    const rightEscape = Math.abs(blocker.x + blocker.width - point.x);
    const topEscape = Math.abs(point.y - blocker.y);
    const bottomEscape = Math.abs(blocker.y + blocker.height - point.y);
    const minimumEscape = Math.min(leftEscape, rightEscape, topEscape, bottomEscape);

    if (minimumEscape === leftEscape) {
      return { x: -(radius + leftEscape), y: 0 };
    }

    if (minimumEscape === rightEscape) {
      return { x: radius + rightEscape, y: 0 };
    }

    if (minimumEscape === topEscape) {
      return { x: 0, y: -(radius + topEscape) };
    }

    return { x: 0, y: radius + bottomEscape };
  }

  throw new Error(`Unsupported terrain blocker kind: ${blocker.kind}`);
}

function buildWorldPath(state, navigation, cellPath, startPoint, endPoint, options = {}) {
  if (cellPath.length === 0) {
    return [];
  }

  const trimmedCellPath = cellPath.slice(1);
  if (trimmedCellPath.length === 0) {
    return [endPoint];
  }

  const rawPoints = trimmedCellPath.map((cell) => getCellCenter(navigation, cell.column, cell.row));
  const smoothedPoints = [];
  let anchor = startPoint;
  let index = 0;

  while (index < rawPoints.length) {
    let furthestVisibleIndex = index;
    for (let candidateIndex = index + 1; candidateIndex < rawPoints.length; candidateIndex += 1) {
      if (!canMoveDirectlyToPoint(state, anchor, rawPoints[candidateIndex], options.radius ?? 8, options)) {
        break;
      }
      furthestVisibleIndex = candidateIndex;
    }

    const point = rawPoints[furthestVisibleIndex];
    smoothedPoints.push(point);
    anchor = point;
    index = furthestVisibleIndex + 1;
  }

  if (
    smoothedPoints.length > 0 &&
    canMoveDirectlyToPoint(state, smoothedPoints.at(-1), endPoint, options.radius ?? 8, options)
  ) {
    return smoothedPoints;
  }

  return [...smoothedPoints, endPoint];
}

function isPointInsideBlocker(point, blocker) {
  if (blocker.kind === "circle") {
    return Math.hypot(point.x - blocker.x, point.y - blocker.y) <= blocker.radius;
  }

  if (blocker.kind === "rect") {
    return (
      point.x >= blocker.x &&
      point.x <= blocker.x + blocker.width &&
      point.y >= blocker.y &&
      point.y <= blocker.y + blocker.height
    );
  }

  throw new Error(`Unsupported terrain blocker kind: ${blocker.kind}`);
}

function reconstructCellPath(cameFrom, goalKey) {
  const cells = [];
  let currentKey = goalKey;

  while (currentKey) {
    cells.push(parseCellKey(currentKey));
    currentKey = cameFrom.get(currentKey) ?? null;
  }

  cells.reverse();
  return cells;
}

function findNearestOpenCell(state, navigation, startCell, blockedCellCache, options = {}) {
  if (!startCell) {
    return null;
  }

  if (!isBlockedCell(state, navigation, startCell.column, startCell.row, blockedCellCache, options)) {
    return startCell;
  }

  const visited = new Set([getCellKey(startCell.column, startCell.row)]);
  const queue = [startCell];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const neighbor of getNeighborCells(navigation, current, false)) {
      const key = getCellKey(neighbor.column, neighbor.row);
      if (visited.has(key)) {
        continue;
      }

      if (!isBlockedCell(state, navigation, neighbor.column, neighbor.row, blockedCellCache, options)) {
        return neighbor;
      }

      visited.add(key);
      queue.push(neighbor);
    }
  }

  return null;
}

function getNeighborCells(navigation, cell, includeDiagonals = true) {
  const neighbors = [];
  const directions = includeDiagonals ? NEIGHBOR_DIRECTIONS : CARDINAL_DIRECTIONS;

  for (const direction of directions) {
    const column = cell.column + direction.column;
    const row = cell.row + direction.row;
    if (column < 0 || row < 0 || column >= navigation.columns || row >= navigation.rows) {
      continue;
    }

    neighbors.push({
      column,
      row,
      cost: direction.cost
    });
  }

  return neighbors;
}

function getCellFromWorldPoint(navigation, point) {
  const column = clamp(Math.floor(point.x / navigation.cellSize), 0, navigation.columns - 1);
  const row = clamp(Math.floor(point.y / navigation.cellSize), 0, navigation.rows - 1);
  return { column, row };
}

function getCellCenter(navigation, column, row) {
  const x = column * navigation.cellSize;
  const y = row * navigation.cellSize;
  return {
    x: x + Math.min(navigation.cellSize, navigation.width - x) * 0.5,
    y: y + Math.min(navigation.cellSize, navigation.height - y) * 0.5
  };
}

function isBlockedCell(state, navigation, column, row, blockedCellCache = null, options = {}) {
  const cacheKey = blockedCellCache ? `${column}:${row}:${getPathOptionCacheKey(options)}` : null;
  if (cacheKey && blockedCellCache.has(cacheKey)) {
    return blockedCellCache.get(cacheKey);
  }

  const cellIndex = row * navigation.columns + column;
  let blocked = navigation.blockedCells[cellIndex];
  const defaultClearanceRadius = navigation.cellSize * 0.35;
  const clearanceRadius = Math.max(defaultClearanceRadius, options.radius ?? 0);

  if (!blocked) {
    const dynamicOccupancyCount = navigation.dynamicOccupancyGrid[cellIndex] ?? 0;
    if (dynamicOccupancyCount > 0 || clearanceRadius > defaultClearanceRadius) {
      const cellCenter = getCellCenter(navigation, column, row);
      blocked = doesCircleOverlapBlockingBuildings(
        state,
        cellCenter,
        clearanceRadius,
        options
      );
      if (!blocked && clearanceRadius > defaultClearanceRadius) {
        blocked = doesCircleOverlapTerrainBlockers(navigation, cellCenter, clearanceRadius);
      }
    }
  }

  if (cacheKey) {
    blockedCellCache.set(cacheKey, blocked);
  }
  return blocked;
}

function getCellKey(column, row) {
  return `${column}:${row}`;
}

function parseCellKey(key) {
  const [column, row] = key.split(":").map(Number);
  return { column, row };
}

function getOctileDistance(left, right) {
  const dx = Math.abs(left.column - right.column);
  const dy = Math.abs(left.row - right.row);
  const diagonal = Math.min(dx, dy);
  const straight = Math.max(dx, dy) - diagonal;
  return diagonal * Math.SQRT2 + straight;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createPathingState() {
  return {
    cache: new Map(),
    queue: [],
    queuedKeys: new Set()
  };
}

function buildPathRequestKey(navigation, startPoint, endPoint, navigationKey, options = {}) {
  const startCell = getCellFromWorldPoint(navigation, startPoint);
  const endCell = getCellFromWorldPoint(navigation, endPoint);
  return [
    navigation.staticNavRevision ?? 0,
    navigationKey,
    getPathOptionCacheKey(options),
    `${startCell.column}:${startCell.row}`,
    `${endCell.column}:${endCell.row}`
  ].join("|");
}

function normalizePathRequestOptions(options = {}) {
  const excludedBuildingIds = options.excludedBuildingIds
    ? [...options.excludedBuildingIds].sort()
    : [];
  return {
    radius: options.radius ?? 0,
    excludedBuildingIds: excludedBuildingIds.length > 0 ? new Set(excludedBuildingIds) : null,
    excludedBuildingIdsKey: excludedBuildingIds.join(",")
  };
}

function getPathOptionCacheKey(options = {}) {
  return `r:${Math.round((options.radius ?? 0) * 10)}|x:${options.excludedBuildingIdsKey ?? ""}`;
}

function doesCircleOverlapBlockingBuildings(state, point, radius, options = {}) {
  if (!state?.navigation) {
    return false;
  }

  const excludedBuildingIds = options.excludedBuildingIds ?? null;

  for (const building of getBlockingBuildings(state, point, radius + getMaximumBuildingRadius(state))) {
    if (excludedBuildingIds?.has(building.id)) {
      continue;
    }

    const distance = Math.hypot(point.x - building.x, point.y - building.y);
    if (distance < radius + building.radius) {
      return true;
    }
  }

  return false;
}

function getBlockingBuildings(state, point, radius) {
  const spatialIndex = state.entitySpatialIndex?.index ?? null;
  const index = spatialIndex && state.entitySpatialIndex?.revision === (state.entitySpatialIndexRevision ?? 0)
    ? spatialIndex
    : null;

  return index
    ? queryBlockingBuildings(index, point, radius)
    : getBlockingBuildingsFromState(state).filter((entity) => {
        return Math.hypot(point.x - entity.x, point.y - entity.y) <= radius + entity.radius;
      });
}

function getBlockingBuildingsFromState(state) {
  return state.entities.filter((entity) => entity.type === "building" && entity.health > 0);
}

function queryBlockingBuildings(index, point, radius) {
  const buckets = index.byType.get("building");
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

function getMaximumBuildingRadius(state) {
  state.maximumBuildingRadius ??= Math.max(
    0,
    ...state.catalog.buildingDefinitions.map((definition) => definition.radius ?? 0)
  );
  return state.maximumBuildingRadius;
}

function getCircleSeparationVector(point, radius, blocker) {
  const dx = point.x - blocker.x;
  const dy = point.y - blocker.y;
  const distance = Math.hypot(dx, dy);
  const minimumDistance = radius + blocker.radius;
  if (distance >= minimumDistance) {
    return null;
  }

  if (distance === 0) {
    return { x: minimumDistance, y: 0 };
  }

  const overlap = minimumDistance - distance;
  return {
    x: (dx / distance) * overlap,
    y: (dy / distance) * overlap
  };
}

function rebuildDynamicOccupancyGrid(state, navigation) {
  navigation.dynamicOccupancyGrid.fill(0);

  for (const building of getBlockingBuildingsFromState(state)) {
    const bounds = getNavigationBoundsForCircle(navigation, building, building.radius);

    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      for (let column = bounds.left; column <= bounds.right; column += 1) {
        if (!doesCircleOverlapCell(navigation, building, column, row)) {
          continue;
        }

        const index = row * navigation.columns + column;
        navigation.dynamicOccupancyGrid[index] += 1;
      }
    }
  }
}

function doesCircleOverlapCell(navigation, circle, column, row) {
  const cellLeft = column * navigation.cellSize;
  const cellTop = row * navigation.cellSize;
  const cellRight = Math.min(navigation.width, cellLeft + navigation.cellSize);
  const cellBottom = Math.min(navigation.height, cellTop + navigation.cellSize);
  const nearestX = clamp(circle.x, cellLeft, cellRight);
  const nearestY = clamp(circle.y, cellTop, cellBottom);
  return Math.hypot(circle.x - nearestX, circle.y - nearestY) < circle.radius;
}

function resolveDirtyRegionIndexes(navigation, dirtyBlockers) {
  if (!dirtyBlockers) {
    return Array.from({ length: navigation.regionRevisions.length }, (_, index) => index);
  }

  const dirtyList = Array.isArray(dirtyBlockers) ? dirtyBlockers : [dirtyBlockers];
  const regionIndexes = new Set();

  for (const dirtyBlocker of dirtyList) {
    if (!dirtyBlocker) {
      continue;
    }

    const radius = dirtyBlocker.radius ?? 0;
    const bounds = {
      left: dirtyBlocker.x - radius,
      right: dirtyBlocker.x + radius,
      top: dirtyBlocker.y - radius,
      bottom: dirtyBlocker.y + radius
    };

    for (const regionIndex of collectRegionIndexesForBounds(navigation, bounds)) {
      regionIndexes.add(regionIndex);
    }
  }

  return regionIndexes.size > 0
    ? [...regionIndexes]
    : Array.from({ length: navigation.regionRevisions.length }, (_, index) => index);
}

function collectRegionIndexesForBounds(navigation, bounds) {
  const maxRegionColumn = navigation.regionColumns - 1;
  const maxRegionRow = navigation.regionRows - 1;
  const cellSpan = navigation.regionCellSpan;
  const leftCell = clamp(Math.floor(bounds.left / navigation.cellSize), 0, navigation.columns - 1);
  const rightCell = clamp(Math.floor(bounds.right / navigation.cellSize), 0, navigation.columns - 1);
  const topCell = clamp(Math.floor(bounds.top / navigation.cellSize), 0, navigation.rows - 1);
  const bottomCell = clamp(Math.floor(bounds.bottom / navigation.cellSize), 0, navigation.rows - 1);
  const leftRegion = clamp(Math.floor(leftCell / cellSpan), 0, maxRegionColumn);
  const rightRegion = clamp(Math.floor(rightCell / cellSpan), 0, maxRegionColumn);
  const topRegion = clamp(Math.floor(topCell / cellSpan), 0, maxRegionRow);
  const bottomRegion = clamp(Math.floor(bottomCell / cellSpan), 0, maxRegionRow);
  const regionIndexes = [];

  for (let row = topRegion; row <= bottomRegion; row += 1) {
    for (let column = leftRegion; column <= rightRegion; column += 1) {
      regionIndexes.push(row * navigation.regionColumns + column);
    }
  }

  return regionIndexes;
}

function buildPathValidityForCellPath(navigation, cellPath) {
  const regionIndexes = new Set();

  for (const cell of cellPath) {
    regionIndexes.add(getRegionIndexForCell(navigation, cell.column, cell.row));
  }

  return buildPathValidity(navigation, [...regionIndexes]);
}

function buildPathValidity(navigation, regionIndexes) {
  return {
    staticNavRevision: navigation.staticNavRevision ?? 0,
    regionIndexes,
    regionRevisions: regionIndexes.map((regionIndex) => navigation.regionRevisions[regionIndex] ?? 0)
  };
}

function getRegionIndexForCell(navigation, column, row) {
  const regionColumn = Math.floor(column / navigation.regionCellSpan);
  const regionRow = Math.floor(row / navigation.regionCellSpan);
  return regionRow * navigation.regionColumns + regionColumn;
}

function getRegionKey(navigation, regionIndex) {
  const regionColumn = regionIndex % navigation.regionColumns;
  const regionRow = Math.floor(regionIndex / navigation.regionColumns);
  return `${regionColumn}:${regionRow}`;
}

function cacheNavigationPath(navigation, requestKey, entry) {
  const existingEntry = navigation.pathing.cache.get(requestKey);
  if (existingEntry) {
    uncacheNavigationPath(navigation, requestKey, existingEntry.validity);
  }

  navigation.pathing.cache.set(requestKey, entry);
  for (const regionIndex of entry.validity?.regionIndexes ?? []) {
    const regionKey = getRegionKey(navigation, regionIndex);
    const bucket = navigation.pathCacheByRegion.get(regionKey);
    if (bucket) {
      bucket.add(requestKey);
    } else {
      navigation.pathCacheByRegion.set(regionKey, new Set([requestKey]));
    }
  }
}

function uncacheNavigationPath(navigation, requestKey, validity) {
  navigation.pathing.cache.delete(requestKey);

  for (const regionIndex of validity?.regionIndexes ?? []) {
    const regionKey = getRegionKey(navigation, regionIndex);
    const bucket = navigation.pathCacheByRegion.get(regionKey);
    if (!bucket) {
      continue;
    }

    bucket.delete(requestKey);
    if (bucket.size === 0) {
      navigation.pathCacheByRegion.delete(regionKey);
    }
  }
}

function evictNavigationPathsForDirtyRegions(navigation, dirtyRegionIndexes) {
  const requestKeysToDelete = new Set();

  for (const regionIndex of dirtyRegionIndexes) {
    const bucket = navigation.pathCacheByRegion.get(getRegionKey(navigation, regionIndex));
    if (!bucket) {
      continue;
    }

    for (const requestKey of bucket) {
      requestKeysToDelete.add(requestKey);
    }
  }

  for (const requestKey of requestKeysToDelete) {
    const cachedEntry = navigation.pathing.cache.get(requestKey);
    if (!cachedEntry) {
      continue;
    }

    uncacheNavigationPath(navigation, requestKey, cachedEntry.validity);
  }
}

function clonePoint(point) {
  return {
    x: point.x,
    y: point.y
  };
}

const CARDINAL_DIRECTIONS = [
  { column: -1, row: 0, cost: 1 },
  { column: 1, row: 0, cost: 1 },
  { column: 0, row: -1, cost: 1 },
  { column: 0, row: 1, cost: 1 }
];

const NEIGHBOR_DIRECTIONS = [
  ...CARDINAL_DIRECTIONS,
  { column: -1, row: -1, cost: Math.SQRT2 },
  { column: 1, row: -1, cost: Math.SQRT2 },
  { column: -1, row: 1, cost: Math.SQRT2 },
  { column: 1, row: 1, cost: Math.SQRT2 }
];
