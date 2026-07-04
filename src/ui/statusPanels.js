import { getPerformanceSummary } from "../debug/performance.js";
import { getMatchTimeDisplaySeconds, getPlayerDisplayValue } from "../multiplayer/interpolation.js";
import { getOwnedBuildings, getPlayerById } from "../state/entities.js";
import { getLocalPlayer, isObserverMode } from "../state/localPlayer.js";
import { getPlayerActiveGlobalBonuses } from "../systems/mapObjectives.js";
import { getResourceIncomeBreakdown, getResourceSpendingBreakdown } from "../systems/resources.js";
import { getTerritoryOwnershipSummary } from "../systems/territory.js";

export function renderMatchTime(state) {
  if (!state.hasActiveMatch) {
    return "";
  }

  return `<div class="match-time">${formatTime(getMatchTimeDisplaySeconds(state))}</div>`;
}

export function renderMatchStatus(state) {
  if (!state.hasActiveMatch) {
    return "";
  }

  if (state.matchConfig?.mode === "ai_test") {
    return renderAiOverviewPanel(state, state.players[0]?.id ?? null);
  }

  const player = getLocalPlayer(state) ?? state.players[0];
  const income = getResourceIncomeBreakdown(state, player.id);
  const spending = getResourceSpendingBreakdown(state, player.id);
  const net = income.total - spending.total;
  const observerNotice = isObserverMode(state)
    ? `<div class="notice">Observer Mode</div>`
    : "";
  const statusNotice = state.matchEnded
    ? `<div class="notice">${getPlayerById(state, state.winnerId).name} wins</div>`
    : observerNotice;

  return `
    <div class="stack">
      ${statusNotice}
      <div class="stat-line stat-line-primary">
        <span class="stat-label">Resources</span>
        <span class="stat-value">${Math.floor(getPlayerDisplayValue(state, player, "resources", player?.resources ?? 0))}</span>
      </div>
      ${renderRateSection("Income", income.entries, income.total, "positive")}
      ${renderRateSection("Spending", spending.entries, spending.total, "negative")}
      <div class="stat-line stat-line-net">
        <span class="stat-label">Net</span>
        <span class="stat-value ${net >= 0 ? "is-positive" : "is-negative"}">${formatSignedRate(net)}</span>
      </div>
      ${state.uiMode === "place_building" && state.uiScreen === "playing"
        ? `<div class="meta">${state.interactionHint}</div>`
        : ""}
    </div>
  `;
}

export function renderPerformancePanel(state) {
  if (!state.hasActiveMatch || !state.showPerformancePanel) {
    return "";
  }

  const performanceSummary = getPerformanceSummary(state);
  return renderCompactPerformanceSummary(performanceSummary);
}

export function renderTerritoryStatus(state) {
  if (!state.hasActiveMatch) {
    return "";
  }

  const territory = getTerritoryOwnershipSummary(state);
  const leftPlayer = getPlayerById(state, 1);
  const rightPlayer = getPlayerById(state, 2);

  return `
    <div class="stack territory-stack">
      <div class="territory-bar" aria-label="Territory ownership overview">
        <div class="territory-fill territory-fill-player" style="width: ${territory.playerPercent.toFixed(1)}%"></div>
        <div class="territory-fill territory-fill-neutral" style="width: ${territory.neutralPercent.toFixed(1)}%"></div>
        <div class="territory-fill territory-fill-ai" style="width: ${territory.aiPercent.toFixed(1)}%"></div>
      </div>
      <div class="territory-stats">
        <div class="territory-stat territory-stat-player">
          <span class="territory-label">${leftPlayer.name}</span>
          <span class="territory-value">${formatPercent(territory.playerPercent)}</span>
        </div>
        <div class="territory-stat territory-stat-neutral">
          <span class="territory-label">Neutral</span>
          <span class="territory-value">${formatPercent(territory.neutralPercent)}</span>
        </div>
        <div class="territory-stat territory-stat-ai">
          <span class="territory-label">${rightPlayer.name}</span>
          <span class="territory-value">${formatPercent(territory.aiPercent)}</span>
        </div>
      </div>
    </div>
  `;
}

export function renderScorePanel(state) {
  if (!state.hasActiveMatch) {
    return "";
  }

  if (state.matchConfig?.mode === "ai_test") {
    return renderAiOverviewPanel(state, state.players[1]?.id ?? null);
  }

  return `
    <div class="stack">
      <div class="meta">Cumulative resource gain</div>
      ${state.players.map((player) => {
        const income = getResourceIncomeBreakdown(state, player.id);
        const activeBonuses = getPlayerActiveGlobalBonuses(state, player.id);
        return `
          <div class="score-row">
            <div class="score-row-header">
              <span class="score-swatch" style="--score-color: ${player.color}"></span>
              <div class="score-player-meta">
                <span class="score-name">${player.name}</span>
                ${renderGlobalBonusBadges(activeBonuses)}
              </div>
            </div>
            <div class="score-values">
              <span class="score-total">${Math.floor(getPlayerDisplayValue(state, player, "cumulativeResourceGain", player.cumulativeResourceGain))}</span>
              <span class="score-rate ${income.total >= 0 ? "is-positive" : "is-negative"}">${formatSignedRate(income.total)}</span>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

export function formatSignedRate(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}/s`;
}

function renderAiOverviewPanel(state, playerId) {
  const player = playerId ? getPlayerById(state, playerId) : null;
  if (!player) {
    return "";
  }

  const income = getResourceIncomeBreakdown(state, player.id);
  const spending = getResourceSpendingBreakdown(state, player.id);
  const net = income.total - spending.total;
  const aiState = player.aiState;
  const debugSummary = aiState?.debugSummary ?? null;
  const strategicIntent = aiState?.strategicIntent ?? debugSummary?.strategicIntent ?? null;
  const macroDecision = aiState?.debugMacroDecision ?? null;
  const waypointPlan = aiState?.debugWaypointPlan ?? null;
  const focusSummary = describeAiFocus(strategicIntent);
  const macroSummary = describeAiMacroStatus(state, player, macroDecision);
  const researchSummary = describeAiResearch(state, player);
  const activeBonuses = getPlayerActiveGlobalBonuses(state, player.id);
  const bonusMeta = activeBonuses.length > 0
    ? `${activeBonuses.map((bonus) => bonus.valueText).join(" | ")} active`
    : "AI active";

  return `
    <div class="stack ai-overview-stack">
      <div class="ai-overview-header">
        <div class="ai-overview-title-row">
          <span class="score-swatch" style="--score-color: ${player.color}"></span>
          <div class="ai-overview-title-copy">
            <span class="score-name">${player.name}</span>
            <span class="meta">${bonusMeta}</span>
          </div>
        </div>
        <div class="ai-overview-resources">${Math.floor(getPlayerDisplayValue(state, player, "resources", player.resources))}</div>
      </div>
      <div class="ai-overview-grid">
        <div class="ai-overview-card">
          <span class="territory-label">Income</span>
          <span class="territory-value ${net >= 0 ? "is-positive" : "is-negative"}">${formatSignedRate(net)}</span>
          <span class="meta">Gross ${income.total.toFixed(1)}/s | Spend ${spending.total.toFixed(1)}/s</span>
        </div>
        <div class="ai-overview-card">
          <span class="territory-label">Focus</span>
          <span class="ai-overview-strategy">${focusSummary.title}</span>
          <span class="meta">${focusSummary.detail}</span>
        </div>
        <div class="ai-overview-card">
          <span class="territory-label">Macro</span>
          <span class="territory-value">${macroSummary.title}</span>
          <span class="meta">${macroSummary.detail}</span>
        </div>
        <div class="ai-overview-card">
          <span class="territory-label">Research</span>
          <span class="territory-value">${researchSummary.title}</span>
          <span class="meta">${researchSummary.detail}</span>
        </div>
      </div>
      ${renderAiMovementSummary(debugSummary, waypointPlan)}
    </div>
  `;
}

function describeAiFocus(strategicIntent) {
  const primary = strategicIntent?.primary ?? "opening";
  const secondary = strategicIntent?.secondary ? formatIntentLabel(strategicIntent.secondary) : null;
  const titlesByIntent = {
    defense: "Holding defense",
    expansion: "Capturing territory",
    objectives: "Contesting objectives",
    pressure: "Applying pressure",
    tech: "Teching up",
    economy: "Growing income",
    counter: "Adjusting counters",
    opening: "Opening setup"
  };
  const detailsByIntent = {
    defense: "Reinforcing threatened lanes and stabilizing the line.",
    expansion: "Looking for new territory and side-lane gains.",
    objectives: "Rotating toward map objectives and rich cells.",
    pressure: "Pushing contested ground and enemy-controlled cells.",
    tech: "Prioritizing tech tiers and research progress.",
    economy: "Favoring stronger income and safer macro growth.",
    counter: "Pivoting composition to answer enemy units.",
    opening: "Establishing early production and map presence."
  };

  return {
    title: titlesByIntent[primary] ?? formatIntentLabel(primary),
    detail: secondary
      ? `${detailsByIntent[primary] ?? ""} Secondary ${secondary}.`.trim()
      : (detailsByIntent[primary] ?? "No clear secondary focus.")
  };
}

function describeAiMacroStatus(state, player, macroDecision) {
  if (player.activeResearch) {
    const tech = state.catalog.tech[player.activeResearch.techId];
    return {
      title: "Researching",
      detail: tech ? tech.displayName : formatIntentLabel(player.activeResearch.techId)
    };
  }

  if (player.activeBaseUpgrade) {
    return {
      title: "Upgrading base",
      detail: `Target tier ${player.activeBaseUpgrade.targetTier}`
    };
  }

  if (player.activeTechUpgrade) {
    return {
      title: "Upgrading tech",
      detail: `Target level ${player.activeTechUpgrade.targetTier}`
    };
  }

  const pendingBuildings = getOwnedBuildings(state, player.id).filter((building) => !building.isConstructed);
  if (pendingBuildings.length > 0) {
    const nextBuilding = pendingBuildings[0];
    const definition = state.catalog.buildings[nextBuilding.definitionId];
    return {
      title: "Building",
      detail: definition?.displayName ?? formatIntentLabel(nextBuilding.definitionId)
    };
  }

  const topCandidate = macroDecision?.topCandidate ?? null;
  const topRejected = macroDecision?.topRejected ?? null;
  if (topCandidate?.approved) {
    return {
      title: "Ready",
      detail: describeMacroAction(topCandidate.id)
    };
  }

  if (topRejected) {
    return {
      title: "Blocked",
      detail: `${describeMacroAction(topRejected.id)}: ${describeMacroBlockReason(topRejected.reason)}`
    };
  }

  return {
    title: "Idle",
    detail: "No immediate macro commitment."
  };
}

function describeAiResearch(state, player) {
  const activeResearch = player.activeResearch ? state.catalog.tech[player.activeResearch.techId] : null;
  const queuedResearch = (player.researchQueue ?? [])
    .slice(0, 2)
    .map((techId) => state.catalog.tech[techId]?.displayName ?? formatIntentLabel(techId));

  if (activeResearch) {
    return {
      title: activeResearch.displayName,
      detail: queuedResearch.length > 0
        ? `Queue: ${queuedResearch.join(", ")} | Done ${player.researchedTechIds.length}`
        : `Done ${player.researchedTechIds.length}`
    };
  }

  if (queuedResearch.length > 0) {
    return {
      title: "Queued",
      detail: `${queuedResearch.join(", ")} | Done ${player.researchedTechIds.length}`
    };
  }

  return {
    title: `Done ${player.researchedTechIds.length}`,
    detail: "No active research."
  };
}

function renderAiMovementSummary(debugSummary, waypointPlan) {
  const threatLabel = formatAiThreatLabel(debugSummary?.primaryThreat ?? null);
  const updatedRole = waypointPlan?.updatedRole ? formatIntentLabel(waypointPlan.updatedRole) : "Idle";
  const routePointCount = waypointPlan?.routes?.[0]?.points?.length ?? 0;
  const baseRouteRole = waypointPlan?.baseRouteRole ? formatIntentLabel(waypointPlan.baseRouteRole) : "Hold";
  const baseRoutePointCount = waypointPlan?.baseRoutePoints?.length ?? 0;

  return `
    <div class="ai-detail-section">
      <div class="stat-group-title">Movement</div>
      <div class="ai-detail-card">
        <div class="stat-line">
          <span class="substat-label">Current threat</span>
          <span class="substat-value">${threatLabel}</span>
        </div>
        <div class="meta">Production routes: ${updatedRole}${routePointCount > 0 ? ` | ${routePointCount} points` : ""}</div>
        <div class="meta">Base movement: ${baseRouteRole}${baseRoutePointCount > 0 ? ` | ${baseRoutePointCount} points` : ""}</div>
      </div>
    </div>
  `;
}

function formatTime(seconds) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatPercent(value) {
  return `${value.toFixed(0)}%`;
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) {
    return "Stable";
  }

  return `${value.toFixed(0)}s`;
}

function renderRateSection(title, entries, total, tone) {
  const rows = entries.length > 0
    ? entries.map((entry) => {
        return `
          <div class="substat-line">
            <span class="substat-label">${entry.label}</span>
            <span class="substat-value ${tone === "positive" ? "is-positive" : "is-negative"}">${formatSignedRate(tone === "positive" ? entry.amount : -entry.amount)}</span>
          </div>
        `;
      }).join("")
    : `
      <div class="substat-line">
        <span class="substat-label">None</span>
        <span class="substat-value">0.0/s</span>
      </div>
    `;

  return `
    <div class="stat-group">
      <div class="stat-group-title">${title}</div>
      ${rows}
      <div class="substat-line substat-line-total">
        <span class="substat-label">Total</span>
        <span class="substat-value ${tone === "positive" ? "is-positive" : "is-negative"}">${formatSignedRate(tone === "positive" ? total : -total)}</span>
      </div>
    </div>
  `;
}

function renderCompactPerformanceSummary(summary) {
  if (!summary.frame) {
    return "";
  }

  const laneSummary = summary.scheduler.length > 0
    ? `
      <div class="stat-group">
        <div class="stat-group-title">Scheduler</div>
        ${summary.scheduler
          .filter((lane) => lane.totalRunCount > 0)
          .sort((left, right) => right.lastDurationMs - left.lastDurationMs)
          .slice(0, 5)
          .map((lane) => {
            return `
              <div class="substat-line">
                <span class="substat-label">${formatLaneLabel(lane.id)}</span>
                <span class="substat-value">${formatDuration(lane.lastDurationMs)} / ${formatDuration(lane.budgetMs)} budget @ ${lane.intervalSeconds.toFixed(2)}s</span>
              </div>
            `;
          }).join("")}
      </div>
    `
    : "";

  const hottestMetrics = summary.hottestMetrics.length > 0
    ? `
      <div class="stat-group">
        <div class="stat-group-title">Hot Sections</div>
        ${summary.hottestMetrics.map((metric) => {
          return `
            <div class="substat-line">
              <span class="substat-label">${formatMetricLabel(metric.name)}</span>
              <span class="substat-value">${formatDuration(metric.summary.avgMs)} avg / ${formatDuration(metric.summary.maxMs)} max</span>
            </div>
          `;
        }).join("")}
      </div>
    `
    : "";

  const renderProfile = summary.renderSections.length > 0
    ? `
      <div class="stat-group">
        <div class="stat-group-title">Render Profile</div>
        <div class="substat-line">
          <span class="substat-label">Total</span>
          <span class="substat-value">${formatDuration(summary.render?.avgMs ?? 0)} avg / ${formatDuration(summary.render?.maxMs ?? 0)} max</span>
        </div>
        ${summary.renderSections.map((metric) => {
          return `
            <div class="substat-line">
              <span class="substat-label">${formatMetricLeafLabel(metric.name)}</span>
              <span class="substat-value">${formatDuration(metric.summary.avgMs)} avg / ${formatDuration(metric.summary.maxMs)} max</span>
            </div>
          `;
        }).join("")}
      </div>
    `
    : "";

  return `
    <div class="stack">
      <div class="stat-group">
        <div class="stat-group-title">Performance</div>
        <div class="substat-line">
          <span class="substat-label">Frame</span>
          <span class="substat-value">${formatDuration(summary.frame.avgMs)} avg / ${formatDuration(summary.frame.maxMs)} max</span>
        </div>
        <div class="substat-line">
          <span class="substat-label">Sim / Render / UI</span>
          <span class="substat-value">${formatDuration(summary.simulation?.avgMs ?? 0)} / ${formatDuration(summary.render?.avgMs ?? 0)} / ${formatDuration(summary.panels?.avgMs ?? 0)}</span>
        </div>
        <div class="substat-line">
          <span class="substat-label">Entities</span>
          <span class="substat-value">${summary.counts.total} (${summary.counts.units}U ${summary.counts.buildings}B ${summary.counts.projectiles}P)</span>
        </div>
      </div>
      ${renderProfile}
      ${hottestMetrics}
      ${laneSummary}
    </div>
  `;
}

function formatIntentLabel(intent) {
  return String(intent)
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function formatAiThreatLabel(threat) {
  if (!threat?.type) {
    return "No critical threat";
  }

  const labels = {
    lane: "Lane pressure",
    structure: "Structure threat"
  };
  const title = labels[threat.type] ?? formatIntentLabel(threat.type);
  return `${title} ${Math.round((threat.severity ?? 0) * 100)}%`;
}

function describeMacroAction(actionId) {
  const labels = {
    build_core: "Add core production",
    build_tech: "Build a Tech Center",
    build_advanced: "Add advanced production",
    upgrade_base: "Upgrade the main base",
    upgrade_tech: "Upgrade the Tech Center",
    research: "Start research"
  };

  return labels[actionId] ?? formatIntentLabel(actionId ?? "unknown");
}

function describeMacroBlockReason(reason) {
  const labels = {
    insufficient_resources: "not enough resources",
    missing_prerequisite: "missing prerequisites",
    missing_production_slot: "no valid build slot",
    low_income: "income too low",
    low_runway: "economy runway too short",
    danger: "too threatened right now",
    no_candidate: "no useful option found",
    already_active: "already in progress",
    queue_full: "research queue already committed"
  };

  return labels[reason] ?? formatIntentLabel(reason ?? "blocked");
}

function renderGlobalBonusBadges(bonuses) {
  if (bonuses.length === 0) {
    return "";
  }

  return `
    <div class="score-badges">
      ${bonuses.map((bonus) => {
        return `<span class="badge score-badge" title="${bonus.label} active">${bonus.valueText}</span>`;
      }).join("")}
    </div>
  `;
}

function formatDuration(value) {
  return `${value.toFixed(2)}ms`;
}

function formatMetricLabel(metricName) {
  return metricName
    .replaceAll(".", " > ")
    .replace("simulation", "Sim")
    .replace("render", "Render")
    .replace("ui", "UI")
    .replace("ai", "AI");
}

function formatMetricLeafLabel(metricName) {
  const leaf = metricName.split(".").at(-1) ?? metricName;
  return leaf
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase());
}

function formatLaneLabel(laneId) {
  return laneId
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase());
}
