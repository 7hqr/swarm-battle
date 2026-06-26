import { WebSocket, WebSocketServer } from "ws";

const DEFAULT_PORT = 3012;

export function startSignalingServer({ port = DEFAULT_PORT } = {}) {
  const wss = new WebSocketServer({ port });
  const lobbies = new Map();
  const socketMeta = new WeakMap();
  let nextClientId = 1;

  wss.on("connection", (socket) => {
    const clientId = `client_${nextClientId++}`;
    socketMeta.set(socket, {
      clientId,
      lobbyCode: null,
      role: null
    });

    send(socket, {
      type: "hello",
      clientId
    });

    socket.on("message", (data) => {
      try {
        const message = JSON.parse(String(data));
        handleMessage(socket, message);
      } catch {
        sendError(socket, "Invalid signaling payload.");
      }
    });

    socket.on("close", () => {
      handleDisconnect(socket);
    });

    socket.on("error", () => {
      handleDisconnect(socket);
    });
  });

  wss.on("listening", () => {
    console.log(`SwarmBattle signaling server listening on ws://localhost:${port}`);
  });

  return wss;

  function handleMessage(socket, message) {
    switch (message.type) {
      case "create_lobby":
        createLobby(socket);
        return;

      case "join_lobby":
        joinLobby(socket, message.code);
        return;

      case "leave_lobby":
        leaveLobby(socket);
        return;

      case "relay_peer_message":
        relayPeerMessage(socket, message.payload);
        return;

      default:
        sendError(socket, `Unsupported signaling message: ${message.type}`);
    }
  }

  function createLobby(socket) {
    leaveLobby(socket);

    let code = generateLobbyCode();
    while (lobbies.has(code)) {
      code = generateLobbyCode();
    }

    const hostMeta = socketMeta.get(socket);
    const lobby = {
      code,
      host: socket,
      guest: null
    };

    lobbies.set(code, lobby);
    hostMeta.lobbyCode = code;
    hostMeta.role = "host";

    send(socket, {
      type: "lobby_created",
      code,
      role: "host",
      playerId: 1
    });
  }

  function joinLobby(socket, requestedCode) {
    leaveLobby(socket);

    const code = String(requestedCode ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      sendError(socket, "Lobby codes must be 6 uppercase letters or digits.");
      return;
    }

    const lobby = lobbies.get(code);
    if (!lobby) {
      sendError(socket, "Lobby not found.");
      return;
    }

    if (lobby.guest) {
      sendError(socket, "Lobby is full.");
      return;
    }

    lobby.guest = socket;
    const guestMeta = socketMeta.get(socket);
    guestMeta.lobbyCode = code;
    guestMeta.role = "guest";

    send(socket, {
      type: "lobby_joined",
      code,
      role: "guest",
      playerId: 2
    });

    send(lobby.host, {
      type: "peer_joined",
      code,
      role: "guest"
    });
  }

  function leaveLobby(socket) {
    const meta = socketMeta.get(socket);
    if (!meta?.lobbyCode) {
      return;
    }

    const lobby = lobbies.get(meta.lobbyCode);
    const { lobbyCode, role } = meta;

    meta.lobbyCode = null;
    meta.role = null;

    if (!lobby) {
      return;
    }

    if (role === "host") {
      if (lobby.guest) {
        const guestMeta = socketMeta.get(lobby.guest);
        if (guestMeta) {
          guestMeta.lobbyCode = null;
          guestMeta.role = null;
        }

        send(lobby.guest, {
          type: "lobby_closed",
          code: lobbyCode,
          reason: "Host left the lobby."
        });
      }

      lobbies.delete(lobbyCode);
      return;
    }

    if (role === "guest") {
      lobby.guest = null;
      send(lobby.host, {
        type: "peer_left",
        code: lobbyCode
      });
    }
  }

  function handleDisconnect(socket) {
    leaveLobby(socket);
  }

  function relayPeerMessage(socket, payload) {
    const meta = socketMeta.get(socket);
    if (!meta?.lobbyCode || !meta.role) {
      sendError(socket, "You are not in a lobby.");
      return;
    }

    const lobby = lobbies.get(meta.lobbyCode);
    if (!lobby) {
      sendError(socket, "Lobby not found.");
      return;
    }

    const targetSocket = meta.role === "host" ? lobby.guest : lobby.host;
    if (!targetSocket) {
      sendError(socket, "No peer is connected to this lobby.");
      return;
    }

    send(targetSocket, {
      type: "peer_message",
      code: meta.lobbyCode,
      fromRole: meta.role,
      payload
    });
  }
}

function send(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

function sendError(socket, message) {
  send(socket, {
    type: "error",
    message
  });
}

function generateLobbyCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return code;
}

const isDirectRun = import.meta.url === new URL(process.argv[1], "file:").href;
if (isDirectRun) {
  const port = Number.parseInt(process.env.SWARMBATTLE_SIGNAL_PORT ?? `${DEFAULT_PORT}`, 10);
  startSignalingServer({ port });
}
