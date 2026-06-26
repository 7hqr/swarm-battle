import { checkMatchEnd } from "../gameState.js";
import { measurePerformance } from "../debug/performance.js";
import { processGameplayCommands } from "../gameplayCommands.js";
import { isSimulationAuthority } from "../multiplayer/matchRuntime.js";
import { updateBaseUpgrades } from "./baseUpgrades.js";
import { updateConstructionProgress } from "./construction.js";
import { updateAi } from "./ai.js";
import { updateCombat, updateProjectileMotion, updateUnitCombatMovement } from "./combat.js";
import { updateMapObjectives } from "./mapObjectives.js";
import { updateProduction } from "./production.js";
import { updateResearch } from "./research.js";
import { updateResources } from "./resources.js";
import { updateTechUpgrades } from "./techUpgrades.js";
import { updateBaseMovement } from "./baseMovement.js";
import { processPathfindingQueue } from "./navigation.js";
import { getSimulationLaneDefinition } from "./scheduler.js";
import { updateTerritory } from "./territory.js";

export function stepSimulation(state, dt) {
  if (!state.hasActiveMatch || state.uiScreen !== "playing" || state.matchEnded || !isSimulationAuthority(state)) {
    return;
  }

  state.simulation.currentTick += 1;
  state.matchTimeSeconds += dt;

  runSimulationLane(state, "commands", dt, () => {
    processGameplayCommands(state);
  });
  runSimulationLane(state, "territory", dt, (laneDt) => {
    updateTerritory(state, laneDt);
  });
  runSimulationLane(state, "mapObjectives", dt, (laneDt) => {
    updateMapObjectives(state, laneDt);
  });
  runSimulationLane(state, "resources", dt, (laneDt) => {
    updateResources(state, laneDt);
  });
  runSimulationLane(state, "ai", dt, (laneDt, lane) => {
    updateAi(state, laneDt, { budgetMs: lane.budgetMs });
  });
  runSimulationLane(state, "pathing", dt, (_laneDt, lane) => {
    processPathfindingQueue(state, lane.budgetMs);
  });
  runSimulationLane(state, "baseUpgrades", dt, (laneDt) => {
    updateBaseUpgrades(state, laneDt);
  });
  runSimulationLane(state, "techUpgrades", dt, (laneDt) => {
    updateTechUpgrades(state, laneDt);
  });
  runSimulationLane(state, "construction", dt, (laneDt) => {
    updateConstructionProgress(state, laneDt);
  });
  runSimulationLane(state, "research", dt, (laneDt) => {
    updateResearch(state, laneDt);
  });
  runSimulationLane(state, "production", dt, (laneDt) => {
    updateProduction(state, laneDt);
  });
  runSimulationLane(state, "movement", dt, (laneDt) => {
    updateBaseMovement(state, laneDt);
    updateUnitCombatMovement(state, laneDt);
  });
  runSimulationLane(state, "combat", dt, (laneDt) => {
    updateCombat(state, laneDt);
  });
  runSimulationLane(state, "projectiles", dt, (laneDt) => {
    updateProjectileMotion(state, laneDt);
  });
  runSimulationLane(state, "matchEnd", dt, () => {
    checkMatchEnd(state);
  });
}

function runSimulationLane(state, laneId, dt, callback) {
  const definition = getSimulationLaneDefinition(laneId);
  const lane = state.simulation.scheduler.lanes[laneId];
  lane.accumulatedSeconds += dt;

  if (lane.accumulatedSeconds + 0.000001 < definition.intervalSeconds) {
    lane.skippedTickCount += 1;
    return false;
  }

  const laneDt = lane.accumulatedSeconds;
  lane.accumulatedSeconds = 0;
  const startedAtMs = performance.now();
  measurePerformance(state, definition.metricName, () => {
    callback(laneDt, lane);
  });
  const durationMs = performance.now() - startedAtMs;
  lane.lastRunTick = state.simulation.currentTick;
  lane.lastRunDtSeconds = laneDt;
  lane.lastDurationMs = durationMs;
  lane.totalRunCount += 1;
  if (durationMs > lane.budgetMs) {
    lane.overBudgetCount += 1;
  }
  return true;
}
