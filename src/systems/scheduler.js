const DEFAULT_SIMULATION_TICK_RATE = 20;
const DEFAULT_COMBAT_TICK_RATE = 10;
const DEFAULT_MOVEMENT_TICK_RATE = 20;

export const SIMULATION_LANE_DEFINITIONS = [
  {
    id: "commands",
    metricName: "simulation.commands",
    intervalSeconds: 1 / DEFAULT_MOVEMENT_TICK_RATE,
    budgetMs: 0.25
  },
  {
    id: "territory",
    metricName: "simulation.territory",
    intervalSeconds: 0.2,
    budgetMs: 1.5
  },
  {
    id: "mapObjectives",
    metricName: "simulation.mapObjectives",
    intervalSeconds: 0.2,
    budgetMs: 0.75
  },
  {
    id: "resources",
    metricName: "simulation.resources",
    intervalSeconds: 0.2,
    budgetMs: 0.5
  },
  {
    id: "ai",
    metricName: "simulation.ai",
    intervalSeconds: 0.2,
    budgetMs: 2
  },
  {
    id: "pathing",
    metricName: "simulation.pathing",
    intervalSeconds: 1 / DEFAULT_MOVEMENT_TICK_RATE,
    budgetMs: 2
  },
  {
    id: "movement",
    metricName: "simulation.movement",
    intervalSeconds: 1 / DEFAULT_MOVEMENT_TICK_RATE,
    budgetMs: 5
  },
  {
    id: "baseUpgrades",
    metricName: "simulation.baseUpgrades",
    intervalSeconds: 1 / DEFAULT_COMBAT_TICK_RATE,
    budgetMs: 0.25
  },
  {
    id: "techUpgrades",
    metricName: "simulation.techUpgrades",
    intervalSeconds: 1 / DEFAULT_COMBAT_TICK_RATE,
    budgetMs: 0.25
  },
  {
    id: "construction",
    metricName: "simulation.construction",
    intervalSeconds: 1 / DEFAULT_COMBAT_TICK_RATE,
    budgetMs: 0.5
  },
  {
    id: "research",
    metricName: "simulation.research",
    intervalSeconds: 1 / DEFAULT_COMBAT_TICK_RATE,
    budgetMs: 0.25
  },
  {
    id: "production",
    metricName: "simulation.production",
    intervalSeconds: 1 / DEFAULT_COMBAT_TICK_RATE,
    budgetMs: 0.5
  },
  {
    id: "projectiles",
    metricName: "simulation.projectiles",
    intervalSeconds: 1 / DEFAULT_MOVEMENT_TICK_RATE,
    budgetMs: 1.5
  },
  {
    id: "combat",
    metricName: "simulation.combat",
    intervalSeconds: 1 / DEFAULT_COMBAT_TICK_RATE,
    budgetMs: 4
  },
  {
    id: "matchEnd",
    metricName: "simulation.matchEnd",
    intervalSeconds: 1 / DEFAULT_COMBAT_TICK_RATE,
    budgetMs: 0.1
  }
];

const SIMULATION_LANE_DEFINITIONS_BY_ID = Object.fromEntries(
  SIMULATION_LANE_DEFINITIONS.map((definition) => [definition.id, definition])
);

export function createSimulationState() {
  return {
    tickRate: DEFAULT_SIMULATION_TICK_RATE,
    tickDurationSeconds: 1 / DEFAULT_SIMULATION_TICK_RATE,
    currentTick: 0,
    scheduler: createSimulationSchedulerState()
  };
}

export function createSimulationSchedulerState() {
  return {
    aiPlayerCursor: 0,
    lanes: Object.fromEntries(
      SIMULATION_LANE_DEFINITIONS.map((definition) => [
        definition.id,
        {
          id: definition.id,
          intervalSeconds: definition.intervalSeconds,
          budgetMs: definition.budgetMs,
          accumulatedSeconds: 0,
          lastRunTick: -1,
          lastRunDtSeconds: 0,
          lastDurationMs: 0,
          totalRunCount: 0,
          overBudgetCount: 0,
          skippedTickCount: 0
        }
      ])
    )
  };
}

export function getSimulationLaneDefinition(laneId) {
  const definition = SIMULATION_LANE_DEFINITIONS_BY_ID[laneId];
  if (!definition) {
    throw new Error(`Unknown simulation lane: ${laneId}`);
  }

  return definition;
}

export function getSimulationTickDurationSeconds(state) {
  return state.simulation?.tickDurationSeconds ?? 1 / DEFAULT_SIMULATION_TICK_RATE;
}
