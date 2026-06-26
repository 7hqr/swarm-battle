import { markTerritoryCellDirty } from "../multiplayer/replicationDirtyState.js";
import { getEntityById, getEntitiesByType } from "../state/entities.js";

const TERRITORY_CELL_SIZE = 40;
const TERRITORY_CAPTURE_RATE = 0.12;
const TERRITORY_OWNERSHIP_THRESHOLD = 0.25;
const TERRITORY_INCOME_PER_CELL = 0.06;
const UNIT_CAPTURE_RADIUS = 64;
const BUILDING_CAPTURE_RADIUS = 280;
const UNIT_CAPTURE_STRENGTH = 0.82;
const UNIT_CAPTURE_DIMINISHING_EXPONENT = 0.9;
const MAX_UNIT_CAPTURE_PRESSURE = 0.9;
const BUILDING_CAPTURE_STRENGTH = 0.14;
const BASE_CAPTURE_BONUS = 0.12;
const INITIAL_TERRITORY_RADIUS = 220;
const RICH_CELL_MULTIPLIER = 5;
const RICH_CELL_PATTERN_OFFSETS = [
  { column: 0, row: 0 },
  { column: -1, row: 0 },
  { column: 1, row: 0 },
  { column: 0, row: -1 },
  { column: 0, row: 1 }
];

export function createTerritoryState(map) {
  const columns = Math.ceil(map.width / TERRITORY_CELL_SIZE);
  const rows = Math.ceil(map.height / TERRITORY_CELL_SIZE);
  const cells = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * TERRITORY_CELL_SIZE;
      const y = row * TERRITORY_CELL_SIZE;
      const width = Math.min(TERRITORY_CELL_SIZE, map.width - x);
      const height = Math.min(TERRITORY_CELL_SIZE, map.height - y);
      cells.push({
        column,
        row,
        x,
        y,
        width,
        height,
        centerX: x + width * 0.5,
        centerY: y + height * 0.5,
        incomeValue: 1,
        richPocketId: null,
        control: 0,
        ownerId: null
      });
    }
  }

  applyRichCellPockets(cells, columns, rows, map.objectives?.richCellPockets ?? []);
  const ownership = createTerritoryOwnershipState(cells, TERRITORY_INCOME_PER_CELL);
  return {
    cellSize: TERRITORY_CELL_SIZE,
    columns,
    rows,
    incomePerOwnedCell: TERRITORY_INCOME_PER_CELL,
    visualRevision: 0,
    cells,
    ownership,
    influence: createTerritoryInfluenceState(cells.length)
  };
}

export function updateTerritory(state, dt) {
  processDirtyTerritoryInfluencers(state);
  const dirtyCellIndexes = state.territory.influence.dirtyCellIndexes;
  const activeCellIndexes = state.territory.influence.activeCellIndexes;
  let changed = false;

  if (dirtyCellIndexes.size === 0 && activeCellIndexes.size === 0) {
    return;
  }

  const cellsToUpdate = new Set([
    ...activeCellIndexes,
    ...dirtyCellIndexes
  ]);
  activeCellIndexes.clear();

  for (const index of cellsToUpdate) {
    const cell = state.territory.cells[index];
    const previousControl = cell.control;
    const previousOwnerId = cell.ownerId;
    const signedPressure = getSignedPressureForCell(state.territory, index);
    if (signedPressure !== 0) {
      cell.control = clamp(cell.control + signedPressure * TERRITORY_CAPTURE_RATE * dt, -1, 1);
      activeCellIndexes.add(index);
    }

    if (cell.control >= TERRITORY_OWNERSHIP_THRESHOLD) {
      cell.ownerId = 1;
    } else if (cell.control <= -TERRITORY_OWNERSHIP_THRESHOLD) {
      cell.ownerId = 2;
    } else {
      cell.ownerId = null;
    }

    if (cell.control !== previousControl || cell.ownerId !== previousOwnerId) {
      if (cell.ownerId !== previousOwnerId) {
        applyCellOwnerChange(state.territory, cell, previousOwnerId, cell.ownerId);
      }
      changed = true;
      markTerritoryCellDirty(state, index);
    }
  }
  dirtyCellIndexes.clear();

  if (changed) {
    state.territory.visualRevision += 1;
  }
}

export function getOwnedTerritoryCellCount(state, playerId) {
  return state.territory.ownership.perPlayer[playerId]?.ownedCellCount ?? 0;
}

export function getTerritoryOwnershipSummary(state) {
  return state.territory.ownership.summary;
}

export function getTerritoryIncomePerSecond(state, playerId) {
  return getTerritoryIncomeBreakdown(state, playerId).totalIncome;
}

export function getTerritoryIncomeBreakdown(state, playerId) {
  const playerOwnership = state.territory.ownership.perPlayer[playerId] ?? createEmptyPlayerOwnership();
  return {
    ownedCellCount: playerOwnership.ownedCellCount,
    richOwnedCellCount: playerOwnership.richOwnedCellCount,
    baseIncome: playerOwnership.baseIncome,
    richBonusIncome: playerOwnership.richBonusIncome,
    totalIncome: playerOwnership.totalIncome
  };
}

export function seedTerritoryAroundPoint(state, playerId, point, radius = INITIAL_TERRITORY_RADIUS) {
  let changed = false;
  for (const cell of state.territory.cells) {
    const distance = Math.hypot(cell.centerX - point.x, cell.centerY - point.y);
    if (distance > radius) {
      continue;
    }

    if (cell.control === (playerId === 1 ? 1 : -1) && cell.ownerId === playerId) {
      continue;
    }

    const previousOwnerId = cell.ownerId;
    cell.control = playerId === 1 ? 1 : -1;
    cell.ownerId = playerId;
    applyCellOwnerChange(state.territory, cell, previousOwnerId, playerId);
    changed = true;
    markTerritoryCellDirty(state, cell.row * state.territory.columns + cell.column);
  }

  if (changed) {
    state.territory.visualRevision += 1;
  }
}

export function markTerritoryInfluencerDirty(state, entityId) {
  if (!state.territory || !entityId) {
    return;
  }

  state.territory.influence.dirtyInfluencerIds.add(entityId);
  state.territory.influence.removedInfluencerIds.delete(entityId);
}

export function markTerritoryInfluencersDirty(state, entityIds) {
  if (!state.territory || !entityIds) {
    return;
  }

  for (const entityId of entityIds) {
    markTerritoryInfluencerDirty(state, entityId);
  }
}

export function markTerritoryInfluencerRemoved(state, entityId) {
  if (!state.territory || !entityId) {
    return;
  }

  const influence = state.territory.influence;
  if (!influence.contributionsByEntityId.has(entityId)) {
    return;
  }

  influence.dirtyInfluencerIds.delete(entityId);
  influence.removedInfluencerIds.add(entityId);
}

export function rebuildTerritoryDerivedState(state, options = {}) {
  if (!state.territory) {
    return;
  }

  rebuildTerritoryOwnershipState(state.territory);
  state.territory.influence = createTerritoryInfluenceState(state.territory.cells.length);
  if (options.rebuildInfluence !== false) {
    const influencerIds = [
      ...getEntitiesByType(state, "unit").map((entity) => entity.id),
      ...getEntitiesByType(state, "building")
        .filter((entity) => entity.isConstructed)
        .map((entity) => entity.id)
    ];
    markTerritoryInfluencersDirty(state, influencerIds);
  }
}

export function isCircleInOwnedTerritory(state, playerId, point, radius) {
  const centerCell = getCellAtWorldPoint(state, point);
  if (!centerCell || centerCell.ownerId !== playerId) {
    return false;
  }

  const bounds = getCellBoundsForCircle(state, point, radius);
  for (let row = bounds.top; row <= bounds.bottom; row += 1) {
    for (let column = bounds.left; column <= bounds.right; column += 1) {
      const cell = state.territory.cells[row * state.territory.columns + column];
      if (!doesCellOverlapCircle(cell, point, radius)) {
        continue;
      }

      if (cell.ownerId !== playerId) {
        return false;
      }
    }
  }

  return true;
}

export function getClaimableCellsNearPoint(state, playerId, point, radius) {
  let claimableCells = 0;
  let pressureScore = 0;

  for (const cell of state.territory.cells) {
    const distance = Math.hypot(cell.centerX - point.x, cell.centerY - point.y);
    if (distance > radius) {
      continue;
    }

    if (cell.ownerId === playerId) {
      continue;
    }

    claimableCells += 1;
    const currentControlForPlayer = playerId === 1 ? cell.control : -cell.control;
    pressureScore += 1 - Math.max(-1, Math.min(1, currentControlForPlayer));
  }

  return {
    claimableCells,
    pressureScore
  };
}

function processDirtyTerritoryInfluencers(state) {
  const influence = state.territory.influence;

  for (const entityId of influence.removedInfluencerIds) {
    const previousContribution = influence.contributionsByEntityId.get(entityId);
    if (!previousContribution) {
      continue;
    }

    applyInfluenceContributionDelta(state.territory, previousContribution, -1);
    influence.contributionsByEntityId.delete(entityId);
  }
  influence.removedInfluencerIds.clear();

  for (const entityId of influence.dirtyInfluencerIds) {
    const previousContribution = influence.contributionsByEntityId.get(entityId);
    if (previousContribution) {
      applyInfluenceContributionDelta(state.territory, previousContribution, -1);
      influence.contributionsByEntityId.delete(entityId);
    }

    const entity = getEntityById(state, entityId);
    if (!entity || entity.health <= 0) {
      continue;
    }

    const nextContribution = buildEntityInfluenceContribution(state, entity);
    if (!nextContribution || nextContribution.cells.length === 0) {
      continue;
    }

    applyInfluenceContributionDelta(state.territory, nextContribution, 1);
    influence.contributionsByEntityId.set(entityId, nextContribution);
  }
  influence.dirtyInfluencerIds.clear();
}

function createTerritoryInfluenceState(cellCount) {
  return {
    playerOneUnitPressureByCell: new Float32Array(cellCount),
    playerTwoUnitPressureByCell: new Float32Array(cellCount),
    playerOneBuildingPressureByCell: new Float32Array(cellCount),
    playerTwoBuildingPressureByCell: new Float32Array(cellCount),
    contributionsByEntityId: new Map(),
    dirtyInfluencerIds: new Set(),
    removedInfluencerIds: new Set(),
    dirtyCellIndexes: new Set(),
    activeCellIndexes: new Set()
  };
}

function buildEntityInfluenceContribution(state, entity) {
  const influenceRadius = getEntityCaptureRadius(state, entity);
  if (influenceRadius <= 0) {
    return null;
  }

  const cells = [];
  const bounds = getCellBoundsForCircle(state, entity, influenceRadius);
  for (let row = bounds.top; row <= bounds.bottom; row += 1) {
    for (let column = bounds.left; column <= bounds.right; column += 1) {
      const cellIndex = row * state.territory.columns + column;
      const cell = state.territory.cells[cellIndex];
      const contribution = getCellContributionFromEntity(state, entity, cell);
      if (contribution === 0) {
        continue;
      }

      cells.push({
        cellIndex,
        contribution
      });
    }
  }

  return {
    entityId: entity.id,
    ownerId: entity.ownerId,
    type: entity.type,
    cells
  };
}

function applyInfluenceContributionDelta(territory, record, direction) {
  const influence = territory.influence;
  const targetArray = getInfluencePressureArray(influence, record);
  for (const cellContribution of record.cells) {
    targetArray[cellContribution.cellIndex] += cellContribution.contribution * direction;
    influence.dirtyCellIndexes.add(cellContribution.cellIndex);
  }
}

function getInfluencePressureArray(influence, record) {
  if (record.type === "unit") {
    return record.ownerId === 1
      ? influence.playerOneUnitPressureByCell
      : influence.playerTwoUnitPressureByCell;
  }

  return record.ownerId === 1
    ? influence.playerOneBuildingPressureByCell
    : influence.playerTwoBuildingPressureByCell;
}

function getSignedPressureForCell(territory, cellIndex) {
  const influence = territory.influence;
  const playerOnePressure = getResolvedPressureForCell(
    influence.playerOneUnitPressureByCell[cellIndex],
    influence.playerOneBuildingPressureByCell[cellIndex]
  );
  const playerTwoPressure = getResolvedPressureForCell(
    influence.playerTwoUnitPressureByCell[cellIndex],
    influence.playerTwoBuildingPressureByCell[cellIndex]
  );
  return clamp(playerOnePressure - playerTwoPressure, -1, 1);
}

function getResolvedPressureForCell(unitPressure, buildingPressure) {
  return getResolvedUnitPressure(unitPressure) + buildingPressure;
}

function getResolvedUnitPressure(unitPressure) {
  if (unitPressure <= 0) {
    return 0;
  }

  return Math.min(MAX_UNIT_CAPTURE_PRESSURE, unitPressure ** UNIT_CAPTURE_DIMINISHING_EXPONENT);
}

function getEntityCaptureRadius(state, entity) {
  if (entity.type === "unit") {
    return UNIT_CAPTURE_RADIUS;
  }

  if (entity.type !== "building" || !entity.isConstructed) {
    return 0;
  }

  return entity.radius + BUILDING_CAPTURE_RADIUS;
}

function getCellBoundsForCircle(state, point, radius) {
  const maxColumn = state.territory.columns - 1;
  const maxRow = state.territory.rows - 1;

  return {
    left: clamp(Math.floor((point.x - radius) / state.territory.cellSize), 0, maxColumn),
    right: clamp(Math.floor((point.x + radius) / state.territory.cellSize), 0, maxColumn),
    top: clamp(Math.floor((point.y - radius) / state.territory.cellSize), 0, maxRow),
    bottom: clamp(Math.floor((point.y + radius) / state.territory.cellSize), 0, maxRow)
  };
}

function getCellContributionFromEntity(state, entity, cell) {
  if (entity.type === "unit") {
    const distance = Math.hypot(entity.x - cell.centerX, entity.y - cell.centerY);
    if (distance > UNIT_CAPTURE_RADIUS) {
      return 0;
    }

    return UNIT_CAPTURE_STRENGTH * (1 - distance / UNIT_CAPTURE_RADIUS);
  }

  if (entity.type === "building" && entity.isConstructed) {
    const buildingDefinition = state.catalog.buildings[entity.definitionId];
    const influenceRadius = entity.radius + BUILDING_CAPTURE_RADIUS;
    const distance = Math.hypot(entity.x - cell.centerX, entity.y - cell.centerY);
    if (distance > influenceRadius) {
      return 0;
    }

    let strength = BUILDING_CAPTURE_STRENGTH;
    if (buildingDefinition.kind === "base") {
      strength += BASE_CAPTURE_BONUS;
    }

    return strength * (1 - distance / influenceRadius);
  }

  return 0;
}

function applyRichCellPockets(cells, columns, rows, richCellPockets) {
  for (const pocket of richCellPockets) {
    const centerColumn = Math.floor(pocket.center.x / TERRITORY_CELL_SIZE);
    const centerRow = Math.floor(pocket.center.y / TERRITORY_CELL_SIZE);

    for (const offset of RICH_CELL_PATTERN_OFFSETS) {
      const column = centerColumn + offset.column;
      const row = centerRow + offset.row;
      if (column < 0 || row < 0 || column >= columns || row >= rows) {
        continue;
      }

      const cell = cells[row * columns + column];
      cell.incomeValue = RICH_CELL_MULTIPLIER;
      cell.richPocketId = pocket.id;
    }
  }
}

function createTerritoryOwnershipState(cells, incomePerOwnedCell) {
  const ownership = {
    perPlayer: {
      1: createEmptyPlayerOwnership(),
      2: createEmptyPlayerOwnership()
    },
    summary: {
      totalCells: cells.length,
      playerCount: 0,
      aiCount: 0,
      neutralCount: cells.length,
      playerPercent: 0,
      aiPercent: 0,
      neutralPercent: 100
    }
  };

  for (const cell of cells) {
    if (cell.ownerId !== 1 && cell.ownerId !== 2) {
      continue;
    }

    applyOwnershipDelta(ownership.perPlayer[cell.ownerId], cell, 1, incomePerOwnedCell);
  }

  refreshOwnershipSummary(ownership);
  return ownership;
}

function rebuildTerritoryOwnershipState(territory) {
  territory.ownership = createTerritoryOwnershipState(territory.cells, territory.incomePerOwnedCell);
}

function createEmptyPlayerOwnership() {
  return {
    ownedCellCount: 0,
    richOwnedCellCount: 0,
    baseIncome: 0,
    richBonusIncome: 0,
    totalIncome: 0
  };
}

function applyCellOwnerChange(territory, cell, previousOwnerId, nextOwnerId) {
  if (previousOwnerId === nextOwnerId) {
    return;
  }

  if (previousOwnerId === 1 || previousOwnerId === 2) {
    applyOwnershipDelta(territory.ownership.perPlayer[previousOwnerId], cell, -1, territory.incomePerOwnedCell);
  }

  if (nextOwnerId === 1 || nextOwnerId === 2) {
    applyOwnershipDelta(territory.ownership.perPlayer[nextOwnerId], cell, 1, territory.incomePerOwnedCell);
  }

  refreshOwnershipSummary(territory.ownership);
}

function applyOwnershipDelta(playerOwnership, cell, direction, incomePerOwnedCell) {
  playerOwnership.ownedCellCount += direction;
  playerOwnership.baseIncome += incomePerOwnedCell * direction;
  if (cell.incomeValue > 1) {
    playerOwnership.richOwnedCellCount += direction;
    playerOwnership.richBonusIncome += incomePerOwnedCell * (cell.incomeValue - 1) * direction;
  }
  playerOwnership.totalIncome = playerOwnership.baseIncome + playerOwnership.richBonusIncome;
}

function refreshOwnershipSummary(ownership) {
  const playerCount = ownership.perPlayer[1].ownedCellCount;
  const aiCount = ownership.perPlayer[2].ownedCellCount;
  const totalCells = ownership.summary.totalCells;
  const neutralCount = totalCells - playerCount - aiCount;

  ownership.summary.playerCount = playerCount;
  ownership.summary.aiCount = aiCount;
  ownership.summary.neutralCount = neutralCount;
  ownership.summary.playerPercent = getTerritoryPercent(playerCount, totalCells);
  ownership.summary.aiPercent = getTerritoryPercent(aiCount, totalCells);
  ownership.summary.neutralPercent = getTerritoryPercent(neutralCount, totalCells);
}

function getCellAtWorldPoint(state, point) {
  const column = Math.floor(point.x / state.territory.cellSize);
  const row = Math.floor(point.y / state.territory.cellSize);
  if (
    column < 0 ||
    row < 0 ||
    column >= state.territory.columns ||
    row >= state.territory.rows
  ) {
    return null;
  }

  return state.territory.cells[row * state.territory.columns + column] ?? null;
}

function doesCellOverlapCircle(cell, point, radius) {
  const nearestX = clamp(point.x, cell.x, cell.x + cell.width);
  const nearestY = clamp(point.y, cell.y, cell.y + cell.height);
  const distance = Math.hypot(point.x - nearestX, point.y - nearestY);
  return distance <= radius;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getTerritoryPercent(count, total) {
  if (total === 0) {
    return 0;
  }

  return (count / total) * 100;
}
