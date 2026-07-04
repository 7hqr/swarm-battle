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
        attackCooldown: 1.15,
        turretTurnRateRadians: 2.25,
        targetDistanceWeight: 98,
        targetDistancePower: 1.35,
        targetUnitPriorityBonus: 22,
        targetCurrentTargetBonus: 11,
        targetStructurePenalty: 10,
        targetMainBasePenalty: 16,
        targetCloseThreatRadius: 150,
        targetCloseThreatBonus: 38,
        targetCloseThreatPower: 1.2
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
        attackCooldown: 0.92,
        turretTurnRateRadians: 2.5,
        targetDistanceWeight: 104,
        targetDistancePower: 1.38,
        targetUnitPriorityBonus: 24,
        targetCurrentTargetBonus: 12,
        targetStructurePenalty: 10,
        targetMainBasePenalty: 16,
        targetCloseThreatRadius: 165,
        targetCloseThreatBonus: 42,
        targetCloseThreatPower: 1.24
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
        attackCooldown: 0.72,
        turretTurnRateRadians: 2.8,
        targetDistanceWeight: 110,
        targetDistancePower: 1.4,
        targetUnitPriorityBonus: 26,
        targetCurrentTargetBonus: 13,
        targetStructurePenalty: 11,
        targetMainBasePenalty: 18,
        targetCloseThreatRadius: 180,
        targetCloseThreatBonus: 46,
        targetCloseThreatPower: 1.28
      }
    }
  }
];

export const baseTiersByTier = Object.fromEntries(
  baseTierDefinitions.map((definition) => [definition.tier, definition])
);
