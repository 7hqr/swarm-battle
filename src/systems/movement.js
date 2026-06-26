import { getEnemyBase } from "../state/entities.js";
import { markEntityDirty } from "../multiplayer/replicationDirtyState.js";
import { canMoveDirectlyToPoint, createDirectPathValidity, isNavigationPathValid, requestNavigationPath } from "./navigation.js";
import { resolveUnitSteeringVelocity } from "./localAvoidance.js";

const PATH_BLOCKER_RADIUS_PADDING = 6;
const CORRIDOR_POINT_REACHED_PADDING = 4;
const GOAL_TRACKING_DISTANCE_THRESHOLD = 18;
const GOAL_REPATH_DISTANCE_THRESHOLD = 72;
const DEVIATION_REPATH_MULTIPLIER = 4.5;
const MIN_PROGRESS_SAMPLE_SECONDS = 0.25;
const MIN_PROGRESS_DISTANCE_FRACTION = 0.18;
const REPATH_COOLDOWN_SECONDS = 0.4;

export function moveUnitAlongRoute(state, spatialIndex, unit, movementProfile, dt) {
  validateMovementProfile(movementProfile, unit.definitionId);

  let destination = unit.waypoints[unit.currentWaypointIndex] ?? null;

  if (destination) {
    const distance = Math.hypot(destination.x - unit.x, destination.y - unit.y);
    if (distance <= getWaypointArrivalDistance(unit)) {
      unit.currentWaypointIndex += 1;
      invalidateUnitPath(unit);
      destination = unit.waypoints[unit.currentWaypointIndex] ?? null;
    }
  }

  if (!destination) {
    destination = getEnemyBase(state, unit.ownerId);
  }

  if (!destination) {
    invalidateUnitPath(unit);
    stopUnit(unit);
    unit.state = "holding_at_final_waypoint";
    return false;
  }

  const moveResult = moveUnitTowardPoint(state, spatialIndex, unit, destination, movementProfile, dt, {
    arrivalDistance: getWaypointArrivalDistance(unit),
    navigationKey: getRouteNavigationKey(unit, destination)
  });

  unit.state = moveResult === "moved"
    ? "moving_to_waypoint"
    : moveResult === "pending"
      ? "waiting_for_path"
      : "blocked_by_terrain";
  return moveResult === "moved";
}

export function moveUnitTowardPoint(state, spatialIndex, unit, destination, movementProfile, dt, options = {}) {
  validateMovementProfile(movementProfile, unit.definitionId);
  ensureUnitMovementState(unit);

  const arrivalDistance = options.arrivalDistance ?? 0;
  const navigationKey = options.navigationKey ?? getPointNavigationKey(destination);
  const blockerRadius = (unit.radius ?? 0) + PATH_BLOCKER_RADIUS_PADDING;
  const excludedBuildingIds = mergeExcludedBuildingIds(
    getMovementBlockerOptions(unit).excludedBuildingIds ?? null,
    options.excludedBuildingIds ?? null
  );
  unit.repathCooldownSeconds = Math.max(0, unit.repathCooldownSeconds - dt);

  const goalUpdate = getMovementGoalUpdate(unit, destination, arrivalDistance, navigationKey, state.navigation?.cellSize ?? 48);
  if (goalUpdate === "reset") {
    clearMovementCorridor(unit);
  } else if (goalUpdate === "repath" && unit.repathCooldownSeconds <= 0) {
    requestRepath(unit);
  }
  setMovementGoal(unit, destination, arrivalDistance, navigationKey);
  syncDirectCorridorDestination(unit, destination);

  if (Math.hypot(destination.x - unit.x, destination.y - unit.y) <= arrivalDistance) {
    clearMovementCorridor(unit);
    stopUnit(unit);
    return "moved";
  }

  if (unit.movementPathValidity && !isNavigationPathValid(state, unit.movementPathValidity)) {
    requestRepath(unit);
  }

  const corridorOptions = {
    excludedBuildingIds,
    pathRequestOrigin: options.pathRequestOrigin ?? null,
    corridorPrefixPoint: options.corridorPrefixPoint ?? null
  };

  ensureMovementCorridor(state, unit, destination, navigationKey, blockerRadius, corridorOptions);
  if (!Array.isArray(unit.movementCorridor) || unit.movementCorridor.length === 0) {
    applyVelocityToward(unit, { x: 0, y: 0 }, movementProfile, dt);
    return unit.movementPathStatus === "pending" ? "pending" : "blocked";
  }

  advanceCorridorIndex(unit, arrivalDistance);
  const deviationLimit = Math.max(unit.radius * DEVIATION_REPATH_MULTIPLIER, state.navigation.cellSize * 0.75);
  unit.deviationDistance = computeCorridorDeviation(unit);
  if (
    unit.deviationDistance > deviationLimit &&
    unit.stuckTimeSeconds >= movementProfile.stuckRepathDelaySeconds * 0.5 &&
    unit.repathCooldownSeconds <= 0
  ) {
    requestRepath(unit);
    ensureMovementCorridor(state, unit, destination, navigationKey, blockerRadius, corridorOptions);
  }

  if (!Array.isArray(unit.movementCorridor) || unit.movementCorridor.length === 0) {
    applyVelocityToward(unit, { x: 0, y: 0 }, movementProfile, dt);
    return unit.movementPathStatus === "pending" ? "pending" : "blocked";
  }

  const lookaheadPoint = getLookaheadPoint(unit, destination, movementProfile);
  const preferredVelocity = getPreferredVelocity(unit, lookaheadPoint, movementProfile, arrivalDistance);
  unit.preferredVelocityX = preferredVelocity.x;
  unit.preferredVelocityY = preferredVelocity.y;

  const steeringVelocity = resolveUnitSteeringVelocity(state, spatialIndex, unit, preferredVelocity, movementProfile, {
    excludedBuildingIds,
    avoidUnits: options.avoidUnits !== false
  });
  unit.steeringVelocityX = steeringVelocity.x;
  unit.steeringVelocityY = steeringVelocity.y;

  const previousX = unit.x;
  const previousY = unit.y;
  applyVelocityToward(unit, steeringVelocity, movementProfile, dt);
  integrateUnitPosition(state, unit, dt, excludedBuildingIds);
  updateProgressTracking(unit, destination, movementProfile, dt);

  const movedDistance = Math.hypot(unit.x - previousX, unit.y - previousY);
  if (unit.stuckTimeSeconds >= movementProfile.stuckRepathDelaySeconds && unit.repathCooldownSeconds <= 0) {
    requestRepath(unit);
  }

  if (movedDistance > 0.01) {
    markEntityDirty(state, unit.id);
    return "moved";
  }

  return unit.movementPathStatus === "pending" ? "pending" : "blocked";
}

export function rotateUnitFacingTowardPoint(unit, movementProfile, point, dt) {
  validateMovementProfile(movementProfile, unit.definitionId);
  ensureUnitMovementState(unit);

  if (!point) {
    return 0;
  }

  const dx = point.x - unit.x;
  const dy = point.y - unit.y;
  if (Math.hypot(dx, dy) < 0.001) {
    return 0;
  }

  const desiredAngle = Math.atan2(dy, dx);
  const currentAngle = Number.isFinite(unit.facingAngle) ? unit.facingAngle : desiredAngle;
  const maxAngleDelta = movementProfile.maxTurnRateRadians * dt;
  const nextAngle = currentAngle + clampAngleDelta(desiredAngle - currentAngle, maxAngleDelta);
  unit.facingAngle = nextAngle;
  return Math.abs(normalizeAngleDelta(desiredAngle - nextAngle));
}

export function invalidateUnitPath(unit) {
  ensureUnitMovementState(unit);
  unit.movementGoal = null;
  clearMovementCorridor(unit);
}

export function stopMover(unit) {
  stopUnit(unit);
}

function ensureMovementCorridor(state, unit, destination, navigationKey, blockerRadius, options = {}) {
  if (Array.isArray(unit.movementCorridor) && unit.movementCorridor.length > 0) {
    return;
  }

  const excludedBuildingIds = options.excludedBuildingIds ?? null;
  const pathRequestOrigin = options.pathRequestOrigin ?? unit;
  const corridorPrefixPoint = options.corridorPrefixPoint ?? null;

  if (canMoveDirectlyToPoint(state, unit, destination, blockerRadius, { excludedBuildingIds })) {
    unit.movementCorridor = [clonePoint(destination)];
    unit.movementCorridorIndex = 0;
    unit.movementPathStatus = "ready";
    unit.movementPathId = null;
    unit.movementPathValidity = createDirectPathValidity(state, unit, destination, blockerRadius);
    return;
  }

  const requestedPath = requestNavigationPath(state, pathRequestOrigin, destination, navigationKey, {
    radius: blockerRadius,
    excludedBuildingIds
  });
  unit.movementPathId = requestedPath.requestKey;
  unit.movementPathStatus = requestedPath.status;
  unit.movementPathValidity = requestedPath.status === "ready" ? requestedPath.validity : null;

  if (requestedPath.status !== "ready") {
    unit.movementCorridor = null;
    unit.movementCorridorIndex = 0;
    return;
  }

  unit.movementCorridor = buildMovementCorridor(pathRequestOrigin, corridorPrefixPoint, requestedPath.path, destination);
  unit.movementCorridorIndex = 0;
}

function clearMovementCorridor(unit) {
  unit.movementCorridor = null;
  unit.movementCorridorIndex = 0;
  unit.movementPathId = null;
  unit.movementPathStatus = "idle";
  unit.movementPathValidity = null;
  unit.stuckTimeSeconds = 0;
  unit.deviationDistance = 0;
  unit.lastProgressDistance = null;
  unit.lastProgressSampleSeconds = 0;
}

function requestRepath(unit) {
  clearMovementCorridor(unit);
  unit.repathCooldownSeconds = REPATH_COOLDOWN_SECONDS;
}

function setMovementGoal(unit, destination, arrivalDistance, navigationKey) {
  unit.movementGoal = {
    x: destination.x,
    y: destination.y,
    arrivalDistance,
    navigationKey
  };
}

function getMovementGoalUpdate(unit, destination, arrivalDistance, navigationKey, navigationCellSize) {
  if (!unit.movementGoal) {
    return "initialize";
  }

  if (
    unit.movementGoal.navigationKey !== navigationKey ||
    Math.abs(unit.movementGoal.arrivalDistance - arrivalDistance) > 0.5
  ) {
    return "reset";
  }

  const goalDriftDistance = Math.hypot(unit.movementGoal.x - destination.x, unit.movementGoal.y - destination.y);
  if (goalDriftDistance <= GOAL_TRACKING_DISTANCE_THRESHOLD) {
    return "track";
  }

  const repathDistanceThreshold = Math.max(GOAL_REPATH_DISTANCE_THRESHOLD, navigationCellSize * 1.5);
  return goalDriftDistance >= repathDistanceThreshold ? "repath" : "track";
}

function advanceCorridorIndex(unit, arrivalDistance) {
  while (unit.movementCorridorIndex < unit.movementCorridor.length) {
    const nextPoint = unit.movementCorridor[unit.movementCorridorIndex];
    if (Math.hypot(nextPoint.x - unit.x, nextPoint.y - unit.y) > arrivalDistance + CORRIDOR_POINT_REACHED_PADDING) {
      break;
    }

    unit.movementCorridorIndex += 1;
  }

  if (unit.movementCorridorIndex >= unit.movementCorridor.length && unit.movementCorridor.length > 0) {
    unit.movementCorridorIndex = unit.movementCorridor.length - 1;
  }
}

function getLookaheadPoint(unit, destination, movementProfile) {
  if (!Array.isArray(unit.movementCorridor) || unit.movementCorridor.length === 0) {
    return clonePoint(destination);
  }

  const lookaheadDistance = Math.max(unit.radius * 2, movementProfile.moveSpeed * movementProfile.lookaheadSeconds);
  const pathPoints = unit.movementCorridor.slice(unit.movementCorridorIndex);
  const waypointChain = pathPoints.length > 0 ? pathPoints : [destination];
  let remainingDistance = lookaheadDistance;
  let anchor = { x: unit.x, y: unit.y };

  for (const point of waypointChain) {
    const segmentLength = Math.hypot(point.x - anchor.x, point.y - anchor.y);
    if (segmentLength === 0) {
      anchor = point;
      continue;
    }

    if (segmentLength >= remainingDistance) {
      return {
        x: anchor.x + ((point.x - anchor.x) / segmentLength) * remainingDistance,
        y: anchor.y + ((point.y - anchor.y) / segmentLength) * remainingDistance
      };
    }

    remainingDistance -= segmentLength;
    anchor = point;
  }

  return clonePoint(destination);
}

function getPreferredVelocity(unit, lookaheadPoint, movementProfile, arrivalDistance) {
  const dx = lookaheadPoint.x - unit.x;
  const dy = lookaheadPoint.y - unit.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) {
    return { x: 0, y: 0 };
  }

  const brakingDistance = Math.max(arrivalDistance + unit.radius, movementProfile.moveSpeed * movementProfile.lookaheadSeconds);
  const desiredSpeed = distance < brakingDistance
    ? movementProfile.moveSpeed * Math.max(0.2, distance / Math.max(1, brakingDistance))
    : movementProfile.moveSpeed;

  return {
    x: (dx / distance) * desiredSpeed,
    y: (dy / distance) * desiredSpeed
  };
}

function applyVelocityToward(unit, desiredVelocity, movementProfile, dt) {
  const limitedDesiredVelocity = limitTurnRate(unit, desiredVelocity, movementProfile, dt);
  const deltaX = limitedDesiredVelocity.x - unit.velocityX;
  const deltaY = limitedDesiredVelocity.y - unit.velocityY;
  const deltaLength = Math.hypot(deltaX, deltaY);
  const maxDelta = movementProfile.maxAcceleration * dt;

  if (deltaLength > maxDelta && deltaLength > 0) {
    unit.velocityX += (deltaX / deltaLength) * maxDelta;
    unit.velocityY += (deltaY / deltaLength) * maxDelta;
  } else {
    unit.velocityX = limitedDesiredVelocity.x;
    unit.velocityY = limitedDesiredVelocity.y;
  }

  syncUnitFacingToVelocity(unit);
}

function limitTurnRate(unit, desiredVelocity, movementProfile, dt) {
  const desiredSpeed = Math.hypot(desiredVelocity.x, desiredVelocity.y);
  if (desiredSpeed === 0) {
    return desiredVelocity;
  }

  const currentSpeed = Math.hypot(unit.velocityX, unit.velocityY);
  if (currentSpeed < 0.001) {
    return desiredVelocity;
  }

  const currentAngle = Math.atan2(unit.velocityY, unit.velocityX);
  const desiredAngle = Math.atan2(desiredVelocity.y, desiredVelocity.x);
  const maxAngleDelta = movementProfile.maxTurnRateRadians * dt;
  const clampedAngle = currentAngle + clampAngleDelta(desiredAngle - currentAngle, maxAngleDelta);

  return {
    x: Math.cos(clampedAngle) * desiredSpeed,
    y: Math.sin(clampedAngle) * desiredSpeed
  };
}

function integrateUnitPosition(state, unit, dt, excludedBuildingIds) {
  const nextPoint = {
    x: unit.x + unit.velocityX * dt,
    y: unit.y + unit.velocityY * dt
  };

  if (canMoveDirectlyToPoint(state, unit, nextPoint, unit.radius, { excludedBuildingIds })) {
    unit.x = nextPoint.x;
    unit.y = nextPoint.y;
    return;
  }

  unit.velocityX *= 0.35;
  unit.velocityY *= 0.35;
  unit.stuckTimeSeconds += dt;
}

function updateProgressTracking(unit, destination, movementProfile, dt) {
  const remainingDistance = Math.hypot(destination.x - unit.x, destination.y - unit.y);
  const minimumProgressDistance = Math.max(
    1.5,
    movementProfile.moveSpeed * MIN_PROGRESS_SAMPLE_SECONDS * MIN_PROGRESS_DISTANCE_FRACTION
  );

  if (unit.lastProgressDistance === null) {
    unit.lastProgressDistance = remainingDistance;
    unit.lastProgressSampleSeconds = 0;
    return;
  }

  unit.lastProgressSampleSeconds += dt;
  if (unit.lastProgressSampleSeconds < MIN_PROGRESS_SAMPLE_SECONDS) {
    return;
  }

  if (unit.lastProgressDistance - remainingDistance >= minimumProgressDistance) {
    unit.stuckTimeSeconds = 0;
  } else {
    unit.stuckTimeSeconds += unit.lastProgressSampleSeconds;
  }

  unit.lastProgressDistance = remainingDistance;
  unit.lastProgressSampleSeconds = 0;

  if (unit.stuckTimeSeconds > movementProfile.stuckRepathDelaySeconds * 0.5 && Math.hypot(unit.velocityX, unit.velocityY) > 0) {
    unit.velocityX *= 0.8;
    unit.velocityY *= 0.8;
  }
}

function computeCorridorDeviation(unit) {
  if (!Array.isArray(unit.movementCorridor) || unit.movementCorridor.length === 0) {
    return 0;
  }

  const currentTarget = unit.movementCorridor[Math.min(unit.movementCorridorIndex, unit.movementCorridor.length - 1)];
  const previousTarget = unit.movementCorridorIndex > 0
    ? unit.movementCorridor[unit.movementCorridorIndex - 1]
    : { x: unit.x, y: unit.y };

  return distanceToSegment(unit, previousTarget, currentTarget);
}

function syncDirectCorridorDestination(unit, destination) {
  if (
    unit.movementPathId !== null ||
    !Array.isArray(unit.movementCorridor) ||
    unit.movementCorridor.length !== 1
  ) {
    return;
  }

  unit.movementCorridor[0] = clonePoint(destination);
}

function ensureUnitMovementState(unit) {
  unit.facingAngle ??= 0;
  unit.velocityX ??= 0;
  unit.velocityY ??= 0;
  unit.preferredVelocityX ??= 0;
  unit.preferredVelocityY ??= 0;
  unit.steeringVelocityX ??= 0;
  unit.steeringVelocityY ??= 0;
  unit.movementGoal ??= null;
  unit.movementCorridor ??= null;
  unit.movementCorridorIndex ??= 0;
  unit.movementPathId ??= null;
  unit.movementPathStatus ??= "idle";
  unit.movementPathValidity ??= null;
  unit.repathCooldownSeconds ??= 0;
  unit.stuckTimeSeconds ??= 0;
  unit.deviationDistance ??= 0;
  unit.lastProgressDistance ??= null;
  unit.lastProgressSampleSeconds ??= 0;
}

function stopUnit(unit) {
  unit.velocityX = 0;
  unit.velocityY = 0;
  unit.preferredVelocityX = 0;
  unit.preferredVelocityY = 0;
  unit.steeringVelocityX = 0;
  unit.steeringVelocityY = 0;
}

function syncUnitFacingToVelocity(unit) {
  if (Math.hypot(unit.velocityX, unit.velocityY) < 0.001) {
    return;
  }

  unit.facingAngle = Math.atan2(unit.velocityY, unit.velocityX);
}

function getMovementBlockerOptions(unit) {
  if (!unit.spawnSourceBuildingId) {
    return {};
  }

  return {
    excludedBuildingIds: new Set([unit.spawnSourceBuildingId])
  };
}

function mergeExcludedBuildingIds(primaryIds, secondaryIds) {
  if (!primaryIds && !secondaryIds) {
    return null;
  }

  return new Set([
    ...(primaryIds ? [...primaryIds] : []),
    ...(secondaryIds ? [...secondaryIds] : [])
  ]);
}

function buildMovementCorridor(pathRequestOrigin, corridorPrefixPoint, requestedPath, destination) {
  const corridor = [];

  if (corridorPrefixPoint) {
    corridor.push(clonePoint(corridorPrefixPoint));
  }

  for (const point of requestedPath) {
    const lastPoint = corridor.at(-1);
    if (lastPoint && Math.hypot(lastPoint.x - point.x, lastPoint.y - point.y) <= CORRIDOR_POINT_REACHED_PADDING) {
      continue;
    }

    corridor.push(clonePoint(point));
  }

  if (corridor.length === 0) {
    corridor.push(clonePoint(destination));
  }

  return corridor;
}

function getWaypointArrivalDistance(unit) {
  return unit.radius;
}

function getRouteNavigationKey(unit, destination) {
  if (unit.waypoints[unit.currentWaypointIndex]) {
    return `route:${unit.currentWaypointIndex}:${destination.x}:${destination.y}`;
  }

  return `enemy_base:${unit.ownerId}`;
}

function getPointNavigationKey(point) {
  return `point:${Math.round(point.x)}:${Math.round(point.y)}`;
}

function validateMovementProfile(movementProfile, unitId) {
  const requiredFields = [
    "moveSpeed",
    "maxAcceleration",
    "maxTurnRateRadians",
    "lookaheadSeconds",
    "neighborAvoidanceRadius",
    "avoidanceWeight",
    "separationWeight",
    "stuckRepathDelaySeconds"
  ];

  for (const field of requiredFields) {
    if (typeof movementProfile[field] !== "number" || Number.isNaN(movementProfile[field])) {
      throw new Error(`Unit ${unitId} is missing movement field ${field}.`);
    }
  }
}

function clampAngleDelta(delta, maxDelta) {
  const normalizedDelta = normalizeAngleDelta(delta);
  return Math.max(-maxDelta, Math.min(maxDelta, normalizedDelta));
}

function normalizeAngleDelta(delta) {
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

function distanceToSegment(point, segmentStart, segmentEnd) {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y);
  }

  const t = Math.max(
    0,
    Math.min(1, (((point.x - segmentStart.x) * dx) + ((point.y - segmentStart.y) * dy)) / lengthSquared)
  );
  const projectionX = segmentStart.x + dx * t;
  const projectionY = segmentStart.y + dy * t;
  return Math.hypot(point.x - projectionX, point.y - projectionY);
}

function clonePoint(point) {
  return {
    x: point.x,
    y: point.y
  };
}
