import { difficultyDefinitions } from "../data/difficulties.js";
import { mapDefinitions } from "../data/maps.js";
import {
  AI_TRACE_CATEGORY_DEFINITIONS,
  AI_TRACE_PRESET_DEFINITIONS
} from "../debug/aiTrace.js";
import { getPlayerById } from "../state/entities.js";

export function renderMenuOverlay(state) {
  if (state.uiScreen === "playing") {
    return "";
  }

  if (state.uiScreen === "main_menu") {
    return `
      <section class="panel panel-menu">
        <h2>SwarmBattle</h2>
        <div class="stack">
          <button type="button" data-action="open-new-game">Vs AI</button>
          <button type="button" data-action="open-multiplayer-host">Host PvP</button>
          <button type="button" data-action="open-multiplayer-join">Join PvP</button>
          <button type="button" data-action="start-ai-test-match">AI Test Match</button>
        </div>
      </section>
    `;
  }

  if (state.uiScreen === "setup") {
    const mapButtons = mapDefinitions.map((mapDefinition) => {
      const active = state.menuSetup.mapId === mapDefinition.id;
      return `
        <button
          type="button"
          data-action="select-map"
          data-value="${mapDefinition.id}"
          class="${active ? "is-active" : ""}"
        >
          ${mapDefinition.displayName}
        </button>
      `;
    }).join("");

    const difficultyButtons = difficultyDefinitions.map((difficultyDefinition) => {
      const active = state.menuSetup.difficultyId === difficultyDefinition.id;
      return `
        <button
          type="button"
          data-action="select-difficulty"
          data-value="${difficultyDefinition.id}"
          class="${active ? "is-active" : ""}"
        >
          ${difficultyDefinition.displayName}
        </button>
      `;
    }).join("");

    const multiplayerMode = state.menuSetup.mode === "multiplayer_host" || state.menuSetup.mode === "multiplayer_client";
    const aiTestMode = state.menuSetup.mode === "ai_test";
    const title = state.menuSetup.mode === "multiplayer_host"
      ? "Host PvP"
      : state.menuSetup.mode === "multiplayer_client"
        ? "Join PvP"
        : aiTestMode
          ? "AI Test Match"
          : "New Game";
    const subtitle = multiplayerMode ? renderMultiplayerSetup(state) : "";

    return `
      <section class="panel panel-menu">
        <h2>${title}</h2>
        <div class="stack setup-stack">
          ${subtitle}
          <div class="menu-section">
            <div class="menu-label">Map Size</div>
            <div class="row setup-button-row">${mapButtons}</div>
          </div>
          ${!multiplayerMode && !aiTestMode ? `
          <div class="menu-section">
            <div class="menu-label">Difficulty</div>
            <div class="row setup-button-row">${difficultyButtons}</div>
          </div>
          ` : ""}
          ${!multiplayerMode ? renderAiTraceSetup(state) : ""}
          <div class="row setup-action-row">
            <button type="button" data-action="start-match" ${getStartMatchDisabledAttribute(state, multiplayerMode)}>${multiplayerMode ? getMultiplayerStartLabel(state) : aiTestMode ? "Start AI Test" : "Start Match"}</button>
            <button type="button" data-action="back-from-setup">Back</button>
          </div>
        </div>
      </section>
    `;
  }

  if (state.uiScreen === "paused") {
    return `
      <section class="panel panel-menu">
        <h2>Paused</h2>
        <div class="stack">
          ${renderAiTraceRuntimeControls(state)}
          <div class="row wide">
            <button type="button" data-action="resume-match">Resume</button>
            <button type="button" data-action="open-new-game">New Game</button>
          </div>
        </div>
      </section>
    `;
  }

  if (state.uiScreen === "post_match") {
    const winner = getPlayerById(state, state.winnerId);
    return `
      <section class="panel panel-menu">
        <h2>Match Complete</h2>
        <div class="stack">
          <div class="menu-copy">${winner ? `${winner.name} wins.` : "Match complete."}</div>
          ${renderAiTraceRuntimeControls(state)}
          <button type="button" data-action="open-new-game">New Game</button>
        </div>
      </section>
    `;
  }

  return "";
}

function renderAiTraceSetup(state) {
  const trace = state.menuSetup.aiTrace;
  const controlsVisible = state.showAiTraceControls;
  const playerButtons = getAiTracePlayerOptions(state)
    .map((option) => {
      const active = trace.playerId === option.value;
      return `
        <button
          type="button"
          data-action="select-ai-trace-player"
          data-value="${option.value}"
          class="${active ? "is-active" : ""}"
        >
          ${option.label}
        </button>
      `;
    })
    .join("");
  const presetButtons = AI_TRACE_PRESET_DEFINITIONS.map((preset) => {
    const active = areSameCategorySet(trace.categoryIds, preset.categoryIds);
    return `
      <button
        type="button"
        data-action="apply-ai-trace-preset"
        data-value="${preset.id}"
        class="${active ? "is-active" : ""}"
      >
        ${preset.label}
      </button>
    `;
  }).join("");
  const categoryButtons = AI_TRACE_CATEGORY_DEFINITIONS.map((category) => {
    const active = trace.categoryIds.includes(category.id);
    return `
      <button
        type="button"
        data-action="toggle-ai-trace-category"
        data-value="${category.id}"
        class="trace-category-button ${active ? "is-active" : ""}"
        title="${escapeAttribute(category.description)}"
      >
        <span>${category.label}</span>
        <span class="trace-category-hint">${category.id}</span>
      </button>
    `;
  }).join("");

  return `
    <div class="menu-section trace-setup-section">
      <div class="trace-section-header">
        <div class="menu-label">AI Trace</div>
        <button type="button" data-action="toggle-ai-trace-controls" class="${controlsVisible ? "is-active" : ""}">
          ${controlsVisible ? "Hide Tools [T]" : "Show Tools [T]"}
        </button>
      </div>
      <div class="meta">${trace.enabled ? "Trace active for this match." : "Trace disabled for this match."} Reveal tools to change the profile.</div>
      ${controlsVisible ? `
        <div class="menu-section">
          <div class="trace-inline-actions">
            <button type="button" data-action="toggle-ai-trace-enabled" class="${trace.enabled ? "is-active" : ""}">
              ${trace.enabled ? "Enabled" : "Disabled"}
            </button>
          </div>
        </div>
        <div class="menu-section">
          <div class="menu-label">Target</div>
          <div class="row setup-button-row">${playerButtons}</div>
        </div>
        <div class="menu-section">
          <div class="menu-label">Presets</div>
          <div class="row trace-button-grid">${presetButtons}</div>
        </div>
        <div class="menu-section">
          <div class="menu-label">Categories</div>
          <div class="row trace-category-grid">${categoryButtons}</div>
        </div>
        <div class="row setup-action-row">
          <button type="button" data-action="clear-ai-trace-selection">Clear Trace Selection</button>
        </div>
      ` : ""}
    </div>
  `;
}

function renderAiTraceRuntimeControls(state) {
  if (!state.hasActiveMatch || state.matchConfig?.mode === "multiplayer_host" || state.matchConfig?.mode === "multiplayer_client") {
    return "";
  }

  const trace = state.menuSetup.aiTrace;
  const controlsVisible = state.showAiTraceControls;
  const targetLabel = trace.playerId === "all" ? "All tracked players" : `Player ${trace.playerId}`;
  const categoryLabel = trace.categoryIds.length === 0
    ? "All categories"
    : trace.categoryIds.join(", ");

  return `
    <div class="menu-section trace-runtime-section">
      <div class="trace-section-header">
        <div class="menu-label">Trace Capture</div>
        <button type="button" data-action="toggle-ai-trace-controls" class="${controlsVisible ? "is-active" : ""}">
          ${controlsVisible ? "Hide Tools [T]" : "Show Tools [T]"}
        </button>
      </div>
      <div class="meta">${trace.enabled ? "Active" : "Disabled"} | ${targetLabel} | ${categoryLabel}</div>
      ${controlsVisible ? `
        <div class="row setup-action-row">
          <button type="button" data-action="download-ai-trace">Download Trace</button>
          <button type="button" data-action="clear-ai-trace-buffer">Clear Buffer</button>
        </div>
      ` : ""}
    </div>
  `;
}

function getAiTracePlayerOptions(state) {
  if (state.menuSetup.mode === "ai_test") {
    return [
      { value: "all", label: "Both AIs" },
      { value: 1, label: "AI 1" },
      { value: 2, label: "AI 2" }
    ];
  }

  return [
    { value: 2, label: "AI" },
    { value: "all", label: "All Players" }
  ];
}

function areSameCategorySet(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return right.every((categoryId) => left.includes(categoryId));
}

function renderMultiplayerSetup(state) {
  const session = state.multiplayerSession;
  const isHost = state.menuSetup.mode === "multiplayer_host";
  const isConnecting = session.connectionState === "connecting";
  const lobbyCode = session.lobbyCode || "------";
  const actionDisabled = isConnecting || session.connectionState === "connected" || session.lobbyCodeInput.trim().length !== 6;
  const playerStatusMarkup = getMultiplayerPlayerRows(state)
    .map((player) => {
      return `
        <div class="multiplayer-player-row">
          <div class="multiplayer-player-name">${player.name}</div>
          <div class="multiplayer-player-status">${player.status}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="stack multiplayer-setup-stack">
      ${isHost ? `
      <div class="menu-section">
        <div class="menu-label">Lobby Code</div>
        <div class="lobby-code-row">
          <div class="lobby-code-display">${lobbyCode}</div>
          <button type="button" data-action="copy-lobby-code" ${session.lobbyCode ? "" : "disabled"}>Copy</button>
        </div>
      </div>
      ` : `
      <div class="menu-section">
        <div class="menu-label">Lobby Code</div>
        <div class="lobby-code-row lobby-code-row-input">
          <input
            type="text"
            value="${escapeAttribute(session.lobbyCodeInput)}"
            data-input="lobby-code"
            maxlength="6"
            spellcheck="false"
            placeholder="ABC123"
          >
        </div>
      </div>
      `}
      ${isHost ? "" : `
      <div class="row setup-action-row">
        <button type="button" data-action="join-multiplayer-lobby" ${actionDisabled ? "disabled" : ""}>Join Lobby</button>
      </div>
      `}
      <div class="multiplayer-status-card">
        ${session.lastError ? `<div class="notice">${session.lastError}</div>` : ""}
        ${session.statusMessage ? `<div class="meta">${session.statusMessage}</div>` : ""}
        <div class="menu-section">
          <div class="menu-label">Players</div>
          <div class="multiplayer-player-list">${playerStatusMarkup}</div>
        </div>
      </div>
    </div>
  `;
}

function getStartMatchDisabledAttribute(state, multiplayerMode) {
  if (!multiplayerMode) {
    return "";
  }

  const session = state.multiplayerSession;
  const isHost = state.menuSetup.mode === "multiplayer_host";
  return !isHost || session.channelState !== "open" || session.matchStarted ? "disabled" : "";
}

function getMultiplayerStartLabel(state) {
  const isHost = state.menuSetup.mode === "multiplayer_host";
  if (isHost) {
    return state.multiplayerSession.matchStarted ? "Match Started" : "Start PvP Match";
  }

  return "Waiting For Host";
}

function getMultiplayerPlayerRows(state) {
  const session = state.multiplayerSession;
  const isHost = state.menuSetup.mode === "multiplayer_host";

  if (isHost) {
    return [
      { name: "You (Host)", status: getHostStatus(session) },
      { name: "Guest", status: getGuestStatusForHost(session) }
    ];
  }

  return [
    { name: "Host", status: getHostStatusForGuest(session) },
    { name: "You (Guest)", status: getGuestStatus(session) }
  ];
}

function getHostStatus(session) {
  if (session.matchStarted) {
    return "In Match";
  }

  if (session.connectionState === "connecting") {
    return "Creating Lobby";
  }

  if (session.connectionState !== "connected") {
    return "Offline";
  }

  if (!session.peerJoined) {
    return "Waiting For Player";
  }

  if (session.channelState === "open") {
    return "Connected";
  }

  return "Connecting";
}

function getGuestStatusForHost(session) {
  if (session.matchStarted || session.channelState === "open") {
    return "Connected";
  }

  if (!session.peerJoined) {
    return "Waiting To Join";
  }

  return "Connecting";
}

function getHostStatusForGuest(session) {
  if (session.connectionState === "connecting") {
    return "Connecting";
  }

  if (session.connectionState !== "connected") {
    return "Offline";
  }

  if (session.matchStarted || session.channelState === "open") {
    return "Connected";
  }

  return "Connecting";
}

function getGuestStatus(session) {
  if (session.matchStarted) {
    return "In Match";
  }

  if (session.connectionState === "connecting") {
    return "Connecting";
  }

  if (session.connectionState !== "connected") {
    return "Offline";
  }

  if (session.channelState === "open") {
    return "Connected";
  }

  return "Waiting For Host";
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
