export function updateAiDebugSnapshot(state, aiPlayer, aiState, snapshot, desiredReserve) {
  aiState.debugSummary = {
    lastEvaluatedAtSeconds: state.matchTimeSeconds,
    resources: aiPlayer.resources,
    strategicReserve: aiState.strategicReserve,
    desiredReserve,
    targetNetIncome: aiState.targetNetIncome,
    nextThinkInSeconds: aiState.thinkCooldownSeconds,
    incomePerSecond: snapshot.economy.incomePerSecond,
    spendPerSecond: snapshot.economy.spendPerSecond,
    netIncomePerSecond: snapshot.economy.netIncomePerSecond,
    disabledProductionCount: snapshot.economy.disabledProductionCount,
    totalProductionBuildingCount: snapshot.economy.totalProductionBuildingCount,
    ownTerritoryCount: snapshot.territory.ownCount,
    enemyTerritoryCount: snapshot.territory.enemyCount,
    neutralTerritoryPercent: snapshot.territory.neutralPercent,
    aiArmyPower: snapshot.military.aiArmyPower,
    playerArmyPower: snapshot.military.playerArmyPower,
    localDefenseThreat: snapshot.military.localDefenseThreat,
    primaryThreat: snapshot.military.primaryThreat
      ? {
          type: snapshot.military.primaryThreat.type,
          severity: snapshot.military.primaryThreat.severity,
          point: clonePoint(snapshot.military.primaryThreat.point)
        }
      : null,
    neutralFrontierCount: snapshot.military.neutralFrontierCount,
    hostileFrontierCount: snapshot.military.hostileFrontierCount,
    strategicIntent: aiState.strategicIntent
      ? {
          primary: aiState.strategicIntent.primary,
          secondary: aiState.strategicIntent.secondary,
          threatSeverity: aiState.strategicIntent.threatSeverity,
          threatType: aiState.strategicIntent.threatType,
          scores: { ...aiState.strategicIntent.scores }
        }
      : null,
    intervals: {
      threatScan: aiState.threatScanCooldownSeconds,
      strategy: aiState.strategyCooldownSeconds,
      baseWaypoint: aiState.baseWaypointCooldownSeconds,
      buildingWaypoint: aiState.buildingWaypointCooldownSeconds,
      macroAction: aiState.macroActionCooldownSeconds
    },
    needs: { ...snapshot.needs },
    biases: {
      economy: aiState.economyBias,
      expansion: aiState.expansionBias,
      pressure: aiState.pressureBias,
      defense: aiState.defenseBias,
      tech: aiState.techBias,
      riskTolerance: aiState.riskTolerance,
      commitmentCaution: aiState.commitmentCaution
    },
    basePosture: {
      forwardBias: aiState.baseForwardBias,
      maxForwardProgress: aiState.baseMaxForwardProgress,
      holdThreatThreshold: aiState.baseHoldThreatThreshold,
      retreatThreatThreshold: aiState.baseRetreatThreatThreshold,
      overwhelmingThreatThreshold: aiState.baseOverwhelmingThreatThreshold,
      retreatArmyRatio: aiState.baseRetreatArmyRatio,
      retreatHealthThreshold: aiState.baseRetreatHealthThreshold,
      retargetIntervalSeconds: aiState.baseRetargetIntervalSeconds,
      minimumEnemyDistanceGain: aiState.baseMinimumEnemyDistanceGain
    },
    production: {
      coreBuildings: snapshot.production.coreBuildings.length,
      techStructures: snapshot.production.techStructures.length,
      advancedBuildings: snapshot.production.advancedBuildings.length,
      producedUnitCounts: Object.fromEntries(
        [...snapshot.production.producedUnitCounts.entries()].sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
      )
    },
    composition: {
      counterNeed: snapshot.composition.counterNeed,
      counterDeficits: { ...snapshot.composition.counterDeficits },
      missingCounterTechIds: [...snapshot.composition.missingCounterTechIds],
      desiredUnitDemand: { ...snapshot.composition.desiredUnitDemand }
    }
  };
}

function clonePoint(point) {
  return point ? { x: point.x, y: point.y } : null;
}
