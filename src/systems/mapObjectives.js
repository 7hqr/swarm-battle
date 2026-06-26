import { markMapObjectiveDirty } from "../multiplayer/replicationDirtyState.js";
import { getEntitySpatialIndex, queryEntitySpatialIndex } from "../state/entities.js";

const CONTROL_MIN = -1;
const CONTROL_MAX = 1;
const OWNERSHIP_GAIN_THRESHOLD = 0.55;
const OWNERSHIP_LOSS_THRESHOLD = 0.45;
const DEFAULT_CAPTURE_RATE = 0.03;
const UNIT_CAPTURE_STRENGTH = 1;

export function updateMapObjectives(state, dt) {
  if (!state.mapObjectives) {
    return;
  }

  for (const objectiveState of state.mapObjectives.controlStructures) {
    const definition = getControlStructureDefinition(state, objectiveState.id);
    const signedPressure = getSignedCapturePressure(state, definition);
    if (signedPressure === 0) {
      continue;
    }

    const nextControl = clamp(
      objectiveState.control + signedPressure * (definition.captureRate ?? DEFAULT_CAPTURE_RATE) * dt,
      CONTROL_MIN,
      CONTROL_MAX
    );
    if (nextControl === objectiveState.control) {
      continue;
    }

    objectiveState.control = nextControl;
    objectiveState.ownerId = resolveObjectiveOwnerId(objectiveState.ownerId, objectiveState.control);
    markMapObjectiveDirty(state, objectiveState.id);
  }
}

export function getPlayerMoveSpeedMultiplier(state, playerId) {
  const bonuses = getPlayerActiveGlobalBonuses(state, playerId);
  let additiveMultiplier = 0;

  for (const bonus of bonuses) {
    if (bonus.kind === "global_move_speed") {
      additiveMultiplier += bonus.value;
    }
  }

  return 1 + additiveMultiplier;
}

export function getPlayerActiveGlobalBonuses(state, playerId) {
  const bonuses = [];

  for (const objective of getControlStructureObjectives(state)) {
    if (objective.ownerId !== playerId) {
      continue;
    }

    bonuses.push({
      id: objective.id,
      label: objective.displayName,
      shortLabel: objective.shortLabel ?? objective.displayName,
      kind: objective.bonus.kind,
      value: objective.bonus.value,
      valueText: formatBonusValue(objective.bonus)
    });
  }

  return bonuses;
}

export function getControlStructureObjectives(state) {
  if (!state.mapObjectives) {
    return [];
  }

  return state.mapObjectives.controlStructures.map((objectiveState) => {
    const definition = getControlStructureDefinition(state, objectiveState.id);
    return {
      ...definition,
      control: objectiveState.control,
      ownerId: objectiveState.ownerId,
      controlPercent: Math.round(Math.abs(objectiveState.control) * 100),
      controllingPlayerId: objectiveState.control > 0 ? 1 : objectiveState.control < 0 ? 2 : null
    };
  });
}

function getSignedCapturePressure(state, definition) {
  let playerOnePressure = 0;
  let playerTwoPressure = 0;
  const radius = definition.radius;
  const radiusSquared = radius * radius;
  const spatialIndex = getEntitySpatialIndex(state);

  for (const entity of queryEntitySpatialIndex(spatialIndex, "unit", definition.center, radius)) {
    const dx = entity.x - definition.center.x;
    const dy = entity.y - definition.center.y;
    if (dx * dx + dy * dy > radiusSquared) {
      continue;
    }

    if (entity.ownerId === 1) {
      playerOnePressure += UNIT_CAPTURE_STRENGTH;
      continue;
    }

    if (entity.ownerId === 2) {
      playerTwoPressure += UNIT_CAPTURE_STRENGTH;
    }
  }

  const netPressure = playerOnePressure - playerTwoPressure;
  if (netPressure === 0) {
    return 0;
  }

  return Math.sign(netPressure) * Math.sqrt(Math.abs(netPressure));
}

function getControlStructureDefinition(state, objectiveId) {
  const definition = state.map?.objectives?.controlStructures?.find((objective) => objective.id === objectiveId);
  if (!definition) {
    throw new Error(`Unknown control structure objective: ${objectiveId}`);
  }

  return definition;
}

function formatBonusValue(bonus) {
  if (bonus.kind === "global_move_speed") {
    return `+${Math.round(bonus.value * 100)}% Move`;
  }

  throw new Error(`Unsupported map objective bonus kind: ${bonus.kind}`);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resolveObjectiveOwnerId(previousOwnerId, control) {
  if (previousOwnerId === 1) {
    return control > OWNERSHIP_LOSS_THRESHOLD ? 1 : null;
  }

  if (previousOwnerId === 2) {
    return control < -OWNERSHIP_LOSS_THRESHOLD ? 2 : null;
  }

  if (control >= OWNERSHIP_GAIN_THRESHOLD) {
    return 1;
  }

  if (control <= -OWNERSHIP_GAIN_THRESHOLD) {
    return 2;
  }

  return null;
}
