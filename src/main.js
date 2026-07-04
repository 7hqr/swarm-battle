import {
  createInitialGameState,
  createMenuState
} from "./gameState.js";
import { getGameplayCommandTypes, queueGameplayCommand } from "./gameplayCommands.js";
import { createInputController, describePlacementValidity } from "./input/inputController.js";
import {
  AI_TRACE_CATEGORY_DEFINITIONS,
  clearAiTraceEntries,
  downloadAiTraceEntries,
  getAiTracePresetCategoryIds
} from "./debug/aiTrace.js";
import {
  beginPerformanceFrame,
  endPerformanceFrame,
  measurePerformance
} from "./debug/performance.js";
import {
  capturePresentationSnapshot,
  getPlayerDisplayValue,
  recordAuthorityPresentationSnapshot,
  recordRemotePresentationSnapshot,
  setPresentationFrameAlpha
} from "./multiplayer/interpolation.js";
import { createSignalingClient } from "./multiplayer/signalingClient.js";
import { isMultiplayerMatch, isSimulationAuthority } from "./multiplayer/matchRuntime.js";
import { resetMultiplayerSessionState } from "./multiplayer/sessionState.js";
import {
  applyReplicationBaseline,
  applyReplicationDelta,
  createReplicationBaseline,
  createReplicationDelta,
  createReplicationStateTracker,
  updateReplicationStateTracker
} from "./multiplayer/stateSnapshot.js";
import { createMultiplayerPeer } from "./multiplayer/webrtcPeer.js";
import { createCanvasRenderer } from "./render/canvasRenderer.js";
import { getSimulationTickDurationSeconds } from "./systems/scheduler.js";
import { stepSimulation } from "./systems/simulation.js";
import { isProductionKind } from "./rules/catalogRules.js";
import {
  clampCamera,
  setCameraCenter,
  setCameraToMapOverview,
  setViewportPadding,
  setViewportSize
} from "./state/camera.js";
import { getOwnedBuildings } from "./state/entities.js";
import { canLocalPlayerIssueCommands, getLocalPlayerId } from "./state/localPlayer.js";
import { getSelectedEntities, setSelectedEntities } from "./state/selection.js";
import { isBuildingUnlocked } from "./rules/catalogRules.js";
import { BUILD_MENU_ITEMS } from "./ui/buildMenuItems.js";
import { createMinimapRenderer, getMinimapWorldPoint } from "./ui/minimap.js";
import { renderPanelHtml } from "./ui/panels.js";

let state = createMenuState();

const canvas = document.querySelector("#battlefield");
const renderer = createCanvasRenderer(canvas);
const minimapCanvas = document.querySelector("#minimap");
const minimapRenderer = createMinimapRenderer(minimapCanvas);
createInputController(canvas, () => state, dispatchGameplayCommand);

const matchTimeElement = document.querySelector("#match-time");
const matchStatusElement = document.querySelector("#match-status");
const territoryStatusElement = document.querySelector("#territory-status");
const scorePanelElement = document.querySelector("#score-panel");
const performancePanelElement = document.querySelector("#performance-panel");
const researchLauncherElement = document.querySelector("#research-launcher");
const matchPanelTitleElement = document.querySelector("#match-panel-title");
const scorePanelTitleElement = document.querySelector("#score-panel-title");
const bottomSelectionElement = document.querySelector("#bottom-selection");
const bottomContextElement = document.querySelector("#bottom-context");
const menuOverlayElement = document.querySelector("#menu-overlay");
const gameplayStageElement = document.querySelector(".gameplay-stage");
const topLeftHudElement = document.querySelector(".hud-top-left");
const topCenterHudElement = document.querySelector(".hud-top-center");
const topRightHudElement = document.querySelector(".hud-top-right");
const debugHudElement = document.querySelector(".hud-debug");
const bottomHudElement = document.querySelector(".hud-bottom");
const gameplayHudElements = [
  topLeftHudElement,
  topCenterHudElement,
  topRightHudElement,
  debugHudElement,
  bottomHudElement
];
const panelHtmlCache = {
  matchTime: "",
  matchStatus: "",
  researchLauncher: "",
  territoryStatus: "",
  scorePanel: "",
  performancePanel: "",
  bottomSelection: "",
  bottomContext: "",
  menuOverlay: "",
  researchModalStatus: "",
  researchModalQueue: "",
  researchModalTree: ""
};
let activeMinimapPointerId = null;
let simulationAccumulatorSeconds = 0;
const SNAPSHOT_SEND_INTERVAL_TICKS = 2;
const MENU_RENDER_INTERVAL_MS = 250;
const OVERLAY_RENDER_INTERVAL_MS = 100;
let signalingClient = null;
let multiplayerPeer = null;
let replicationState = null;
let lastSceneRenderTime = Number.NEGATIVE_INFINITY;
let activeResearchPanPointerId = null;
let activeResearchPanElement = null;
let lastResearchPanClientPoint = null;
window.__swarmbattleGameState = state;

resizeCanvas();
window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", handleWindowKeyDown);
document.addEventListener("click", handleDocumentClick);
document.addEventListener("input", handleDocumentInput);
document.addEventListener("pointerdown", handleDocumentPointerDown);
document.addEventListener("pointermove", handleDocumentPointerMove);
document.addEventListener("pointerup", handleDocumentPointerUp);
document.addEventListener("pointercancel", handleDocumentPointerUp);
document.addEventListener("wheel", handleDocumentWheel, { passive: false });

let lastFrameTime = performance.now();
requestAnimationFrame(frame);

function frame(currentTime) {
  window.__swarmbattleGameState = state;
  const resized = syncCanvasSizeToStage();

  const elapsedSeconds = Math.min((currentTime - lastFrameTime) / 1000, 0.25);
  lastFrameTime = currentTime;

  beginPerformanceFrame(state, elapsedSeconds);
  measurePerformance(state, "simulation.total", () => {
    const fixedSimulationTickSeconds = getSimulationTickDurationSeconds(state);
    simulationAccumulatorSeconds += elapsedSeconds;
    while (simulationAccumulatorSeconds >= fixedSimulationTickSeconds) {
      if (isSimulationAuthority(state)) {
        recordAuthorityPresentationSnapshot(state);
      }
      stepSimulation(state, fixedSimulationTickSeconds);
      if (shouldBroadcastAuthoritativeState()) {
        broadcastAuthoritativeReplicationDelta();
      }
      simulationAccumulatorSeconds -= fixedSimulationTickSeconds;
    }
  });
  setPresentationFrameAlpha(state, simulationAccumulatorSeconds / getSimulationTickDurationSeconds(state));
  resolvePendingPlacedBuildingSelection(state);

  if (state.uiScreen === "playing" && state.uiMode === "place_building") {
    measurePerformance(state, "ui.placementHint", () => {
      state.interactionHint = describePlacementValidity(state);
    });
  } else if (state.uiScreen !== "playing") {
    state.interactionHint = "";
  }

  measurePerformance(state, "ui.panels", () => {
    renderPanels();
  });
  if (shouldRenderScene(state, currentTime, resized)) {
    measurePerformance(state, "render.total", () => {
      renderer.render(state);
    });
    lastSceneRenderTime = currentTime;
  }
  minimapRenderer.render(state, currentTime);
  endPerformanceFrame(state);
  requestAnimationFrame(frame);
}

function handleDocumentClick(event) {
  const uiButton = event.target.closest("[data-action]");
  if (!uiButton) {
    return;
  }

  handleUiAction(uiButton.dataset.action, uiButton.dataset.value ?? null);
}

function handleUiAction(action, value) {
  if (action === "open-new-game") {
    openSetupMenu("standard");
    return;
  }

  if (action === "open-multiplayer-host") {
    openSetupMenu("multiplayer_host");
    return;
  }

  if (action === "open-multiplayer-join") {
    openSetupMenu("multiplayer_client");
    return;
  }

  if (action === "start-ai-test-match") {
    openSetupMenu("ai_test");
    return;
  }

  if (action === "select-map") {
    state.menuSetup.mapId = value;
    return;
  }

  if (action === "select-difficulty") {
    state.menuSetup.difficultyId = value;
    return;
  }

  if (action === "start-match") {
    if (state.menuSetup.mode === "multiplayer_host") {
      startMultiplayerMatchAsHost();
      return;
    }

    disconnectMultiplayerSession();
    clearAiTraceEntries();
    state = createInitialGameState({ menuSetup: state.menuSetup });
    simulationAccumulatorSeconds = 0;
    resizeCanvas();
    setCameraToMapOverview(state);
    return;
  }

  if (action === "resume-match") {
    if (state.hasActiveMatch && !state.matchEnded) {
      state.uiScreen = "playing";
    }
    return;
  }

  if (action === "back-from-setup") {
    closeSetupMenu();
    return;
  }

  if (action === "join-multiplayer-lobby") {
    beginMultiplayerSession("guest");
    return;
  }

  if (action === "copy-lobby-code") {
    copyLobbyCodeToClipboard();
    return;
  }

  if (action === "toggle-ai-trace-controls") {
    state.showAiTraceControls = !state.showAiTraceControls;
    return;
  }

  if (action === "toggle-ai-trace-enabled") {
    state.menuSetup.aiTrace.enabled = !state.menuSetup.aiTrace.enabled;
    return;
  }

  if (action === "select-ai-trace-player") {
    state.menuSetup.aiTrace.playerId = value === "all" ? "all" : Number(value);
    return;
  }

  if (action === "apply-ai-trace-preset") {
    state.menuSetup.aiTrace.enabled = true;
    state.menuSetup.aiTrace.categoryIds = getAiTracePresetCategoryIds(value);
    return;
  }

  if (action === "toggle-ai-trace-category") {
    if (!AI_TRACE_CATEGORY_DEFINITIONS.some((category) => category.id === value)) {
      throw new Error(`Unknown AI trace category action: ${value}`);
    }

    const selectedCategoryIds = new Set(state.menuSetup.aiTrace.categoryIds);
    if (selectedCategoryIds.has(value)) {
      selectedCategoryIds.delete(value);
    } else {
      selectedCategoryIds.add(value);
    }

    state.menuSetup.aiTrace.enabled = selectedCategoryIds.size > 0;
    state.menuSetup.aiTrace.categoryIds = AI_TRACE_CATEGORY_DEFINITIONS
      .map((category) => category.id)
      .filter((categoryId) => selectedCategoryIds.has(categoryId));
    return;
  }

  if (action === "clear-ai-trace-selection") {
    state.menuSetup.aiTrace.enabled = false;
    state.menuSetup.aiTrace.playerId = "all";
    state.menuSetup.aiTrace.categoryIds = [];
    return;
  }

  if (action === "download-ai-trace") {
    downloadAiTraceEntries(state);
    return;
  }

  if (action === "clear-ai-trace-buffer") {
    clearAiTraceEntries();
    return;
  }

  if (!canIssueMatchCommands()) {
    if (action === "close-research-modal" || action === "toggle-research-modal") {
      state.showResearchModal = false;
    }
    return;
  }

  const localPlayerId = getLocalPlayerId(state);
  if (!localPlayerId) {
    return;
  }

  const hasResearchAccess = hasConstructedTechCenter(localPlayerId);

  const selectedProductionBuildings = getSelectedPlayerProductionBuildings();

  if (action === "enter-build-mode") {
    state.showResearchModal = false;
    state.uiMode = "place_building";
    state.pendingBuildingId = value;
    state.pendingPlacedBuildingSelection = null;
    state.interactionHint = "Move over the battlefield and left click to place.";
    return;
  }

  if (action === "toggle-research-modal") {
    if (!hasResearchAccess) {
      state.showResearchModal = false;
      return;
    }

    state.showResearchModal = !state.showResearchModal;
    if (state.showResearchModal) {
      cancelPlayerInteractionMode();
    }
    return;
  }

  if (action === "open-research-modal") {
    if (!hasResearchAccess) {
      state.showResearchModal = false;
      return;
    }

    state.showResearchModal = true;
    cancelPlayerInteractionMode();
    return;
  }

  if (action === "close-research-modal") {
    state.showResearchModal = false;
    return;
  }

  if (action === "start-base-upgrade") {
    dispatchGameplayCommand({
      type: getGameplayCommandTypes().START_BASE_UPGRADE,
      playerId: localPlayerId
    });
    return;
  }

  if (action === "start-tech-upgrade") {
    dispatchGameplayCommand({
      type: getGameplayCommandTypes().START_TECH_UPGRADE,
      playerId: localPlayerId
    });
    return;
  }

  if (action === "start-research") {
    dispatchGameplayCommand({
      type: getGameplayCommandTypes().START_RESEARCH,
      playerId: localPlayerId,
      techId: value
    });
    return;
  }

  if (action === "toggle-research-paused") {
    dispatchGameplayCommand({
      type: getGameplayCommandTypes().TOGGLE_RESEARCH_PAUSED,
      playerId: localPlayerId
    });
    return;
  }

  if (action === "cancel-active-research") {
    dispatchGameplayCommand({
      type: getGameplayCommandTypes().CANCEL_ACTIVE_RESEARCH,
      playerId: localPlayerId
    });
    return;
  }

  if (action === "remove-research-queue-item") {
    dispatchGameplayCommand({
      type: getGameplayCommandTypes().REMOVE_RESEARCH_QUEUE_ITEM,
      playerId: localPlayerId,
      queueIndex: Number.parseInt(value, 10)
    });
    return;
  }

  if (action === "activate-production" && selectedProductionBuildings.length > 0) {
    dispatchGameplayCommand({
      type: getGameplayCommandTypes().SET_PRODUCTION_ENABLED,
      playerId: localPlayerId,
      buildingIds: selectedProductionBuildings.map((building) => building.id),
      enabled: true
    });
    return;
  }

  if (action === "deactivate-production" && selectedProductionBuildings.length > 0) {
    dispatchGameplayCommand({
      type: getGameplayCommandTypes().SET_PRODUCTION_ENABLED,
      playerId: localPlayerId,
      buildingIds: selectedProductionBuildings.map((building) => building.id),
      enabled: false
    });
    return;
  }

  if (action === "exit-mode") {
    cancelPlayerInteractionMode();
  }
}

function handleDocumentInput(event) {
  const input = event.target.closest("[data-input]");
  if (!input) {
    return;
  }

  if (input.dataset.input === "lobby-code") {
    state.multiplayerSession.lobbyCodeInput = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  }
}

function renderPanels() {
  const localPlayerId = getLocalPlayerId(state);
  if (!localPlayerId || !hasConstructedTechCenter(localPlayerId)) {
    state.showResearchModal = false;
  }

  syncGameplayHudVisibility();
  syncHudTitles();
  syncMenuOverlayPresentation();

  const panelHtml = renderPanelHtml(state);
  const timeChanged = patchPanel(matchTimeElement, "matchTime", panelHtml.matchTime);
  const matchChanged = patchPanel(matchStatusElement, "matchStatus", panelHtml.matchStatus);
  const researchLauncherChanged = patchPanel(researchLauncherElement, "researchLauncher", panelHtml.researchLauncher);
  const territoryChanged = patchPanel(territoryStatusElement, "territoryStatus", panelHtml.territoryStatus);
  const scoreChanged = patchPanel(scorePanelElement, "scorePanel", panelHtml.scorePanel);
  const performanceChanged = patchPanel(performancePanelElement, "performancePanel", panelHtml.performancePanel);
  const bottomSelectionChanged = patchPanel(bottomSelectionElement, "bottomSelection", panelHtml.bottomSelection);
  const bottomContextChanged = patchPanel(bottomContextElement, "bottomContext", panelHtml.bottomContext);
  const menuChanged = patchPanel(menuOverlayElement, "menuOverlay", panelHtml.menuOverlay);
  const researchStatusElement = document.querySelector("#research-modal-status");
  const researchQueueElement = document.querySelector("#research-modal-queue");
  const researchTreeElement = document.querySelector("#research-modal-tree");
  const researchStatusChanged = patchPanel(researchStatusElement, "researchModalStatus", panelHtml.researchModalStatus);
  const researchQueueChanged = patchPanel(researchQueueElement, "researchModalQueue", panelHtml.researchModalQueue);
  const researchTreeChanged = patchPanel(researchTreeElement, "researchModalTree", panelHtml.researchModalTree);
  debugHudElement.classList.toggle("is-hidden", panelHtml.performancePanel === "");
  const changed =
    timeChanged ||
    matchChanged ||
    researchLauncherChanged ||
    territoryChanged ||
    scoreChanged ||
    performanceChanged ||
    bottomSelectionChanged ||
    bottomContextChanged ||
    menuChanged ||
    researchStatusChanged ||
    researchQueueChanged ||
    researchTreeChanged;

  if (changed) {
    syncViewportPadding();
  }

  syncLiveResearchProgress();
}

function patchPanel(element, cacheKey, html) {
  if (!element) {
    panelHtmlCache[cacheKey] = html;
    return false;
  }

  if (panelHtmlCache[cacheKey] === html) {
    return false;
  }

  panelHtmlCache[cacheKey] = html;
  element.innerHTML = html;
  return true;
}

function syncLiveResearchProgress() {
  const localPlayerId = getLocalPlayerId(state);
  const player = localPlayerId ? state.players.find((candidate) => candidate.id === localPlayerId) : null;
  const activeResearch = player?.activeResearch;
  const launcherBarElement = document.querySelector("[data-live-research-launcher-progress-bar] .progress-bar-fill");
  const launcherLabelElement = document.querySelector("[data-live-research-launcher-progress-label]");
  const statusBarElement = document.querySelector("[data-live-research-status-progress-bar] .progress-bar-fill");
  const statusLabelElement = document.querySelector("[data-live-research-status-progress-label]");

  if (!activeResearch) {
    if (launcherBarElement) {
      launcherBarElement.style.width = "0%";
    }
    if (launcherLabelElement) {
      launcherLabelElement.textContent = "";
    }
    if (statusBarElement) {
      statusBarElement.style.width = "0%";
    }
    if (statusLabelElement) {
      statusLabelElement.textContent = "";
    }
    return;
  }

  const tech = state.catalog.tech[activeResearch.techId];
  const displayProgressSeconds = getPlayerDisplayValue(
    state,
    player,
    "activeResearchProgressSeconds",
    activeResearch.progressSeconds
  );
  const progress = Math.max(0, Math.min(1, displayProgressSeconds / tech.researchTime));
  const progressPercent = `${(progress * 100).toFixed(0)}%`;

  if (launcherBarElement) {
    launcherBarElement.style.width = progressPercent;
  }
  if (launcherLabelElement) {
    launcherLabelElement.textContent = progressPercent;
  }
  if (statusBarElement) {
    statusBarElement.style.width = progressPercent;
  }
  if (statusLabelElement) {
    statusLabelElement.textContent = activeResearch.isPaused ? `Paused at ${progressPercent}` : `${progressPercent} complete`;
  }
}

function resizeCanvas() {
  const resized = syncCanvasSizeToStage();
  if (!resized) {
    syncViewportPadding();
    clampCamera(state);
  }
}

function syncCanvasSizeToStage() {
  const width = gameplayStageElement.clientWidth;
  const height = gameplayStageElement.clientHeight;
  const devicePixelRatio = window.devicePixelRatio || 1;
  const targetCanvasWidth = Math.floor(width * devicePixelRatio);
  const targetCanvasHeight = Math.floor(height * devicePixelRatio);

  syncGameplayHudVisibility();

  if (
    canvas.width === targetCanvasWidth &&
    canvas.height === targetCanvasHeight &&
    state.viewport.width === width &&
    state.viewport.height === height &&
    state.viewport.devicePixelRatio === devicePixelRatio
  ) {
    return false;
  }

  canvas.width = targetCanvasWidth;
  canvas.height = targetCanvasHeight;
  setViewportSize(state, width, height, devicePixelRatio);
  syncViewportPadding();
  clampCamera(state);
  return true;
}

function handleWindowKeyDown(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }

  if (
    (event.key === "t" || event.key === "T") &&
    !isEditableEventTarget(event.target) &&
    ["setup", "paused", "post_match"].includes(state.uiScreen)
  ) {
    state.showAiTraceControls = !state.showAiTraceControls;
    return;
  }

  if (event.key === "`" || event.key === "~") {
    state.showPerformancePanel = !state.showPerformancePanel;
    return;
  }

  if (event.key === "Escape") {
    handleEscapeKey();
    return;
  }

  if (event.key === "Tab") {
    event.preventDefault();
    if (canIssueMatchCommands()) {
      const localPlayerId = getLocalPlayerId(state);
      if (!localPlayerId || !hasConstructedTechCenter(localPlayerId)) {
        state.showResearchModal = false;
        return;
      }

      state.showResearchModal = !state.showResearchModal;
      if (state.showResearchModal) {
        cancelPlayerInteractionMode();
      }
    }
    return;
  }

  handleBuildHotkey(event);
}

function handleBuildHotkey(event) {
  if (!canIssueMatchCommands()) {
    return;
  }

  const buildMenuItem = BUILD_MENU_ITEMS.find(({ key }) => key === event.key);
  if (!buildMenuItem) {
    return;
  }

  const localPlayerId = getLocalPlayerId(state);
  if (!localPlayerId || !isBuildingUnlocked(state, localPlayerId, buildMenuItem.buildingId)) {
    return;
  }

  handleUiAction("enter-build-mode", buildMenuItem.buildingId);
}

function handleEscapeKey() {
  if (state.showResearchModal) {
    state.showResearchModal = false;
    return;
  }

  if (state.uiScreen === "playing") {
    cancelPlayerInteractionMode();
    state.uiScreen = "paused";
    return;
  }

  if (state.uiScreen === "paused") {
    state.uiScreen = "playing";
    return;
  }

  if (state.uiScreen === "setup") {
    closeSetupMenu();
  }
}

function hasConstructedTechCenter(playerId) {
  return getOwnedBuildings(state, playerId, "tech_structure").some((building) => building.isConstructed);
}

function cancelPlayerInteractionMode() {
  state.uiMode = "select";
  state.pendingBuildingId = null;
  state.pendingPlacedBuildingSelection = null;
  state.interactionHint = "";
}

function openSetupMenu(mode = "standard") {
  cancelPlayerInteractionMode();
  state.showResearchModal = false;
  state.showAiTraceControls = false;
  disconnectMultiplayerSession();
  state.menuSetup.mode = mode;
  state.menuSetup.localPlayerId = mode === "multiplayer_client" ? 2 : 1;
  state.setupReturnScreen = state.uiScreen === "paused"
    ? "paused"
    : state.uiScreen === "post_match"
      ? "post_match"
      : "main_menu";
  state.uiScreen = "setup";

  if (mode === "multiplayer_host") {
    beginMultiplayerSession("host");
  }
}

function closeSetupMenu() {
  if (state.menuSetup.mode === "multiplayer_host" || state.menuSetup.mode === "multiplayer_client") {
    disconnectMultiplayerSession();
  }

  state.uiScreen = state.setupReturnScreen ?? "main_menu";
}

function isEditableEventTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function getSelectedPlayerProductionBuildings() {
  const localPlayerId = getLocalPlayerId(state);
  return getSelectedEntities(state).filter((entity) => {
    return entity.type === "building" && entity.ownerId === localPlayerId && isProductionKind(entity.kind);
  });
}

function canIssueMatchCommands() {
  return canLocalPlayerIssueCommands(state);
}

function syncGameplayHudVisibility() {
  const visible = state.hasActiveMatch;
  const showBottomHud = visible && state.matchConfig?.mode !== "ai_test";

  for (const element of gameplayHudElements) {
    element.style.display = visible ? "" : "none";
  }
  bottomHudElement.style.display = showBottomHud ? "" : "none";

  menuOverlayElement.parentElement.style.display = "";
}

function syncHudTitles() {
  if (!matchPanelTitleElement || !scorePanelTitleElement) {
    return;
  }

  if (state.matchConfig?.mode === "ai_test") {
    matchPanelTitleElement.textContent = "Player 1";
    scorePanelTitleElement.textContent = "Player 2";
    return;
  }

  matchPanelTitleElement.textContent = "Status";
  scorePanelTitleElement.textContent = "Score";
}

function handleDocumentPointerDown(event) {
  const researchCanvas = event.target.closest("[data-research-canvas]");
  if (researchCanvas && state.showResearchModal && event.button === 0 && !event.target.closest("[data-action]")) {
    event.preventDefault();
    activeResearchPanPointerId = event.pointerId;
    activeResearchPanElement = researchCanvas;
    lastResearchPanClientPoint = { x: event.clientX, y: event.clientY };
    researchCanvas.setPointerCapture?.(event.pointerId);
    return;
  }

  const minimapSurface = event.target.closest("#minimap");
  if (!minimapSurface || !state.hasActiveMatch || state.uiScreen !== "playing") {
    return;
  }

  event.preventDefault();
  activeMinimapPointerId = event.pointerId;
  if (minimapSurface.setPointerCapture) {
    minimapSurface.setPointerCapture(event.pointerId);
  }
  centerCameraFromMinimapPointer(event, minimapSurface);
}

function handleDocumentPointerMove(event) {
  if (activeResearchPanPointerId === event.pointerId && lastResearchPanClientPoint) {
    state.researchView.panX += event.clientX - lastResearchPanClientPoint.x;
    state.researchView.panY += event.clientY - lastResearchPanClientPoint.y;
    lastResearchPanClientPoint = { x: event.clientX, y: event.clientY };
    return;
  }

  if (activeMinimapPointerId !== event.pointerId) {
    return;
  }

  const minimapSurface = document.querySelector("#minimap");
  if (!minimapSurface) {
    return;
  }

  centerCameraFromMinimapPointer(event, minimapSurface);
}

function handleDocumentPointerUp(event) {
  if (activeResearchPanPointerId === event.pointerId) {
    if (activeResearchPanElement?.hasPointerCapture?.(event.pointerId)) {
      activeResearchPanElement.releasePointerCapture(event.pointerId);
    }
    activeResearchPanPointerId = null;
    activeResearchPanElement = null;
    lastResearchPanClientPoint = null;
    return;
  }

  if (activeMinimapPointerId !== event.pointerId) {
    return;
  }

  const minimapSurface = document.querySelector("#minimap");
  if (minimapSurface?.hasPointerCapture?.(event.pointerId)) {
    minimapSurface.releasePointerCapture(event.pointerId);
  }
  activeMinimapPointerId = null;
}

function centerCameraFromMinimapPointer(event, minimapSurface) {
  const worldPoint = getMinimapWorldPoint(state, minimapSurface, event.clientX, event.clientY);
  setCameraCenter(state, worldPoint.x, worldPoint.y);
  state.mouseWorldPosition = worldPoint;
}

function handleDocumentWheel(event) {
  const researchCanvas = event.target.closest("[data-research-canvas]");
  if (!researchCanvas || !state.showResearchModal) {
    return;
  }

  event.preventDefault();
  const rect = researchCanvas.getBoundingClientRect();
  const viewportX = event.clientX - rect.left;
  const viewportY = event.clientY - rect.top;
  const currentZoom = state.researchView.zoom;
  const nextZoom = clampValue(currentZoom * Math.exp(-event.deltaY * 0.0012), 0.45, 1.8);
  const contentX = (viewportX - state.researchView.panX) / currentZoom;
  const contentY = (viewportY - state.researchView.panY) / currentZoom;

  state.researchView.zoom = nextZoom;
  state.researchView.panX = viewportX - contentX * nextZoom;
  state.researchView.panY = viewportY - contentY * nextZoom;
}

function syncMenuOverlayPresentation() {
  const menuScreenActive = state.showResearchModal || ["main_menu", "setup", "paused", "post_match"].includes(state.uiScreen);
  const pauseScreenActive = state.uiScreen === "paused";
  const overlayElement = menuOverlayElement.parentElement;

  overlayElement.classList.toggle("is-modal", menuScreenActive);
  overlayElement.classList.toggle("is-pause-modal", pauseScreenActive);
  overlayElement.classList.toggle("is-research-modal", state.showResearchModal);
  bottomHudElement.classList.toggle("is-pause-blurred", pauseScreenActive);
}

function syncViewportPadding() {
  setViewportPadding(state, { left: 0, right: 0, top: 0, bottom: 0 });
}

function copyLobbyCodeToClipboard() {
  const session = state.multiplayerSession;
  const lobbyCode = (session.lobbyCode || session.lobbyCodeInput).trim().toUpperCase();
  if (!lobbyCode) {
    return;
  }

  if (!navigator.clipboard?.writeText) {
    session.lastError = "Clipboard API is unavailable in this browser.";
    return;
  }

  navigator.clipboard.writeText(lobbyCode)
    .then(() => {
      session.statusMessage = `Lobby code ${lobbyCode} copied to clipboard.`;
      session.lastError = "";
    })
    .catch(() => {
      session.lastError = "Failed to copy lobby code to clipboard.";
    });
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function beginMultiplayerSession(role) {
  const session = state.multiplayerSession;
  if (session.connectionState === "connecting") {
    return;
  }

  const preservedUrl = session.signalingUrl;
  const preservedCodeInput = session.lobbyCodeInput;
  disconnectMultiplayerSession();
  resetMultiplayerSessionState(session);
  session.connectionState = "connecting";
  session.connectionIntent = role;
  session.signalingUrl = preservedUrl || session.signalingUrl;
  if (role === "guest") {
    session.lobbyCodeInput = preservedCodeInput.trim().toUpperCase();
  } else {
    session.lobbyCodeInput = preservedCodeInput;
  }
  session.statusMessage = role === "host"
    ? "Connecting to signaling server and creating lobby..."
    : "Connecting to signaling server and joining lobby...";

  const signalingUrl = session.signalingUrl;
  const requestedCode = session.lobbyCodeInput;
  try {
    signalingClient = createSignalingClient(signalingUrl, {
      onOpen() {
        session.lastError = "";
        if (role === "host") {
          signalingClient.send({ type: "create_lobby" });
          return;
        }

        signalingClient.send({
          type: "join_lobby",
          code: requestedCode
        });
      },
      onClose() {
        handleSignalingClosed();
      },
      onError(message) {
        session.lastError = message;
      },
      onMessage(message) {
        handleSignalingMessage(message);
      }
    });
  } catch (error) {
    disconnectMultiplayerSession({
      closeSocket: false,
      lastError: error instanceof Error ? error.message : "Invalid signaling URL."
    });
  }
}

function handleSignalingMessage(message) {
  const session = state.multiplayerSession;

  if (message.type === "hello") {
    session.clientId = message.clientId;
    return;
  }

  if (message.type === "lobby_created") {
    session.connectionState = "connected";
    session.role = "host";
    session.playerId = message.playerId;
    session.lobbyCode = message.code;
    session.transportState = "waiting_for_peer";
    session.matchStarted = false;
    session.statusMessage = `Lobby ${message.code} created. Share this code with the other player.`;
    state.menuSetup.localPlayerId = message.playerId;
    return;
  }

  if (message.type === "lobby_joined") {
    session.connectionState = "connected";
    session.role = "guest";
    session.playerId = message.playerId;
    session.lobbyCode = message.code;
    session.peerJoined = true;
    session.transportState = "waiting_for_offer";
    session.matchStarted = false;
    session.statusMessage = `Joined lobby ${message.code}. Waiting for host WebRTC offer.`;
    state.menuSetup.localPlayerId = message.playerId;
    ensureMultiplayerPeer(false);
    return;
  }

  if (message.type === "peer_joined") {
    session.peerJoined = true;
    session.transportState = "negotiating";
    session.matchStarted = false;
    session.statusMessage = `Guest connected to lobby ${message.code}. Negotiating WebRTC transport...`;
    ensureMultiplayerPeer(true);
    startHostPeerNegotiation();
    return;
  }

  if (message.type === "peer_left") {
    session.peerJoined = false;
    session.transportState = "waiting_for_peer";
    session.channelState = "closed";
    session.iceConnectionState = "new";
    session.matchStarted = false;
    closeMultiplayerPeer();
    session.statusMessage = "Guest disconnected from the lobby.";
    return;
  }

  if (message.type === "peer_message") {
    ensureMultiplayerPeer(session.role === "host");
    applyPeerSignal(message.payload);
    return;
  }

  if (message.type === "lobby_closed") {
    disconnectMultiplayerSession({
      closeSocket: true,
      statusMessage: message.reason,
      lastError: message.reason
    });
    return;
  }

  if (message.type === "error") {
    disconnectMultiplayerSession({
      closeSocket: true,
      lastError: message.message
    });
  }
}

function handleSignalingClosed() {
  const session = state.multiplayerSession;
  if (session.connectionState === "disconnected") {
    return;
  }

  const previousLobbyCode = session.lobbyCode;
  const previousUrl = session.signalingUrl;
  const previousInput = session.lobbyCodeInput;
  resetMultiplayerSessionState(session, false);
  session.signalingUrl = previousUrl;
  session.lobbyCodeInput = previousInput;
  session.lobbyCode = previousLobbyCode;
  session.transportState = "idle";
  session.channelState = "closed";
  session.iceConnectionState = "closed";
  session.statusMessage = "Disconnected from signaling server.";
}

function disconnectMultiplayerSession(options = true) {
  const normalizedOptions = typeof options === "boolean"
    ? { closeSocket: options }
    : {
        closeSocket: options.closeSocket ?? true,
        statusMessage: options.statusMessage ?? "",
        lastError: options.lastError ?? ""
      };
  const session = state.multiplayerSession;
  const previousUrl = session.signalingUrl;
  const previousInput = session.lobbyCodeInput;
  closeMultiplayerPeer();
  replicationState = null;

  if (normalizedOptions.closeSocket && signalingClient) {
    signalingClient.close();
  }

  signalingClient = null;
  resetMultiplayerSessionState(session, false);
  session.signalingUrl = previousUrl;
  session.lobbyCodeInput = previousInput;
  session.statusMessage = normalizedOptions.statusMessage;
  session.lastError = normalizedOptions.lastError;
}

function ensureMultiplayerPeer(isHost) {
  if (multiplayerPeer) {
    return multiplayerPeer;
  }

  const session = state.multiplayerSession;
  session.transportState = "negotiating";
  multiplayerPeer = createMultiplayerPeer({
    isHost,
    onSignal(payload) {
      signalingClient?.send({
        type: "relay_peer_message",
        payload
      });
    },
    onConnectionStateChange(connectionState) {
      session.transportState = resolveTransportStateFromConnection(connectionState, session);
      if (connectionState === "connected") {
        session.statusMessage = "WebRTC peer connection established.";
      }

      if (connectionState === "failed" || connectionState === "disconnected" || connectionState === "closed") {
        session.lastError = `Peer connection ${connectionState}.`;
      }
    },
    onIceConnectionStateChange(iceConnectionState) {
      session.iceConnectionState = iceConnectionState;
    },
    onChannelStateChange(channelState) {
      session.channelState = channelState;
    },
    onOpen() {
      session.transportState = "ready";
      session.matchReady = true;
      session.statusMessage = "WebRTC data channel connected.";
    },
    onClose() {
      session.transportState = session.peerJoined ? "negotiating" : "idle";
      session.channelState = "closed";
      session.matchReady = false;
      session.matchStarted = false;
      session.lastTransportMessage = "";
    },
    onMessage(payload) {
      handlePeerDataMessage(payload);
    },
    onError(message) {
      session.lastError = message;
    }
  });

  return multiplayerPeer;
}

async function startHostPeerNegotiation() {
  try {
    ensureMultiplayerPeer(true);
    await multiplayerPeer.startAsHost();
  } catch (error) {
    state.multiplayerSession.lastError = error instanceof Error ? error.message : "Failed to create WebRTC offer.";
  }
}

async function applyPeerSignal(payload) {
  try {
    if (!multiplayerPeer) {
      ensureMultiplayerPeer(state.multiplayerSession.role === "host");
    }

    await multiplayerPeer.applySignal(payload);
  } catch (error) {
    state.multiplayerSession.lastError = error instanceof Error ? error.message : "Failed to apply peer signal.";
  }
}

function closeMultiplayerPeer() {
  multiplayerPeer?.close();
  multiplayerPeer = null;
}

function resolveTransportStateFromConnection(connectionState, session) {
  if (session.channelState === "open") {
    return "ready";
  }

  if (connectionState === "connected") {
    return "connected";
  }

  if (connectionState === "failed" || connectionState === "disconnected" || connectionState === "closed") {
    return session.peerJoined ? "negotiating" : "idle";
  }

  return "negotiating";
}

function dispatchGameplayCommand(command) {
  if (isSimulationAuthority(state) || !isMultiplayerMatch(state)) {
    queueGameplayCommand(state, command);
    return;
  }

  try {
    multiplayerPeer?.send({
      type: "gameplay_command",
      command
    });
  } catch (error) {
    state.multiplayerSession.lastError = error instanceof Error ? error.message : "Failed to send gameplay command.";
  }
}

function resolvePendingPlacedBuildingSelection(state) {
  const pendingSelection = state.pendingPlacedBuildingSelection;
  if (!pendingSelection) {
    return;
  }

  const placedBuilding = state.entities.find((entity) => {
    return entity.type === "building" &&
      entity.ownerId === pendingSelection.ownerId &&
      entity.definitionId === pendingSelection.definitionId &&
      entity.x === pendingSelection.point.x &&
      entity.y === pendingSelection.point.y;
  });

  if (!placedBuilding) {
    return;
  }

  setSelectedEntities(state, [placedBuilding.id], placedBuilding.id);
  state.pendingPlacedBuildingSelection = null;
}

function handlePeerDataMessage(payload) {
  const session = state.multiplayerSession;

  if (payload.type === "hello") {
    session.lastTransportMessage = `Peer said hello as ${payload.role}.`;
    return;
  }

  if (payload.type === "start_match") {
    session.matchStarted = true;
    session.statusMessage = "Host started the multiplayer match.";
    startMultiplayerMatchAsGuest(payload.menuSetup);
    return;
  }

  if (payload.type === "gameplay_command") {
    if (!isSimulationAuthority(state)) {
      return;
    }

    queueGameplayCommand(state, payload.command);
    return;
  }

  if (payload.type === "state_snapshot") {
    return;
  }

  if (payload.type === "replication_baseline") {
    if (isSimulationAuthority(state)) {
      return;
    }

    const previousPresentationSnapshot = capturePresentationSnapshot(state);
    applyReplicationBaseline(state, payload.baseline);
    recordRemotePresentationSnapshot(state, previousPresentationSnapshot, performance.now());
    session.lastSnapshotTick = payload.baseline.tick;
    session.lastTransportMessage = `Applied replication baseline tick ${payload.baseline.tick}.`;
    return;
  }

  if (payload.type === "replication_delta") {
    if (isSimulationAuthority(state)) {
      return;
    }

    const previousPresentationSnapshot = capturePresentationSnapshot(state);
    applyReplicationDelta(state, payload);
    recordRemotePresentationSnapshot(state, previousPresentationSnapshot, performance.now());
    session.lastSnapshotTick = payload.match.tick;
    session.lastTransportMessage = `Applied replication delta tick ${payload.match.tick}.`;
    return;
  }

  session.lastTransportMessage = JSON.stringify(payload);
}

function startMultiplayerMatchAsHost() {
  if (!multiplayerPeer || state.multiplayerSession.channelState !== "open") {
    return;
  }

  const session = state.multiplayerSession;
  clearAiTraceEntries();
  const nextState = createInitialGameState({
    menuSetup: {
      ...state.menuSetup,
      mode: "multiplayer_host",
      localPlayerId: 1
    }
  });
  nextState.multiplayerSession = session;
  state = nextState;
  simulationAccumulatorSeconds = 0;
  resizeCanvas();
  setCameraToMapOverview(state);
  replicationState = createReplicationStateTracker(state);
  session.matchStarted = true;
  session.statusMessage = "Multiplayer match started. You are the authority host.";

  try {
    multiplayerPeer.send({
      type: "start_match",
      menuSetup: {
        mapId: state.menuSetup.mapId,
        mode: "multiplayer_client",
        localPlayerId: 2
      }
    });
    multiplayerPeer.send({
      type: "replication_baseline",
      baseline: createReplicationBaseline(state)
    });
    updateReplicationStateTracker(state, replicationState);
  } catch (error) {
    session.lastError = error instanceof Error ? error.message : "Failed to start multiplayer match.";
  }
}

function startMultiplayerMatchAsGuest(menuSetup) {
  const session = state.multiplayerSession;
  clearAiTraceEntries();
  const nextState = createInitialGameState({
    menuSetup: {
      ...state.menuSetup,
      ...menuSetup,
      mode: "multiplayer_client",
      localPlayerId: 2
    }
  });
  nextState.multiplayerSession = session;
  state = nextState;
  simulationAccumulatorSeconds = 0;
  resizeCanvas();
  setCameraToMapOverview(state);
  replicationState = null;
  session.matchStarted = true;
  session.statusMessage = "Multiplayer match started. Waiting for host snapshots.";
}

function shouldBroadcastAuthoritativeState() {
  return (
    multiplayerPeer &&
    state.multiplayerSession.matchStarted &&
    isSimulationAuthority(state) &&
    isMultiplayerMatch(state) &&
    state.multiplayerSession.channelState === "open" &&
    state.simulation.currentTick % SNAPSHOT_SEND_INTERVAL_TICKS === 0
  );
}

function broadcastAuthoritativeReplicationDelta() {
  try {
    if (!replicationState) {
      replicationState = createReplicationStateTracker(state);
    }

    multiplayerPeer.send({
      ...createReplicationDelta(state, replicationState)
    });
    updateReplicationStateTracker(state, replicationState);
  } catch (error) {
    state.multiplayerSession.lastError = error instanceof Error ? error.message : "Failed to broadcast authoritative replication delta.";
  }
}

function shouldRenderScene(state, currentTime, resized) {
  if (resized) {
    return true;
  }

  const renderIntervalMs = getSceneRenderIntervalMs(state);
  if (renderIntervalMs === 0) {
    return true;
  }

  return currentTime - lastSceneRenderTime >= renderIntervalMs;
}

function getSceneRenderIntervalMs(state) {
  if (state.hasActiveMatch && state.uiScreen === "playing") {
    return 0;
  }

  if (state.hasActiveMatch) {
    return OVERLAY_RENDER_INTERVAL_MS;
  }

  return MENU_RENDER_INTERVAL_MS;
}
