import { queryEntitySpatialIndex } from "../state/entities.js";
import { doesCircleOverlapBlockers } from "./navigation.js";

const SAMPLE_ANGLE_OFFSETS = [-1.35, -0.9, -0.45, 0, 0.45, 0.9, 1.35, Math.PI, Math.PI * 0.5, -Math.PI * 0.5];

export function resolveUnitSteeringVelocity(state, spatialIndex, unit, preferredVelocity, movementProfile, options = {}) {
  if (!spatialIndex) {
    throw new Error("resolveUnitSteeringVelocity requires a spatial index.");
  }

  const maxSpeed = movementProfile.moveSpeed;
  const lookaheadSeconds = movementProfile.lookaheadSeconds;
  const avoidanceRadius = movementProfile.neighborAvoidanceRadius;
  const excludedBuildingIds = options.excludedBuildingIds ?? null;
  const neighbors = options.avoidUnits === false
    ? []
    : queryEntitySpatialIndex(
      spatialIndex,
      "unit",
      unit,
      avoidanceRadius + maxSpeed * lookaheadSeconds + unit.radius
    ).filter((neighbor) => neighbor.id !== unit.id && neighbor.health > 0);

  const candidateVelocities = buildVelocityCandidates(unit, preferredVelocity, maxSpeed);
  let bestVelocity = clampVelocity(preferredVelocity, maxSpeed);
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidateVelocity of candidateVelocities) {
    const score = scoreVelocityCandidate(
      state,
      unit,
      neighbors,
      candidateVelocity,
      preferredVelocity,
      movementProfile,
      excludedBuildingIds
    );
    if (score < bestScore) {
      bestScore = score;
      bestVelocity = candidateVelocity;
    }
  }

  return bestVelocity;
}

function buildVelocityCandidates(unit, preferredVelocity, maxSpeed) {
  const preferredSpeed = Math.min(maxSpeed, Math.hypot(preferredVelocity.x, preferredVelocity.y));
  const baseDirection = preferredSpeed > 0
    ? Math.atan2(preferredVelocity.y, preferredVelocity.x)
    : Math.atan2(unit.velocityY ?? 0, unit.velocityX ?? 0);
  const speedLevels = [preferredSpeed, preferredSpeed * 0.82, preferredSpeed * 0.55, Math.min(maxSpeed, preferredSpeed * 1.05)];
  const candidates = [
    { x: 0, y: 0 },
    clampVelocity(preferredVelocity, maxSpeed),
    clampVelocity({ x: unit.velocityX ?? 0, y: unit.velocityY ?? 0 }, maxSpeed)
  ];

  if (!Number.isFinite(baseDirection)) {
    return dedupeVelocities(candidates);
  }

  for (const angleOffset of SAMPLE_ANGLE_OFFSETS) {
    for (const speed of speedLevels) {
      if (speed <= 0) {
        continue;
      }

      candidates.push({
        x: Math.cos(baseDirection + angleOffset) * speed,
        y: Math.sin(baseDirection + angleOffset) * speed
      });
    }
  }

  return dedupeVelocities(candidates.map((candidate) => clampVelocity(candidate, maxSpeed)));
}

function scoreVelocityCandidate(state, unit, neighbors, candidateVelocity, preferredVelocity, movementProfile, excludedBuildingIds) {
  const lookaheadSeconds = movementProfile.lookaheadSeconds;
  const candidateSpeed = Math.hypot(candidateVelocity.x, candidateVelocity.y);
  const preferredSpeed = Math.hypot(preferredVelocity.x, preferredVelocity.y);
  const currentVelocity = { x: unit.velocityX ?? 0, y: unit.velocityY ?? 0 };
  const currentSpeed = Math.hypot(currentVelocity.x, currentVelocity.y);
  const preferredSide = getPreferredSide(unit);
  const futurePoint = {
    x: unit.x + candidateVelocity.x * lookaheadSeconds,
    y: unit.y + candidateVelocity.y * lookaheadSeconds
  };
  const midPoint = {
    x: unit.x + candidateVelocity.x * lookaheadSeconds * 0.5,
    y: unit.y + candidateVelocity.y * lookaheadSeconds * 0.5
  };

  let score = Math.abs(candidateSpeed - preferredSpeed) * 0.18;
  score += getDirectionPenalty(candidateVelocity, preferredVelocity) * 32;
  score += getDirectionPenalty(candidateVelocity, currentVelocity) * (currentSpeed > 1 ? 14 : 4);

  if (doesCircleOverlapBlockers(state, midPoint, unit.radius, { excludedBuildingIds })) {
    score += 6000;
  }

  if (doesCircleOverlapBlockers(state, futurePoint, unit.radius, { excludedBuildingIds })) {
    score += 12000;
  }

  for (const neighbor of neighbors) {
    const relativeFutureX = futurePoint.x - (neighbor.x + (neighbor.velocityX ?? 0) * lookaheadSeconds);
    const relativeFutureY = futurePoint.y - (neighbor.y + (neighbor.velocityY ?? 0) * lookaheadSeconds);
    const distance = Math.hypot(relativeFutureX, relativeFutureY);
    const desiredSpacing = unit.radius + neighbor.radius + 2;
    const overlapDistance = desiredSpacing - distance;
    if (overlapDistance > 0) {
      score += overlapDistance * overlapDistance * 40 * movementProfile.avoidanceWeight;
    } else {
      const softSpacing = movementProfile.neighborAvoidanceRadius - distance;
      if (softSpacing > 0) {
        score += softSpacing * 0.02 * movementProfile.separationWeight;
      }
    }

    const relativeNowX = neighbor.x - unit.x;
    const relativeNowY = neighbor.y - unit.y;
    const side = Math.sign(relativeNowX * candidateVelocity.y - relativeNowY * candidateVelocity.x);
    if (side === 0) {
      score += 0.2;
    } else if (side !== preferredSide) {
      score += 0.3;
    }
  }

  return score;
}

function getDirectionPenalty(candidateVelocity, preferredVelocity) {
  const candidateLength = Math.hypot(candidateVelocity.x, candidateVelocity.y);
  const preferredLength = Math.hypot(preferredVelocity.x, preferredVelocity.y);
  if (candidateLength === 0 || preferredLength === 0) {
    return preferredLength === 0 ? 0 : 1;
  }

  const dot = ((candidateVelocity.x / candidateLength) * (preferredVelocity.x / preferredLength))
    + ((candidateVelocity.y / candidateLength) * (preferredVelocity.y / preferredLength));
  return 1 - Math.max(-1, Math.min(1, dot));
}

function clampVelocity(velocity, maxSpeed) {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed === 0 || speed <= maxSpeed) {
    return velocity;
  }

  return {
    x: (velocity.x / speed) * maxSpeed,
    y: (velocity.y / speed) * maxSpeed
  };
}

function dedupeVelocities(velocities) {
  const deduped = [];
  const seen = new Set();

  for (const velocity of velocities) {
    const key = `${Math.round(velocity.x * 10)}:${Math.round(velocity.y * 10)}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(velocity);
  }

  return deduped;
}

function getPreferredSide(unit) {
  let hash = 0;
  for (let index = 0; index < unit.id.length; index += 1) {
    hash = ((hash << 5) - hash) + unit.id.charCodeAt(index);
    hash |= 0;
  }

  return hash % 2 === 0 ? 1 : -1;
}
