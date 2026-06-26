# Signaling Setup

This project now includes the first functional multiplayer session layer:

- websocket signaling server
- host lobby auto-creation
- join by lobby code
- browser-side lobby status UI
- WebRTC offer/answer/ICE relay through signaling
- browser-to-browser data channel handshake
- host-started multiplayer match bootstrap
- guest-to-host gameplay command transport
- host-to-guest authoritative baseline-plus-delta replication

It now includes a first explicit baseline-plus-delta replication pass.

## Install

From the project root:

```powershell
npm install
```

## Run The Signaling Server

```powershell
npm run signal
```

## Run Both Local Servers

From the project root:

```powershell
npm run dev
```

Default addresses:

```text
Game:   http://localhost:4173
Signal: ws://localhost:3012
```

Optional overrides:

```powershell
$env:SWARMBATTLE_GAME_PORT=8080
$env:SWARMBATTLE_SIGNAL_PORT=4012
npm run dev
```

Default address:

```text
ws://localhost:3012
```

Optional port override:

```powershell
$env:SWARMBATTLE_SIGNAL_PORT=4012
npm run signal
```

## Current Browser Flow

1. Open `Host PvP`.
2. Wait for the lobby to be created automatically.
3. Share the 6-character lobby code.
4. On the other browser, open `Join PvP`, enter the same lobby code, then click `Join Lobby`.
5. Use the player list to confirm each side is connecting or connected.

If WebRTC negotiation succeeds, the player list should progress through statuses such as:

- `Creating Lobby`
- `Waiting For Player`
- `Connecting`
- `Connected`

From there:

1. The host clicks `Start PvP Match`.
2. Both browsers enter the match.
3. The host runs the simulation.
4. The guest sends commands to the host and receives authoritative snapshots back.

## Current Limitations

- replication is still an early explicit delta format, not a fully optimized final wire protocol
- disconnect only affects lobby state, not a live match
