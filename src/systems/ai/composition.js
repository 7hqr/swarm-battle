import {
  getUnitStats,
  isProductionKindUnlocked,
  isUnitUnlocked
} from "../../rules/catalogRules.js";
export function getArmyPower(state, playerId, units) {
  return units.reduce((total, unit) => {
    const stats = getUnitStats(state, playerId, unit.definitionId);
    const dps = stats.attackDamage / Math.max(0.2, stats.attackCooldown);
    const rangeFactor = stats.attackRange >= 100 ? 1.14 : stats.attackRange >= 40 ? 1.02 : 0.9;
    const durabilityFactor = stats.maxHealth * getDurabilityMultiplier(stats.durabilityTag);
    return total + durabilityFactor * 0.32 + dps * 8.2 * rangeFactor + stats.moveSpeed * 0.08;
  }, 0);
}

export function analyzeArmyComposition(state, playerId, units) {
  const totals = {
    frontline: 0,
    swarm: 0,
    ranged: 0,
    antiSwarm: 0,
    antiTank: 0,
    durable: 0
  };
  let totalWeight = 0;

  for (const unit of units) {
    const definition = state.catalog.units[unit.definitionId];
    const stats = getUnitStats(state, playerId, unit.definitionId);
    const weight = 1 + stats.maxHealth * 0.0025 + stats.attackDamage / Math.max(1, stats.attackCooldown) * 0.02;
    const contribution = getCompositionContribution(definition);
    totalWeight += weight;

    for (const [bucket, amount] of Object.entries(contribution)) {
      totals[bucket] += amount * weight;
    }
  }

  if (totalWeight <= 0) {
    return totals;
  }

  for (const key of Object.keys(totals)) {
    totals[key] /= totalWeight;
  }

  return totals;
}

export function getCounterDeficits(ownComposition, enemyComposition) {
  return {
    frontline: clamp01(enemyComposition.ranged * 0.95 + enemyComposition.frontline * 0.25 - ownComposition.frontline),
    antiSwarm: clamp01(enemyComposition.swarm * 1.15 - ownComposition.antiSwarm),
    antiTank: clamp01(enemyComposition.durable * 1.1 + enemyComposition.frontline * 0.25 - ownComposition.antiTank),
    ranged: clamp01(enemyComposition.frontline * 0.55 - ownComposition.ranged)
  };
}

export function getMissingCounterTechIds(state, aiContext, counterDeficits) {
  const techIds = new Set();

  if (counterDeficits.frontline >= 0.35) {
    if (isUnitUnlocked(state, aiContext.playerId, "ranged_damage")) {
      techIds.add("ranged_attack_damage_1");
      techIds.add("ranged_fire_lane_focus");
    }
    if (
      isProductionKindUnlocked(state, aiContext.playerId, "advanced_production") &&
      isUnitUnlocked(state, aiContext.playerId, "tanky_frontline")
    ) {
      techIds.add("frontline_health_1");
      techIds.add("frontline_wall_focus");
    }
  }

  if (counterDeficits.antiSwarm >= 0.35) {
    if (isProductionKindUnlocked(state, aiContext.playerId, "advanced_production") && isUnitUnlocked(state, aiContext.playerId, "anti_swarm")) {
      techIds.add("anti_swarm_chain_range_1");
      techIds.add("anti_swarm_chain_coverage_focus");
    }
  }

  if (counterDeficits.antiTank >= 0.35) {
    if (isProductionKindUnlocked(state, aiContext.playerId, "advanced_production") && isUnitUnlocked(state, aiContext.playerId, "anti_tank")) {
      techIds.add("anti_tank_attack_damage_1");
      techIds.add("anti_tank_heavy_focus");
    }
  }

  return [...techIds];
}

export function getDesiredUnitDemand(aiState, evaluation) {
  const frontlineDemand = 0.55 + evaluation.counterDeficits.frontline * 1.2;
  return {
    basic:
      (0.78 +
        evaluation.counterDeficits.frontline * 0.7 +
        evaluation.defenseNeed * 0.5 +
        evaluation.expansionNeed * 0.25) *
      (aiState.roleBiases.basic ?? 1),
    disposable_swarm:
      (0.55 +
        evaluation.expansionNeed * 0.95 +
        evaluation.pressureNeed * 0.8 +
        evaluation.economyNeed * 0.45) *
      (aiState.roleBiases.swarm ?? 1),
    ranged_damage:
      (0.62 +
        evaluation.enemyComposition.frontline * 0.55 +
        evaluation.pressureNeed * 0.45 +
        evaluation.counterDeficits.frontline * 0.4) *
      (aiState.roleBiases.ranged ?? 1),
    tanky_frontline:
      (0.72 +
        frontlineDemand * 0.65 +
        evaluation.defenseNeed * 0.6 +
        evaluation.pressureNeed * 0.25) *
      (aiState.roleBiases.frontline ?? 1),
    anti_swarm:
      (0.3 + evaluation.counterDeficits.antiSwarm * 1.45 + evaluation.enemyComposition.swarm * 0.35) *
      (aiState.roleBiases.anti_swarm ?? 1),
    anti_tank:
      (0.3 + evaluation.counterDeficits.antiTank * 1.45 + evaluation.enemyComposition.durable * 0.35) *
      (aiState.roleBiases.anti_tank ?? 1)
  };
}

function getCompositionContribution(definition) {
  const contribution = {
    frontline: 0,
    swarm: 0,
    ranged: 0,
    antiSwarm: 0,
    antiTank: 0,
    durable: 0
  };

  if (definition.role === "basic") {
    contribution.frontline += 1;
  } else if (definition.role === "swarm") {
    contribution.swarm += 1;
  } else if (definition.role === "ranged") {
    contribution.ranged += 1;
  } else if (definition.role === "frontline") {
    contribution.frontline += 1;
    contribution.durable += 1;
  } else if (definition.role === "anti_swarm") {
    contribution.antiSwarm += 1;
    contribution.ranged += 0.55;
  } else if (definition.role === "anti_tank") {
    contribution.antiTank += 1;
    contribution.ranged += 0.55;
  }

  if (definition.durabilityTag === "heavy") {
    contribution.durable += 0.75;
  } else if (definition.durabilityTag === "medium") {
    contribution.durable += 0.35;
  }

  return contribution;
}

export function getUnitStrategicProfile(unitDefinition) {
  if (unitDefinition.role === "basic") {
    return { expansion: 0.6, pressure: 0.55, defense: 0.8, counter: 0.35, efficiency: 0.55 };
  }

  if (unitDefinition.role === "swarm") {
    return { expansion: 1, pressure: 0.9, defense: 0.4, counter: 0.2, efficiency: 1 };
  }

  if (unitDefinition.role === "ranged") {
    return { expansion: 0.45, pressure: 0.8, defense: 0.65, counter: 0.55, efficiency: 0.5 };
  }

  if (unitDefinition.role === "frontline") {
    return { expansion: 0.3, pressure: 0.6, defense: 1, counter: 0.65, efficiency: 0.25 };
  }

  if (unitDefinition.role === "anti_swarm") {
    return { expansion: 0.2, pressure: 0.55, defense: 0.8, counter: 1, efficiency: 0.3 };
  }

  if (unitDefinition.role === "anti_tank") {
    return { expansion: 0.2, pressure: 0.62, defense: 0.72, counter: 1, efficiency: 0.28 };
  }

  return { expansion: 0.4, pressure: 0.4, defense: 0.4, counter: 0.4, efficiency: 0.4 };
}

function getDurabilityMultiplier(durabilityTag) {
  if (durabilityTag === "heavy") {
    return 1.2;
  }

  if (durabilityTag === "medium") {
    return 1.05;
  }

  return 0.9;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
