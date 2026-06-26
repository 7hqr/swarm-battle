export const buildingDefinitions = [
  {
    id: "main_base",
    displayName: "Main Base",
    kind: "base",
    cost: 0,
    costIncreasePerOwned: 0,
    buildTime: 0,
    maxHealth: 5000,
    healthRegenPerSecond: 5,
    radius: 30,
    producedUnitIds: [],
    requiredTechTier: 1,
    supportsResearch: false,
    defense: {
      attackRange: 500,
      attackDamage: 25,
      attackCooldown: 0.75,
      aggroRadius: 500,
      targetFilters: ["unit"],
      attackMode: "projectile",
      projectileSpeed: 360,
      projectileRadius: 4
    }
  },
  {
    id: "melee_factory",
    displayName: "Basic Factory",
    kind: "core_production",
    cost: 80,
    costIncreasePerOwned: 40,
    buildTime: 10,
    maxHealth: 750,
    healthRegenPerSecond: 2,
    radius: 20,
    producedUnitIds: ["basic"],
    requiredTechTier: 1,
    supportsResearch: false
  },
  {
    id: "swarm_factory",
    displayName: "Swarm Factory",
    kind: "core_production",
    cost: 80,
    costIncreasePerOwned: 40,
    buildTime: 10,
    maxHealth: 750,
    healthRegenPerSecond: 2,
    radius: 20,
    producedUnitIds: ["disposable_swarm"],
    requiredTechTier: 2,
    supportsResearch: false
  },
  {
    id: "ranged_factory",
    displayName: "Ranged Factory",
    kind: "core_production",
    cost: 80,
    costIncreasePerOwned: 40,
    buildTime: 10,
    maxHealth: 750,
    healthRegenPerSecond: 2,
    radius: 20,
    producedUnitIds: ["ranged_damage"],
    requiredTechTier: 2,
    supportsResearch: false
  },
  {
    id: "frontline_factory",
    displayName: "Frontline Factory",
    kind: "advanced_production",
    cost: 170,
    costIncreasePerOwned: 85,
    buildTime: 20,
    maxHealth: 1500,
    healthRegenPerSecond: 3,
    radius: 25,
    producedUnitIds: ["tanky_frontline"],
    requiredTechTier: 3,
    supportsResearch: false
  },
  {
    id: "anti_swarm_factory",
    displayName: "Anti-Swarm Factory",
    kind: "advanced_production",
    cost: 170,
    costIncreasePerOwned: 85,
    buildTime: 20,
    maxHealth: 1500,
    healthRegenPerSecond: 3,
    radius: 25,
    producedUnitIds: ["anti_swarm"],
    requiredTechTier: 3,
    supportsResearch: false
  },
  {
    id: "anti_tank_factory",
    displayName: "Anti-Tank Factory",
    kind: "advanced_production",
    cost: 170,
    costIncreasePerOwned: 85,
    buildTime: 20,
    maxHealth: 1500,
    healthRegenPerSecond: 3,
    radius: 25,
    producedUnitIds: ["anti_tank"],
    requiredTechTier: 3,
    supportsResearch: false
  },
  {
    id: "tech_nexus",
    displayName: "Tech Center",
    kind: "tech_structure",
    cost: 280,
    costIncreasePerOwned: 0,
    buildTime: 20,
    maxHealth: 300,
    healthRegenPerSecond: 1,
    radius: 18,
    producedUnitIds: [],
    requiredTechTier: 1,
    supportsResearch: true
  }
];

export const buildingsById = Object.fromEntries(
  buildingDefinitions.map((definition) => [definition.id, definition])
);

