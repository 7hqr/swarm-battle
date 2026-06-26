import {
  appendWaypoint,
  removeQueuedResearch,
  clearWaypointChain,
  setProductionBuildingsEnabled,
  startBaseUpgrade,
  startTechUpgrade,
  startResearch
} from "./gameState.js";
import { placeBuildingAt } from "./systems/construction.js";

const COMMAND_TYPES = {
  PLACE_BUILDING: "place_building",
  START_BASE_UPGRADE: "start_base_upgrade",
  START_TECH_UPGRADE: "start_tech_upgrade",
  START_RESEARCH: "start_research",
  REMOVE_RESEARCH_QUEUE_ITEM: "remove_research_queue_item",
  SET_PRODUCTION_ENABLED: "set_production_enabled",
  CLEAR_WAYPOINT_CHAIN: "clear_waypoint_chain",
  APPEND_WAYPOINT: "append_waypoint",
  SET_WAYPOINT_CHAIN: "set_waypoint_chain"
};

export function getGameplayCommandTypes() {
  return COMMAND_TYPES;
}

export function queueGameplayCommand(state, command) {
  const normalizedCommand = normalizeGameplayCommand(command);
  state.pendingGameplayCommands.push({
    id: `command_${state.nextCommandId++}`,
    tick: state.simulation.currentTick + 1,
    command: normalizedCommand
  });
  return normalizedCommand;
}

export function processGameplayCommands(state) {
  const currentTick = state.simulation.currentTick;
  const readyCommands = [];
  const deferredCommands = [];

  for (const entry of state.pendingGameplayCommands) {
    if (entry.tick <= currentTick) {
      readyCommands.push(entry);
      continue;
    }

    deferredCommands.push(entry);
  }

  state.pendingGameplayCommands = deferredCommands;

  for (const entry of readyCommands) {
    applyGameplayCommand(state, entry.command);
  }
}

export function applyGameplayCommand(state, command) {
  switch (command.type) {
    case COMMAND_TYPES.PLACE_BUILDING:
      return placeBuildingAt(state, command.playerId, command.buildingId, command.point).ok;

    case COMMAND_TYPES.START_BASE_UPGRADE:
      return startBaseUpgrade(state, command.playerId);

    case COMMAND_TYPES.START_TECH_UPGRADE:
      return startTechUpgrade(state, command.playerId);

    case COMMAND_TYPES.START_RESEARCH:
      return startResearch(state, command.playerId, command.techId);

    case COMMAND_TYPES.REMOVE_RESEARCH_QUEUE_ITEM:
      return removeQueuedResearch(state, command.playerId, command.queueIndex);

    case COMMAND_TYPES.SET_PRODUCTION_ENABLED:
      return setProductionBuildingsEnabled(state, command.buildingIds, command.enabled);

    case COMMAND_TYPES.CLEAR_WAYPOINT_CHAIN:
      return clearWaypointChain(state, command.buildingId);

    case COMMAND_TYPES.APPEND_WAYPOINT:
      return appendWaypoint(state, command.buildingId, command.point);

    case COMMAND_TYPES.SET_WAYPOINT_CHAIN:
      return setWaypointChain(state, command.buildingId, command.points);

    default:
      throw new Error(`Unsupported gameplay command type: ${command.type}`);
  }
}

function normalizeGameplayCommand(command) {
  if (!command || typeof command !== "object") {
    throw new Error("Gameplay command must be an object.");
  }

  if (!command.type) {
    throw new Error("Gameplay command type is required.");
  }

  if (!command.playerId) {
    throw new Error(`Gameplay command ${command.type} requires playerId.`);
  }

  switch (command.type) {
    case COMMAND_TYPES.PLACE_BUILDING:
      assertPoint(command.point, command.type);
      assertRequired(command.buildingId, "buildingId", command.type);
      return {
        type: command.type,
        playerId: command.playerId,
        buildingId: command.buildingId,
        point: clonePoint(command.point)
      };

    case COMMAND_TYPES.START_BASE_UPGRADE:
    case COMMAND_TYPES.START_TECH_UPGRADE:
      return {
        type: command.type,
        playerId: command.playerId
      };

    case COMMAND_TYPES.START_RESEARCH:
      assertRequired(command.techId, "techId", command.type);
      return {
        type: command.type,
        playerId: command.playerId,
        techId: command.techId
      };

    case COMMAND_TYPES.REMOVE_RESEARCH_QUEUE_ITEM:
      if (!Number.isInteger(command.queueIndex) || command.queueIndex < 0) {
        throw new Error(`Gameplay command ${command.type} requires non-negative integer queueIndex.`);
      }

      return {
        type: command.type,
        playerId: command.playerId,
        queueIndex: command.queueIndex
      };

    case COMMAND_TYPES.SET_PRODUCTION_ENABLED:
      if (!Array.isArray(command.buildingIds) || command.buildingIds.length === 0) {
        throw new Error(`Gameplay command ${command.type} requires non-empty buildingIds.`);
      }

      if (typeof command.enabled !== "boolean") {
        throw new Error(`Gameplay command ${command.type} requires boolean enabled.`);
      }

      return {
        type: command.type,
        playerId: command.playerId,
        buildingIds: [...new Set(command.buildingIds)],
        enabled: command.enabled
      };

    case COMMAND_TYPES.CLEAR_WAYPOINT_CHAIN:
      assertRequired(command.buildingId, "buildingId", command.type);
      return {
        type: command.type,
        playerId: command.playerId,
        buildingId: command.buildingId
      };

    case COMMAND_TYPES.APPEND_WAYPOINT:
      assertRequired(command.buildingId, "buildingId", command.type);
      assertPoint(command.point, command.type);
      return {
        type: command.type,
        playerId: command.playerId,
        buildingId: command.buildingId,
        point: clonePoint(command.point)
      };

    case COMMAND_TYPES.SET_WAYPOINT_CHAIN:
      assertRequired(command.buildingId, "buildingId", command.type);
      if (!Array.isArray(command.points)) {
        throw new Error(`Gameplay command ${command.type} requires points array.`);
      }

      return {
        type: command.type,
        playerId: command.playerId,
        buildingId: command.buildingId,
        points: command.points.map((point) => {
          assertPoint(point, command.type);
          return clonePoint(point);
        })
      };

    default:
      throw new Error(`Unsupported gameplay command type: ${command.type}`);
  }
}

function setWaypointChain(state, buildingId, points) {
  if (!clearWaypointChain(state, buildingId)) {
    return false;
  }

  for (const point of points) {
    if (!appendWaypoint(state, buildingId, point)) {
      return false;
    }
  }

  return true;
}

function assertRequired(value, fieldName, commandType) {
  if (!value) {
    throw new Error(`Gameplay command ${commandType} requires ${fieldName}.`);
  }
}

function assertPoint(point, commandType) {
  if (!point || typeof point.x !== "number" || typeof point.y !== "number") {
    throw new Error(`Gameplay command ${commandType} requires a numeric point.`);
  }
}

function clonePoint(point) {
  return {
    x: point.x,
    y: point.y
  };
}
