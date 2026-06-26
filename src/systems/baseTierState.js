export function applyBaseTierStatsToBaseEntity(base, tierDefinition, options = {}) {
  const { preserveHealthDelta = false } = options;
  const previousMaxHealth = typeof base.maxHealth === "number" ? base.maxHealth : 0;
  const previousHealth = typeof base.health === "number" ? base.health : previousMaxHealth;
  const nextStats = tierDefinition.baseStats;

  if (!nextStats) {
    throw new Error(`Missing base stats for base tier ${tierDefinition.tier}.`);
  }

  base.maxHealth = nextStats.maxHealth;
  base.health = preserveHealthDelta
    ? Math.min(base.maxHealth, previousHealth + Math.max(0, nextStats.maxHealth - previousMaxHealth))
    : nextStats.maxHealth;
  base.healthRegenPerSecond = nextStats.healthRegenPerSecond;
  base.moveSpeed = nextStats.moveSpeed;
  base.maxAcceleration = nextStats.maxAcceleration;
  base.maxTurnRateRadians = nextStats.maxTurnRateRadians;
  base.lookaheadSeconds = nextStats.lookaheadSeconds;
  base.neighborAvoidanceRadius = nextStats.neighborAvoidanceRadius;
  base.avoidanceWeight = nextStats.avoidanceWeight;
  base.separationWeight = nextStats.separationWeight;
  base.stuckRepathDelaySeconds = nextStats.stuckRepathDelaySeconds;
  base.defense = {
    ...(base.defense ?? {}),
    ...nextStats.defense
  };
}
