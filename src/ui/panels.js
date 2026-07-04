import {
  canResearchTech,
  canUpgradeBase,
  canUpgradeTech
} from "../gameState.js";
import {
  getBuildingAvailability,
  getBuildingCost,
  getConstructedTechCenterLevel,
  getProducedUnitId,
  getProductionBatchSize,
  getProductionCycleTime,
  getResearchCost,
  getResearchRequiredTechCenterLevel,
  isProductionKind
} from "../rules/catalogRules.js";
import {
  getOwnedBuildings,
  isPlayerOwnedEntity
} from "../state/entities.js";
import {
  canLocalPlayerIssueCommands,
  getLocalPlayer,
  getLocalPlayerId,
  isLocalPlayerEntity,
  isObserverMode
} from "../state/localPlayer.js";
import { getEntityDisplayValue, getPlayerDisplayValue } from "../multiplayer/interpolation.js";
import { getSelectedEntities } from "../state/selection.js";
import { BUILD_MENU_ITEMS } from "./buildMenuItems.js";
import { renderMenuOverlay } from "./menuPanel.js";
import {
  renderMatchStatus,
  renderMatchTime,
  renderPerformancePanel,
  renderScorePanel,
  renderTerritoryStatus
} from "./statusPanels.js";

const TECH_BRANCH_NODE_WIDTH = 188;
const TECH_BRANCH_NODE_HEIGHT = 104;
const TECH_BRANCH_COLUMN_SPACING = 208;
const TECH_BRANCH_ROW_SPACING = 136;
const TECH_BRANCH_PADDING_X = 18;
const TECH_BRANCH_PADDING_Y = 16;

export function renderPanelHtml(state) {
  const researchModalVisible = state.showResearchModal;
  return {
    matchTime: renderMatchTime(state),
    matchStatus: renderMatchStatus(state),
    researchLauncher: renderResearchLauncher(state),
    territoryStatus: renderTerritoryStatus(state),
    scorePanel: renderScorePanel(state),
    performancePanel: renderPerformancePanel(state),
    bottomSelection: renderBottomSelectionPanel(state),
    bottomContext: renderBottomContextPanel(state),
    menuOverlay: researchModalVisible ? renderResearchModalShell() : renderMenuOverlay(state),
    researchModalStatus: researchModalVisible ? renderResearchStatus(state) : "",
    researchModalQueue: researchModalVisible ? renderResearchQueuePanel(state) : "",
    researchModalTree: researchModalVisible ? renderResearchTreePanel(state) : ""
  };
}

function renderBottomSelectionPanel(state) {
  if (!state.hasActiveMatch) {
    return "";
  }

  const selectedEntities = getSelectedEntities(state);
  if (selectedEntities.length === 0) {
    return `<div class="meta">No selection.</div>`;
  }

  if (selectedEntities.length === 1) {
    return renderSingleSelectionSummary(state, selectedEntities[0]);
  }

  return renderMultiSelectionSummary(state, selectedEntities);
}

function renderBottomContextPanel(state) {
  if (!state.hasActiveMatch) {
    return "";
  }

  if (isObserverMode(state)) {
    return `<div class="meta">Observer mode. Commands are disabled.</div>`;
  }

  const selectedEntities = getSelectedEntities(state);
  if (selectedEntities.length === 0) {
    return renderDefaultCommandDeck(state);
  }

  const controlsDisabled = !canIssueMatchCommands(state);
  if (selectedEntities.length === 1) {
    return renderSingleSelectionCommands(state, selectedEntities[0], controlsDisabled);
  }

  return renderMultiSelectionCommands(state, selectedEntities, controlsDisabled);
}

function renderSingleSelectionSummary(state, selected) {
  if (selected.type === "unit") {
    const unitDefinition = state.catalog.units[selected.definitionId];
    return `
      <div class="stack">
        <div><span class="badge">Unit</span> ${unitDefinition.displayName}</div>
        <div class="meta">Health: ${Math.ceil(getEntityDisplayValue(state, selected, "health", selected.health))} / ${selected.maxHealth}</div>
      </div>
    `;
  }

  const buildingDefinition = state.catalog.buildings[selected.definitionId];
  const localPlayerId = getLocalPlayerId(state);
  const playerOwned = localPlayerId ? isPlayerOwnedEntity(state, selected.id, localPlayerId) : false;
  const details = [
    `<div><span class="badge">Building</span> ${buildingDefinition.displayName}</div>`,
    `<div class="meta">Health: ${Math.ceil(getEntityDisplayValue(state, selected, "health", selected.health))} / ${selected.maxHealth}</div>`
  ];

  if (!selected.isConstructed) {
    details.push(`<div class="meta">Under construction</div>`);
  }

  if (isProductionKind(buildingDefinition.kind)) {
    const producedUnitId = getProducedUnitId(buildingDefinition);
    const unitDefinition = state.catalog.units[producedUnitId];
    const batchSize = getProductionBatchSize(buildingDefinition);
    const cycleTime = getProductionCycleTime(buildingDefinition, unitDefinition);
    details.push(`<div class="meta">Production: ${selected.enabled ? "active" : "inactive"}</div>`);
    details.push(`<div class="meta">Produces: ${batchSize} ${unitDefinition.displayName}${batchSize === 1 ? "" : " units"} per ${cycleTime}s</div>`);
  }

  if (buildingDefinition.kind === "base" && playerOwned) {
    const player = getLocalPlayer(state);
    const currentTier = state.catalog.baseTiers[player.baseTier];
    details.push(`<div class="meta">Base tier: ${currentTier.displayName}</div>`);
  }

  if (buildingDefinition.supportsResearch && playerOwned && selected.isConstructed) {
    details.push(`<div class="meta">Research hub online</div>`);
  }

  return `<div class="stack">${details.join("")}</div>`;
}

function renderMultiSelectionSummary(state, selectedEntities) {
  const selectedBuildings = selectedEntities.filter((entity) => entity.type === "building");
  if (selectedBuildings.length !== selectedEntities.length) {
    return `
      <div class="stack">
        <div><span class="badge">Selection</span> ${selectedEntities.length} entities</div>
        <div class="meta">Mixed unit and building selection.</div>
      </div>
    `;
  }

  const playerOwnedBuildings = selectedBuildings.filter((building) => building.ownerId === getLocalPlayerId(state));
  const enemyBuildingCount = selectedBuildings.length - playerOwnedBuildings.length;
  const typeIds = [...new Set(selectedBuildings.map((building) => building.definitionId))];
  const selectionLabel = typeIds.length === 1
    ? state.catalog.buildings[typeIds[0]].displayName
    : "Mixed building selection";
  const averageHealthPercent = selectedBuildings.reduce((sum, building) => {
    return sum + getEntityDisplayValue(state, building, "health", building.health) / building.maxHealth;
  }, 0) / selectedBuildings.length;

  return `
    <div class="stack">
      <div><span class="badge">Selection</span> ${selectedBuildings.length} buildings</div>
      <div class="meta">${selectionLabel}</div>
      <div class="meta">Average health: ${(averageHealthPercent * 100).toFixed(0)}%</div>
      <div class="meta">Player-owned: ${playerOwnedBuildings.length}</div>
      ${enemyBuildingCount > 0 ? `<div class="meta">Enemy buildings: ${enemyBuildingCount}</div>` : ""}
    </div>
  `;
}

function renderDefaultCommandDeck(state) {
  return `
    <div class="stack">
      <div class="command-deck-body">${renderBuildDeck(state)}</div>
    </div>
  `;
}

function renderBuildDeck(state) {
  const commandsDisabled = !canIssueMatchCommands(state);
  const localPlayerId = getLocalPlayerId(state);
  const buttons = BUILD_MENU_ITEMS.map(({ key, buildingId }) => {
    const definition = state.catalog.buildings[buildingId];
    const cost = localPlayerId ? getBuildingCost(state, localPlayerId, buildingId) : 0;
    const active = state.uiMode === "place_building" && state.pendingBuildingId === buildingId;
    const availability = localPlayerId
      ? getBuildingAvailability(state, localPlayerId, buildingId)
      : { unlocked: false, reason: "Unavailable" };
    const unlocked = availability.unlocked;
    const disabled = commandsDisabled || !unlocked;

    return `
      <button
        type="button"
        data-action="enter-build-mode"
        data-value="${buildingId}"
        class="command-card ${active ? "is-active" : ""} ${unlocked ? "" : "is-locked"}"
        title="${escapeAttribute(formatBuildingTooltip(state, definition, cost))}"
        ${disabled ? "disabled" : ""}
      >
        <span class="badge">${key}</span>
        ${unlocked ? "" : `<span class="command-card-lock" aria-hidden="true">🔒</span>`}
        <span class="command-card-title">${definition.displayName}</span>
        <span class="command-card-meta">${cost} resources</span>
        <span class="command-card-meta">${availability.reason}</span>
      </button>
    `;
  }).join("");

  return `
    <div class="stack">
      <div class="command-card-grid">${buttons}</div>
    </div>
  `;
}

function renderResearchStatus(state) {
  const player = getLocalPlayer(state);
  const commandsDisabled = !canIssueMatchCommands(state);
  const activeResearch = player?.activeResearch
      ? (() => {
          const tech = state.catalog.tech[player.activeResearch.techId];
          return `
            <div class="meta">Researching ${tech.displayName}${player.activeResearch.isPaused ? " (Paused)" : ""}</div>
            <div class="progress-bar" data-live-research-status-progress-bar>
              <div class="progress-bar-fill"></div>
            </div>
            <div class="meta" data-live-research-status-progress-label></div>
            <div class="row">
              <button type="button" data-action="toggle-research-paused" ${commandsDisabled ? "disabled" : ""}>
                ${player.activeResearch.isPaused ? "Resume" : "Pause"}
              </button>
              <button type="button" data-action="cancel-active-research" ${commandsDisabled ? "disabled" : ""}>Remove</button>
            </div>
          `;
        })()
    : `<div class="meta">No active research.</div>`;

  return `
    <div class="meta">Active research</div>
    ${activeResearch}
  `;
}

function renderResearchQueuePanel(state) {
  const player = getLocalPlayer(state);
  const commandsDisabled = !canIssueMatchCommands(state);
  return renderResearchQueue(state, player, commandsDisabled);
}

function renderResearchTreePanel(state) {
  const player = getLocalPlayer(state);
  const commandsDisabled = !canIssueMatchCommands(state);
  const localPlayerId = getLocalPlayerId(state);
  const branchColumns = [...state.catalog.techBranchDefinitions]
    .sort((left, right) => left.order - right.order)
    .map((branchDefinition) => renderResearchBranch(state, player, localPlayerId, branchDefinition, commandsDisabled))
    .join("");

  return `
    <div class="tech-tree-canvas" data-research-canvas>
      <div class="tech-tree-grid" style="${formatResearchCanvasTransform(state.researchView)}">${branchColumns}</div>
    </div>
  `;
}

function renderResearchBranch(state, player, localPlayerId, branchDefinition, commandsDisabled) {
  const branchNodes = state.catalog.techDefinitions
    .filter((techDefinition) => techDefinition.branchId === branchDefinition.id);
  const branchMetrics = getBranchCanvasMetrics(branchNodes);
  const nodeById = new Map(branchNodes.map((techDefinition) => [techDefinition.id, techDefinition]));
  const dependencyLines = renderResearchDependencyLines(branchNodes, nodeById, branchMetrics);
  const nodes = [...branchNodes]
    .sort((left, right) => {
      if (left.layout.row !== right.layout.row) {
        return left.layout.row - right.layout.row;
      }

      return left.layout.column - right.layout.column;
    })
    .map((techDefinition) => {
      return renderResearchNode(
        state,
        player,
        localPlayerId,
        techDefinition,
        commandsDisabled,
        branchMetrics
      );
    })
    .join("");

  return `
    <div class="tech-branch">
      <div class="tech-branch-header">
        <div class="tech-branch-title">${branchDefinition.displayName}</div>
      </div>
      <div class="tech-branch-path" style="${formatBranchCanvasStyle(branchMetrics)}">
        <svg class="tech-branch-lines" viewBox="0 0 ${branchMetrics.width} ${branchMetrics.height}" preserveAspectRatio="none" aria-hidden="true">
          ${dependencyLines}
        </svg>
        ${nodes}
      </div>
    </div>
  `;
}

function renderResearchNode(state, player, localPlayerId, techDefinition, commandsDisabled, branchMetrics) {
  const completed = !!player && player.researchedTechIds.includes(techDefinition.id);
  const active = !!player && player.activeResearch?.techId === techDefinition.id;
  const queueIndex = player ? player.researchQueue.indexOf(techDefinition.id) : -1;
  const queued = queueIndex !== -1;
  const available = localPlayerId ? canResearchTech(state, localPlayerId, techDefinition.id) : false;
  const cost = localPlayerId ? getResearchCost(state, localPlayerId, techDefinition.id) : techDefinition.cost;
  const prerequisiteSummary = techDefinition.prerequisiteIds.length > 0
    ? techDefinition.prerequisiteIds.map((prerequisiteId) => state.catalog.tech[prerequisiteId].displayName).join(", ")
    : "Root node";
  const exclusiveLockedBy = player ? getExclusiveLockSource(state, player, techDefinition) : null;
  const effectDescription = formatResearchNodeDetail(
    state,
    techDefinition,
    completed,
    active,
    queued,
    available,
    player,
    exclusiveLockedBy
  );
  const cardClass = [
    "tech-node",
    completed ? "is-completed" : "",
    active ? "is-active" : "",
    queued ? "is-queued" : "",
    !completed && !active && !queued && available ? "is-available" : "",
    !completed && !active && !queued && !available ? "is-locked" : ""
  ].filter(Boolean).join(" ");

  return `
    <button
      type="button"
      data-action="start-research"
      data-value="${techDefinition.id}"
      class="${cardClass}"
      style="${formatNodeCanvasStyle(techDefinition.layout, branchMetrics)}"
      title="${escapeAttribute(formatResearchTooltip(state, techDefinition, cost, prerequisiteSummary, exclusiveLockedBy))}"
      ${commandsDisabled || !available ? "disabled" : ""}
    >
      <span class="command-card-title">${techDefinition.displayName}</span>
      <span class="command-card-meta">${cost} resources | ${techDefinition.researchTime}s</span>
      <span class="command-card-meta">${effectDescription}</span>
    </button>
  `;
}

function renderResearchQueue(state, player, commandsDisabled) {
  if (!player || player.researchQueue.length === 0) {
    return `<div class="meta">Research queue empty.</div>`;
  }

  const queueItems = player.researchQueue.map((techId, index) => {
    const definition = state.catalog.tech[techId];
    return `
      <div class="queue-row">
        <div class="queue-row-copy">
          <span class="badge">#${index + 1}</span>
          <span>${definition.displayName}</span>
        </div>
        <button
          type="button"
          data-action="remove-research-queue-item"
          data-value="${index}"
          ${commandsDisabled ? "disabled" : ""}
        >
          Remove
        </button>
      </div>
    `;
  }).join("");

  return `
    <div class="stack">
      <div class="meta">Queued research</div>
      <div class="queue-stack">${queueItems}</div>
    </div>
  `;
}

function renderSingleSelectionCommands(state, selected, controlsDisabled) {
  if (selected.type === "unit") {
    return `<div class="meta">No unit commands available.</div>`;
  }

  const buildingDefinition = state.catalog.buildings[selected.definitionId];
  const playerOwned = isLocalPlayerEntity(state, selected.id);
  if (!playerOwned) {
    return `<div class="meta">Enemy building selected. Commands unavailable.</div>`;
  }

  if (buildingDefinition.producedUnitIds.length > 0) {
    const unitId = getProducedUnitId(buildingDefinition);
    const unitDefinition = state.catalog.units[unitId];
    const batchSize = getProductionBatchSize(buildingDefinition);
    const cycleTime = getProductionCycleTime(buildingDefinition, unitDefinition);

    return `
      <div class="stack">
        <div class="meta">Produces ${batchSize} ${unitDefinition.displayName}${batchSize === 1 ? "" : " units"} per ${cycleTime}s.</div>
        <div class="row">
          <button type="button" data-action="activate-production" ${controlsDisabled || selected.enabled ? "disabled" : ""}>Activate</button>
          <button type="button" data-action="deactivate-production" ${controlsDisabled || !selected.enabled ? "disabled" : ""}>Deactivate</button>
        </div>
      </div>
    `;
  }

  if (buildingDefinition.kind === "base") {
    const player = getLocalPlayer(state);
    const currentTier = state.catalog.baseTiers[player.baseTier];
    const nextTier = state.catalog.baseTiers[player.baseTier + 1] ?? null;
    const activeUpgrade = player.activeBaseUpgrade
      ? (() => {
          const tier = state.catalog.baseTiers[player.activeBaseUpgrade.targetTier];
          const displayProgressSeconds = getPlayerDisplayValue(
            state,
            player,
            "activeBaseUpgradeProgressSeconds",
            player.activeBaseUpgrade.progressSeconds
          );
          const progress = displayProgressSeconds / tier.upgradeTime;
          return `<div class="meta">Upgrading to ${tier.displayName}: ${(progress * 100).toFixed(0)}%</div>`;
        })()
      : nextTier && getLocalPlayerId(state)
        ? renderBaseUpgradeButton(state, currentTier, nextTier, controlsDisabled)
        : `<div class="meta">Maximum base tier reached.</div>`;

    return `
      <div class="stack">
        <div class="meta">Main base command node.</div>
        <div class="meta">Current tier: ${currentTier.displayName}</div>
        <div class="meta">Right click to move. Shift+right click appends waypoints. Press C to clear.</div>
        ${activeUpgrade}
      </div>
    `;
  }

  if (buildingDefinition.supportsResearch) {
    if (!selected.isConstructed) {
      return `<div class="meta">Research unlocks when this Tech Center is complete.</div>`;
    }

    const player = getLocalPlayer(state);
    const currentTier = state.catalog.techTiers[player.techTier];
    const nextTier = state.catalog.techTiers[player.techTier + 1] ?? null;
    const activeUpgrade = player.activeTechUpgrade
      ? (() => {
          const tier = state.catalog.techTiers[player.activeTechUpgrade.targetTier];
          const displayProgressSeconds = getPlayerDisplayValue(
            state,
            player,
            "activeTechUpgradeProgressSeconds",
            player.activeTechUpgrade.progressSeconds
          );
          const progress = displayProgressSeconds / tier.upgradeTime;
          return `<div class="meta">Upgrading to ${tier.displayName}: ${(progress * 100).toFixed(0)}%</div>`;
        })()
      : nextTier
        ? renderTechUpgradeButton(state, nextTier, controlsDisabled)
        : `<div class="meta">Maximum Tech Center tier reached.</div>`;

    return `
      <div class="stack">
        <div class="meta">Current level: ${currentTier.displayName}</div>
        ${activeUpgrade}
      </div>
    `;
  }

  return `<div class="meta">No commands available for this structure.</div>`;
}

function renderMultiSelectionCommands(state, selectedEntities, controlsDisabled) {
  const selectedBuildings = selectedEntities.filter((entity) => entity.type === "building");
  if (selectedBuildings.length !== selectedEntities.length) {
    return `<div class="meta">Mixed selections do not share commands.</div>`;
  }

  const playerOwnedBuildings = selectedBuildings.filter((building) => building.ownerId === getLocalPlayerId(state));
  const productionBuildings = playerOwnedBuildings.filter((building) => isProductionKind(building.kind));
  if (productionBuildings.length === 0) {
    return `<div class="meta">No shared commands available for this selection.</div>`;
  }

  const sharedEnabledState = getSharedValue(productionBuildings.map((building) => building.enabled));
  const producedUnitLabels = [...new Set(productionBuildings.map((building) => {
    const buildingDefinition = state.catalog.buildings[building.definitionId];
    return state.catalog.units[getProducedUnitId(buildingDefinition)].displayName;
  }))].sort((left, right) => left.localeCompare(right));

  return `
    <div class="stack">
      <div class="meta">Shared production commands for ${productionBuildings.length} structure${productionBuildings.length === 1 ? "" : "s"}.</div>
      <div class="meta">Outputs: ${producedUnitLabels.join(", ")}</div>
      <div class="meta">Production: ${sharedEnabledState === true ? "active" : sharedEnabledState === false ? "inactive" : "mixed"}</div>
      <div class="row">
        <button type="button" data-action="activate-production" ${controlsDisabled || sharedEnabledState === true ? "disabled" : ""}>Activate Selected</button>
        <button type="button" data-action="deactivate-production" ${controlsDisabled || sharedEnabledState === false ? "disabled" : ""}>Deactivate Selected</button>
      </div>
    </div>
  `;
}

function getSharedValue(values) {
  if (values.length === 0) {
    return null;
  }

  const firstValue = values[0];
  return values.every((value) => value === firstValue) ? firstValue : null;
}

function canIssueMatchCommands(state) {
  return canLocalPlayerIssueCommands(state);
}

function formatBuildingTooltip(state, definition, cost) {
  const producedUnits = definition.producedUnitIds.length > 0
    ? definition.producedUnitIds.map((unitId) => state.catalog.units[unitId].displayName).join(", ")
    : "None";
  const lines = [
    definition.displayName,
    `Cost: ${cost}`,
    `Build Time: ${definition.buildTime}s`,
    `Health: ${definition.maxHealth}`,
    formatTechCenterRequirementLine(definition.requiredTechCenterLevel)
  ];

  if (Number.isInteger(definition.maxOwned)) {
    lines.push(`Build Limit: ${definition.maxOwned}`);
  }

  if (definition.producedUnitIds.length > 0) {
    const unitDefinition = state.catalog.units[getProducedUnitId(definition)];
    lines.push(`Produces: ${producedUnits}`);
    lines.push(`Production: ${getProductionBatchSize(definition)} per ${getProductionCycleTime(definition, unitDefinition)}s`);
  }

  if (definition.supportsResearch) {
    lines.push("Tech Center");
  }

  return lines.join("\n");
}

function formatResearchTooltip(state, techDefinition, cost, prerequisiteSummary, exclusiveLockedBy = null) {
  return [
    techDefinition.displayName,
    techDefinition.description,
    `Cost: ${cost}`,
    `Tech Center Requirement: Lv. ${getResearchRequiredTechCenterLevel(techDefinition)}`,
    `Research Time: ${techDefinition.researchTime}s`,
    `Prereqs: ${prerequisiteSummary}`,
    exclusiveLockedBy ? `Exclusive Lock: ${exclusiveLockedBy.displayName}` : null
  ].filter(Boolean).join("\n");
}

function renderBaseUpgradeButton(state, currentTier, nextTier, controlsDisabled) {
  const localPlayerId = getLocalPlayerId(state);
  const disabled = controlsDisabled || !canUpgradeBase(state, localPlayerId);
  const deltaLines = formatBaseUpgradeDeltas(currentTier, nextTier);

  return `
    <button type="button" data-action="start-base-upgrade" class="command-card command-card-upgrade" ${disabled ? "disabled" : ""}>
      <span class="command-card-title">Upgrade to ${nextTier.displayName}</span>
      <span class="command-card-meta">${nextTier.cost} resources | ${nextTier.upgradeTime}s</span>
      <span class="command-card-meta">${deltaLines}</span>
    </button>
  `;
}

function renderTechUpgradeButton(state, nextTier, controlsDisabled) {
  const localPlayerId = getLocalPlayerId(state);
  const disabled = controlsDisabled || !canUpgradeTech(state, localPlayerId);

  return `
    <button type="button" data-action="start-tech-upgrade" class="command-card command-card-upgrade" ${disabled ? "disabled" : ""}>
      <span class="command-card-title">Upgrade to ${nextTier.displayName}</span>
      <span class="command-card-meta">${nextTier.cost} resources | ${nextTier.upgradeTime}s</span>
      <span class="command-card-meta">Unlock deeper research rows and later tech progression.</span>
    </button>
  `;
}

function formatBaseUpgradeDeltas(currentTier, nextTier) {
  const currentStats = currentTier.baseStats;
  const nextStats = nextTier.baseStats;
  const deltas = [
    `HP +${nextStats.maxHealth - currentStats.maxHealth}`,
    `Regen +${nextStats.healthRegenPerSecond - currentStats.healthRegenPerSecond}/s`,
    `Move +${nextStats.moveSpeed - currentStats.moveSpeed}`,
    `Range +${nextStats.defense.attackRange - currentStats.defense.attackRange}`,
    `Damage +${nextStats.defense.attackDamage - currentStats.defense.attackDamage}`
  ];

  return deltas.join(" | ");
}

function getResearchAvailabilityLabel(state, player, techDefinition, available) {
  if (available) {
    return player.activeResearch || player.researchQueue.length > 0 ? "Queueable" : "Ready";
  }

  if (!player) {
    return "Unavailable";
  }

  const techCenterLevel = getConstructedTechCenterLevel(state, player.id);
  const requiredTechCenterLevel = getResearchRequiredTechCenterLevel(techDefinition);
  if (techCenterLevel < requiredTechCenterLevel) {
    return techCenterLevel === 0
      ? "Needs Tech Center"
      : `Needs Tech Center Lv. ${requiredTechCenterLevel}`;
  }

  for (const prerequisiteId of techDefinition.prerequisiteIds) {
    const isSatisfied =
      player.researchedTechIds.includes(prerequisiteId) ||
      player.activeResearch?.techId === prerequisiteId ||
      player.researchQueue.includes(prerequisiteId);
    if (!isSatisfied) {
      return `Needs ${state.catalog.tech[prerequisiteId].displayName}`;
    }
  }

  const exclusiveLockedBy = getExclusiveLockSource(state, player, techDefinition);
  if (exclusiveLockedBy) {
    return `Locked by ${exclusiveLockedBy.displayName}`;
  }

  return "Unavailable";
}

function formatResearchNodeDetail(state, techDefinition, completed, active, queued, available, player, exclusiveLockedBy) {
  if (completed) {
    return "Completed";
  }

  if (active) {
    return "Research in progress.";
  }

  if (queued) {
    return "Queued for research.";
  }

  if (!available) {
    return player ? getResearchAvailabilityLabel(state, player, techDefinition, available) : "Unavailable";
  }

  return exclusiveLockedBy ? `Locked by ${exclusiveLockedBy.displayName}` : techDefinition.description;
}

function renderResearchLauncher(state) {
  if (!state.hasActiveMatch || isObserverMode(state)) {
    return "";
  }

  const localPlayerId = getLocalPlayerId(state);
  if (!localPlayerId || !hasConstructedTechCenter(state, localPlayerId)) {
    return "";
  }

  const player = getLocalPlayer(state);
  const activeResearch = player?.activeResearch;
  const activeLabel = activeResearch
    ? `${state.catalog.tech[activeResearch.techId].displayName}${activeResearch.isPaused ? " (Paused)" : ""}`
    : "Idle";
  const currentMarkup = `
    <div class="research-launcher-section">
      <span class="research-launcher-section-label">Current</span>
      <span class="research-launcher-meta">${activeLabel}</span>
    </div>
  `;
  const queueMarkup = (player?.researchQueue?.length ?? 0) > 0
    ? `
      <div class="research-launcher-section research-launcher-queue">
        <span class="research-launcher-section-label">Queued</span>
        ${player.researchQueue.map((techId) => `<span class="research-launcher-queue-item">${state.catalog.tech[techId].displayName}</span>`).join("")}
      </div>
    `
    : "";
  const progressMarkup = activeResearch
    ? `
      <div class="research-launcher-progress-row">
        <div class="progress-bar research-launcher-progress-bar" data-live-research-launcher-progress-bar>
          <div class="progress-bar-fill"></div>
        </div>
        <span class="research-launcher-progress-label" data-live-research-launcher-progress-label></span>
      </div>
    `
    : "";

  return `
    <button
      type="button"
      data-action="toggle-research-modal"
      class="panel research-launcher ${state.showResearchModal ? "is-active" : ""}"
    >
      <span class="research-launcher-title-row">
        <span class="research-launcher-title">Research</span>
        <span class="research-launcher-hotkey">[Tab]</span>
      </span>
      ${currentMarkup}
      ${queueMarkup}
      ${progressMarkup}
    </button>
  `;
}

function renderResearchModal(state) {
  return renderResearchModalShell(state);
}

function renderResearchModalShell() {
  return `
    <section class="panel panel-menu panel-research-modal">
      <div class="panel-title-row">
        <h2>Research</h2>
        <button type="button" data-action="close-research-modal">Close</button>
      </div>
      <div class="research-modal-layout">
        <div class="research-modal-sidebar">
          <div class="research-modal-status panel" id="research-modal-status"></div>
          <div class="research-modal-queue panel" id="research-modal-queue"></div>
        </div>
        <div id="research-modal-tree"></div>
      </div>
    </section>
  `;
}

function hasConstructedTechCenter(state, playerId) {
  return getOwnedBuildings(state, playerId, "tech_structure").some((building) => building.isConstructed);
}

function getExclusiveLockSource(state, player, techDefinition) {
  if (!player || !techDefinition.exclusiveGroupId) {
    return null;
  }

  for (const candidate of state.catalog.techDefinitions) {
    if (candidate.id === techDefinition.id || candidate.exclusiveGroupId !== techDefinition.exclusiveGroupId) {
      continue;
    }

    if (
      player.researchedTechIds.includes(candidate.id) ||
      player.activeResearch?.techId === candidate.id ||
      player.researchQueue.includes(candidate.id)
    ) {
      return candidate;
    }
  }

  return null;
}

function getBranchCanvasMetrics(branchNodes) {
  const rows = branchNodes.map((techDefinition) => techDefinition.layout.row);
  const columns = branchNodes.map((techDefinition) => techDefinition.layout.column);
  const minColumn = Math.min(...columns);
  const maxColumn = Math.max(...columns);
  const maxRow = Math.max(...rows);

  return {
    minColumn,
    maxColumn,
    maxRow,
    width:
      TECH_BRANCH_PADDING_X * 2 +
      (maxColumn - minColumn) * TECH_BRANCH_COLUMN_SPACING +
      TECH_BRANCH_NODE_WIDTH,
    height:
      TECH_BRANCH_PADDING_Y * 2 +
      maxRow * TECH_BRANCH_ROW_SPACING +
      TECH_BRANCH_NODE_HEIGHT
  };
}

function renderResearchDependencyLines(branchNodes, nodeById, branchMetrics) {
  const paths = [];

  for (const node of branchNodes) {
    const nodePosition = getNodeCanvasPosition(node.layout, branchMetrics);
    const targetX = nodePosition.left + TECH_BRANCH_NODE_WIDTH * 0.5;
    const targetY = nodePosition.top;

    for (const prerequisiteId of node.prerequisiteIds) {
      const prerequisite = nodeById.get(prerequisiteId);
      if (!prerequisite) {
        continue;
      }

      const prerequisitePosition = getNodeCanvasPosition(prerequisite.layout, branchMetrics);
      const sourceX = prerequisitePosition.left + TECH_BRANCH_NODE_WIDTH * 0.5;
      const sourceY = prerequisitePosition.top + TECH_BRANCH_NODE_HEIGHT;
      const midpointY = sourceY + (targetY - sourceY) * 0.5;
      paths.push(
        `<path d="M ${sourceX} ${sourceY} L ${sourceX} ${midpointY} L ${targetX} ${midpointY} L ${targetX} ${targetY}" />`
      );
    }
  }

  return paths.join("");
}

function formatBranchCanvasStyle(branchMetrics) {
  return `width:${branchMetrics.width}px;height:${branchMetrics.height}px;`;
}

function formatResearchCanvasTransform(researchView) {
  const zoom = researchView?.zoom ?? 1;
  const panX = researchView?.panX ?? 0;
  const panY = researchView?.panY ?? 0;
  return `transform:translate(${panX}px, ${panY}px) scale(${zoom});transform-origin:0 0;`;
}

function formatNodeCanvasStyle(layout, branchMetrics) {
  const position = getNodeCanvasPosition(layout, branchMetrics);
  return `left:${position.left}px;top:${position.top}px;width:${TECH_BRANCH_NODE_WIDTH}px;min-height:${TECH_BRANCH_NODE_HEIGHT}px;`;
}

function getNodeCanvasPosition(layout, branchMetrics) {
  return {
    left: TECH_BRANCH_PADDING_X + (layout.column - branchMetrics.minColumn) * TECH_BRANCH_COLUMN_SPACING,
    top: TECH_BRANCH_PADDING_Y + layout.row * TECH_BRANCH_ROW_SPACING
  };
}

function escapeAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatTechCenterRequirementLine(requiredTechCenterLevel) {
  return requiredTechCenterLevel <= 0
    ? "Tech Center Requirement: None"
    : `Tech Center Requirement: Lv. ${requiredTechCenterLevel}`;
}
