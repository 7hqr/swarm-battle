const lastTraceSignatureByKey = new Map();
const traceBuffer = [];
const MAX_TRACE_BUFFER_ENTRIES = 2000;
export const AI_TRACE_CATEGORY_DEFINITIONS = [
  {
    id: "macro",
    label: "Macro Decisions",
    description: "Top approved and rejected strategic actions."
  },
  {
    id: "macro_audit",
    label: "Macro Audit",
    description: "Economy, reserve, and commitment detail for blocked spending."
  },
  {
    id: "base",
    label: "Base Decisions",
    description: "Main-base relocation role and candidate choice."
  },
  {
    id: "base_route",
    label: "Base Routes",
    description: "Requested versus sanitized waypoint routes."
  },
  {
    id: "base_move",
    label: "Base Movement",
    description: "Live base path progress and blocked movement state."
  }
];
export const AI_TRACE_PRESET_DEFINITIONS = [
  {
    id: "economy",
    label: "Economy Audit",
    categoryIds: ["macro", "macro_audit"]
  },
  {
    id: "base_relocation",
    label: "Base Relocation",
    categoryIds: ["base", "base_route", "base_move"]
  },
  {
    id: "decision_summary",
    label: "Decision Summary",
    categoryIds: ["macro", "base"]
  },
  {
    id: "full",
    label: "Full AI Trace",
    categoryIds: AI_TRACE_CATEGORY_DEFINITIONS.map((category) => category.id)
  }
];

initializeAiTraceTools();

export function traceAiEvent(state, playerId, category, signature, details) {
  if (!isAiTraceEnabled(state, category, playerId)) {
    return;
  }

  const key = `${playerId}:${category}`;
  if (lastTraceSignatureByKey.get(key) === signature) {
    return;
  }

  lastTraceSignatureByKey.set(key, signature);
  const entry = {
    matchTimeSeconds: round3(state.matchTimeSeconds),
    playerId,
    category,
    signature,
    details
  };
  traceBuffer.push(entry);
  if (traceBuffer.length > MAX_TRACE_BUFFER_ENTRIES) {
    traceBuffer.splice(0, traceBuffer.length - MAX_TRACE_BUFFER_ENTRIES);
  }
  console.log(`[AI Trace][P${playerId}][${category}] t=${state.matchTimeSeconds.toFixed(2)}`, details);
}

function isAiTraceEnabled(state, category, playerId) {
  const config = getAiTraceConfig(state);
  if (!config.enabled) {
    return false;
  }

  if (config.playerId !== "all" && config.playerId !== playerId) {
    return false;
  }

  if (config.categoryIds.length === 0) {
    return true;
  }

  return config.categoryIds.includes(category);
}

export function createDefaultAiTraceConfig() {
  return {
    enabled: false,
    playerId: "all",
    categoryIds: []
  };
}

export function resolveAiTraceConfig(config = {}) {
  const enabled = config.enabled === true;
  const playerId = resolvePlayerId(config.playerId);
  const categoryIds = resolveCategoryIds(config.categoryIds);
  return {
    enabled,
    playerId,
    categoryIds
  };
}

export function getAiTracePresetCategoryIds(presetId) {
  const preset = AI_TRACE_PRESET_DEFINITIONS.find((definition) => definition.id === presetId);
  if (!preset) {
    throw new Error(`Unknown AI trace preset: ${presetId}`);
  }

  return [...preset.categoryIds];
}

function initializeAiTraceTools() {
  const windowObject = globalThis?.window;
  if (!windowObject || windowObject.__swarmbattleAiTraceToolsInstalled) {
    return;
  }

  windowObject.__swarmbattleAiTraceToolsInstalled = true;
  windowObject.swarmBattleAiTrace = {
    getEntries,
    clear: clearEntries,
    download: downloadEntries,
    buildCapturePayload
  };
}

function getEntries() {
  return traceBuffer.slice();
}

export function clearAiTraceEntries() {
  traceBuffer.splice(0, traceBuffer.length);
  lastTraceSignatureByKey.clear();
}

export function buildAiTraceCapturePayload(state = null) {
  return {
    exportedAtIso: new Date().toISOString(),
    match: state
      ? {
          mode: state.matchConfig?.mode ?? null,
          mapId: state.matchConfig?.mapId ?? null,
          difficultyId: state.matchConfig?.difficultyId ?? null,
          matchTimeSeconds: round3(state.matchTimeSeconds)
        }
      : null,
    traceConfig: state ? getAiTraceConfig(state) : getAiTraceConfig(),
    entries: getEntries()
  };
}

export function downloadAiTraceEntries(state = null, filename = null) {
  const windowObject = globalThis?.window;
  const documentObject = globalThis?.document;
  if (!windowObject || !documentObject) {
    return false;
  }

  const resolvedFilename = filename ?? `swarmbattle-ai-trace-${formatTimestampForFilename(new Date())}.json`;
  const payload = JSON.stringify(buildAiTraceCapturePayload(state), null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = documentObject.createElement("a");
  anchor.href = objectUrl;
  anchor.download = resolvedFilename;
  documentObject.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
  return true;
}

function downloadEntries(filename = null) {
  return downloadAiTraceEntries(null, filename);
}

function buildCapturePayload() {
  return buildAiTraceCapturePayload(null);
}

function clearEntries() {
  clearAiTraceEntries();
}

function getAiTraceConfig(state = globalThis?.window?.__swarmbattleGameState ?? null) {
  return resolveAiTraceConfig(state?.menuSetup?.aiTrace);
}

function resolvePlayerId(value) {
  if (value === "all") {
    return "all";
  }

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return "all";
  }

  return numericValue;
}

function resolveCategoryIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const validCategoryIds = new Set(AI_TRACE_CATEGORY_DEFINITIONS.map((category) => category.id));
  return value.filter((categoryId, index) => {
    return typeof categoryId === "string" && validCategoryIds.has(categoryId) && value.indexOf(categoryId) === index;
  });
}

function formatTimestampForFilename(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
