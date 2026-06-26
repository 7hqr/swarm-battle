import { getGameplayCommandTypes } from "../gameplayCommands.js";
import {
  panCameraByScreenDelta,
  screenToWorld,
  zoomCameraAtScreenPoint
} from "../state/camera.js";
import { getLocalPlayerId, isObserverMode } from "../state/localPlayer.js";
import {
  addSelectedEntity,
  getSelectedEntities,
  setSelectedEntities
} from "../state/selection.js";
import { isProductionKind } from "../rules/catalogRules.js";
import { canPlaceBuildingAt } from "../systems/construction.js";

const DRAG_SELECTION_THRESHOLD = 6;

export function createInputController(canvas, getState, dispatchGameplayCommand) {
  let activePanPointerId = null;
  let lastPanScreenPoint = null;
  let activeSelectionPointerId = null;
  let selectionStartScreenPoint = null;
  let selectionStartWorldPoint = null;
  let selectionAppendMode = false;

  const controller = {
    dispose() {
      canvas.removeEventListener("dblclick", handleDoubleClick);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel, { passive: false });
      canvas.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    }
  };

  canvas.addEventListener("dblclick", handleDoubleClick);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerUp);
  canvas.addEventListener("wheel", handleWheel, { passive: false });
  canvas.addEventListener("contextmenu", handleContextMenu);
  window.addEventListener("keydown", handleKeyDown);

  return controller;

  function handlePointerMove(event) {
    const state = getState();
    if (state.uiScreen !== "playing") {
      return;
    }

    const screenPoint = getScreenPoint(event);
    if (activePanPointerId === event.pointerId && lastPanScreenPoint) {
      panCameraByScreenDelta(
        state,
        screenPoint.x - lastPanScreenPoint.x,
        screenPoint.y - lastPanScreenPoint.y
      );
      lastPanScreenPoint = screenPoint;
    }

    if (
      activeSelectionPointerId === event.pointerId &&
      selectionStartScreenPoint &&
      selectionStartWorldPoint
    ) {
      state.selectionBox = hasExceededDragThreshold(selectionStartScreenPoint, screenPoint)
        ? {
            start: selectionStartWorldPoint,
            end: screenToWorld(state, screenPoint)
          }
        : null;
    }

    state.mouseWorldPosition = screenToWorld(state, screenPoint);
  }

  function handlePointerDown(event) {
    const state = getState();
    if (state.uiScreen !== "playing") {
      return;
    }

    const screenPoint = getScreenPoint(event);
    const point = screenToWorld(state, screenPoint);
    state.mouseWorldPosition = point;

    if (event.button === 1) {
      event.preventDefault();
      activePanPointerId = event.pointerId;
      lastPanScreenPoint = screenPoint;
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    if (event.button === 2) {
      event.preventDefault();
      handleRightPointerDown(point, event.shiftKey);
      return;
    }

    if (event.button !== 0) {
      return;
    }

    if (state.uiMode === "place_building" && state.pendingBuildingId) {
      const localPlayerId = getLocalPlayerId(state);
      if (!localPlayerId) {
        state.interactionHint = "Observer mode.";
        return;
      }

      const placement = canPlaceBuildingAt(state, localPlayerId, state.pendingBuildingId, point);
      if (placement.ok) {
        const placedBuildingId = state.pendingBuildingId;
        dispatchGameplayCommand({
          type: getGameplayCommandTypes().PLACE_BUILDING,
          playerId: localPlayerId,
          buildingId: placedBuildingId,
          point
        });
        if (event.shiftKey) {
          state.pendingPlacedBuildingSelection = null;
          state.interactionHint = "Click to place building.";
        } else {
          state.pendingPlacedBuildingSelection = {
            ownerId: localPlayerId,
            definitionId: placedBuildingId,
            point: { x: point.x, y: point.y }
          };
          state.uiMode = "select";
          state.pendingBuildingId = null;
          state.interactionHint = "";
        }
      } else {
        state.interactionHint = placement.reason;
      }
      return;
    }

    activeSelectionPointerId = event.pointerId;
    selectionStartScreenPoint = screenPoint;
    selectionStartWorldPoint = point;
    selectionAppendMode = isAppendModifierPressed(event);
    canvas.setPointerCapture(event.pointerId);
  }

  function handlePointerUp(event) {
    if (activePanPointerId === event.pointerId) {
      activePanPointerId = null;
      lastPanScreenPoint = null;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      return;
    }

    if (activeSelectionPointerId !== event.pointerId || !selectionStartScreenPoint || !selectionStartWorldPoint) {
      return;
    }

    if (event.type === "pointercancel") {
      const state = getState();
      state.selectionBox = null;
      activeSelectionPointerId = null;
      selectionStartScreenPoint = null;
      selectionStartWorldPoint = null;
      selectionAppendMode = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      return;
    }

    const state = getState();
    const screenPoint = getScreenPoint(event);
    const point = screenToWorld(state, screenPoint);
    const isDragSelection = hasExceededDragThreshold(selectionStartScreenPoint, screenPoint);

    state.mouseWorldPosition = point;

    if (isDragSelection) {
      selectBuildingsInBox(state, selectionStartWorldPoint, point, selectionAppendMode);
    } else {
      selectEntityFromClick(state, point, {
        appendOnly: selectionAppendMode
      });
    }

    state.selectionBox = null;
    activeSelectionPointerId = null;
    selectionStartScreenPoint = null;
    selectionStartWorldPoint = null;
    selectionAppendMode = false;

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event) {
    const state = getState();
    if (state.uiScreen !== "playing") {
      return;
    }

    if (event.key.toLowerCase() === "c") {
      if (isObserverMode(state)) {
        return;
      }

      const selectedBuildings = getSelectedWaypointBuildings(state);
      if (selectedBuildings.length > 0) {
        const localPlayerId = getLocalPlayerId(state);
        if (localPlayerId) {
          for (const building of selectedBuildings) {
            dispatchGameplayCommand({
              type: getGameplayCommandTypes().CLEAR_WAYPOINT_CHAIN,
              playerId: localPlayerId,
              buildingId: building.id
            });
          }
        }
      }
      return;
    }

    if (event.key.toLowerCase() === "e") {
      if (isObserverMode(state)) {
        return;
      }

      const selectedBuildings = getSelectedProductionBuildings(state);
      if (selectedBuildings.length > 0) {
        const allEnabled = selectedBuildings.every((building) => building.enabled);
        const localPlayerId = getLocalPlayerId(state);
        if (localPlayerId) {
          dispatchGameplayCommand({
            type: getGameplayCommandTypes().SET_PRODUCTION_ENABLED,
            playerId: localPlayerId,
            buildingIds: selectedBuildings.map((building) => building.id),
            enabled: !allEnabled
          });
        }
      }
      return;
    }

    if (event.key === "Escape") {
      state.uiMode = "select";
      state.pendingBuildingId = null;
      state.pendingPlacedBuildingSelection = null;
      state.interactionHint = "";
    }
  }

  function handleDoubleClick(event) {
    const state = getState();
    if (state.uiScreen !== "playing" || event.button !== 0) {
      return;
    }

    if (state.uiMode === "place_building") {
      return;
    }

    const point = screenToWorld(state, getScreenPoint(event));
    state.mouseWorldPosition = point;

    selectEntityFromClick(state, point, {
      appendOnly: isAppendModifierPressed(event),
      selectAllMatchingType: true
    });
  }

  function handleContextMenu(event) {
    event.preventDefault();
  }

  function handleWheel(event) {
    const state = getState();
    if (state.uiScreen !== "playing") {
      return;
    }

    event.preventDefault();
    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    zoomCameraAtScreenPoint(state, state.camera.zoom * zoomFactor, getScreenPoint(event));
    state.mouseWorldPosition = screenToWorld(state, getScreenPoint(event));
  }

  function handleRightPointerDown(point, appendOnly) {
    const state = getState();
    if (isObserverMode(state)) {
      return;
    }

    if (state.uiMode === "place_building") {
      state.uiMode = "select";
      state.pendingBuildingId = null;
      state.pendingPlacedBuildingSelection = null;
      state.interactionHint = "";
      return;
    }

    const selectedBuildings = getSelectedWaypointBuildings(state);
    if (selectedBuildings.length === 0) {
      return;
    }

    const localPlayerId = getLocalPlayerId(state);
    if (!localPlayerId) {
      return;
    }

    if (!appendOnly) {
      for (const building of selectedBuildings) {
        dispatchGameplayCommand({
          type: getGameplayCommandTypes().CLEAR_WAYPOINT_CHAIN,
          playerId: localPlayerId,
          buildingId: building.id
        });
      }
    }

    for (const building of selectedBuildings) {
      dispatchGameplayCommand({
        type: getGameplayCommandTypes().APPEND_WAYPOINT,
        playerId: localPlayerId,
        buildingId: building.id,
        point
      });
    }
  }
}

export function describePlacementValidity(state) {
  if (state.uiMode !== "place_building" || !state.pendingBuildingId) {
    return "";
  }

  const localPlayerId = getLocalPlayerId(state);
  if (!localPlayerId) {
    return "Observer mode.";
  }

  const result = canPlaceBuildingAt(state, localPlayerId, state.pendingBuildingId, state.mouseWorldPosition);
  return result.ok ? "Click to place building." : result.reason;
}

function findEntityAtPoint(state, point) {
  const reversed = [...state.entities].reverse();
  return reversed.find((entity) => {
    if (entity.type === "projectile") {
      return false;
    }

    const distance = Math.hypot(entity.x - point.x, entity.y - point.y);
    return distance <= entity.radius;
  }) ?? null;
}

function getSelectedWaypointBuildings(state) {
  const localPlayerId = getLocalPlayerId(state);
  return getSelectedEntities(state).filter((entity) => {
    return entity.type === "building" && entity.ownerId === localPlayerId && Array.isArray(entity.waypointChain);
  });
}

function getSelectedProductionBuildings(state) {
  return getSelectedWaypointBuildings(state).filter((building) => isProductionKind(building.kind));
}

function isPlayerOwnedBuilding(state, entity) {
  return entity.type === "building" && entity.ownerId === getLocalPlayerId(state);
}

function selectEntityFromClick(state, point, { appendOnly, selectAllMatchingType = false }) {
  const clickedEntity = findEntityAtPoint(state, point);
  if (!clickedEntity) {
    if (!appendOnly) {
      setSelectedEntities(state, []);
    }
    return;
  }

  if (selectAllMatchingType && isPlayerOwnedBuilding(state, clickedEntity)) {
    const matchingBuildingIds = state.entities
      .filter((entity) => {
        return (
          entity.type === "building" &&
          entity.ownerId === clickedEntity.ownerId &&
          entity.definitionId === clickedEntity.definitionId
        );
      })
      .map((entity) => entity.id);

    setSelectedEntities(
      state,
      appendOnly ? [...state.selectedEntityIds, ...matchingBuildingIds] : matchingBuildingIds,
      clickedEntity.id
    );
    return;
  }

  if (appendOnly && isPlayerOwnedBuilding(state, clickedEntity)) {
    addSelectedEntity(state, clickedEntity.id);
    return;
  }

  setSelectedEntities(state, [clickedEntity.id], clickedEntity.id);
}

function selectBuildingsInBox(state, start, end, appendOnly) {
  const bounds = normalizeBounds(start, end);
  const selectedBuildingIds = state.entities
    .filter((entity) => {
      return (
        entity.type === "building" &&
        entity.ownerId === getLocalPlayerId(state) &&
        entity.x >= bounds.left &&
        entity.x <= bounds.right &&
        entity.y >= bounds.top &&
        entity.y <= bounds.bottom
      );
    })
    .map((entity) => entity.id);

  if (appendOnly && selectedBuildingIds.length === 0) {
    return;
  }

  setSelectedEntities(
    state,
    appendOnly ? [...state.selectedEntityIds, ...selectedBuildingIds] : selectedBuildingIds,
    selectedBuildingIds[0] ?? state.selectedEntityId
  );
}

function hasExceededDragThreshold(start, end) {
  return Math.hypot(end.x - start.x, end.y - start.y) >= DRAG_SELECTION_THRESHOLD;
}

function normalizeBounds(start, end) {
  return {
    left: Math.min(start.x, end.x),
    right: Math.max(start.x, end.x),
    top: Math.min(start.y, end.y),
    bottom: Math.max(start.y, end.y)
  };
}

function isAppendModifierPressed(event) {
  return event.ctrlKey || event.metaKey;
}

function getScreenPoint(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}
