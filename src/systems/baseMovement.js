import { traceAiEvent } from "../debug/aiTrace.js";
import { markEntityDirty } from "../multiplayer/replicationDirtyState.js";
import { createEntitySpatialIndexSnapshot, invalidateEntitySpatialIndex } from "../state/entities.js";
import {
  canMoveDirectlyToPoint
} from "./navigation.js";
import { invalidateUnitPath, moveUnitTowardPoint, stopMover } from "./movement.js";
import { markTerritoryInfluencersDirty } from "./territory.js";

const BASE_PATH_BLOCKER_RADIUS_PADDING = 10;
const BASE_WAYPOINT_ARRIVAL_PADDING = 8;

export function updateBaseMovement(state, dt) {
  const movedBaseIds = [];
  const movementSpatialIndex = createEntitySpatialIndexSnapshot(state.entities);

  for (const entity of state.entities) {
    if (
      entity.type !== "building" ||
      entity.kind !== "base" ||
      !entity.isConstructed ||
      !Array.isArray(entity.waypointChain) ||
      entity.waypointChain.length === 0
    ) {
      continue;
    }

    if (!moveBaseAlongWaypoints(state, movementSpatialIndex, entity, dt)) {
      continue;
    }

    movedBaseIds.push(entity.id);
  }

  if (movedBaseIds.length === 0) {
    return;
  }

  invalidateEntitySpatialIndex(state);
  markTerritoryInfluencersDirty(state, movedBaseIds);
}

function moveBaseAlongWaypoints(state, movementSpatialIndex, base, dt) {
  let destination = base.waypointChain[0] ?? null;
  if (!destination) {
    invalidateUnitPath(base);
    stopMover(base);
    base.currentWaypointIndex = 0;
    markEntityDirty(state, base.id);
    return false;
  }

  while (destination && hasReachedBaseWaypoint(base, destination)) {
    traceBaseMovement(state, base, "consume_waypoint", destination);
    base.waypointChain.shift();
    base.currentWaypointIndex = 0;
    invalidateUnitPath(base);
    destination = base.waypointChain[0] ?? null;
    markEntityDirty(state, base.id);
  }

  if (!destination) {
    base.currentWaypointIndex = 0;
    stopMover(base);
    markEntityDirty(state, base.id);
    return false;
  }

  const movementResult = moveBaseTowardPoint(state, movementSpatialIndex, base, destination, dt, {
    arrivalDistance: getBaseWaypointArrivalDistance(base),
    navigationKey: getBaseNavigationKey(base, destination)
  });
  traceBaseMovement(state, base, movementResult, destination);

  if (movementResult === "moved") {
    markEntityDirty(state, base.id);
    return true;
  }

  return false;
}

function moveBaseTowardPoint(state, movementSpatialIndex, base, destination, dt, options = {}) {
  const arrivalDistance = options.arrivalDistance ?? 0;
  const blockerRadius = (base.radius ?? 0) + BASE_PATH_BLOCKER_RADIUS_PADDING;
  const movementOptions = {
    excludedBuildingIds: new Set([base.id])
  };
  const navigationKey = options.navigationKey ?? getPointNavigationKey(destination);

  return moveUnitTowardPoint(state, movementSpatialIndex, base, destination, base, dt, {
    arrivalDistance,
    navigationKey,
    excludedBuildingIds: movementOptions.excludedBuildingIds,
    avoidUnits: false
  });
}

function getBaseWaypointArrivalDistance(base) {
  return (base.radius ?? 0) + BASE_WAYPOINT_ARRIVAL_PADDING;
}

function hasReachedBaseWaypoint(base, waypoint) {
  return Math.hypot(waypoint.x - base.x, waypoint.y - base.y) <= getBaseWaypointArrivalDistance(base);
}

function getBaseNavigationKey(base, destination) {
  if (base.waypointChain[0]) {
    return `base_route:0:${destination.x}:${destination.y}`;
  }

  return getPointNavigationKey(destination);
}

function getPointNavigationKey(point) {
  return `base_point:${Math.round(point.x)}:${Math.round(point.y)}`;
}

function traceBaseMovement(state, base, result, destination) {
  const corridorPreview = Array.isArray(base.movementCorridor)
    ? base.movementCorridor.slice(0, 4).map(clonePoint)
    : [];
  const signature = JSON.stringify({
    entityId: base.id,
    result,
    basePoint: roundPoint(base),
    destination: roundPoint(destination),
    routeHead: roundPoint(base.waypointChain[0] ?? null),
    routeLength: base.waypointChain.length,
    corridorHead: roundPoint(corridorPreview[0] ?? null),
    corridorLength: Array.isArray(base.movementCorridor) ? base.movementCorridor.length : 0,
    pathStatus: base.movementPathStatus ?? "idle"
  });
  traceAiEvent(state, base.ownerId, "base_move", signature, {
    entityId: base.id,
    result,
    basePoint: clonePoint(base),
    destination: clonePoint(destination),
    waypointChain: base.waypointChain.map(clonePoint),
    movementGoal: clonePoint(base.movementGoal),
    movementCorridor: corridorPreview,
    movementCorridorLength: Array.isArray(base.movementCorridor) ? base.movementCorridor.length : 0,
    movementPathStatus: base.movementPathStatus ?? "idle"
  });
}

function clonePoint(point) {
  return point ? { x: point.x, y: point.y } : null;
}

function roundPoint(point) {
  return point ? { x: Math.round(point.x), y: Math.round(point.y) } : null;
}
