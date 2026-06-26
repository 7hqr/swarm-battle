export function isMultiplayerMatch(state) {
  return state.matchConfig?.mode === "multiplayer_host" || state.matchConfig?.mode === "multiplayer_client";
}

export function isSimulationAuthority(state) {
  return state.matchConfig?.mode !== "multiplayer_client";
}
