export const baseTierDefinitions = [
  {
    tier: 1,
    displayName: "Tier 1",
    cost: 0,
    upgradeTime: 0,
    baseStats: {
      maxHealth: 4200,
      healthRegenPerSecond: 3,
      moveSpeed: 18,
      maxAcceleration: 40,
      maxTurnRateRadians: 2.2,
      lookaheadSeconds: 0.7,
      neighborAvoidanceRadius: 96,
      avoidanceWeight: 0.8,
      separationWeight: 1.6,
      stuckRepathDelaySeconds: 1.2,
      defense: {
        attackRange: 320,
        attackDamage: 18,
        attackCooldown: 1.15
      }
    }
  },
  {
    tier: 2,
    displayName: "Tier 2",
    cost: 450,
    upgradeTime: 40,
    baseStats: {
      maxHealth: 5800,
      healthRegenPerSecond: 6,
      moveSpeed: 24,
      maxAcceleration: 48,
      maxTurnRateRadians: 2.35,
      lookaheadSeconds: 0.72,
      neighborAvoidanceRadius: 100,
      avoidanceWeight: 0.82,
      separationWeight: 1.65,
      stuckRepathDelaySeconds: 1.15,
      defense: {
        attackRange: 430,
        attackDamage: 28,
        attackCooldown: 0.92
      }
    }
  },
  {
    tier: 3,
    displayName: "Tier 3",
    cost: 900,
    upgradeTime: 65,
    baseStats: {
      maxHealth: 7800,
      healthRegenPerSecond: 10,
      moveSpeed: 32,
      maxAcceleration: 58,
      maxTurnRateRadians: 2.5,
      lookaheadSeconds: 0.74,
      neighborAvoidanceRadius: 108,
      avoidanceWeight: 0.85,
      separationWeight: 1.7,
      stuckRepathDelaySeconds: 1.1,
      defense: {
        attackRange: 540,
        attackDamage: 42,
        attackCooldown: 0.72
      }
    }
  }
];

export const baseTiersByTier = Object.fromEntries(
  baseTierDefinitions.map((definition) => [definition.tier, definition])
);
