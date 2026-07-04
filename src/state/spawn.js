import { getEnemyBase } from "./entities.js";
import { getUnitStats, isProductionKind, supportsWaypointChain } from "../rules/catalogRules.js";
import { markEntityCreated } from "../multiplayer/replicationDirtyState.js";
import { addEntity } from "./entities.js";
import { markTerritoryInfluencerDirty } from "../systems/territory.js";
import { invalidateNavigationBlockers } from "../systems/navigation.js";
import { applyBaseTierStatsToBaseEntity } from "../systems/baseTierState.js";

export function spawnBuilding(state, { ownerId, definitionId, x, y, constructionCost }) {
  const definition = state.catalog.buildings[definitionId];
  const isConstructed = definition.buildTime === 0;
  const entity = {
    id: `entity_${state.nextEntityId++}`,
    type: "building",
    ownerId,
    definitionId,
    kind: definition.kind,
    x,
    y,
    radius: definition.radius,
    health: definition.maxHealth,
    maxHealth: definition.maxHealth,
    defense: definition.defense ? { ...definition.defense } : null,
    waypointChain: supportsWaypointChain(definition.kind) ? [] : null,
    currentWaypointIndex: definition.kind === "base" ? 0 : null,
    facingAngle: 0,
    velocityX: definition.kind === "base" ? 0 : null,
    velocityY: definition.kind === "base" ? 0 : null,
    preferredVelocityX: definition.kind === "base" ? 0 : null,
    preferredVelocityY: definition.kind === "base" ? 0 : null,
    steeringVelocityX: definition.kind === "base" ? 0 : null,
    steeringVelocityY: definition.kind === "base" ? 0 : null,
    movementGoal: definition.kind === "base" ? null : null,
    movementCorridor: definition.kind === "base" ? null : null,
    movementCorridorIndex: definition.kind === "base" ? 0 : null,
    movementPathId: definition.kind === "base" ? null : null,
    movementPathStatus: definition.kind === "base" ? "idle" : null,
    movementPathValidity: definition.kind === "base" ? null : null,
    repathCooldownSeconds: definition.kind === "base" ? 0 : null,
    stuckTimeSeconds: definition.kind === "base" ? 0 : null,
    deviationDistance: definition.kind === "base" ? 0 : null,
    lastProgressDistance: definition.kind === "base" ? null : null,
    lastProgressSampleSeconds: definition.kind === "base" ? 0 : null,
    productionProgressSeconds: 0,
    attackCooldownRemaining: 0,
    currentTargetId: definition.defense ? null : undefined,
    turretFacingAngle: definition.defense ? 0 : undefined,
    constructionCost: constructionCost ?? definition.cost,
    constructionProgressSeconds: isConstructed ? definition.buildTime : 0,
    isConstructed,
    enabled: isProductionKind(definition.kind)
  };

  if (definition.kind === "base") {
    const tierDefinition = state.catalog.baseTiers[1];
    applyBaseTierStatsToBaseEntity(entity, tierDefinition);
  }

  addEntity(state, entity);
  invalidateNavigationBlockers(state, entity);
  markEntityCreated(state, entity.id);
  if (isConstructed) {
    markTerritoryInfluencerDirty(state, entity.id);
  }

  return entity;
}

export function spawnUnit(state, ownerId, unitId, originBuilding) {
  const stats = getUnitStats(state, ownerId, unitId);
  const spawnExitPoint = getSpawnExitPoint(state, ownerId, originBuilding, stats.collisionRadius);
  const initialFacingAngle = getInitialUnitFacingAngle(originBuilding, spawnExitPoint);
  const unit = {
    id: `entity_${state.nextEntityId++}`,
    type: "unit",
    ownerId,
    definitionId: unitId,
    x: originBuilding.x,
    y: originBuilding.y,
    radius: stats.collisionRadius,
    health: stats.maxHealth,
    maxHealth: stats.maxHealth,
    currentTargetId: null,
    currentWaypointIndex: 0,
    waypoints: originBuilding.waypointChain.map((point) => ({ x: point.x, y: point.y })),
    facingAngle: initialFacingAngle,
    velocityX: 0,
    velocityY: 0,
    preferredVelocityX: 0,
    preferredVelocityY: 0,
    steeringVelocityX: 0,
    steeringVelocityY: 0,
    movementGoal: null,
    movementCorridor: null,
    movementCorridorIndex: 0,
    movementPathId: null,
    movementPathStatus: "idle",
    movementPathValidity: null,
    repathCooldownSeconds: 0,
    stuckTimeSeconds: 0,
    deviationDistance: 0,
    lastProgressDistance: null,
    lastProgressSampleSeconds: 0,
    leashAnchorPosition: { x: originBuilding.x, y: originBuilding.y },
    spawnSourceBuildingId: originBuilding.id,
    spawnExitPoint,
    spawnExitGraceSeconds: 0,
    aggroTimerRemaining: 0,
    attackCooldownRemaining: 0,
    targetSwitchLockSeconds: 0,
    state: "exiting_factory"
  };

  addEntity(state, unit);
  markEntityCreated(state, unit.id);
  markTerritoryInfluencerDirty(state, unit.id);
  return unit;
}

function getInitialUnitFacingAngle(originBuilding, spawnExitPoint) {
  const dx = spawnExitPoint.x - originBuilding.x;
  const dy = spawnExitPoint.y - originBuilding.y;
  return Math.atan2(dy, dx);
}

function getSpawnExitPoint(state, ownerId, originBuilding, unitRadius) {
  const primaryTarget = originBuilding.waypointChain[0] ?? getEnemyBase(state, ownerId);
  const fallbackDirectionX = ownerId === 1 ? 1 : -1;
  const dx = (primaryTarget?.x ?? (originBuilding.x + fallbackDirectionX)) - originBuilding.x;
  const dy = (primaryTarget?.y ?? originBuilding.y) - originBuilding.y;
  const distance = Math.hypot(dx, dy) || 1;
  const exitDistance = originBuilding.radius + unitRadius + 8;

  return {
    x: originBuilding.x + (dx / distance) * exitDistance,
    y: originBuilding.y + (dy / distance) * exitDistance
  };
}
