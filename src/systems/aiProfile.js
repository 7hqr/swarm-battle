const TECH_BRANCH_PLANS = {
  basic: {
    early: ["basic_health_1", "basic_attack_cooldown_1"],
    pressure: ["basic_pressure_focus", "basic_pressure_follow_up"],
    defense: ["basic_line_focus", "basic_line_follow_up"]
  },
  disposable_swarm: {
    early: ["swarm_move_speed_1", "swarm_build_time_1"],
    pressure: ["swarm_surround_focus", "swarm_surround_follow_up"],
    defense: ["swarm_approach_focus", "swarm_approach_follow_up"]
  },
  ranged_damage: {
    early: ["ranged_attack_damage_1", "ranged_mobility_1"],
    pressure: ["ranged_fire_lane_focus", "ranged_fire_lane_follow_up"],
    defense: ["ranged_self_preservation_focus", "ranged_self_preservation_follow_up"]
  },
  tanky_frontline: {
    early: ["frontline_health_1", "frontline_move_speed_1"],
    pressure: ["frontline_pressure_focus", "frontline_pressure_follow_up"],
    defense: ["frontline_wall_focus", "frontline_wall_follow_up"]
  },
  anti_swarm: {
    early: ["anti_swarm_chain_range_1", "anti_swarm_attack_cooldown_1"],
    pressure: ["anti_swarm_chain_burst_focus", "anti_swarm_chain_burst_follow_up"],
    defense: ["anti_swarm_chain_coverage_focus", "anti_swarm_chain_coverage_follow_up"]
  },
  anti_tank: {
    early: ["anti_tank_attack_damage_1", "anti_tank_projectile_speed_1"],
    pressure: ["anti_tank_tracking_focus", "anti_tank_tracking_follow_up"],
    defense: ["anti_tank_heavy_focus", "anti_tank_heavy_follow_up"]
  }
};

const BASELINE_AI_PROFILE = {
  strategicReserve: 85,
  targetNetIncome: 0.05,
  coreExpansionTargetTime: 21,
  techTargetTime: 12,
  advancedTargetTime: 31,
  economyBias: 1,
  expansionBias: 1,
  pressureBias: 1,
  defenseBias: 1,
  techBias: 1.04,
  objectiveBias: 1,
  riskTolerance: 1,
  commitmentCaution: 0.36,
  actionWeights: {
    build_core: 1.02,
    build_tech: 1.08,
    build_advanced: 1.02,
    upgrade_base: 1.04,
    research: 1.08
  },
  roleBiases: {
    basic: 1,
    swarm: 1,
    ranged: 1,
    frontline: 1,
    anti_swarm: 1,
    anti_tank: 1
  },
  researchPlan: createResearchPlan([
    ["basic", "defense"],
    ["ranged_damage", "pressure"],
    ["tanky_frontline", "defense"],
    ["disposable_swarm", "pressure"],
    ["anti_tank", "pressure"],
    ["anti_swarm", "defense"]
  ]),
  basePosture: {
    forwardBias: 1.01,
    maxForwardProgress: 0.54,
    holdThreatThreshold: 0.32,
    retreatThreatThreshold: 0.51,
    overwhelmingThreatThreshold: 0.67,
    retreatArmyRatio: 0.81,
    retreatHealthThreshold: 0.26,
    retargetIntervalSeconds: 3,
    minimumEnemyDistanceGain: 63
  }
};

export function createInitialAiState() {
  return {
    thinkCooldownSeconds: 0,
    strategicReserve: BASELINE_AI_PROFILE.strategicReserve,
    targetNetIncome: BASELINE_AI_PROFILE.targetNetIncome,
    coreExpansionTargetTime: BASELINE_AI_PROFILE.coreExpansionTargetTime,
    techTargetTime: BASELINE_AI_PROFILE.techTargetTime,
    advancedTargetTime: BASELINE_AI_PROFILE.advancedTargetTime,
    economyBias: BASELINE_AI_PROFILE.economyBias,
    expansionBias: BASELINE_AI_PROFILE.expansionBias,
    pressureBias: BASELINE_AI_PROFILE.pressureBias,
    defenseBias: BASELINE_AI_PROFILE.defenseBias,
    techBias: BASELINE_AI_PROFILE.techBias,
    objectiveBias: BASELINE_AI_PROFILE.objectiveBias,
    riskTolerance: BASELINE_AI_PROFILE.riskTolerance,
    commitmentCaution: BASELINE_AI_PROFILE.commitmentCaution,
    actionWeights: { ...BASELINE_AI_PROFILE.actionWeights },
    roleBiases: { ...BASELINE_AI_PROFILE.roleBiases },
    researchPlan: [...BASELINE_AI_PROFILE.researchPlan],
    baseForwardBias: BASELINE_AI_PROFILE.basePosture.forwardBias,
    baseMaxForwardProgress: BASELINE_AI_PROFILE.basePosture.maxForwardProgress,
    baseHoldThreatThreshold: BASELINE_AI_PROFILE.basePosture.holdThreatThreshold,
    baseRetreatThreatThreshold: BASELINE_AI_PROFILE.basePosture.retreatThreatThreshold,
    baseOverwhelmingThreatThreshold: BASELINE_AI_PROFILE.basePosture.overwhelmingThreatThreshold,
    baseRetreatArmyRatio: BASELINE_AI_PROFILE.basePosture.retreatArmyRatio,
    baseRetreatHealthThreshold: BASELINE_AI_PROFILE.basePosture.retreatHealthThreshold,
    baseRetargetIntervalSeconds: BASELINE_AI_PROFILE.basePosture.retargetIntervalSeconds,
    baseMinimumEnemyDistanceGain: BASELINE_AI_PROFILE.basePosture.minimumEnemyDistanceGain,
    threatScanCooldownSeconds: 0,
    strategyCooldownSeconds: 0,
    baseWaypointCooldownSeconds: randomRange([0.5, 1.5]),
    buildingWaypointCooldownSeconds: randomRange([1.5, 3]),
    macroActionCooldownSeconds: randomRange([0.15, 0.45]),
    buildingWaypointIntervalRange: [2, 5],
    waypointBuildingCooldowns: {},
    waypointBuildingCursor: 0,
    macroActionPipeline: null,
    lastBaseRelocationPlanTimeSeconds: Number.NEGATIVE_INFINITY,
    lastEvaluationTick: -1,
    lastEvaluationTimeSeconds: -1,
    jobRunCounts: {},
    strategicIntent: null,
    latestThreats: null,
    debugSummary: null,
    debugWaypointPlan: null
  };
}

function createResearchPlan(branches) {
  const plan = [];

  for (const [branchId, focus] of branches) {
    const branchPlan = TECH_BRANCH_PLANS[branchId];
    if (!branchPlan) {
      throw new Error(`Unknown AI research branch: ${branchId}`);
    }

    plan.push(...branchPlan.early);
    plan.push(...branchPlan[focus]);
  }

  return plan;
}

function randomRange([min, max]) {
  return min + Math.random() * (max - min);
}
