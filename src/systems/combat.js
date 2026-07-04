import {
  removeDestroyedEntities
} from "../gameState.js";
import { markEntityCreated, markEntityDestroyed, markEntityDirty } from "../multiplayer/replicationDirtyState.js";
import { getUnitStats } from "../rules/catalogRules.js";
import {
  invalidateUnitPath,
  moveUnitAlongRoute,
  moveUnitTowardPoint,
  rotateUnitFacingTowardPoint
} from "./movement.js";
import { resolveCircleOutsideBlockers } from "./navigation.js";
import { markTerritoryInfluencersDirty } from "./territory.js";
import {
  addEntity,
  createEntitySpatialIndexSnapshot,
  getEntitiesByType,
  getEntityById,
  invalidateEntitySpatialIndex,
  queryEntitySpatialIndex,
  replaceEntityCollection
} from "../state/entities.js";

const TARGET_SWITCH_SCORE_ADVANTAGE = 8;
const MAX_TRANSIENT_EFFECTS = 160;
const ATTACK_FACING_THRESHOLD_RADIANS = Math.PI / 18;
const BUILDING_ATTACK_FACING_THRESHOLD_RADIANS = Math.PI / 30;

export function updateCombat(state, dt) {
  pruneExpiredTransientEffects(state);
  resolveUnitDeathEffects(state);
  removeDestroyedEntities(state);
  const combatSpatialIndex = createCombatSpatialIndex(state);
  updateBuildings(state, dt, combatSpatialIndex);
  resolveUnitDeathEffects(state);
  removeDestroyedEntities(state);

  const units = getEntitiesByType(state, "unit");

  for (const unit of units) {
    updateUnitAttack(state, unit, dt, combatSpatialIndex);
  }

  resolveUnitDeathEffects(state);
  removeDestroyedEntities(state);
}

export function updateProjectileMotion(state, dt) {
  updateProjectiles(state, dt);
  removeDestroyedEntities(state);
}

export function updateUnitCombatMovement(state, dt) {
  const combatSpatialIndex = createCombatSpatialIndex(state);
  const units = getEntitiesByType(state, "unit");

  for (const unit of units) {
    updateUnitMovement(state, unit, dt, combatSpatialIndex);
  }

  const survivingUnits = getEntitiesByType(state, "unit");
  applyEmergencyUnitRecovery(state, combatSpatialIndex, survivingUnits);
  applyTerrainCollisionRecovery(state, survivingUnits);
  markTerritoryInfluencersDirty(state, survivingUnits.map((unit) => unit.id));
  invalidateEntitySpatialIndex(state);
}

function updateBuildings(state, dt, combatSpatialIndex) {
  const buildings = getEntitiesByType(state, "building");

  for (const building of buildings) {
    markEntityDirty(state, building.id);
    const definition = state.catalog.buildings[building.definitionId];
    const healthRegenPerSecond = building.healthRegenPerSecond ?? definition.healthRegenPerSecond;
    const defenseProfile = building.defense ?? definition.defense;

    if (building.health > 0 && building.isConstructed && healthRegenPerSecond > 0) {
      building.health = Math.min(
        building.maxHealth,
        building.health + healthRegenPerSecond * dt
      );
    }

    if (!defenseProfile || !building.isConstructed) {
      continue;
    }

    building.attackCooldownRemaining = Math.max(0, building.attackCooldownRemaining - dt);
    let target = building.currentTargetId ? getEntityById(state, building.currentTargetId) : null;
    if (target && !canContinueBuildingTargeting(building, target, defenseProfile)) {
      target = null;
      building.currentTargetId = null;
    }

    if (!target) {
      target = acquireTarget(state, building, defenseProfile, combatSpatialIndex);
      building.currentTargetId = target?.id ?? null;
    }

    if (!target) {
      continue;
    }

    const remainingFacingError = rotateBuildingTurretTowardTarget(building, defenseProfile, target, dt);
    const distanceToTarget = Math.hypot(target.x - building.x, target.y - building.y);
    const attackDistance = defenseProfile.attackRange + target.radius;
    if (
      distanceToTarget > attackDistance ||
      building.attackCooldownRemaining > 0 ||
      remainingFacingError > BUILDING_ATTACK_FACING_THRESHOLD_RADIANS
    ) {
      continue;
    }

    resolveAttack(state, building, target, defenseProfile);
    building.attackCooldownRemaining = defenseProfile.attackCooldown;
    building.currentTargetId = acquireTarget(state, building, defenseProfile, combatSpatialIndex)?.id ?? null;
  }
}

function updateUnitMovement(state, unit, dt, combatSpatialIndex) {
  const stats = getUnitStats(state, unit.ownerId, unit.definitionId);
  validateUnitCombatProfile(stats, unit.definitionId);
  markEntityDirty(state, unit.id);
  unit.attackCooldownRemaining = Math.max(0, unit.attackCooldownRemaining - dt);
  unit.aggroTimerRemaining = Math.max(0, unit.aggroTimerRemaining - dt);
  unit.targetSwitchLockSeconds = Math.max(0, unit.targetSwitchLockSeconds - dt);
  updateSpawnSourceGrace(state, unit, dt);

  if (updateSpawnExit(state, unit, stats, dt, combatSpatialIndex)) {
    return;
  }

  if (stats.behaviorTags?.includes("route_locked_no_attack")) {
    unit.currentTargetId = null;
    moveUnitAlongRoute(state, combatSpatialIndex, unit, stats, dt);
    return;
  }

  let target = unit.currentTargetId ? getEntityById(state, unit.currentTargetId) : null;

  if (target && !canContinueTargeting(unit, target, stats)) {
    target = null;
    unit.currentTargetId = null;
  }

  if (target && unit.targetSwitchLockSeconds === 0) {
    const currentCandidate = scoreTarget(state, target, unit.ownerId, unit, stats, combatSpatialIndex);
    const nextCandidate = acquireTargetCandidate(state, unit, stats, combatSpatialIndex);
    if (
      currentCandidate &&
      nextCandidate &&
      nextCandidate.target.id !== target.id &&
      nextCandidate.score + TARGET_SWITCH_SCORE_ADVANTAGE < currentCandidate.score
    ) {
      target = nextCandidate.target;
      unit.currentTargetId = target.id;
      unit.leashAnchorPosition = { x: unit.x, y: unit.y };
      unit.targetSwitchLockSeconds = stats.targetSwitchCooldown;
      unit.aggroTimerRemaining = stats.aggroPersistenceTime;
      unit.state = "acquiring_target";
    }
  }

  if (!target) {
    const candidate = acquireTargetCandidate(state, unit, stats, combatSpatialIndex);
    target = candidate?.target ?? null;
    if (target) {
      unit.currentTargetId = target.id;
      unit.leashAnchorPosition = { x: unit.x, y: unit.y };
      unit.targetSwitchLockSeconds = stats.targetSwitchCooldown;
      unit.aggroTimerRemaining = stats.aggroPersistenceTime;
      unit.state = "acquiring_target";
    }
  }

  if (target) {
    refreshAggroPersistence(unit, target, stats);
    const targetRadius = target.radius ?? 10;
    const distanceToTarget = Math.hypot(target.x - unit.x, target.y - unit.y);
    const attackDistance = stats.attackRange + targetRadius;

    if (distanceToTarget <= attackDistance) {
      unit.state = "attacking";
      tryResolveUnitAttack(state, unit, target, stats, dt);
      return;
    }

    const distanceFromAnchor = Math.hypot(
      unit.x - unit.leashAnchorPosition.x,
      unit.y - unit.leashAnchorPosition.y
    );

    if (distanceFromAnchor > stats.leashDistance) {
      unit.currentTargetId = null;
      unit.state = "returning_to_route";
      invalidateUnitPath(unit);
      moveUnitAlongRoute(state, combatSpatialIndex, unit, stats, dt);
      return;
    }

    unit.state = "pursuing";
    moveUnitTowardPoint(state, combatSpatialIndex, unit, target, stats, dt, {
      navigationKey: `target:${target.id}:${Math.floor(target.x / state.navigation.cellSize)}:${Math.floor(target.y / state.navigation.cellSize)}`
    });
    return;
  }

  moveUnitAlongRoute(state, combatSpatialIndex, unit, stats, dt);
}

function updateUnitAttack(state, unit, dt, combatSpatialIndex) {
  const stats = getUnitStats(state, unit.ownerId, unit.definitionId);
  validateUnitCombatProfile(stats, unit.definitionId);
  if (unit.spawnExitPoint || stats.behaviorTags?.includes("route_locked_no_attack")) {
    return;
  }

  let target = unit.currentTargetId ? getEntityById(state, unit.currentTargetId) : null;
  if (target && !canContinueTargeting(unit, target, stats)) {
    target = null;
    unit.currentTargetId = null;
  }

  if (!target) {
    return;
  }

  const targetRadius = target.radius ?? 10;
  const distanceToTarget = Math.hypot(target.x - unit.x, target.y - unit.y);
  const attackDistance = stats.attackRange + targetRadius;
  if (distanceToTarget > attackDistance || unit.attackCooldownRemaining > 0) {
    return;
  }

  tryResolveUnitAttack(state, unit, target, stats, dt);
}

function tryResolveUnitAttack(state, unit, target, stats, dt) {
  unit.state = "attacking";
  const remainingFacingError = rotateUnitFacingTowardPoint(unit, stats, target, dt);
  if (remainingFacingError > ATTACK_FACING_THRESHOLD_RADIANS || unit.attackCooldownRemaining > 0) {
    return false;
  }

  resolveAttack(state, unit, target, stats);
  unit.attackCooldownRemaining = stats.attackCooldown;
  return true;
}

function updateProjectiles(state, dt) {
  const projectiles = getEntitiesByType(state, "projectile");
  const expiredProjectileIds = new Set();

  for (const projectile of projectiles) {
    markEntityDirty(state, projectile.id);
    const target = getEntityById(state, projectile.targetId);
    if (target && target.health > 0) {
      projectile.targetLastKnownX = target.x;
      projectile.targetLastKnownY = target.y;
    }

    const targetX = target?.health > 0 ? target.x : projectile.targetLastKnownX;
    const targetY = target?.health > 0 ? target.y : projectile.targetLastKnownY;
    if (typeof targetX !== "number" || typeof targetY !== "number") {
      expiredProjectileIds.add(projectile.id);
      continue;
    }

    const dx = targetX - projectile.x;
    const dy = targetY - projectile.y;
    const distance = Math.hypot(dx, dy);
    const hitDistance = projectile.radius + (target?.radius ?? 0);

    if (distance <= hitDistance) {
      if (target && target.health > 0) {
        applyProjectileHit(state, projectile, target);
      }
      expiredProjectileIds.add(projectile.id);
      continue;
    }

    const distanceStep = Math.min(distance, projectile.speed * dt);
    projectile.velocityX = distance > 0 ? (dx / distance) * projectile.speed : 0;
    projectile.velocityY = distance > 0 ? (dy / distance) * projectile.speed : 0;
    projectile.lastMotionDtSeconds = dt;
    projectile.x += distance > 0 ? (dx / distance) * distanceStep : 0;
    projectile.y += distance > 0 ? (dy / distance) * distanceStep : 0;
  }

  if (expiredProjectileIds.size === 0) {
    return;
  }

  replaceEntityCollection(state, state.entities.filter((entity) => {
    return entity.type !== "projectile" || !expiredProjectileIds.has(entity.id);
  }));
  for (const projectileId of expiredProjectileIds) {
    markEntityDestroyed(state, projectileId);
  }
}

function canContinueTargeting(unit, target, stats) {
  const distance = Math.hypot(target.x - unit.x, target.y - unit.y);
  return (
    target.health > 0 &&
    canTargetEntity(stats.targetFilters, target) &&
    distance <= stats.aggroRadius + stats.leashDistance &&
    (distance <= stats.aggroRadius || unit.aggroTimerRemaining > 0)
  );
}

function canContinueBuildingTargeting(building, target, defenseProfile) {
  const distance = Math.hypot(target.x - building.x, target.y - building.y);
  return (
    target.health > 0 &&
    target.ownerId !== building.ownerId &&
    canTargetEntity(defenseProfile.targetFilters, target) &&
    distance <= defenseProfile.aggroRadius
  );
}

function resolveAttack(state, attacker, target, combatProfile) {
  if (combatProfile.attackMode === "projectile") {
    spawnProjectile(state, attacker, target, combatProfile);
    return;
  }

  applyDamage(state, target, combatProfile.attackDamage, attacker);
}

function spawnProjectile(state, attacker, target, combatProfile) {
  const projectileOrigin = getProjectileOrigin(attacker);
  spawnProjectileFromPoint(state, attacker.ownerId, {
    x: projectileOrigin.x,
    y: projectileOrigin.y,
    radius: projectileOrigin.radius ?? attacker.radius ?? 0,
    facingAngle: projectileOrigin.facingAngle
  }, target, {
    projectileRadius: combatProfile.projectileRadius,
    projectileSpeed: combatProfile.projectileSpeed,
    damage: combatProfile.attackDamage,
    ownerEntityId: attacker.id,
    chainMaxJumps: combatProfile.chainMaxJumps ?? 0,
    chainRange: combatProfile.chainRange ?? 0,
    chainDamageMultiplier: combatProfile.chainDamageMultiplier ?? 1,
    targetFilters: combatProfile.targetFilters ?? [],
    chainJumpIndex: 0,
    hitTargetIds: []
  });
}

function getProjectileOrigin(attacker) {
  const facingAngle = Number.isFinite(attacker.turretFacingAngle)
    ? attacker.turretFacingAngle
    : attacker.facingAngle;
  if (attacker.type !== "building" || attacker.kind !== "base") {
    return {
      x: attacker.x,
      y: attacker.y,
      radius: attacker.radius ?? 0,
      facingAngle
    };
  }

  const barrelLength = Math.max(12, (attacker.radius ?? 0) * 0.68);
  return {
    x: attacker.x + Math.cos(facingAngle) * barrelLength,
    y: attacker.y + Math.sin(facingAngle) * barrelLength,
    radius: 0,
    facingAngle
  };
}

function spawnProjectileFromPoint(state, ownerId, origin, target, attackProfile) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distance = Math.hypot(dx, dy) || 1;
  const originRadius = origin.radius ?? 0;
  const projectileRadius = attackProfile.projectileRadius ?? 3;
  const targetRadius = target.radius ?? 0;
  const hitDistance = projectileRadius + targetRadius;
  const preferredSpawnDistance = originRadius + 4;
  const spawnDistance = Math.max(0, Math.min(preferredSpawnDistance, distance - hitDistance - 1));
  const spawnAngle = Number.isFinite(origin.facingAngle)
    ? origin.facingAngle
    : Math.atan2(dy, dx);
  const speed = attackProfile.projectileSpeed ?? 260;

  const projectile = {
    id: `entity_${state.nextEntityId++}`,
    type: "projectile",
    ownerId,
    x: origin.x + Math.cos(spawnAngle) * spawnDistance,
    y: origin.y + Math.sin(spawnAngle) * spawnDistance,
    radius: projectileRadius,
    speed,
    velocityX: (dx / distance) * speed,
    velocityY: (dy / distance) * speed,
    lastMotionDtSeconds: 0,
    damage: attackProfile.damage,
    ownerEntityId: attackProfile.ownerEntityId ?? null,
    targetId: target.id,
    targetLastKnownX: target.x,
    targetLastKnownY: target.y,
    targetFilters: Array.isArray(attackProfile.targetFilters) ? [...attackProfile.targetFilters] : [],
    chainMaxJumps: attackProfile.chainMaxJumps ?? 0,
    chainRange: attackProfile.chainRange ?? 0,
    chainDamageMultiplier: attackProfile.chainDamageMultiplier ?? 1,
    chainJumpIndex: attackProfile.chainJumpIndex ?? 0,
    hitTargetIds: Array.isArray(attackProfile.hitTargetIds) ? [...attackProfile.hitTargetIds] : []
  };
  addEntity(state, projectile);
  markEntityCreated(state, projectile.id);
}

function applyProjectileHit(state, projectile, target) {
  const attacker = getEntityById(state, projectile.ownerEntityId);
  applyDamage(state, target, projectile.damage, attacker);

  if ((projectile.chainJumpIndex ?? 0) >= (projectile.chainMaxJumps ?? 0)) {
    return;
  }

  const nextDamage = projectile.damage * (projectile.chainDamageMultiplier ?? 1);
  if (nextDamage <= 0) {
    return;
  }

  const nextTarget = acquireChainTarget(state, projectile, target);
  if (!nextTarget) {
    return;
  }

  spawnProjectileFromPoint(state, projectile.ownerId, target, nextTarget, {
    projectileRadius: projectile.radius,
    projectileSpeed: projectile.speed,
    damage: nextDamage,
    ownerEntityId: projectile.ownerEntityId ?? null,
    targetFilters: projectile.targetFilters,
    chainMaxJumps: projectile.chainMaxJumps,
    chainRange: projectile.chainRange,
    chainDamageMultiplier: projectile.chainDamageMultiplier,
    chainJumpIndex: (projectile.chainJumpIndex ?? 0) + 1,
    hitTargetIds: [...(projectile.hitTargetIds ?? []), target.id]
  });
}

function applyDamage(state, target, amount, source = null, options = {}) {
  if (!target || target.health <= 0 || amount <= 0) {
    return;
  }

  target.health -= amount;
  markEntityDirty(state, target.id);

  if (options.suppressReactiveEffects) {
    return;
  }

  applyReflectDamage(state, target, source);
}

function applyReflectDamage(state, target, source) {
  if (!source || source.type !== "unit" || source.health <= 0 || target.type !== "unit") {
    return;
  }

  const targetStats = getUnitStats(state, target.ownerId, target.definitionId);
  if (!targetStats.behaviorTags?.includes("reflect_damage")) {
    return;
  }

  const reflectDamage = targetStats.reflectDamage ?? 0;
  if (reflectDamage <= 0) {
    return;
  }

  addTransientEffect(state, {
    type: "reflect_damage",
    sourceX: target.x,
    sourceY: target.y,
    targetX: source.x,
    targetY: source.y,
    startedAtSeconds: state.matchTimeSeconds,
    durationSeconds: 0.22,
    ownerId: target.ownerId
  });
  applyDamage(state, source, reflectDamage, null, { suppressReactiveEffects: true });
}

function resolveUnitDeathEffects(state) {
  const combatSpatialIndex = createCombatSpatialIndex(state);
  const destroyedUnits = getEntitiesByType(state, "unit").filter((unit) => {
    return unit.health <= 0 && !unit.deathEffectsResolved;
  });

  for (const unit of destroyedUnits) {
    unit.deathEffectsResolved = true;
    const stats = getUnitStats(state, unit.ownerId, unit.definitionId);
    if (!stats.behaviorTags?.includes("death_explosion")) {
      continue;
    }

    const explosionDamage = stats.deathExplosionDamage ?? 0;
    const explosionRadius = stats.deathExplosionRadius ?? 0;
    if (explosionDamage <= 0 || explosionRadius <= 0) {
      continue;
    }

    addTransientEffect(state, {
      type: "death_explosion",
      x: unit.x,
      y: unit.y,
      radius: explosionRadius,
      startedAtSeconds: state.matchTimeSeconds,
      durationSeconds: 0.4,
      ownerId: unit.ownerId
    });
    const targets = getNearbyHostileTargets(combatSpatialIndex, unit, explosionRadius, unit.ownerId);
    for (const target of targets) {
      const distance = Math.hypot(target.x - unit.x, target.y - unit.y);
      if (distance > explosionRadius + (target.radius ?? 0)) {
        continue;
      }

      applyDamage(state, target, explosionDamage, null, { suppressReactiveEffects: true });
    }
  }
}

function acquireChainTarget(state, projectile, anchorTarget) {
  const chainRange = projectile.chainRange ?? 0;
  if (chainRange <= 0) {
    return null;
  }

  const alreadyHitTargetIds = new Set([...(projectile.hitTargetIds ?? []), anchorTarget.id]);
  const nearbyTargets = getNearbyHostileTargets(createCombatSpatialIndex(state), anchorTarget, chainRange, projectile.ownerId);
  let bestTarget = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of nearbyTargets) {
    if (
      alreadyHitTargetIds.has(candidate.id) ||
      candidate.health <= 0 ||
      !canTargetEntity(projectile.targetFilters, candidate)
    ) {
      continue;
    }

    const distance = Math.hypot(candidate.x - anchorTarget.x, candidate.y - anchorTarget.y);
    if (distance > chainRange || distance >= bestDistance) {
      continue;
    }

    bestTarget = candidate;
    bestDistance = distance;
  }

  return bestTarget;
}

function acquireTargetCandidate(state, attacker, combatProfile, combatSpatialIndex) {
  const hostileTargets = getNearbyHostileTargets(combatSpatialIndex, attacker, combatProfile.aggroRadius, attacker.ownerId);
  let bestTarget = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const target of hostileTargets) {
    const score = scoreTarget(state, target, attacker.ownerId, attacker, combatProfile, combatSpatialIndex);
    if (score === null) {
      continue;
    }

    if (score < bestScore) {
      bestTarget = target;
      bestScore = score;
    }
  }

  if (!bestTarget) {
    return null;
  }

  return {
    target: bestTarget,
    score: bestScore
  };
}

function acquireTarget(state, attacker, combatProfile, combatSpatialIndex) {
  return acquireTargetCandidate(state, attacker, combatProfile, combatSpatialIndex)?.target ?? null;
}

function canTargetEntity(targetFilters, target) {
  return Array.isArray(targetFilters) && targetFilters.includes(target.type);
}

function scoreTarget(state, target, ownerId, attacker, combatProfile, combatSpatialIndex) {
  if (target.health <= 0 || !canTargetEntity(combatProfile.targetFilters, target)) {
    return null;
  }

  const distance = Math.hypot(target.x - attacker.x, target.y - attacker.y);
  if (distance > combatProfile.aggroRadius) {
    return null;
  }

  let score = distance;
  if (attacker.type === "building" && attacker.kind === "base") {
    score = scoreBaseDefenseTarget(attacker, target, combatProfile, distance);
  } else if (target.type === "unit") {
    score -= 10;
  } else if (target.type === "building") {
    score += target.kind === "base" ? 14 : 6;
  }

  if (
    combatProfile.behaviorTags?.includes("prefers_heavy_targets") &&
    target.type === "unit"
  ) {
    const durability = state.catalog.units[target.definitionId]?.durabilityTag;
    if (durability === "heavy") {
      score -= 24;
    }
  }

  if (combatProfile.behaviorTags?.includes("prefers_dense_targets")) {
    score -= countNearbyEnemies(state, target, ownerId, combatSpatialIndex) * 3;
  }

  return score;
}

function rotateBuildingTurretTowardTarget(building, defenseProfile, target, dt) {
  const dx = target.x - building.x;
  const dy = target.y - building.y;
  if (Math.hypot(dx, dy) < 0.001) {
    return 0;
  }

  const desiredAngle = Math.atan2(dy, dx);
  const currentAngle = Number.isFinite(building.turretFacingAngle) ? building.turretFacingAngle : desiredAngle;
  const turnRate = defenseProfile.turretTurnRateRadians ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(turnRate)) {
    building.turretFacingAngle = desiredAngle;
    return 0;
  }

  const maxAngleDelta = turnRate * dt;
  const nextAngle = currentAngle + clampAngleDelta(desiredAngle - currentAngle, maxAngleDelta);
  building.turretFacingAngle = nextAngle;
  return Math.abs(normalizeAngleDelta(desiredAngle - nextAngle));
}

function scoreBaseDefenseTarget(base, target, defenseProfile, distance) {
  const aggroRadius = Math.max(1, defenseProfile.aggroRadius ?? defenseProfile.attackRange ?? 1);
  const distanceWeight = defenseProfile.targetDistanceWeight ?? aggroRadius;
  const distancePower = defenseProfile.targetDistancePower ?? 1;
  const normalizedDistance = Math.max(0, distance / aggroRadius);
  let score = Math.pow(normalizedDistance, distancePower) * distanceWeight;

  if (target.type === "unit") {
    score -= defenseProfile.targetUnitPriorityBonus ?? 0;

    const closeThreatRadius = defenseProfile.targetCloseThreatRadius ?? 0;
    const closeThreatBonus = defenseProfile.targetCloseThreatBonus ?? 0;
    const closeThreatPower = defenseProfile.targetCloseThreatPower ?? 1;
    if (closeThreatRadius > 0 && closeThreatBonus > 0 && distance < closeThreatRadius) {
      const closeThreatRatio = 1 - distance / closeThreatRadius;
      score -= Math.pow(closeThreatRatio, closeThreatPower) * closeThreatBonus;
    }
  } else if (target.type === "building") {
    score += defenseProfile.targetStructurePenalty ?? 0;
    if (target.kind === "base") {
      score += defenseProfile.targetMainBasePenalty ?? 0;
    }
  }

  if (base.currentTargetId === target.id) {
    score -= defenseProfile.targetCurrentTargetBonus ?? 0;
  }

  return score;
}

function countNearbyEnemies(state, anchorTarget, ownerId, combatSpatialIndex) {
  let nearby = 0;
  const nearbyUnits = queryEntitySpatialIndex(combatSpatialIndex, "unit", anchorTarget, 70);

  for (const entity of nearbyUnits) {
    if (entity.id === anchorTarget.id || entity.ownerId === ownerId || entity.type !== "unit") {
      continue;
    }

    const distance = Math.hypot(entity.x - anchorTarget.x, entity.y - anchorTarget.y);
    if (distance <= 70) {
      nearby += 1;
    }
  }
  return nearby;
}

function applyEmergencyUnitRecovery(state, combatSpatialIndex, units) {
  const unitOrder = new Map(units.map((unit, index) => [unit.id, index]));

  for (let index = 0; index < units.length; index += 1) {
    const left = units[index];

    const nearbyUnits = queryEntitySpatialIndex(combatSpatialIndex, "unit", left, left.radius * 2 + 8);
    for (const right of nearbyUnits) {
      if ((unitOrder.get(right.id) ?? -1) <= index) {
        continue;
      }

      const dx = right.x - left.x;
      const dy = right.y - left.y;
      const distance = Math.hypot(dx, dy);
      const minimumDistance = left.radius + right.radius;

      if (distance >= minimumDistance) {
        continue;
      }

      if (distance === 0) {
        left.x -= minimumDistance * 0.5;
        right.x += minimumDistance * 0.5;
        markEntityDirty(state, left.id);
        markEntityDirty(state, right.id);
        continue;
      }

      const overlap = minimumDistance - distance;
      const pushX = (dx / distance) * overlap * 0.5;
      const pushY = (dy / distance) * overlap * 0.5;

      left.x -= pushX;
      left.y -= pushY;
      right.x += pushX;
      right.y += pushY;
      markEntityDirty(state, left.id);
      markEntityDirty(state, right.id);
    }

    const nearbyBuildings = queryEntitySpatialIndex(combatSpatialIndex, "building", left, left.radius + 40);
    for (const building of nearbyBuildings) {
      if (left.spawnSourceBuildingId && building.id === left.spawnSourceBuildingId) {
        continue;
      }

      const dx = left.x - building.x;
      const dy = left.y - building.y;
      const distance = Math.hypot(dx, dy);
      const minimumDistance = left.radius + building.radius + 2;
      if (distance >= minimumDistance) {
        continue;
      }

      if (distance === 0) {
        left.x += minimumDistance;
        markEntityDirty(state, left.id);
        continue;
      }

      const overlap = minimumDistance - distance;
      left.x += (dx / distance) * overlap;
      left.y += (dy / distance) * overlap;
      markEntityDirty(state, left.id);
    }
  }
}

function applyTerrainCollisionRecovery(state, units) {
  for (const unit of units) {
    if (unit.spawnSourceBuildingId) {
      continue;
    }

    if (!resolveCircleOutsideBlockers(state, unit, unit.radius)) {
      continue;
    }

    invalidateUnitPath(unit);
    markEntityDirty(state, unit.id);
  }
}

function updateSpawnExit(state, unit, stats, dt, combatSpatialIndex) {
  if (!unit.spawnExitPoint) {
    return false;
  }

  const exitReached = Math.hypot(unit.spawnExitPoint.x - unit.x, unit.spawnExitPoint.y - unit.y) <= unit.radius;
  if (exitReached) {
    unit.spawnExitPoint = null;
    unit.spawnExitGraceSeconds = 0.35;
    unit.state = "moving_to_waypoint";
    invalidateUnitPath(unit);
    return false;
  }

  moveUnitTowardPoint(state, combatSpatialIndex, unit, unit.spawnExitPoint, stats, dt);
  unit.state = "exiting_factory";
  return true;
}

function createCombatSpatialIndex(state) {
  return createEntitySpatialIndexSnapshot(state.entities);
}

function updateSpawnSourceGrace(state, unit, dt) {
  if (!unit.spawnSourceBuildingId) {
    unit.spawnExitGraceSeconds = 0;
    return;
  }

  if (unit.spawnExitPoint) {
    return;
  }

  const sourceBuilding = getEntityById(state, unit.spawnSourceBuildingId);
  if (!sourceBuilding || sourceBuilding.health <= 0) {
    unit.spawnSourceBuildingId = null;
    unit.spawnExitGraceSeconds = 0;
    return;
  }

  unit.spawnExitGraceSeconds = Math.max(0, (unit.spawnExitGraceSeconds ?? 0) - dt);
  const releaseDistance = sourceBuilding.radius + unit.radius + 14;
  const distanceFromSource = Math.hypot(unit.x - sourceBuilding.x, unit.y - sourceBuilding.y);
  if (unit.spawnExitGraceSeconds === 0 && distanceFromSource >= releaseDistance) {
    unit.spawnSourceBuildingId = null;
  }
}

function refreshAggroPersistence(unit, target, stats) {
  const distance = Math.hypot(target.x - unit.x, target.y - unit.y);
  if (distance <= stats.aggroRadius) {
    unit.aggroTimerRemaining = stats.aggroPersistenceTime;
  }
}

function validateUnitCombatProfile(stats, unitId) {
  const requiredFields = [
    "attackRange",
    "attackDamage",
    "attackCooldown",
    "aggroRadius",
    "aggroPersistenceTime",
    "leashDistance",
    "targetSwitchCooldown"
  ];

  for (const field of requiredFields) {
    if (typeof stats[field] !== "number" || Number.isNaN(stats[field])) {
      throw new Error(`Unit ${unitId} is missing combat field ${field}.`);
    }
  }
}

function getNearbyHostileTargets(combatSpatialIndex, point, radius, ownerId) {
  return queryEntitySpatialIndex(combatSpatialIndex, "all", point, radius).filter((entity) => {
    return entity.ownerId !== ownerId && (entity.type === "unit" || entity.type === "building");
  });
}

function addTransientEffect(state, effect) {
  state.transientEffects.push(effect);
  if (state.transientEffects.length > MAX_TRANSIENT_EFFECTS) {
    state.transientEffects.splice(0, state.transientEffects.length - MAX_TRANSIENT_EFFECTS);
  }
}

function pruneExpiredTransientEffects(state) {
  if (!Array.isArray(state.transientEffects) || state.transientEffects.length === 0) {
    return;
  }

  state.transientEffects = state.transientEffects.filter((effect) => {
    return state.matchTimeSeconds <= effect.startedAtSeconds + effect.durationSeconds;
  });
}

function clampAngleDelta(angle, limit) {
  return clamp(normalizeAngleDelta(angle), -limit, limit);
}

function normalizeAngleDelta(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
