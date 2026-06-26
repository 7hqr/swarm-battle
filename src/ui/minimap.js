import { getVisibleWorldBounds } from "../state/camera.js";
import { getLocalPlayerId } from "../state/localPlayer.js";
import { getEntityDisplayPoint } from "../multiplayer/interpolation.js";
import { getSelectedEntities } from "../state/selection.js";
import { getEntitiesByType } from "../state/entities.js";

const MAP_BACKGROUND = "#151d26";
const NEUTRAL_TERRITORY = "rgba(255,255,255,0.08)";
const PLAYER_TERRITORY = "rgba(130, 209, 115, 0.4)";
const ENEMY_TERRITORY = "rgba(255, 122, 107, 0.4)";
const PLAYER_ENTITY = "#82d173";
const ENEMY_ENTITY = "#ff7a6b";
const VIEWPORT_COLOR = "#f6e9b9";
const SELECTION_COLOR = "#f3f6e9";
const MINIMAP_REFRESH_INTERVAL_MS = 100;

export function createMinimapRenderer(canvas) {
  const context = canvas.getContext("2d");
  const territoryCache = {
    canvas: null,
    context: null,
    width: 0,
    height: 0,
    territoryRevision: -1,
    localPlayerId: null
  };
  let lastRenderAtMs = Number.NEGATIVE_INFINITY;
  let clearedWhileInactive = false;

  return {
    render(state, nowMs = performance.now()) {
      if (!state.hasActiveMatch) {
        if (!clearedWhileInactive) {
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.clearRect(0, 0, canvas.width, canvas.height);
          clearedWhileInactive = true;
        }
        return;
      }

      clearedWhileInactive = false;
      const resized = resizeCanvasToDisplaySize(canvas, state.viewport.devicePixelRatio ?? 1);
      const width = canvas.width;
      const height = canvas.height;
      const projection = getMinimapProjection(width, height, state.map.width, state.map.height);
      const localPlayerId = getLocalPlayerId(state) ?? 1;
      const projectedWidth = Math.max(1, Math.ceil(projection.width));
      const projectedHeight = Math.max(1, Math.ceil(projection.height));
      const territoryDirty =
        territoryCache.territoryRevision !== state.territory.visualRevision ||
        territoryCache.localPlayerId !== localPlayerId ||
        territoryCache.width !== projectedWidth ||
        territoryCache.height !== projectedHeight;
      const throttled = nowMs - lastRenderAtMs < MINIMAP_REFRESH_INTERVAL_MS;
      if (!resized && !territoryDirty && throttled) {
        return;
      }

      ensureTerritoryCache(state, territoryCache, projection, localPlayerId);

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "rgba(0, 0, 0, 0.22)";
      context.fillRect(0, 0, width, height);
      context.drawImage(territoryCache.canvas, projection.offsetX, projection.offsetY);
      drawEntities(context, state, projection);
      drawSelection(context, state, projection);
      drawViewport(context, state, projection);
      drawFrame(context, projection);
      lastRenderAtMs = nowMs;
    }
  };
}

export function getMinimapWorldPoint(state, canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const projection = getMinimapProjection(rect.width, rect.height, state.map.width, state.map.height);
  const localX = clamp(clientX - rect.left, projection.offsetX, projection.offsetX + projection.width);
  const localY = clamp(clientY - rect.top, projection.offsetY, projection.offsetY + projection.height);

  return {
    x: ((localX - projection.offsetX) / projection.width) * state.map.width,
    y: ((localY - projection.offsetY) / projection.height) * state.map.height
  };
}

function drawEntities(context, state, projection) {
  const nowMs = performance.now();
  const localPlayerId = getLocalPlayerId(state) ?? 1;
  const renderableEntities = [
    ...getEntitiesByType(state, "building"),
    ...getEntitiesByType(state, "unit")
  ];
  for (const entity of renderableEntities) {
    const displayPoint = getEntityDisplayPoint(state, entity, nowMs);
    const radius = entity.type === "building" ? 2.2 : 1.35;
    context.fillStyle = entity.ownerId === localPlayerId ? PLAYER_ENTITY : ENEMY_ENTITY;
    context.beginPath();
    context.arc(
      projection.offsetX + displayPoint.x * projection.scale,
      projection.offsetY + displayPoint.y * projection.scale,
      radius,
      0,
      Math.PI * 2
    );
    context.fill();
  }
}

function drawSelection(context, state, projection) {
  const nowMs = performance.now();
  const selectedEntities = getSelectedEntities(state);
  if (selectedEntities.length === 0) {
    return;
  }

  context.strokeStyle = SELECTION_COLOR;
  context.lineWidth = 1;

  for (const entity of selectedEntities) {
    if (entity.type !== "unit" && entity.type !== "building") {
      continue;
    }

    const displayPoint = getEntityDisplayPoint(state, entity, nowMs);
    context.beginPath();
    context.arc(
      projection.offsetX + displayPoint.x * projection.scale,
      projection.offsetY + displayPoint.y * projection.scale,
      entity.type === "building" ? 3.8 : 2.7,
      0,
      Math.PI * 2
    );
    context.stroke();
  }
}

function drawViewport(context, state, projection) {
  const bounds = getVisibleWorldBounds(state);
  const left = projection.offsetX + clamp(bounds.left, 0, state.map.width) * projection.scale;
  const top = projection.offsetY + clamp(bounds.top, 0, state.map.height) * projection.scale;
  const right = projection.offsetX + clamp(bounds.right, 0, state.map.width) * projection.scale;
  const bottom = projection.offsetY + clamp(bounds.bottom, 0, state.map.height) * projection.scale;

  context.strokeStyle = VIEWPORT_COLOR;
  context.lineWidth = 1.25;
  context.strokeRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
}

function drawFrame(context, projection) {
  context.strokeStyle = "rgba(255,255,255,0.16)";
  context.lineWidth = 1;
  context.strokeRect(
    projection.offsetX + 0.5,
    projection.offsetY + 0.5,
    Math.max(0, projection.width - 1),
    Math.max(0, projection.height - 1)
  );
}

function getMinimapProjection(width, height, mapWidth, mapHeight) {
  const scale = Math.min(width / mapWidth, height / mapHeight);
  const projectedWidth = mapWidth * scale;
  const projectedHeight = mapHeight * scale;

  return {
    scale,
    width: projectedWidth,
    height: projectedHeight,
    offsetX: (width - projectedWidth) * 0.5,
    offsetY: (height - projectedHeight) * 0.5
  };
}

function resizeCanvasToDisplaySize(canvas, devicePixelRatio) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
  const height = Math.max(1, Math.floor(rect.height * devicePixelRatio));

  if (canvas.width === width && canvas.height === height) {
    return false;
  }

  canvas.width = width;
  canvas.height = height;
  return true;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ensureTerritoryCache(state, cache, projection, localPlayerId) {
  if (!cache.canvas || cache.width !== projection.width || cache.height !== projection.height) {
    cache.canvas = createCanvasSurface(Math.max(1, Math.ceil(projection.width)), Math.max(1, Math.ceil(projection.height)));
    cache.context = cache.canvas.getContext("2d");
    cache.width = cache.canvas.width;
    cache.height = cache.canvas.height;
    cache.territoryRevision = -1;
  }

  if (cache.territoryRevision === state.territory.visualRevision && cache.localPlayerId === localPlayerId) {
    return;
  }

  cache.context.setTransform(1, 0, 0, 1, 0, 0);
  cache.context.clearRect(0, 0, cache.width, cache.height);
  cache.context.fillStyle = MAP_BACKGROUND;
  cache.context.fillRect(0, 0, cache.width, cache.height);

  for (const cell of state.territory.cells) {
    cache.context.fillStyle = cell.ownerId === localPlayerId
      ? PLAYER_TERRITORY
      : cell.ownerId
        ? ENEMY_TERRITORY
        : NEUTRAL_TERRITORY;
    cache.context.fillRect(
      (cell.x * projection.scale),
      (cell.y * projection.scale),
      Math.max(1, cell.width * projection.scale),
      Math.max(1, cell.height * projection.scale)
    );
  }

  cache.territoryRevision = state.territory.visualRevision;
  cache.localPlayerId = localPlayerId;
}

function createCanvasSurface(width, height) {
  if (typeof OffscreenCanvas === "function") {
    return new OffscreenCanvas(width, height);
  }

  const surface = document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  return surface;
}
