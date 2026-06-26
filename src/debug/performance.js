import { getEntitiesByType } from "../state/entities.js";

const METRIC_ORDER = [
  "frame.total",
  "simulation.total",
  "simulation.commands",
  "simulation.territory",
  "simulation.mapObjectives",
  "simulation.resources",
  "simulation.ai",
  "simulation.pathing",
  "simulation.baseUpgrades",
  "simulation.construction",
  "simulation.research",
  "simulation.production",
  "simulation.combat",
  "simulation.matchEnd",
  "render.total",
  "render.background",
  "render.terrain",
  "render.territory",
  "render.placementPreview",
  "render.waypoints",
  "render.buildings",
  "render.projectiles",
  "render.units",
  "render.selection",
  "render.selectionBox",
  "render.screenSpace",
  "ui.panels",
  "ui.placementHint",
  "ai.playerTotal",
  "ai.evaluate",
  "ai.threatScan",
  "ai.strategy",
  "ai.waypoints",
  "ai.macroAction",
  "ai.debugSnapshot"
];

const WINDOW_SIZE = 120;
const MAX_SPIKES = 8;

export function createPerformanceProfile() {
  return {
    frameIndex: 0,
    currentFrame: null,
    metrics: Object.create(null),
    counts: createEntityCounts(),
    spikes: [],
    metricOrder: [...METRIC_ORDER]
  };
}

export function beginPerformanceFrame(state, dtSeconds) {
  const profile = getPerformanceProfile(state);
  profile.currentFrame = {
    startedAtMs: performance.now(),
    dtMs: dtSeconds * 1000,
    sections: Object.create(null),
    counts: createEntityCounts()
  };
}

export function endPerformanceFrame(state) {
  const profile = getPerformanceProfile(state);
  const frame = profile.currentFrame;
  if (!frame) {
    return;
  }

  const totalMs = performance.now() - frame.startedAtMs;
  profile.frameIndex += 1;
  profile.counts = frame.counts;
  recordMetric(profile, "frame.total", totalMs);

  const spike = {
    frame: profile.frameIndex,
    totalMs,
    topSections: getTopSections(frame.sections, 3)
  };
  insertSpike(profile.spikes, spike);
  profile.currentFrame = null;
}

export function measurePerformance(state, metricName, callback) {
  const startedAtMs = performance.now();
  const result = callback();
  recordSectionTiming(state, metricName, performance.now() - startedAtMs);
  return result;
}

export function updatePerformanceEntityCounts(state) {
  const profile = getPerformanceProfile(state);
  const frame = profile.currentFrame;
  if (!frame) {
    return;
  }

  const counts = createEntityCounts();
  counts.territoryCells = state.territory?.cells.length ?? 0;
  counts.units = getEntitiesByType(state, "unit").length;
  counts.buildings = getEntitiesByType(state, "building").length;
  counts.projectiles = getEntitiesByType(state, "projectile").length;
  counts.total = counts.units + counts.buildings + counts.projectiles;

  frame.counts = counts;
}

export function getPerformanceSummary(state) {
  const profile = getPerformanceProfile(state);
  return {
    frameIndex: profile.frameIndex,
    counts: profile.counts,
    frame: summarizeMetric(profile.metrics["frame.total"]),
    simulation: summarizeMetric(profile.metrics["simulation.total"]),
    render: summarizeMetric(profile.metrics["render.total"]),
    panels: summarizeMetric(profile.metrics["ui.panels"]),
    scheduler: getSchedulerSummary(state),
    renderSections: getTopMetricsByPrefix(profile, "render.", 6, new Set(["render.total"])),
    hottestMetrics: getHottestMetrics(profile, 6),
    recentSpikes: profile.spikes.map((spike) => ({
      frame: spike.frame,
      totalMs: spike.totalMs,
      topSections: spike.topSections.map((section) => ({ ...section }))
    }))
  };
}

function getPerformanceProfile(state) {
  state.performance ??= createPerformanceProfile();
  return state.performance;
}

function recordSectionTiming(state, metricName, durationMs) {
  const profile = getPerformanceProfile(state);
  const frame = profile.currentFrame;
  if (!frame) {
    return;
  }

  frame.sections[metricName] = (frame.sections[metricName] ?? 0) + durationMs;
  recordMetric(profile, metricName, durationMs);
}

function recordMetric(profile, metricName, durationMs) {
  const metric = profile.metrics[metricName] ?? createMetric();
  profile.metrics[metricName] = metric;
  metric.lastMs = durationMs;
  metric.sumMs += durationMs;
  metric.sampleCount += 1;
  metric.maxMs = Math.max(metric.maxMs, durationMs);
  metric.samples.push(durationMs);

  if (metric.samples.length > WINDOW_SIZE) {
    const removed = metric.samples.shift();
    metric.windowSumMs -= removed;
  }

  metric.windowSumMs += durationMs;
  metric.windowAverageMs = metric.windowSumMs / metric.samples.length;
}

function createMetric() {
  return {
    lastMs: 0,
    maxMs: 0,
    sumMs: 0,
    sampleCount: 0,
    samples: [],
    windowSumMs: 0,
    windowAverageMs: 0
  };
}

function summarizeMetric(metric) {
  if (!metric || metric.sampleCount === 0) {
    return null;
  }

  return {
    lastMs: metric.lastMs,
    avgMs: metric.windowAverageMs,
    maxMs: metric.maxMs,
    samples: metric.sampleCount
  };
}

function getHottestMetrics(profile, count) {
  return METRIC_ORDER
    .map((metricName) => ({
      name: metricName,
      summary: summarizeMetric(profile.metrics[metricName])
    }))
    .filter((entry) => entry.summary && entry.name !== "frame.total")
    .sort((left, right) => right.summary.avgMs - left.summary.avgMs)
    .slice(0, count);
}

function getTopMetricsByPrefix(profile, prefix, count, excludedNames = new Set()) {
  return METRIC_ORDER
    .filter((metricName) => metricName.startsWith(prefix) && !excludedNames.has(metricName))
    .map((metricName) => ({
      name: metricName,
      summary: summarizeMetric(profile.metrics[metricName])
    }))
    .filter((entry) => entry.summary)
    .sort((left, right) => right.summary.avgMs - left.summary.avgMs)
    .slice(0, count);
}

function getTopSections(sections, count) {
  return Object.entries(sections)
    .map(([name, totalMs]) => ({ name, totalMs }))
    .sort((left, right) => right.totalMs - left.totalMs)
    .slice(0, count);
}

function insertSpike(spikes, spike) {
  spikes.push(spike);
  spikes.sort((left, right) => right.totalMs - left.totalMs);
  if (spikes.length > MAX_SPIKES) {
    spikes.length = MAX_SPIKES;
  }
}

function createEntityCounts() {
  return {
    total: 0,
    units: 0,
    buildings: 0,
    projectiles: 0,
    territoryCells: 0
  };
}

function getSchedulerSummary(state) {
  const lanes = state.simulation?.scheduler?.lanes;
  if (!lanes) {
    return [];
  }

  return Object.values(lanes).map((lane) => ({
    id: lane.id,
    intervalSeconds: lane.intervalSeconds,
    budgetMs: lane.budgetMs,
    lastRunDtSeconds: lane.lastRunDtSeconds,
    lastDurationMs: lane.lastDurationMs,
    overBudgetCount: lane.overBudgetCount,
    totalRunCount: lane.totalRunCount
  }));
}
