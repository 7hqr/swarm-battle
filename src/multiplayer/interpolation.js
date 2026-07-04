import { isSimulationAuthority } from "./matchRuntime.js";
import { getSimulationTickDurationSeconds } from "../systems/scheduler.js";

const SNAPSHOT_INTERPOLATION_MS = 180;

export function createPresentationState() {
  return {
    previousSnapshot: null,
    lastSnapshotReceivedAtMs: 0,
    frameAlpha: 0
  };
}

export function capturePresentationSnapshot(state) {
  return {
    matchTimeSeconds: state.matchTimeSeconds,
    playersById: new Map(
      state.players.map((player) => [
        player.id,
        {
          resources: player.resources,
          cumulativeResourceGain: player.cumulativeResourceGain,
          baseTier: player.baseTier,
          activeBaseUpgradeProgressSeconds: player.activeBaseUpgrade?.progressSeconds ?? null,
          techTier: player.techTier,
          activeTechUpgradeProgressSeconds: player.activeTechUpgrade?.progressSeconds ?? null,
          activeResearchProgressSeconds: player.activeResearch?.progressSeconds ?? null
        }
      ])
    ),
    entitiesById: new Map(
      state.entities.map((entity) => [
        entity.id,
        {
          x: entity.x,
          y: entity.y,
          velocityX: entity.velocityX ?? null,
          velocityY: entity.velocityY ?? null,
          facingAngle: entity.facingAngle ?? null,
          turretFacingAngle: entity.turretFacingAngle ?? null,
          health: entity.health,
          constructionProgressSeconds: entity.constructionProgressSeconds ?? null,
          productionProgressSeconds: entity.productionProgressSeconds ?? null
        }
      ])
    )
  };
}

export function recordAuthorityPresentationSnapshot(state) {
  state.presentation.previousSnapshot = capturePresentationSnapshot(state);
}

export function recordRemotePresentationSnapshot(state, previousSnapshot, nowMs) {
  state.presentation.previousSnapshot = previousSnapshot;
  state.presentation.lastSnapshotReceivedAtMs = nowMs;
}

export function setPresentationFrameAlpha(state, alpha) {
  state.presentation.frameAlpha = clamp(alpha, 0, 1);
}

export function getEntityDisplayPoint(state, entity, nowMs = performance.now()) {
  return {
    x: interpolateEntityValue(state, entity, "x", entity.x, nowMs),
    y: interpolateEntityValue(state, entity, "y", entity.y, nowMs)
  };
}

export function getEntityDisplayAngle(state, entity, fallbackCurrentValue, nowMs = performance.now()) {
  return getEntityDisplayAngleForField(state, entity, "facingAngle", fallbackCurrentValue, nowMs);
}

export function getEntityDisplayAngleForField(
  state,
  entity,
  fieldName,
  fallbackCurrentValue,
  nowMs = performance.now()
) {
  const previousSnapshot = state.presentation.previousSnapshot;
  const previousEntity = previousSnapshot?.entitiesById?.get(entity.id);
  if (
    !previousEntity ||
    typeof previousEntity[fieldName] !== "number" ||
    typeof fallbackCurrentValue !== "number"
  ) {
    return fallbackCurrentValue;
  }

  return lerpAngle(previousEntity[fieldName], fallbackCurrentValue, getPresentationProgress(state, nowMs));
}

export function getEntityDisplayValue(state, entity, fieldName, fallbackCurrentValue, nowMs = performance.now()) {
  return interpolateEntityValue(state, entity, fieldName, fallbackCurrentValue, nowMs);
}

export function getPlayerDisplayValue(state, player, fieldName, fallbackCurrentValue, nowMs = performance.now()) {
  const previousSnapshot = state.presentation.previousSnapshot;
  const previousPlayer = previousSnapshot?.playersById?.get(player.id);
  if (!previousPlayer || typeof previousPlayer[fieldName] !== "number" || typeof fallbackCurrentValue !== "number") {
    return fallbackCurrentValue;
  }

  return lerp(previousPlayer[fieldName], fallbackCurrentValue, getPresentationProgress(state, nowMs));
}

export function getMatchTimeDisplaySeconds(state, nowMs = performance.now()) {
  const previousMatchTimeSeconds = state.presentation.previousSnapshot?.matchTimeSeconds;
  if (typeof previousMatchTimeSeconds !== "number") {
    return state.matchTimeSeconds;
  }

  return lerp(previousMatchTimeSeconds, state.matchTimeSeconds, getPresentationProgress(state, nowMs));
}

function interpolateEntityValue(state, entity, fieldName, fallbackCurrentValue, nowMs) {
  const previousSnapshot = state.presentation.previousSnapshot;
  const previousEntity = previousSnapshot?.entitiesById?.get(entity.id);
  if (typeof fallbackCurrentValue !== "number") {
    return fallbackCurrentValue;
  }

  if (!previousEntity || typeof previousEntity[fieldName] !== "number") {
    return inferNewEntityDisplayValue(state, entity, fieldName, fallbackCurrentValue, nowMs);
  }

  return lerp(previousEntity[fieldName], fallbackCurrentValue, getPresentationProgress(state, nowMs));
}

function inferNewEntityDisplayValue(state, entity, fieldName, fallbackCurrentValue, nowMs) {
  if (entity.type !== "projectile" || (fieldName !== "x" && fieldName !== "y")) {
    return fallbackCurrentValue;
  }

  const velocityField = fieldName === "x" ? "velocityX" : "velocityY";
  const velocity = entity[velocityField];
  if (typeof velocity !== "number") {
    return fallbackCurrentValue;
  }

  const motionDt = entity.lastMotionDtSeconds ?? getSimulationTickDurationSeconds(state);
  const inferredPreviousValue = fallbackCurrentValue - velocity * motionDt;
  return lerp(inferredPreviousValue, fallbackCurrentValue, getPresentationProgress(state, nowMs));
}

function getPresentationProgress(state, nowMs) {
  if (isSimulationAuthority(state)) {
    return state.presentation.frameAlpha ?? 0;
  }

  return clamp((nowMs - state.presentation.lastSnapshotReceivedAtMs) / SNAPSHOT_INTERPOLATION_MS, 0, 1);
}

function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

function lerpAngle(start, end, progress) {
  const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return start + delta * progress;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
