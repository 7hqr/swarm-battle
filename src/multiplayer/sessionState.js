const DEFAULT_SIGNALING_URL = "ws://localhost:3012";

export function createMultiplayerSessionState() {
  return {
    signalingUrl: DEFAULT_SIGNALING_URL,
    connectionState: "disconnected",
    connectionIntent: null,
    transportState: "idle",
    iceConnectionState: "new",
    channelState: "closed",
    lobbyCodeInput: "",
    lobbyCode: "",
    role: null,
    playerId: null,
    peerJoined: false,
    matchReady: false,
    matchStarted: false,
    clientId: null,
    lastTransportMessage: "",
    lastSnapshotTick: 0,
    statusMessage: "",
    lastError: ""
  };
}

export function resetMultiplayerSessionState(session, preserveUrl = true) {
  const signalingUrl = preserveUrl ? session.signalingUrl : DEFAULT_SIGNALING_URL;
  const lobbyCodeInput = preserveUrl ? session.lobbyCodeInput : "";
  Object.assign(session, createMultiplayerSessionState(), {
    signalingUrl,
    lobbyCodeInput
  });
}
