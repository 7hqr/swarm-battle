export function chooseStrategicIntent(state, aiState, snapshot) {
  const weightedNeeds = [
    ["defense", snapshot.needs.defense * aiState.defenseBias],
    ["expansion", snapshot.needs.expansion * aiState.expansionBias],
    ["objectives", snapshot.needs.objectives * aiState.objectiveBias],
    ["pressure", snapshot.needs.pressure * aiState.pressureBias],
    ["tech", snapshot.needs.tech * aiState.techBias],
    ["economy", snapshot.needs.economy * aiState.economyBias],
    ["counter", snapshot.needs.counterComposition * aiState.techBias]
  ].sort((left, right) => right[1] - left[1]);
  const primary = weightedNeeds[0]?.[0] ?? "expansion";
  const threat = snapshot.threats.primaryThreat;
  const emergencyDefense = threat && threat.severity >= 0.48;
  const activePrimary = emergencyDefense ? "defense" : primary;

  return {
    primary: activePrimary,
    secondary: weightedNeeds.find(([need]) => need !== activePrimary)?.[0] ?? null,
    updatedAtSeconds: state.matchTimeSeconds,
    threatPoint: clonePoint(threat?.point ?? null),
    threatSeverity: threat?.severity ?? 0,
    threatType: threat?.type ?? null,
    scores: Object.fromEntries(weightedNeeds)
  };
}

function clonePoint(point) {
  return point ? { x: point.x, y: point.y } : null;
}
