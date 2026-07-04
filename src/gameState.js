import { baseTierDefinitions, baseTiersByTier } from "./data/baseTiers.js";
import { buildingDefinitions, buildingsById } from "./data/buildings.js";
import { defaultDifficultyId, difficultiesById } from "./data/difficulties.js";
import { defaultMap, defaultMapId, mapsById } from "./data/maps.js";
import { techTierDefinitions, techTiersByTier } from "./data/techTiers.js";
import { techBranchDefinitions, techBranchesById, techDefinitions, techById } from "./data/tech.js";
import { unitDefinitions, unitsById } from "./data/units.js";
import { createDefaultAiTraceConfig, resolveAiTraceConfig } from "./debug/aiTrace.js";
import { createPerformanceProfile } from "./debug/performance.js";
import { createPresentationState } from "./multiplayer/interpolation.js";
import { createReplicationDirtyState } from "./multiplayer/replicationDirtyState.js";
import {
  markEntityDestroyed,
  markEntityDirty,
  markMatchDirty,
  markPlayerDirty
} from "./multiplayer/replicationDirtyState.js";
import { createMultiplayerSessionState } from "./multiplayer/sessionState.js";
import { createInitialAiState } from "./systems/aiProfile.js";
import { createNavigationState, invalidateNavigationBlockers, resolvePointToNavigablePosition } from "./systems/navigation.js";
import { createSimulationState } from "./systems/scheduler.js";
import {
  createTerritoryState,
  markTerritoryInfluencerRemoved,
  seedTerritoryAroundPoint
} from "./systems/territory.js";
import { getConstructedTechCenterLevel, getResearchRequiredTechCenterLevel, isUnitUnlocked } from "./rules/catalogRules.js";
import {
  getEntityById,
  getPlayerById,
  getOwnedBuildings,
  replaceEntityCollection
} from "./state/entities.js";
import { setSelectedEntities } from "./state/selection.js";
import { spawnBuilding } from "./state/spawn.js";

const PLAYER_COLORS = {
  1: "#82d173",
  2: "#ff7a6b"
};

export function createMenuState(menuSetup = createDefaultMenuSetup()) {
  return createGameState({
    menuSetup,
    matchConfig: null,
    hasActiveMatch: false,
    uiScreen: "main_menu",
    localPlayerId: null
  });
}

export function createInitialGameState(options = {}) {
  const menuSetup = resolveMenuSetup(options.menuSetup ?? options);
  const matchConfig = resolveMatchConfig(menuSetup);

  return createGameState({
    menuSetup,
    matchConfig,
    hasActiveMatch: true,
    uiScreen: "playing",
    localPlayerId: matchConfig.localPlayerId
  });
}

function createGameState({ menuSetup, matchConfig, hasActiveMatch, uiScreen, localPlayerId }) {
  const activeMap = hasActiveMatch ? (matchConfig?.map ?? defaultMap) : null;
  const players = hasActiveMatch ? createPlayers(matchConfig) : [];
  const resolvedMenuSetup = resolveMenuSetup(menuSetup);
  const state = {
    matchTimeSeconds: 0,
    nextEntityId: 1,
    nextCommandId: 1,
    map: activeMap,
    catalog: {
      units: unitsById,
      unitDefinitions,
      buildings: buildingsById,
      buildingDefinitions,
      tech: techById,
      techDefinitions,
      techBranches: techBranchesById,
      techBranchDefinitions,
      baseTiers: baseTiersByTier,
      baseTierDefinitions,
      techTiers: techTiersByTier,
      techTierDefinitions
    },
    players,
    entities: [],
    entityIndexRevision: 0,
    entitySpatialIndexRevision: 0,
    entityIndexes: null,
    entitySpatialIndex: null,
    territory: activeMap ? createTerritoryState(activeMap) : null,
    mapObjectives: activeMap ? createMapObjectivesState(activeMap) : null,
    navigation: activeMap ? createNavigationState(activeMap) : null,
    selectedEntityId: null,
    selectedEntityIds: [],
    pendingPlacedBuildingSelection: null,
    selectionBox: null,
    uiMode: "select",
    pendingBuildingId: null,
    showPerformancePanel: false,
    showResearchModal: false,
    showAiTraceControls: false,
    researchView: {
      zoom: 1,
      panX: 24,
      panY: 24
    },
    interactionHint: "",
    uiScreen,
    hasActiveMatch,
    menuSetup: resolvedMenuSetup,
    matchConfig,
    localPlayerId,
    matchEnded: false,
    winnerId: null,
    log: [],
    multiplayerSession: createMultiplayerSessionState(),
    presentation: createPresentationState(),
    replicationDirty: createReplicationDirtyState(),
    pendingGameplayCommands: [],
    transientEffects: [],
    simulation: createSimulationState(),
    performance: createPerformanceProfile(),
    mouseWorldPosition: activeMap
      ? { x: activeMap.width * 0.5, y: activeMap.height * 0.5 }
      : { x: 0, y: 0 },
    viewport: {
      width: 1600,
      height: 900,
      devicePixelRatio: 1,
      padding: {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0
      }
    },
    camera: {
      x: activeMap ? activeMap.width * 0.5 : 0,
      y: activeMap ? activeMap.height * 0.5 : 0,
      zoom: 1
    }
  };

  if (!hasActiveMatch) {
    pushLog(state, "Open New Game to choose a map size and difficulty.");
    return state;
  }

  initializePlayers(state);
  setSelectedEntities(state, []);
  if (matchConfig?.mode === "ai_test") {
    pushLog(state, "AI test match started. Watch both AIs expand, upgrade bases, build Tech Centers, and fight.");
  } else {
    pushLog(state, "Prototype booted. Build a Tech Center early to unlock specialist production and research, then level it up for deeper tech rows.");
  }

  return state;
}

function createMapObjectivesState(map) {
  return {
    controlStructures: (map.objectives?.controlStructures ?? []).map((structure) => ({
      id: structure.id,
      control: 0,
      ownerId: null
    }))
  };
}

function resolveMenuSetup(menuSetup = {}) {
  const mapId = menuSetup.mapId && mapsById[menuSetup.mapId] ? menuSetup.mapId : defaultMapId;
  const difficultyId = menuSetup.difficultyId && difficultiesById[menuSetup.difficultyId]
    ? menuSetup.difficultyId
    : defaultDifficultyId;
  const mode = ["ai_test", "multiplayer_host", "multiplayer_client"].includes(menuSetup.mode)
    ? menuSetup.mode
    : "standard";

  return {
    mapId,
    difficultyId,
    mode,
    localPlayerId: resolveLocalPlayerId(mode, menuSetup.localPlayerId),
    aiTrace: resolveAiTraceConfig(menuSetup.aiTrace)
  };
}

function resolveMatchConfig(menuSetup) {
  return {
    mapId: menuSetup.mapId,
    difficultyId: menuSetup.difficultyId,
    mode: menuSetup.mode,
    localPlayerId: menuSetup.localPlayerId,
    map: mapsById[menuSetup.mapId],
    difficulty: difficultiesById[menuSetup.difficultyId]
  };
}

function createDefaultMenuSetup() {
  return {
    mapId: defaultMapId,
    difficultyId: defaultDifficultyId,
    mode: "standard",
    localPlayerId: 1,
    aiTrace: createDefaultAiTraceConfig()
  };
}

function createPlayers(matchConfig) {
  if (matchConfig?.mode === "ai_test") {
    return [
      createPlayerState(1, "AI 1", 1, true),
      createPlayerState(2, "AI 2", 1, true)
    ];
  }

  if (matchConfig?.mode === "multiplayer_host" || matchConfig?.mode === "multiplayer_client") {
    return [
      createPlayerState(1, "Player 1", 1, false),
      createPlayerState(2, "Player 2", 1, false)
    ];
  }

  return [
    createPlayerState(1, "Player", 1, false),
    createPlayerState(2, "AI", matchConfig?.difficulty.aiResourceMultiplier ?? 1, true)
  ];
}

function createPlayerState(id, name, resourceMultiplier, isAiControlled) {
  return {
    id,
    name,
    color: PLAYER_COLORS[id],
    resources: 150,
    cumulativeResourceGain: 0,
    resourceMultiplier,
    constructionPriorityIndex: 0,
    productionPriorityIndex: 0,
    baseTier: 1,
    activeBaseUpgrade: null,
    techTier: 1,
    activeTechUpgrade: null,
    researchedTechIds: [],
    researchProgressByTechId: {},
    researchQueue: [],
    activeResearch: null,
    startingBaseId: null,
    notifications: [],
    aiState: isAiControlled
      ? {
          ...createInitialAiState()
        }
      : null
  };
}

function resolveLocalPlayerId(mode, localPlayerId) {
  if (mode === "ai_test") {
    return null;
  }

  if (mode === "multiplayer_client") {
    return localPlayerId === 1 ? 1 : 2;
  }

  return localPlayerId === 2 ? 2 : 1;
}

function initializePlayers(state) {
  for (const start of state.map.playerStarts) {
    const player = getPlayerById(state, start.playerId);
    const base = spawnBuilding(state, {
      ownerId: start.playerId,
      definitionId: "main_base",
      x: start.base.x,
      y: start.base.y
    });
    player.startingBaseId = base.id;
    seedTerritoryAroundPoint(state, start.playerId, start.base);
  }
}

export function canUpgradeBase(state, playerId) {
  const player = getPlayerById(state, playerId);
  const nextTier = state.catalog.baseTiers[player.baseTier + 1];
  const base = getEntityById(state, player.startingBaseId);
  return !!nextTier && !player.activeBaseUpgrade && !!base && base.isConstructed;
}

export function canUpgradeTech(state, playerId) {
  const player = getPlayerById(state, playerId);
  if (!player) {
    return false;
  }

  const nextTier = state.catalog.techTiers[player.techTier + 1];
  if (!nextTier || player.activeTechUpgrade) {
    return false;
  }

  return getOwnedBuildings(state, playerId, "tech_structure").some((building) => building.isConstructed);
}

export function startBaseUpgrade(state, playerId) {
  const player = getPlayerById(state, playerId);
  if (!canUpgradeBase(state, playerId)) {
    return false;
  }

  const nextTier = state.catalog.baseTiers[player.baseTier + 1];
  player.activeBaseUpgrade = {
    targetTier: nextTier.tier,
    progressSeconds: 0
  };
  markPlayerDirty(state, playerId);
  pushLog(state, `${player.name} started main base upgrade: ${nextTier.displayName}.`);
  return true;
}

export function startTechUpgrade(state, playerId) {
  const player = getPlayerById(state, playerId);
  if (!canUpgradeTech(state, playerId)) {
    return false;
  }

  const nextTier = state.catalog.techTiers[player.techTier + 1];
  player.activeTechUpgrade = {
    targetTier: nextTier.tier,
    progressSeconds: 0
  };
  markPlayerDirty(state, playerId);
  pushLog(state, `${player.name} started Tech Center upgrade: ${nextTier.displayName}.`);
  return true;
}

export function canResearchTech(state, playerId, techId) {
  const player = getPlayerById(state, playerId);
  const definition = state.catalog.tech[techId];
  if (!player || !definition || !canPlayerAccessResearch(state, playerId, definition)) {
    return false;
  }

  if (
    player.researchedTechIds.includes(techId) ||
    player.activeResearch?.techId === techId ||
    player.researchQueue.includes(techId)
  ) {
    return false;
  }

  if (!definition.effects.every((effect) => isResearchEffectUnlocked(state, playerId, effect))) {
    return false;
  }

  if (isTechLockedByExclusiveChoice(state, player, definition)) {
    return false;
  }

  const satisfiedResearchIds = new Set([
    ...player.researchedTechIds,
    ...(player.activeResearch ? [player.activeResearch.techId] : []),
    ...player.researchQueue
  ]);

  return definition.prerequisiteIds.every((prerequisiteId) => satisfiedResearchIds.has(prerequisiteId));
}

export function startResearch(state, playerId, techId) {
  const player = getPlayerById(state, playerId);
  const definition = state.catalog.tech[techId];

  if (!definition || !canResearchTech(state, playerId, techId)) {
    return false;
  }

  if (player.activeResearch || player.researchQueue.length > 0) {
    player.researchQueue.push(techId);
    markPlayerDirty(state, playerId);
    pushLog(state, `${player.name} queued research: ${definition.displayName}.`);
    return true;
  }

  player.activeResearch = createActiveResearchState(player, techId);
  markPlayerDirty(state, playerId);
  pushLog(state, `${player.name} started research: ${definition.displayName}.`);
  return true;
}

export function toggleResearchPaused(state, playerId) {
  const player = getPlayerById(state, playerId);
  if (!player?.activeResearch) {
    return false;
  }

  player.activeResearch.isPaused = !player.activeResearch.isPaused;
  markPlayerDirty(state, playerId);
  const techDefinition = state.catalog.tech[player.activeResearch.techId];
  pushLog(
    state,
    `${player.name} ${player.activeResearch.isPaused ? "paused" : "resumed"} research: ${techDefinition.displayName}.`
  );
  return true;
}

export function cancelActiveResearch(state, playerId) {
  const player = getPlayerById(state, playerId);
  if (!player?.activeResearch) {
    return false;
  }

  const techDefinition = state.catalog.tech[player.activeResearch.techId];
  storeResearchProgress(player, player.activeResearch.techId, player.activeResearch.progressSeconds);
  player.activeResearch = null;
  markPlayerDirty(state, playerId);
  pushLog(state, `${player.name} removed current research: ${techDefinition.displayName}.`);
  tryStartQueuedResearch(state, playerId);
  return true;
}

export function removeQueuedResearch(state, playerId, queueIndex) {
  const player = getPlayerById(state, playerId);
  if (!player || !Number.isInteger(queueIndex) || queueIndex < 0 || queueIndex >= player.researchQueue.length) {
    return false;
  }

  const [techId] = player.researchQueue.splice(queueIndex, 1);
  markPlayerDirty(state, playerId);
  pushLog(state, `${player.name} removed ${state.catalog.tech[techId].displayName} from the research queue.`);
  return true;
}

export function canStartResearchNow(state, playerId, techId) {
  const player = getPlayerById(state, playerId);
  const definition = state.catalog.tech[techId];
  if (!player || !definition || player.activeResearch || !canPlayerAccessResearch(state, playerId, definition)) {
    return false;
  }

  if (player.researchedTechIds.includes(techId)) {
    return false;
  }

  if (!definition.effects.every((effect) => isResearchEffectUnlocked(state, playerId, effect))) {
    return false;
  }

  if (isTechLockedByExclusiveChoice(state, player, definition)) {
    return false;
  }

  return definition.prerequisiteIds.every((prerequisiteId) => player.researchedTechIds.includes(prerequisiteId));
}

export function beginResearchNow(state, playerId, techId) {
  const player = getPlayerById(state, playerId);
  const definition = state.catalog.tech[techId];
  if (!player || !definition || !canStartResearchNow(state, playerId, techId)) {
    return false;
  }

  player.activeResearch = createActiveResearchState(player, techId);
  markPlayerDirty(state, playerId);
  pushLog(state, `${player.name} started research: ${definition.displayName}.`);
  return true;
}

export function tryStartQueuedResearch(state, playerId) {
  const player = getPlayerById(state, playerId);
  if (!player || player.activeResearch || player.researchQueue.length === 0) {
    return false;
  }

  const [nextTechId] = player.researchQueue;
  if (!canStartResearchNow(state, playerId, nextTechId)) {
    return false;
  }

  player.researchQueue.shift();
  markPlayerDirty(state, playerId);
  return beginResearchNow(state, playerId, nextTechId);
}

export function setProductionBuildingsEnabled(state, buildingIds, enabled) {
  const buildings = resolveProductionBuildings(state, buildingIds);
  if (!buildings) {
    return false;
  }

  const changedBuildings = buildings.filter((building) => building.enabled !== enabled);
  if (changedBuildings.length === 0) {
    return true;
  }

  for (const building of changedBuildings) {
    building.enabled = enabled;
    markEntityDirty(state, building.id);
  }

  pushLog(
    state,
    `${getPlayerById(state, changedBuildings[0].ownerId).name} ${enabled ? "activated" : "deactivated"} ${changedBuildings.length} building${changedBuildings.length === 1 ? "" : "s"}.`
  );
  return true;
}

export function clearWaypointChain(state, buildingId) {
  const building = getEntityById(state, buildingId);
  if (!building || building.type !== "building" || !Array.isArray(building.waypointChain)) {
    return false;
  }

  building.waypointChain = [];
  resetBuildingWaypointState(building);
  markEntityDirty(state, building.id);
  return true;
}

export function clearWaypointChains(state, buildingIds) {
  const buildings = resolveProductionBuildings(state, buildingIds);
  if (!buildings) {
    return false;
  }

  for (const building of buildings) {
    building.waypointChain = [];
    resetBuildingWaypointState(building);
    markEntityDirty(state, building.id);
  }

  return true;
}

export function appendWaypoint(state, buildingId, point) {
  const building = getEntityById(state, buildingId);
  if (!building || building.type !== "building" || !Array.isArray(building.waypointChain)) {
    return false;
  }

  const waypoint = resolveWaypointPoint(
    state,
    point,
    getWaypointResolutionRadius(building),
    getWaypointResolutionOptions(building)
  );
  if (!waypoint) {
    return false;
  }

  if (building.kind === "base" && building.waypointChain.length === 0) {
    resetBuildingWaypointState(building);
  }
  building.waypointChain.push(waypoint);
  markEntityDirty(state, building.id);
  return true;
}

export function appendWaypointToBuildings(state, buildingIds, point) {
  const buildings = resolveProductionBuildings(state, buildingIds);
  if (!buildings) {
    return false;
  }

  for (const building of buildings) {
    const waypoint = resolveWaypointPoint(
      state,
      point,
      getWaypointResolutionRadius(building),
      getWaypointResolutionOptions(building)
    );
    if (!waypoint) {
      return false;
    }

    if (building.kind === "base" && building.waypointChain.length === 0) {
      resetBuildingWaypointState(building);
    }
    building.waypointChain.push({ ...waypoint });
    markEntityDirty(state, building.id);
  }

  return true;
}



export function removeDestroyedEntities(state) {
  const destroyed = state.entities.filter((entity) => entity.health <= 0);
  if (destroyed.length === 0) {
    return;
  }

  const destroyedIds = new Set(destroyed.map((entity) => entity.id));
  const destroyedBuildings = destroyed.filter((entity) => entity.type === "building");

  replaceEntityCollection(state, state.entities.filter((entity) => !destroyedIds.has(entity.id)));
  if (destroyedBuildings.length > 0) {
    invalidateNavigationBlockers(state, destroyedBuildings);
  }
  for (const destroyedEntityId of destroyedIds) {
    markTerritoryInfluencerRemoved(state, destroyedEntityId);
    markEntityDestroyed(state, destroyedEntityId);
  }
  const survivingSelectedEntityIds = state.selectedEntityIds.filter((entityId) => !destroyedIds.has(entityId));

  if (survivingSelectedEntityIds.length !== state.selectedEntityIds.length) {
    setSelectedEntities(state, survivingSelectedEntityIds, state.selectedEntityId);
    if (survivingSelectedEntityIds.length === 0) {
      state.uiMode = "select";
      state.pendingBuildingId = null;
      state.interactionHint = "";
    }
  }

  for (const entity of state.entities) {
    if (entity.type !== "unit") {
      continue;
    }

    if (entity.currentTargetId && destroyedIds.has(entity.currentTargetId)) {
      entity.currentTargetId = null;
      entity.state = "moving_to_waypoint";
      markEntityDirty(state, entity.id);
    }
  }
}

export function checkMatchEnd(state) {
  if (!state.hasActiveMatch || state.matchEnded) {
    return;
  }

  for (const player of state.players) {
    const base = getEntityById(state, player.startingBaseId);
    if (!base) {
      state.matchEnded = true;
      state.uiScreen = "post_match";
      state.winnerId = player.id === 1 ? 2 : 1;
      markMatchDirty(state);
      pushLog(state, `${getPlayerById(state, state.winnerId).name} destroyed the enemy base.`);
      return;
    }
  }
}

export function pushLog(state, message) {
  state.log.unshift({
    id: `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    timeSeconds: state.matchTimeSeconds,
    message
  });

  if (state.log.length > 10) {
    state.log.length = 10;
  }
  markMatchDirty(state);
}

function resolveProductionBuildings(state, buildingIds) {
  const buildings = [];
  const seen = new Set();

  for (const buildingId of buildingIds) {
    if (!buildingId || seen.has(buildingId)) {
      continue;
    }

    seen.add(buildingId);
    const building = getEntityById(state, buildingId);
    if (!building || building.type !== "building" || !Array.isArray(building.waypointChain)) {
      return null;
    }

    buildings.push(building);
  }

  return buildings;
}

function resetBuildingWaypointState(building) {
  if (building.kind !== "base") {
    return;
  }

  building.currentWaypointIndex = 0;
  building.movementGoal = null;
  building.movementCorridor = null;
  building.movementCorridorIndex = 0;
  building.movementPathId = null;
  building.movementPathStatus = "idle";
  building.movementPathValidity = null;
  building.repathCooldownSeconds = 0;
  building.stuckTimeSeconds = 0;
  building.deviationDistance = 0;
  building.lastProgressDistance = null;
  building.lastProgressSampleSeconds = 0;
  building.velocityX = 0;
  building.velocityY = 0;
  building.preferredVelocityX = 0;
  building.preferredVelocityY = 0;
  building.steeringVelocityX = 0;
  building.steeringVelocityY = 0;
}

function resolveWaypointPoint(state, point, radius = 12, options = undefined) {
  const snappedPoint = resolvePointToNavigablePosition(state, point, radius, options);
  if (!snappedPoint) {
    return null;
  }

  return {
    x: Math.round(snappedPoint.x),
    y: Math.round(snappedPoint.y)
  };
}

function getWaypointResolutionRadius(building) {
  return building.kind === "base"
    ? Math.max(12, building.radius ?? 12)
    : 12;
}

function getWaypointResolutionOptions(building) {
  if (!building?.id) {
    return undefined;
  }

  return {
    excludedBuildingIds: new Set([building.id])
  };
}

function canPlayerAccessResearch(state, playerId, definition) {
  const player = getPlayerById(state, playerId);
  if (!player) {
    return false;
  }

  return getConstructedTechCenterLevel(state, playerId) >= getResearchRequiredTechCenterLevel(definition);
}

function isTechLockedByExclusiveChoice(state, player, definition) {
  if (!definition.exclusiveGroupId) {
    return false;
  }

  return state.catalog.techDefinitions.some((candidate) => {
    if (candidate.id === definition.id || candidate.exclusiveGroupId !== definition.exclusiveGroupId) {
      return false;
    }

    return (
      player.researchedTechIds.includes(candidate.id) ||
      player.activeResearch?.techId === candidate.id ||
      player.researchQueue.includes(candidate.id)
    );
  });
}

function isResearchEffectUnlocked(state, playerId, effect) {
  if (effect.kind !== "modify_unit_stat" && effect.kind !== "add_unit_behavior") {
    throw new Error(`Unsupported armory tech effect: ${effect.kind}`);
  }

  const targetUnitIds = effect.target?.unitIds ?? [];
  return targetUnitIds.length > 0 && targetUnitIds.every((unitId) => isUnitUnlocked(state, playerId, unitId));
}

function createActiveResearchState(player, techId) {
  return {
    techId,
    progressSeconds: getStoredResearchProgress(player, techId),
    isPaused: false
  };
}

function getStoredResearchProgress(player, techId) {
  return player.researchProgressByTechId?.[techId] ?? 0;
}

function storeResearchProgress(player, techId, progressSeconds) {
  player.researchProgressByTechId[techId] = progressSeconds;
}

export function clearStoredResearchProgress(player, techId) {
  delete player.researchProgressByTechId[techId];
}
