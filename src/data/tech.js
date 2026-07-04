const rawTechBranchDefinitions = [
  {
    id: "basic",
    displayName: "Basic",
    unitId: "basic",
    order: 0
  },
  {
    id: "disposable_swarm",
    displayName: "Swarm",
    unitId: "disposable_swarm",
    order: 1
  },
  {
    id: "ranged_damage",
    displayName: "Ranged",
    unitId: "ranged_damage",
    order: 2
  },
  {
    id: "tanky_frontline",
    displayName: "Frontline",
    unitId: "tanky_frontline",
    order: 3
  },
  {
    id: "anti_swarm",
    displayName: "Anti-Swarm",
    unitId: "anti_swarm",
    order: 4
  },
  {
    id: "anti_tank",
    displayName: "Anti-Tank",
    unitId: "anti_tank",
    order: 5
  }
];

const rawTechDefinitions = [
  {
    id: "basic_health_1",
    branchId: "basic",
    displayName: "Health +10",
    description: "Basic max health +10.",
    cost: 170,
    researchTime: 64,
    requiredTechTier: 1,
    prerequisiteIds: [],
    exclusiveGroupId: null,
    layout: { row: 0, column: 0 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["basic"] },
        stat: "maxHealth",
        operation: "add",
        value: 10
      }
    ]
  },
  {
    id: "basic_attack_cooldown_1",
    branchId: "basic",
    displayName: "Attack cooldown -0.08s",
    description: "Basic attack cooldown -0.08s.",
    cost: 210,
    researchTime: 76,
    requiredTechTier: 1,
    prerequisiteIds: ["basic_health_1"],
    exclusiveGroupId: null,
    layout: { row: 1, column: 0 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["basic"] },
        stat: "attackCooldown",
        operation: "add",
        value: -0.08
      }
    ]
  },
  {
    id: "basic_pressure_focus",
    branchId: "basic",
    displayName: "Pressure focus",
    description: "Basic move speed +5 and attack range +8.",
    cost: 300,
    researchTime: 100,
    requiredTechTier: 1,
    prerequisiteIds: ["basic_attack_cooldown_1"],
    exclusiveGroupId: "basic_fork_1",
    layout: { row: 2, column: -1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["basic"] },
        stat: "moveSpeed",
        operation: "add",
        value: 5
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["basic"] },
        stat: "attackRange",
        operation: "add",
        value: 8
      }
    ]
  },
  {
    id: "basic_line_focus",
    branchId: "basic",
    displayName: "Line focus",
    description: "Basic max health +14 and aggro persistence time +0.35s.",
    cost: 300,
    researchTime: 100,
    requiredTechTier: 1,
    prerequisiteIds: ["basic_attack_cooldown_1"],
    exclusiveGroupId: "basic_fork_1",
    layout: { row: 2, column: 1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["basic"] },
        stat: "maxHealth",
        operation: "add",
        value: 14
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["basic"] },
        stat: "aggroPersistenceTime",
        operation: "add",
        value: 0.35
      }
    ]
  },
  {
    id: "basic_pressure_follow_up",
    branchId: "basic",
    displayName: "Pressure follow-up",
    description: "Basic build time -0.5s.",
    cost: 400,
    researchTime: 128,
    requiredTechTier: 1,
    prerequisiteIds: ["basic_pressure_focus"],
    exclusiveGroupId: null,
    layout: { row: 3, column: -1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["basic"] },
        stat: "buildTime",
        operation: "add",
        value: -0.5
      }
    ]
  },
  {
    id: "basic_line_follow_up",
    branchId: "basic",
    displayName: "Line follow-up",
    description: "Basic max health +16.",
    cost: 400,
    researchTime: 128,
    requiredTechTier: 1,
    prerequisiteIds: ["basic_line_focus"],
    exclusiveGroupId: null,
    layout: { row: 3, column: 1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["basic"] },
        stat: "maxHealth",
        operation: "add",
        value: 16
      }
    ]
  },
  {
    id: "swarm_move_speed_1",
    branchId: "disposable_swarm",
    displayName: "Move speed +6",
    description: "Swarm move speed +6.",
    cost: 180,
    researchTime: 64,
    requiredTechTier: 2,
    prerequisiteIds: [],
    exclusiveGroupId: null,
    layout: { row: 0, column: 0 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["disposable_swarm"] },
        stat: "moveSpeed",
        operation: "add",
        value: 6
      }
    ]
  },
  {
    id: "swarm_build_time_1",
    branchId: "disposable_swarm",
    displayName: "Build time -0.35s",
    description: "Swarm build time -0.35s.",
    cost: 220,
    researchTime: 76,
    requiredTechTier: 2,
    prerequisiteIds: ["swarm_move_speed_1"],
    exclusiveGroupId: null,
    layout: { row: 1, column: 0 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["disposable_swarm"] },
        stat: "buildTime",
        operation: "add",
        value: -0.35
      }
    ]
  },
  {
    id: "swarm_surround_focus",
    branchId: "disposable_swarm",
    displayName: "Surround focus",
    description: "Swarm attack cooldown -0.05s and max turn rate +1.2.",
    cost: 300,
    researchTime: 100,
    requiredTechTier: 2,
    prerequisiteIds: ["swarm_build_time_1"],
    exclusiveGroupId: "swarm_fork_1",
    layout: { row: 2, column: -1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["disposable_swarm"] },
        stat: "attackCooldown",
        operation: "add",
        value: -0.05
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["disposable_swarm"] },
        stat: "maxTurnRateRadians",
        operation: "add",
        value: 1.2
      }
    ]
  },
  {
    id: "swarm_approach_focus",
    branchId: "disposable_swarm",
    displayName: "Approach focus",
    description: "Swarm max health +8 and leash distance +18.",
    cost: 300,
    researchTime: 100,
    requiredTechTier: 2,
    prerequisiteIds: ["swarm_build_time_1"],
    exclusiveGroupId: "swarm_fork_1",
    layout: { row: 2, column: 1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["disposable_swarm"] },
        stat: "maxHealth",
        operation: "add",
        value: 8
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["disposable_swarm"] },
        stat: "leashDistance",
        operation: "add",
        value: 18
      }
    ]
  },
  {
    id: "swarm_surround_follow_up",
    branchId: "disposable_swarm",
    displayName: "Surround follow-up",
    description: "Swarm attack damage +1 and move speed +5.",
    cost: 390,
    researchTime: 124,
    requiredTechTier: 2,
    prerequisiteIds: ["swarm_surround_focus"],
    exclusiveGroupId: null,
    layout: { row: 3, column: -1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["disposable_swarm"] },
        stat: "attackDamage",
        operation: "add",
        value: 1
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["disposable_swarm"] },
        stat: "moveSpeed",
        operation: "add",
        value: 5
      }
    ]
  },
  {
    id: "swarm_approach_follow_up",
    branchId: "disposable_swarm",
    displayName: "Approach follow-up",
    description: "Swarm aggro persistence time +0.45s and target switch cooldown -0.05s.",
    cost: 390,
    researchTime: 124,
    requiredTechTier: 2,
    prerequisiteIds: ["swarm_approach_focus"],
    exclusiveGroupId: null,
    layout: { row: 3, column: 1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["disposable_swarm"] },
        stat: "aggroPersistenceTime",
        operation: "add",
        value: 0.45
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["disposable_swarm"] },
        stat: "targetSwitchCooldown",
        operation: "add",
        value: -0.05
      }
    ]
  },
  {
    id: "ranged_attack_damage_1",
    branchId: "ranged_damage",
    displayName: "Attack damage +2",
    description: "Ranged attack damage +2.",
    cost: 185,
    researchTime: 68,
    requiredTechTier: 2,
    prerequisiteIds: [],
    exclusiveGroupId: null,
    layout: { row: 0, column: 0 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["ranged_damage"] },
        stat: "attackDamage",
        operation: "add",
        value: 2
      }
    ]
  },
  {
    id: "ranged_mobility_1",
    branchId: "ranged_damage",
    displayName: "Move speed +3",
    description: "Ranged move speed +3.",
    cost: 225,
    researchTime: 80,
    requiredTechTier: 2,
    prerequisiteIds: ["ranged_attack_damage_1"],
    exclusiveGroupId: null,
    layout: { row: 1, column: 0 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["ranged_damage"] },
        stat: "moveSpeed",
        operation: "add",
        value: 3
      }
    ]
  },
  {
    id: "ranged_fire_lane_focus",
    branchId: "ranged_damage",
    displayName: "Fire lane focus",
    description: "Ranged attack range +16 and attack damage +2.",
    cost: 310,
    researchTime: 104,
    requiredTechTier: 2,
    prerequisiteIds: ["ranged_mobility_1"],
    exclusiveGroupId: "ranged_fork_1",
    layout: { row: 2, column: -1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["ranged_damage"] },
        stat: "attackRange",
        operation: "add",
        value: 16
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["ranged_damage"] },
        stat: "attackDamage",
        operation: "add",
        value: 2
      }
    ]
  },
  {
    id: "ranged_self_preservation_focus",
    branchId: "ranged_damage",
    displayName: "Self-preservation focus",
    description: "Ranged max health +12 and move speed +4.",
    cost: 310,
    researchTime: 104,
    requiredTechTier: 2,
    prerequisiteIds: ["ranged_mobility_1"],
    exclusiveGroupId: "ranged_fork_1",
    layout: { row: 2, column: 1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["ranged_damage"] },
        stat: "maxHealth",
        operation: "add",
        value: 12
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["ranged_damage"] },
        stat: "moveSpeed",
        operation: "add",
        value: 4
      }
    ]
  },
  {
    id: "ranged_fire_lane_follow_up",
    branchId: "ranged_damage",
    displayName: "Fire lane follow-up",
    description: "Ranged attack cooldown -0.12s.",
    cost: 405,
    researchTime: 132,
    requiredTechTier: 2,
    prerequisiteIds: ["ranged_fire_lane_focus"],
    exclusiveGroupId: null,
    layout: { row: 3, column: -1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["ranged_damage"] },
        stat: "attackCooldown",
        operation: "add",
        value: -0.12
      }
    ]
  },
  {
    id: "ranged_self_preservation_follow_up",
    branchId: "ranged_damage",
    displayName: "Self-preservation follow-up",
    description: "Ranged target switch cooldown -0.2s and max health +10.",
    cost: 405,
    researchTime: 132,
    requiredTechTier: 2,
    prerequisiteIds: ["ranged_self_preservation_focus"],
    exclusiveGroupId: null,
    layout: { row: 3, column: 1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["ranged_damage"] },
        stat: "targetSwitchCooldown",
        operation: "add",
        value: -0.2
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["ranged_damage"] },
        stat: "maxHealth",
        operation: "add",
        value: 10
      }
    ]
  },
  {
    id: "frontline_health_1",
    branchId: "tanky_frontline",
    displayName: "Health +30",
    description: "Frontline max health +30.",
    cost: 250,
    researchTime: 80,
    requiredTechTier: 3,
    prerequisiteIds: [],
    exclusiveGroupId: null,
    layout: { row: 0, column: 0 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["tanky_frontline"] },
        stat: "maxHealth",
        operation: "add",
        value: 30
      }
    ]
  },
  {
    id: "frontline_move_speed_1",
    branchId: "tanky_frontline",
    displayName: "Move speed +3",
    description: "Frontline move speed +3.",
    cost: 290,
    researchTime: 92,
    requiredTechTier: 3,
    prerequisiteIds: ["frontline_health_1"],
    exclusiveGroupId: null,
    layout: { row: 1, column: 0 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["tanky_frontline"] },
        stat: "moveSpeed",
        operation: "add",
        value: 3
      }
    ]
  },
  {
    id: "frontline_wall_focus",
    branchId: "tanky_frontline",
    displayName: "Reactive plating",
    description: "Frontline max health +36, aggro persistence time +0.8s, and reflect damage +6.",
    cost: 360,
    researchTime: 112,
    requiredTechTier: 3,
    prerequisiteIds: ["frontline_move_speed_1"],
    exclusiveGroupId: "frontline_fork_1",
    layout: { row: 2, column: -1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["tanky_frontline"] },
        stat: "maxHealth",
        operation: "add",
        value: 36
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["tanky_frontline"] },
        stat: "aggroPersistenceTime",
        operation: "add",
        value: 0.8
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["tanky_frontline"] },
        stat: "reflectDamage",
        operation: "add",
        value: 6
      },
      {
        kind: "add_unit_behavior",
        target: { unitIds: ["tanky_frontline"] },
        behaviorId: "reflect_damage"
      }
    ]
  },
  {
    id: "frontline_pressure_focus",
    branchId: "tanky_frontline",
    displayName: "Detonation march",
    description: "Frontline move speed +4, death explosion damage +42, loses its normal attack, and keeps marching its route.",
    cost: 360,
    researchTime: 112,
    requiredTechTier: 3,
    prerequisiteIds: ["frontline_move_speed_1"],
    exclusiveGroupId: "frontline_fork_1",
    layout: { row: 2, column: 1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["tanky_frontline"] },
        stat: "moveSpeed",
        operation: "add",
        value: 4
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["tanky_frontline"] },
        stat: "deathExplosionDamage",
        operation: "add",
        value: 42
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["tanky_frontline"] },
        stat: "deathExplosionRadius",
        operation: "add",
        value: 48
      },
      {
        kind: "add_unit_behavior",
        target: { unitIds: ["tanky_frontline"] },
        behaviorId: "death_explosion"
      },
      {
        kind: "add_unit_behavior",
        target: { unitIds: ["tanky_frontline"] },
        behaviorId: "route_locked_no_attack"
      }
    ]
  },
  {
    id: "frontline_wall_follow_up",
    branchId: "tanky_frontline",
    displayName: "Reactive overload",
    description: "Frontline max health +44 and reflect damage +8.",
    cost: 460,
    researchTime: 140,
    requiredTechTier: 3,
    prerequisiteIds: ["frontline_wall_focus"],
    exclusiveGroupId: null,
    layout: { row: 3, column: -1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["tanky_frontline"] },
        stat: "maxHealth",
        operation: "add",
        value: 44
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["tanky_frontline"] },
        stat: "reflectDamage",
        operation: "add",
        value: 8
      }
    ]
  },
  {
    id: "frontline_pressure_follow_up",
    branchId: "tanky_frontline",
    displayName: "Detonation overload",
    description: "Frontline death explosion damage +28, death explosion radius +20, and move speed +3.",
    cost: 460,
    researchTime: 140,
    requiredTechTier: 3,
    prerequisiteIds: ["frontline_pressure_focus"],
    exclusiveGroupId: null,
    layout: { row: 3, column: 1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["tanky_frontline"] },
        stat: "deathExplosionDamage",
        operation: "add",
        value: 28
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["tanky_frontline"] },
        stat: "deathExplosionRadius",
        operation: "add",
        value: 20
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["tanky_frontline"] },
        stat: "moveSpeed",
        operation: "add",
        value: 3
      }
    ]
  },
  {
    id: "anti_swarm_chain_range_1",
    branchId: "anti_swarm",
    displayName: "Chain range +24",
    description: "Anti-swarm chain range +24.",
    cost: 250,
    researchTime: 80,
    requiredTechTier: 3,
    prerequisiteIds: [],
    exclusiveGroupId: null,
    layout: { row: 0, column: 0 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_swarm"] },
        stat: "chainRange",
        operation: "add",
        value: 24
      }
    ]
  },
  {
    id: "anti_swarm_attack_cooldown_1",
    branchId: "anti_swarm",
    displayName: "Attack cooldown -0.08s",
    description: "Anti-swarm attack cooldown -0.08s.",
    cost: 290,
    researchTime: 92,
    requiredTechTier: 3,
    prerequisiteIds: ["anti_swarm_chain_range_1"],
    exclusiveGroupId: null,
    layout: { row: 1, column: 0 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_swarm"] },
        stat: "attackCooldown",
        operation: "add",
        value: -0.08
      }
    ]
  },
  {
    id: "anti_swarm_chain_coverage_focus",
    branchId: "anti_swarm",
    displayName: "Chain coverage focus",
    description: "Anti-swarm chain max jumps +1 and chain damage multiplier -0.08.",
    cost: 360,
    researchTime: 112,
    requiredTechTier: 3,
    prerequisiteIds: ["anti_swarm_attack_cooldown_1"],
    exclusiveGroupId: "anti_swarm_fork_1",
    layout: { row: 2, column: -1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_swarm"] },
        stat: "chainMaxJumps",
        operation: "add",
        value: 1
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_swarm"] },
        stat: "chainDamageMultiplier",
        operation: "add",
        value: -0.08
      }
    ]
  },
  {
    id: "anti_swarm_chain_burst_focus",
    branchId: "anti_swarm",
    displayName: "Chain burst focus",
    description: "Anti-swarm chain max jumps -1, chain damage multiplier +0.14, and attack damage +2.",
    cost: 360,
    researchTime: 112,
    requiredTechTier: 3,
    prerequisiteIds: ["anti_swarm_attack_cooldown_1"],
    exclusiveGroupId: "anti_swarm_fork_1",
    layout: { row: 2, column: 1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_swarm"] },
        stat: "chainMaxJumps",
        operation: "add",
        value: -1
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_swarm"] },
        stat: "chainDamageMultiplier",
        operation: "add",
        value: 0.14
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_swarm"] },
        stat: "attackDamage",
        operation: "add",
        value: 2
      }
    ]
  },
  {
    id: "anti_swarm_chain_coverage_follow_up",
    branchId: "anti_swarm",
    displayName: "Chain coverage follow-up",
    description: "Anti-swarm chain range +28.",
    cost: 460,
    researchTime: 140,
    requiredTechTier: 3,
    prerequisiteIds: ["anti_swarm_chain_coverage_focus"],
    exclusiveGroupId: null,
    layout: { row: 3, column: -1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_swarm"] },
        stat: "chainRange",
        operation: "add",
        value: 28
      }
    ]
  },
  {
    id: "anti_swarm_chain_burst_follow_up",
    branchId: "anti_swarm",
    displayName: "Chain burst follow-up",
    description: "Anti-swarm attack damage +3.",
    cost: 460,
    researchTime: 140,
    requiredTechTier: 3,
    prerequisiteIds: ["anti_swarm_chain_burst_focus"],
    exclusiveGroupId: null,
    layout: { row: 3, column: 1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_swarm"] },
        stat: "attackDamage",
        operation: "add",
        value: 3
      }
    ]
  },
  {
    id: "anti_tank_attack_damage_1",
    branchId: "anti_tank",
    displayName: "Attack damage +5",
    description: "Anti-tank attack damage +5.",
    cost: 250,
    researchTime: 80,
    requiredTechTier: 3,
    prerequisiteIds: [],
    exclusiveGroupId: null,
    layout: { row: 0, column: 0 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_tank"] },
        stat: "attackDamage",
        operation: "add",
        value: 5
      }
    ]
  },
  {
    id: "anti_tank_projectile_speed_1",
    branchId: "anti_tank",
    displayName: "Projectile speed +35",
    description: "Anti-tank projectile speed +35.",
    cost: 290,
    researchTime: 92,
    requiredTechTier: 3,
    prerequisiteIds: ["anti_tank_attack_damage_1"],
    exclusiveGroupId: null,
    layout: { row: 1, column: 0 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_tank"] },
        stat: "projectileSpeed",
        operation: "add",
        value: 35
      }
    ]
  },
  {
    id: "anti_tank_heavy_focus",
    branchId: "anti_tank",
    displayName: "Heavy focus",
    description: "Anti-tank attack damage +7.",
    cost: 360,
    researchTime: 112,
    requiredTechTier: 3,
    prerequisiteIds: ["anti_tank_projectile_speed_1"],
    exclusiveGroupId: "anti_tank_fork_1",
    layout: { row: 2, column: -1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_tank"] },
        stat: "attackDamage",
        operation: "add",
        value: 7
      }
    ]
  },
  {
    id: "anti_tank_tracking_focus",
    branchId: "anti_tank",
    displayName: "Tracking focus",
    description: "Anti-tank projectile speed +30 and target switch cooldown -0.2s.",
    cost: 360,
    researchTime: 112,
    requiredTechTier: 3,
    prerequisiteIds: ["anti_tank_projectile_speed_1"],
    exclusiveGroupId: "anti_tank_fork_1",
    layout: { row: 2, column: 1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_tank"] },
        stat: "projectileSpeed",
        operation: "add",
        value: 30
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_tank"] },
        stat: "targetSwitchCooldown",
        operation: "add",
        value: -0.2
      }
    ]
  },
  {
    id: "anti_tank_heavy_follow_up",
    branchId: "anti_tank",
    displayName: "Heavy follow-up",
    description: "Anti-tank attack range +12 and attack cooldown -0.1s.",
    cost: 460,
    researchTime: 140,
    requiredTechTier: 3,
    prerequisiteIds: ["anti_tank_heavy_focus"],
    exclusiveGroupId: null,
    layout: { row: 3, column: -1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_tank"] },
        stat: "attackRange",
        operation: "add",
        value: 12
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_tank"] },
        stat: "attackCooldown",
        operation: "add",
        value: -0.1
      }
    ]
  },
  {
    id: "anti_tank_tracking_follow_up",
    branchId: "anti_tank",
    displayName: "Tracking follow-up",
    description: "Anti-tank projectile speed +45 and move speed +4.",
    cost: 460,
    researchTime: 140,
    requiredTechTier: 3,
    prerequisiteIds: ["anti_tank_tracking_focus"],
    exclusiveGroupId: null,
    layout: { row: 3, column: 1 },
    effects: [
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_tank"] },
        stat: "projectileSpeed",
        operation: "add",
        value: 45
      },
      {
        kind: "modify_unit_stat",
        target: { unitIds: ["anti_tank"] },
        stat: "moveSpeed",
        operation: "add",
        value: 4
      }
    ]
  }
];

export const techBranchDefinitions = rawTechBranchDefinitions.map((definition) => ({ ...definition }));
export const techDefinitions = rawTechDefinitions.map((definition) => {
  const {
    requiredTechTier: _obsoleteRequiredTechTier,
    ...resolvedDefinition
  } = definition;

  return {
    ...resolvedDefinition,
    requiredTechCenterLevel: definition.layout.row + 1,
    prerequisiteIds: [...definition.prerequisiteIds],
    layout: { ...definition.layout },
    effects: definition.effects.map((effect) => ({
      ...effect,
      target: effect.target ? { unitIds: [...(effect.target.unitIds ?? [])] } : effect.target
    }))
  };
});

const VALID_TECH_BEHAVIOR_IDS = new Set([
  "death_explosion",
  "reflect_damage",
  "route_locked_no_attack"
]);

validateTechDefinitions(techBranchDefinitions, techDefinitions);

export const techBranchesById = Object.fromEntries(
  techBranchDefinitions.map((definition) => [definition.id, definition])
);

export const techById = Object.fromEntries(
  techDefinitions.map((definition) => [definition.id, definition])
);

function validateTechDefinitions(branchDefinitions, definitions) {
  const branchById = new Map(branchDefinitions.map((definition) => [definition.id, definition]));
  const techByIdMap = new Map(definitions.map((definition) => [definition.id, definition]));
  const branchLayoutKeys = new Set();
  const exclusiveGroups = new Map();

  for (const branch of branchDefinitions) {
    if (!branch.unitId) {
      throw new Error(`Tech branch ${branch.id} must declare unitId.`);
    }
  }

  for (const definition of definitions) {
    if (!branchById.has(definition.branchId)) {
      throw new Error(`Tech ${definition.id} references unknown branch ${definition.branchId}.`);
    }

    if (!Number.isInteger(definition.layout?.row) || !Number.isInteger(definition.layout?.column)) {
      throw new Error(`Tech ${definition.id} must define integer layout.row and layout.column.`);
    }

    if (!Number.isInteger(definition.requiredTechCenterLevel) || definition.requiredTechCenterLevel !== definition.layout.row + 1) {
      throw new Error(`Tech ${definition.id} must derive requiredTechCenterLevel from its layout row.`);
    }

    const layoutKey = `${definition.branchId}:${definition.layout.row}:${definition.layout.column}`;
    if (branchLayoutKeys.has(layoutKey)) {
      throw new Error(`Duplicate tech layout slot ${layoutKey}.`);
    }
    branchLayoutKeys.add(layoutKey);

    if (!Array.isArray(definition.prerequisiteIds)) {
      throw new Error(`Tech ${definition.id} prerequisiteIds must be an array.`);
    }

    if (!Array.isArray(definition.effects) || definition.effects.length === 0) {
      throw new Error(`Tech ${definition.id} must define at least one effect.`);
    }

    for (const effect of definition.effects) {
      validateTechEffect(definition, branchById, effect);
    }

    for (const prerequisiteId of definition.prerequisiteIds) {
      const prerequisite = techByIdMap.get(prerequisiteId);
      if (!prerequisite) {
        throw new Error(`Tech ${definition.id} references unknown prerequisite ${prerequisiteId}.`);
      }

      if (prerequisite.branchId !== definition.branchId) {
        throw new Error(`Tech ${definition.id} cannot depend on cross-branch prerequisite ${prerequisiteId}.`);
      }
    }

    if (definition.exclusiveGroupId) {
      const existingBranchId = exclusiveGroups.get(definition.exclusiveGroupId);
      if (existingBranchId && existingBranchId !== definition.branchId) {
        throw new Error(`Exclusive group ${definition.exclusiveGroupId} spans multiple branches.`);
      }
      exclusiveGroups.set(definition.exclusiveGroupId, definition.branchId);

      if (definition.prerequisiteIds.some((prerequisiteId) => {
        return techByIdMap.get(prerequisiteId)?.exclusiveGroupId === definition.exclusiveGroupId;
      })) {
        throw new Error(`Tech ${definition.id} cannot depend on a node in the same exclusive group.`);
      }
    }
  }

  const visited = new Set();
  const activeStack = new Set();
  for (const definition of definitions) {
    validateNoCycles(definition.id, techByIdMap, visited, activeStack);
  }
}

function validateTechEffect(definition, branchById, effect) {
  const targetUnitIds = effect.target?.unitIds ?? [];
  if (targetUnitIds.length === 0) {
    throw new Error(`Tech ${definition.id} effect ${effect.kind} must target at least one unit.`);
  }

  const branch = branchById.get(definition.branchId);
  for (const unitId of targetUnitIds) {
    if (unitId !== branch.unitId) {
      throw new Error(`Tech ${definition.id} effect targets unit ${unitId} outside branch ${definition.branchId}.`);
    }
  }

  if (effect.kind === "modify_unit_stat") {
    if (effect.operation !== "add") {
      throw new Error(`Tech ${definition.id} uses unsupported stat operation ${effect.operation}.`);
    }
    if (typeof effect.stat !== "string" || effect.stat.length === 0) {
      throw new Error(`Tech ${definition.id} modify_unit_stat effect must define stat.`);
    }
    if (typeof effect.value !== "number" || Number.isNaN(effect.value)) {
      throw new Error(`Tech ${definition.id} modify_unit_stat effect must define numeric value.`);
    }
    return;
  }

  if (effect.kind === "add_unit_behavior") {
    if (!VALID_TECH_BEHAVIOR_IDS.has(effect.behaviorId)) {
      throw new Error(`Tech ${definition.id} references unsupported behavior ${effect.behaviorId}.`);
    }
    return;
  }

  throw new Error(`Tech ${definition.id} uses unsupported effect kind ${effect.kind}.`);
}

function validateNoCycles(techId, techByIdMap, visited, activeStack) {
  if (visited.has(techId)) {
    return;
  }

  if (activeStack.has(techId)) {
    throw new Error(`Tech prerequisite cycle detected at ${techId}.`);
  }

  activeStack.add(techId);
  const definition = techByIdMap.get(techId);
  for (const prerequisiteId of definition.prerequisiteIds) {
    validateNoCycles(prerequisiteId, techByIdMap, visited, activeStack);
  }
  activeStack.delete(techId);
  visited.add(techId);
}


