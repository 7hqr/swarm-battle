import { getEntitiesByType, getEntityById, getPlayerById } from "../state/entities.js";
import { getViewportFocusPoint, getVisibleWorldBounds } from "../state/camera.js";
import { getLocalPlayerId } from "../state/localPlayer.js";
import {
  getEntityDisplayAngle,
  getEntityDisplayAngleForField,
  getEntityDisplayPoint,
  getEntityDisplayValue,
  getPlayerDisplayValue
} from "../multiplayer/interpolation.js";
import {
  getProducedUnitId,
  getProductionCycleTime,
  isProductionKind
} from "../rules/catalogRules.js";
import { getSelectedEntities } from "../state/selection.js";
import { getControlStructureObjectives } from "../systems/mapObjectives.js";
import {
  measurePerformance,
  updatePerformanceEntityCounts
} from "../debug/performance.js";

const PLAYER_COLORS = {
  1: "#82d173",
  2: "#ff7a6b"
};
const SCENE_BACKGROUND = "#0b1015";
const MAP_BACKGROUND = "#151d26";
const TERRAIN_FILL = "#243242";
const TERRAIN_STROKE = "rgba(193, 210, 227, 0.28)";
const GRID_LINE = "rgba(255,255,255,0.055)";
const HEALTH_BAR_COLOR = "#72d2c1";
const UNIT_HEALTH_BAR_COLOR = "#d6f08d";
const RICH_CELL_FILL = "rgba(216, 177, 79, 0.12)";
const RICH_CELL_STROKE = "rgba(216, 177, 79, 0.45)";
const NEUTRAL_OBJECTIVE_COLOR = "#d8b14f";
const UNIT_HEALTH_BAR_MIN_ZOOM = 0.7;
const EFFECT_MIN_ZOOM = 0.45;

export function createCanvasRenderer(canvas) {
  const context = canvas.getContext("2d");
  const territoryCache = createTerritoryRenderCache();

  return {
    render(state) {
      updatePerformanceEntityCounts(state);
      const dpr = state.viewport.devicePixelRatio ?? 1;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = SCENE_BACKGROUND;
      context.fillRect(0, 0, canvas.width, canvas.height);

      if (!state.hasActiveMatch || !state.map || !state.territory) {
        return;
      }

      const focusPoint = getViewportFocusPoint(state);
      const visibleBounds = getVisibleWorldBounds(state, 96);

      context.setTransform(
        dpr * state.camera.zoom,
        0,
        0,
        dpr * state.camera.zoom,
        dpr * (focusPoint.x - state.camera.x * state.camera.zoom),
        dpr * (focusPoint.y - state.camera.y * state.camera.zoom)
      );

      measurePerformance(state, "render.background", () => drawBackground(context, state, visibleBounds));
      measurePerformance(state, "render.terrain", () => drawTerrain(context, state, visibleBounds));
      measurePerformance(state, "render.territory", () => drawTerritory(context, state, visibleBounds, territoryCache));
      measurePerformance(state, "render.objectives", () => drawMapObjectives(context, state, visibleBounds));
      measurePerformance(state, "render.placementPreview", () => drawPlacementPreview(context, state));
      measurePerformance(state, "render.waypoints", () => drawWaypoints(context, state, visibleBounds));
      measurePerformance(state, "render.buildings", () => drawBuildings(context, state, visibleBounds));
      measurePerformance(state, "render.projectiles", () => drawProjectiles(context, state, visibleBounds));
      measurePerformance(state, "render.units", () => drawUnits(context, state, visibleBounds));
      measurePerformance(state, "render.transientEffects", () => drawTransientEffects(context, state, visibleBounds));
      measurePerformance(state, "render.selection", () => drawSelection(context, state, visibleBounds));
      measurePerformance(state, "render.selectionBox", () => drawSelectionBox(context, state));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      measurePerformance(state, "render.screenSpace", () => {
        drawModeHint(context, state);
        drawWinnerBanner(context, state);
      });
    }
  };
}

function drawBackground(context, state, visibleBounds) {
  const clippedBounds = clipBoundsToMap(state, visibleBounds);
  const width = Math.max(0, clippedBounds.right - clippedBounds.left);
  const height = Math.max(0, clippedBounds.bottom - clippedBounds.top);
  if (width === 0 || height === 0) {
    return;
  }

  context.fillStyle = MAP_BACKGROUND;
  context.fillRect(clippedBounds.left, clippedBounds.top, width, height);

  context.strokeStyle = GRID_LINE;
  context.lineWidth = 1 / Math.max(state.camera.zoom, 0.001);
  const startX = Math.floor(clippedBounds.left / state.territory.cellSize) * state.territory.cellSize;
  const endX = Math.ceil(clippedBounds.right / state.territory.cellSize) * state.territory.cellSize;
  for (let x = startX; x <= endX; x += state.territory.cellSize) {
    context.beginPath();
    context.moveTo(x, clippedBounds.top);
    context.lineTo(x, clippedBounds.bottom);
    context.stroke();
  }

  const startY = Math.floor(clippedBounds.top / state.territory.cellSize) * state.territory.cellSize;
  const endY = Math.ceil(clippedBounds.bottom / state.territory.cellSize) * state.territory.cellSize;
  for (let y = startY; y <= endY; y += state.territory.cellSize) {
    context.beginPath();
    context.moveTo(clippedBounds.left, y);
    context.lineTo(clippedBounds.right, y);
    context.stroke();
  }
}

function drawTerrain(context, state, visibleBounds) {
  const blockers = state.map.terrain?.blockers ?? [];
  if (blockers.length === 0) {
    return;
  }

  context.fillStyle = TERRAIN_FILL;
  context.strokeStyle = TERRAIN_STROKE;
  context.lineWidth = 2;

  for (const blocker of blockers) {
    if (!isBlockerVisible(blocker, visibleBounds)) {
      continue;
    }

    context.beginPath();
    if (blocker.kind === "circle") {
      context.arc(blocker.x, blocker.y, blocker.radius, 0, Math.PI * 2);
    } else if (blocker.kind === "rect") {
      context.rect(blocker.x, blocker.y, blocker.width, blocker.height);
    } else {
      throw new Error(`Unsupported terrain blocker kind: ${blocker.kind}`);
    }
    context.fill();
    context.stroke();
  }
}

function drawTerritory(context, state, visibleBounds, territoryCache) {
  ensureTerritoryRenderCache(state, territoryCache);
  if (!territoryCache.canvas) {
    return;
  }

  const clippedBounds = clipBoundsToMap(state, visibleBounds);
  const sourceLeft = Math.max(0, Math.floor(clippedBounds.left));
  const sourceTop = Math.max(0, Math.floor(clippedBounds.top));
  const sourceRight = Math.min(territoryCache.canvas.width, Math.ceil(clippedBounds.right));
  const sourceBottom = Math.min(territoryCache.canvas.height, Math.ceil(clippedBounds.bottom));
  const sourceWidth = Math.max(0, sourceRight - sourceLeft);
  const sourceHeight = Math.max(0, sourceBottom - sourceTop);

  if (sourceWidth === 0 || sourceHeight === 0) {
    return;
  }

  context.drawImage(
    territoryCache.canvas,
    sourceLeft,
    sourceTop,
    sourceWidth,
    sourceHeight,
    sourceLeft,
    sourceTop,
    sourceWidth,
    sourceHeight
  );

  const visibleCells = getVisibleTerritoryCells(state, clippedBounds);
  drawOwnedTerritoryOutlines(context, state, 1, visibleCells);
  drawOwnedTerritoryOutlines(context, state, 2, visibleCells);
}

function redrawTerritoryCache(state, cache) {
  const context = cache.context;
  context.clearRect(0, 0, cache.canvas.width, cache.canvas.height);

  for (const cell of state.territory.cells) {
    const alpha = Math.abs(cell.control) * 0.22;
    if (alpha > 0) {
      context.fillStyle = cell.control > 0
        ? `rgba(130, 209, 115, ${alpha})`
        : `rgba(255, 122, 107, ${alpha})`;
      context.fillRect(cell.x, cell.y, cell.width, cell.height);
    }

    context.strokeStyle = "rgba(255,255,255,0.035)";
    context.lineWidth = 1;
    context.strokeRect(cell.x, cell.y, cell.width, cell.height);

    if (cell.incomeValue > 1) {
      context.fillStyle = RICH_CELL_FILL;
      context.fillRect(cell.x + 2, cell.y + 2, Math.max(0, cell.width - 4), Math.max(0, cell.height - 4));
      context.strokeStyle = RICH_CELL_STROKE;
      context.strokeRect(cell.x + 3, cell.y + 3, Math.max(0, cell.width - 6), Math.max(0, cell.height - 6));
    }
  }

}

function createTerritoryRenderCache() {
  return {
    canvas: null,
    context: null,
    width: 0,
    height: 0,
    visualRevision: -1
  };
}

function ensureTerritoryRenderCache(state, cache) {
  const width = Math.max(1, Math.ceil(state.map.width));
  const height = Math.max(1, Math.ceil(state.map.height));
  if (!cache.canvas || cache.width !== width || cache.height !== height) {
    cache.canvas = document.createElement("canvas");
    cache.canvas.width = width;
    cache.canvas.height = height;
    cache.context = cache.canvas.getContext("2d");
    cache.width = width;
    cache.height = height;
    cache.visualRevision = -1;
  }

  if (cache.visualRevision === state.territory.visualRevision) {
    return;
  }

  redrawTerritoryCache(state, cache);
  cache.visualRevision = state.territory.visualRevision;
}

function drawMapObjectives(context, state, visibleBounds) {
  for (const objective of getControlStructureObjectives(state)) {
    if (!isCircleVisible(objective.center.x, objective.center.y, objective.radius, visibleBounds)) {
      continue;
    }

    const ownerColor = objective.ownerId ? PLAYER_COLORS[objective.ownerId] : NEUTRAL_OBJECTIVE_COLOR;
    const progressColor = objective.controllingPlayerId ? PLAYER_COLORS[objective.controllingPlayerId] : NEUTRAL_OBJECTIVE_COLOR;
    const progressWidth = 68;
    const progressRatio = Math.min(1, Math.abs(objective.control));
    context.save();
    context.strokeStyle = withAlpha(ownerColor, 0.38);
    context.fillStyle = withAlpha(ownerColor, 0.12);
    context.lineWidth = 2;
    context.setLineDash([16, 12]);
    context.beginPath();
    context.arc(objective.center.x, objective.center.y, objective.radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.setLineDash([]);

    context.fillStyle = withAlpha(ownerColor, 0.28);
    context.strokeStyle = ownerColor;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(objective.center.x, objective.center.y, 18, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.fillStyle = "#f3f6e9";
    context.font = "bold 11px Segoe UI";
    context.textAlign = "center";
    context.fillText("SPD", objective.center.x, objective.center.y + 4);
    context.font = "12px Segoe UI";
    context.fillText(objective.displayName, objective.center.x, objective.center.y - objective.radius - 12);
    drawObjectiveProgressBar(
      context,
      objective.center.x,
      objective.center.y + objective.radius + 10,
      progressWidth,
      progressRatio,
      progressColor,
      ownerColor,
      objective
    );
    context.restore();
  }
}

function drawOwnedTerritoryOutlines(context, state, ownerId, cells) {
  const outlinePath = new Path2D();
  const outlineColor = withAlpha(PLAYER_COLORS[ownerId], 0.66);
  let hasOutline = false;

  for (const cell of cells) {
    if (cell.ownerId !== ownerId) {
      continue;
    }

    const topNeighbor = getTerritoryCell(state, cell.row - 1, cell.column);
    const rightNeighbor = getTerritoryCell(state, cell.row, cell.column + 1);
    const bottomNeighbor = getTerritoryCell(state, cell.row + 1, cell.column);
    const leftNeighbor = getTerritoryCell(state, cell.row, cell.column - 1);

    if (topNeighbor?.ownerId !== ownerId) {
      outlinePath.moveTo(cell.x, cell.y);
      outlinePath.lineTo(cell.x + cell.width, cell.y);
      hasOutline = true;
    }

    if (rightNeighbor?.ownerId !== ownerId) {
      outlinePath.moveTo(cell.x + cell.width, cell.y);
      outlinePath.lineTo(cell.x + cell.width, cell.y + cell.height);
      hasOutline = true;
    }

    if (bottomNeighbor?.ownerId !== ownerId) {
      outlinePath.moveTo(cell.x + cell.width, cell.y + cell.height);
      outlinePath.lineTo(cell.x, cell.y + cell.height);
      hasOutline = true;
    }

    if (leftNeighbor?.ownerId !== ownerId) {
      outlinePath.moveTo(cell.x, cell.y + cell.height);
      outlinePath.lineTo(cell.x, cell.y);
      hasOutline = true;
    }
  }

  if (!hasOutline) {
    return;
  }

  context.save();
  context.strokeStyle = outlineColor;
  context.lineWidth = 1.8;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.shadowColor = withAlpha(PLAYER_COLORS[ownerId], 0.16);
  context.shadowBlur = 4;
  context.stroke(outlinePath);
  context.restore();
}

function getTerritoryCell(state, row, column) {
  if (
    row < 0 ||
    column < 0 ||
    row >= state.territory.rows ||
    column >= state.territory.columns
  ) {
    return null;
  }

  return state.territory.cells[row * state.territory.columns + column] ?? null;
}

function drawWaypoints(context, state, visibleBounds) {
  const nowMs = performance.now();
  const localPlayerId = getLocalPlayerId(state);
  const selectedBuildings = getSelectedEntities(state).filter((entity) => {
    return (
      entity.type === "building" &&
      entity.ownerId === localPlayerId &&
      Array.isArray(entity.waypointChain) &&
      isEntityVisible(state, entity, visibleBounds, 48)
    );
  });
  if (selectedBuildings.length === 0) {
    return;
  }

  context.strokeStyle = "rgba(233, 239, 223, 0.55)";
  context.fillStyle = "rgba(233, 239, 223, 0.85)";
  context.lineWidth = 2;

  for (const selected of selectedBuildings) {
    let lastPoint = getEntityDisplayPoint(state, selected, nowMs);
    let index = 1;

    for (const point of selected.waypointChain) {
      context.beginPath();
      context.moveTo(lastPoint.x, lastPoint.y);
      context.lineTo(point.x, point.y);
      context.stroke();

      context.beginPath();
      context.arc(point.x, point.y, 5, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "#111";
      context.font = "11px Segoe UI";
      context.textAlign = "center";
      context.fillText(String(index), point.x, point.y - 10);
      context.fillStyle = "rgba(233, 239, 223, 0.85)";
      lastPoint = point;
      index += 1;
    }
  }
}

function drawPlacementPreview(context, state) {
  if (state.uiMode !== "place_building" || !state.pendingBuildingId) {
    return;
  }

  const buildingDefinition = state.catalog.buildings[state.pendingBuildingId];
  const point = state.mouseWorldPosition;
  const previewColor = state.interactionHint === "Click to place building."
    ? "rgba(130, 209, 115, 0.4)"
    : "rgba(255, 122, 107, 0.35)";

  context.fillStyle = previewColor;
  context.strokeStyle = previewColor.replace(/0\.\d+\)/, "0.9)");
  context.lineWidth = 2;
  context.beginPath();
  context.arc(point.x, point.y, buildingDefinition.radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
}

function drawBuildings(context, state, visibleBounds) {
  const nowMs = performance.now();
  const showMinimalBars = state.camera.zoom >= UNIT_HEALTH_BAR_MIN_ZOOM;
  for (const entity of getEntitiesByType(state, "building")) {
    if (!isEntityVisible(state, entity, visibleBounds, 72)) {
      continue;
    }

    const displayPoint = getEntityDisplayPoint(state, entity, nowMs);
    const player = getPlayerById(state, entity.ownerId);
    const buildingDefinition = state.catalog.buildings[entity.definitionId];
    const displayConstructionProgress = !entity.isConstructed
      ? getEntityDisplayValue(
        state,
        entity,
        "constructionProgressSeconds",
        entity.constructionProgressSeconds,
        nowMs
      )
      : null;
    const constructionRatio = !entity.isConstructed
      ? clamp(displayConstructionProgress / Math.max(1, buildingDefinition.buildTime), 0, 1)
      : 1;
    const isDisabledProduction = isProductionKind(buildingDefinition.kind) && entity.enabled === false;
    const fillAlpha = isDisabledProduction
      ? 0.22
      : 0.38;
    const strokeColor = isDisabledProduction ? "#8d949b" : player.color;
    const fillColorBase = isDisabledProduction ? strokeColor : player.color;

    context.fillStyle = withAlpha(fillColorBase, fillAlpha);
    context.beginPath();
    context.arc(displayPoint.x, displayPoint.y, entity.radius, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = strokeColor;
    context.lineWidth = 2;
    if (entity.isConstructed) {
      context.beginPath();
      context.arc(displayPoint.x, displayPoint.y, entity.radius, 0, Math.PI * 2);
      context.stroke();
    } else if (constructionRatio > 0) {
      context.beginPath();
      context.arc(
        displayPoint.x,
        displayPoint.y,
        entity.radius,
        -Math.PI * 0.5,
        -Math.PI * 0.5 + constructionRatio * Math.PI * 2
      );
      context.stroke();
    }

    if (buildingDefinition.kind === "base" && entity.isConstructed) {
      drawBaseTurret(context, state, entity, displayPoint, nowMs);
    }

    context.fillStyle = "#f3f6e9";
    context.font = "12px Segoe UI";
    context.textAlign = "center";
    context.fillText(buildingDefinition.displayName, displayPoint.x, displayPoint.y - entity.radius - 8);

    const displayHealth = getEntityDisplayValue(state, entity, "health", entity.health, nowMs);
    if (showMinimalBars) {
      drawUnitHealthBar(
        context,
        displayPoint.x,
        displayPoint.y + entity.radius + 7,
        Math.max(22, entity.radius * 2.25),
        displayHealth / entity.maxHealth
      );
    }

    if (!entity.isConstructed) {
      if (showMinimalBars) {
        drawUnitProgressBar(
          context,
          displayPoint.x,
          displayPoint.y + entity.radius + 12,
          Math.max(22, entity.radius * 2.25),
          constructionRatio
        );
      }
      continue;
    }

    const producedUnitId = getProducedUnitId(buildingDefinition);
    if (producedUnitId && entity.productionProgressSeconds > 0) {
      const unitDefinition = state.catalog.units[producedUnitId];
      const productionCycleTime = getProductionCycleTime(buildingDefinition, unitDefinition);
      const displayProductionProgress = getEntityDisplayValue(
        state,
        entity,
        "productionProgressSeconds",
        entity.productionProgressSeconds,
        nowMs
      );
      const progress = displayProductionProgress / productionCycleTime;
      if (showMinimalBars) {
        drawUnitProgressBar(
          context,
          displayPoint.x,
          displayPoint.y + entity.radius + 12,
          Math.max(22, entity.radius * 2.25),
          progress
        );
      }
      continue;
    }

    if (buildingDefinition.kind === "base") {
      const upgrade = player.activeBaseUpgrade;
      if (upgrade) {
        const tierDefinition = state.catalog.baseTiers[upgrade.targetTier];
        const displayProgressSeconds = getPlayerDisplayValue(
          state,
          player,
          "activeBaseUpgradeProgressSeconds",
          upgrade.progressSeconds,
          nowMs
        );
        const progress = displayProgressSeconds / tierDefinition.upgradeTime;
        if (showMinimalBars) {
          drawUnitProgressBar(
            context,
            displayPoint.x,
            displayPoint.y + entity.radius + 12,
            Math.max(22, entity.radius * 2.25),
            progress
          );
        }
      }
      continue;
    }

    if (buildingDefinition.kind === "tech_structure") {
      const techUpgrade = player.activeTechUpgrade;
      if (techUpgrade) {
        const displayProgressSeconds = getPlayerDisplayValue(
          state,
          player,
          "activeTechUpgradeProgressSeconds",
          techUpgrade.progressSeconds,
          nowMs
        );
        const progress = displayProgressSeconds / state.catalog.techTiers[techUpgrade.targetTier].upgradeTime;
        if (showMinimalBars) {
          drawUnitProgressBar(
            context,
            displayPoint.x,
            displayPoint.y + entity.radius + 12,
            Math.max(22, entity.radius * 2.25),
            progress
          );
        }
        continue;
      }
    }
  }
}

function drawUnits(context, state, visibleBounds) {
  const nowMs = performance.now();
  const showHealthBars = state.camera.zoom >= UNIT_HEALTH_BAR_MIN_ZOOM;
  for (const entity of getEntitiesByType(state, "unit")) {
    if (!isEntityVisible(state, entity, visibleBounds, 32)) {
      continue;
    }

    const displayPoint = getEntityDisplayPoint(state, entity, nowMs);
    const unitDefinition = state.catalog.units[entity.definitionId];
    const fillColor = unitDefinition.durabilityTag === "heavy"
      ? withAlpha(PLAYER_COLORS[entity.ownerId], 0.85)
      : withAlpha(PLAYER_COLORS[entity.ownerId], 0.6);

    context.fillStyle = fillColor;
    context.strokeStyle = PLAYER_COLORS[entity.ownerId];
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(displayPoint.x, displayPoint.y, entity.radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    const facingAngle = getEntityDisplayAngle(state, entity, entity.facingAngle ?? 0, nowMs);
    const markerInnerDistance = Math.max(2, entity.radius * 0.2);
    const markerOuterDistance = entity.radius + 4;
    const markerStartX = displayPoint.x + Math.cos(facingAngle) * markerInnerDistance;
    const markerStartY = displayPoint.y + Math.sin(facingAngle) * markerInnerDistance;
    const markerEndX = displayPoint.x + Math.cos(facingAngle) * markerOuterDistance;
    const markerEndY = displayPoint.y + Math.sin(facingAngle) * markerOuterDistance;

    context.strokeStyle = "#f6e9b9";
    context.lineWidth = Math.max(1.5, entity.radius * 0.22);
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(markerStartX, markerStartY);
    context.lineTo(markerEndX, markerEndY);
    context.stroke();

    if (showHealthBars) {
      const displayHealth = getEntityDisplayValue(state, entity, "health", entity.health, nowMs);
      const healthRatio = clamp(displayHealth / Math.max(1, entity.maxHealth), 0, 1);
      drawUnitHealthBar(context, displayPoint.x, displayPoint.y - entity.radius - 7, Math.max(14, entity.radius * 2.1), healthRatio);
    }
  }
}

function drawBaseTurret(context, state, entity, displayPoint, nowMs) {
  const turretAngle = getEntityDisplayAngleForField(
    state,
    entity,
    "turretFacingAngle",
    entity.turretFacingAngle ?? entity.facingAngle ?? 0,
    nowMs
  );
  const mountRadius = Math.max(7, entity.radius * 0.34);
  const barrelLength = Math.max(12, entity.radius * 0.68);
  const barrelWidth = Math.max(5, entity.radius * 0.18);
  const barrelEndX = displayPoint.x + Math.cos(turretAngle) * barrelLength;
  const barrelEndY = displayPoint.y + Math.sin(turretAngle) * barrelLength;

  context.save();
  context.strokeStyle = "#f6e9b9";
  context.lineWidth = barrelWidth;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(displayPoint.x, displayPoint.y);
  context.lineTo(barrelEndX, barrelEndY);
  context.stroke();

  context.fillStyle = "#1d2732";
  context.beginPath();
  context.arc(displayPoint.x, displayPoint.y, mountRadius, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "#f3f6e9";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(displayPoint.x, displayPoint.y, mountRadius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawProjectiles(context, state, visibleBounds) {
  const nowMs = performance.now();
  for (const entity of getEntitiesByType(state, "projectile")) {
    if (!isEntityVisible(state, entity, visibleBounds, 16)) {
      continue;
    }

    const displayPoint = getEntityDisplayPoint(state, entity, nowMs);
    context.fillStyle = withAlpha(PLAYER_COLORS[entity.ownerId], 0.92);
    context.strokeStyle = "#f6e9b9";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(displayPoint.x, displayPoint.y, entity.radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
}

function drawTransientEffects(context, state, visibleBounds) {
  if (state.camera.zoom < EFFECT_MIN_ZOOM || !Array.isArray(state.transientEffects) || state.transientEffects.length === 0) {
    return;
  }

  for (const effect of state.transientEffects) {
    const elapsed = state.matchTimeSeconds - effect.startedAtSeconds;
    const progress = clamp(elapsed / Math.max(0.001, effect.durationSeconds), 0, 1);

    if (effect.type === "death_explosion") {
      drawDeathExplosionEffect(context, effect, progress, visibleBounds);
      continue;
    }

    if (effect.type === "reflect_damage") {
      drawReflectDamageEffect(context, effect, progress, visibleBounds);
    }
  }
}

function drawSelection(context, state, visibleBounds) {
  const nowMs = performance.now();
  const selectedEntities = getSelectedEntities(state);
  if (selectedEntities.length === 0) {
    return;
  }

  context.strokeStyle = "#f6e9b9";
  context.lineWidth = 3;

  for (const selected of selectedEntities) {
    if (!isEntityVisible(state, selected, visibleBounds, 16)) {
      continue;
    }

    const displayPoint = getEntityDisplayPoint(state, selected, nowMs);
    context.beginPath();
    context.arc(displayPoint.x, displayPoint.y, selected.radius + 6, 0, Math.PI * 2);
    context.stroke();
  }

  const primarySelected = getEntityById(state, state.selectedEntityId);
  if (!primarySelected || selectedEntities.length === 1 || !isEntityVisible(state, primarySelected, visibleBounds, 16)) {
    return;
  }

  const primaryDisplayPoint = getEntityDisplayPoint(state, primarySelected, nowMs);
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(primaryDisplayPoint.x, primaryDisplayPoint.y, primarySelected.radius + 11, 0, Math.PI * 2);
  context.stroke();
}

function drawSelectionBox(context, state) {
  if (!state.selectionBox) {
    return;
  }

  const { start, end } = state.selectionBox;
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  context.fillStyle = "rgba(246, 233, 185, 0.12)";
  context.strokeStyle = "rgba(246, 233, 185, 0.9)";
  context.lineWidth = 1.5;
  context.setLineDash([10, 6]);
  context.fillRect(left, top, width, height);
  context.strokeRect(left, top, width, height);
  context.setLineDash([]);
}

function drawModeHint(context, state) {
  if (state.uiMode !== "place_building" || !state.interactionHint) {
    return;
  }

  const width = Math.min(560, state.viewport.width - 32);
  const height = 38;
  const x = Math.max(16, (state.viewport.width - width) * 0.5);
  const y = Math.max(16, state.viewport.height - height - 18);
  context.fillStyle = "rgba(0, 0, 0, 0.58)";
  context.fillRect(x, y, width, height);
  context.strokeStyle = "rgba(246, 233, 185, 0.32)";
  context.lineWidth = 1;
  context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  context.fillStyle = "#f3f6e9";
  context.font = "16px Segoe UI";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(state.interactionHint, x + width * 0.5, y + height * 0.5);
}

function drawWinnerBanner(context, state) {
  if (!state.matchEnded) {
    return;
  }

  const winner = getPlayerById(state, state.winnerId);
  context.fillStyle = "rgba(0, 0, 0, 0.58)";
  context.fillRect(0, 0, state.viewport.width, state.viewport.height);

  context.fillStyle = winner.color;
  context.font = "bold 48px Segoe UI";
  context.textAlign = "center";
  context.fillText(`${winner.name} wins`, state.viewport.width * 0.5, state.viewport.height * 0.5);
}

function drawUnitHealthBar(context, x, y, width, progress) {
  const clampedProgress = clamp(progress, 0, 1);
  const height = 2.5;
  context.fillStyle = "rgba(0,0,0,0.55)";
  context.fillRect(x - width / 2, y, width, height);
  context.fillStyle = UNIT_HEALTH_BAR_COLOR;
  context.fillRect(x - width / 2, y, Math.max(0, width * clampedProgress), height);
}

function drawUnitProgressBar(context, x, y, width, progress) {
  const clampedProgress = clamp(progress, 0, 1);
  const height = 2.5;
  context.fillStyle = "rgba(0,0,0,0.55)";
  context.fillRect(x - width / 2, y, width, height);
  context.fillStyle = "#d8b14f";
  context.fillRect(x - width / 2, y, Math.max(0, width * clampedProgress), height);
}

function drawHealthBar(context, x, y, width, progress) {
  context.fillStyle = "rgba(0,0,0,0.45)";
  context.fillRect(x - width / 2, y, width, 6);
  context.fillStyle = HEALTH_BAR_COLOR;
  context.fillRect(x - width / 2, y, Math.max(0, width * progress), 6);
}

function drawProgressBar(context, x, y, width, progress) {
  context.fillStyle = "rgba(0,0,0,0.45)";
  context.fillRect(x - width / 2, y, width, 5);
  context.fillStyle = "#d8b14f";
  context.fillRect(x - width / 2, y, Math.max(0, width * progress), 5);
}

function drawObjectiveProgressBar(context, x, y, width, progress, progressColor, ownerColor, objective) {
  context.fillStyle = "rgba(0,0,0,0.55)";
  context.fillRect(x - width / 2, y, width, 6);
  context.fillStyle = withAlpha(progressColor, 0.9);
  context.fillRect(x - width / 2, y, Math.max(0, width * progress), 6);
  context.strokeStyle = withAlpha(ownerColor, 0.75);
  context.lineWidth = 1;
  context.strokeRect(x - width / 2, y, width, 6);

  context.fillStyle = "#f3f6e9";
  context.font = "10px Segoe UI";
  context.textAlign = "center";
  const ownerLabel = objective.ownerId
    ? `Owned by P${objective.ownerId}`
    : objective.controllingPlayerId
      ? `Capturing P${objective.controllingPlayerId} ${objective.controlPercent}%`
      : "Neutral";
  context.fillText(ownerLabel, x, y + 18);
}

function withAlpha(hexColor, alpha) {
  const clean = hexColor.replace("#", "");
  const red = Number.parseInt(clean.slice(0, 2), 16);
  const green = Number.parseInt(clean.slice(2, 4), 16);
  const blue = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function drawDeathExplosionEffect(context, effect, progress, visibleBounds) {
  const currentRadius = effect.radius * (0.3 + progress * 0.7);
  if (!isCircleVisible(effect.x, effect.y, currentRadius, visibleBounds)) {
    return;
  }

  const ownerColor = PLAYER_COLORS[effect.ownerId] ?? "#f6e9b9";
  context.save();
  context.globalAlpha = 1 - progress;
  context.fillStyle = withAlpha(ownerColor, 0.16);
  context.strokeStyle = withAlpha("#ffd27d", 0.95 - progress * 0.35);
  context.lineWidth = 2.5;
  context.beginPath();
  context.arc(effect.x, effect.y, currentRadius, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  context.globalAlpha = (1 - progress) * 0.75;
  context.strokeStyle = withAlpha("#fff2c2", 0.95);
  context.lineWidth = 1.25;
  context.beginPath();
  context.arc(effect.x, effect.y, currentRadius * 0.55, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawReflectDamageEffect(context, effect, progress, visibleBounds) {
  const left = Math.min(effect.sourceX, effect.targetX) - 12;
  const right = Math.max(effect.sourceX, effect.targetX) + 12;
  const top = Math.min(effect.sourceY, effect.targetY) - 12;
  const bottom = Math.max(effect.sourceY, effect.targetY) + 12;
  if (right < visibleBounds.left || left > visibleBounds.right || bottom < visibleBounds.top || top > visibleBounds.bottom) {
    return;
  }

  const ownerColor = PLAYER_COLORS[effect.ownerId] ?? "#72d2c1";
  const pulse = Math.sin(progress * Math.PI);
  context.save();
  context.globalAlpha = 1 - progress;
  context.strokeStyle = withAlpha(ownerColor, 0.95);
  context.lineWidth = 1.6 + pulse * 1.2;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(effect.sourceX, effect.sourceY);
  context.lineTo(effect.targetX, effect.targetY);
  context.stroke();

  context.fillStyle = withAlpha("#f6fff0", 0.95 - progress * 0.4);
  context.beginPath();
  context.arc(effect.targetX, effect.targetY, 2 + pulse * 2.5, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function clipBoundsToMap(state, visibleBounds) {
  return {
    left: clamp(visibleBounds.left, 0, state.map.width),
    right: clamp(visibleBounds.right, 0, state.map.width),
    top: clamp(visibleBounds.top, 0, state.map.height),
    bottom: clamp(visibleBounds.bottom, 0, state.map.height)
  };
}

function getVisibleTerritoryCells(state, visibleBounds) {
  const leftColumn = clamp(Math.floor(visibleBounds.left / state.territory.cellSize), 0, state.territory.columns - 1);
  const rightColumn = clamp(Math.floor(visibleBounds.right / state.territory.cellSize), 0, state.territory.columns - 1);
  const topRow = clamp(Math.floor(visibleBounds.top / state.territory.cellSize), 0, state.territory.rows - 1);
  const bottomRow = clamp(Math.floor(visibleBounds.bottom / state.territory.cellSize), 0, state.territory.rows - 1);
  const cells = [];

  for (let row = topRow; row <= bottomRow; row += 1) {
    for (let column = leftColumn; column <= rightColumn; column += 1) {
      cells.push(state.territory.cells[row * state.territory.columns + column]);
    }
  }

  return cells;
}

function isEntityVisible(state, entity, visibleBounds, padding = 0) {
  const displayPoint = getEntityDisplayPoint(state, entity);
  const x = displayPoint.x;
  const y = displayPoint.y;
  const radius = (entity.radius ?? 0) + padding;
  return (
    x + radius >= visibleBounds.left &&
    x - radius <= visibleBounds.right &&
    y + radius >= visibleBounds.top &&
    y - radius <= visibleBounds.bottom
  );
}

function isBlockerVisible(blocker, visibleBounds) {
  if (blocker.kind === "circle") {
    return (
      blocker.x + blocker.radius >= visibleBounds.left &&
      blocker.x - blocker.radius <= visibleBounds.right &&
      blocker.y + blocker.radius >= visibleBounds.top &&
      blocker.y - blocker.radius <= visibleBounds.bottom
    );
  }

  if (blocker.kind === "rect") {
    return (
      blocker.x + blocker.width >= visibleBounds.left &&
      blocker.x <= visibleBounds.right &&
      blocker.y + blocker.height >= visibleBounds.top &&
      blocker.y <= visibleBounds.bottom
    );
  }

  throw new Error(`Unsupported terrain blocker kind: ${blocker.kind}`);
}

function isCircleVisible(x, y, radius, visibleBounds) {
  return (
    x + radius >= visibleBounds.left &&
    x - radius <= visibleBounds.right &&
    y + radius >= visibleBounds.top &&
    y - radius <= visibleBounds.bottom
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
