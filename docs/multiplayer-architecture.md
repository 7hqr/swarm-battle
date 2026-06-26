# Multiplayer Architecture Direction

This document records the architecture direction established before transport implementation.

## Decisions Locked In

- Host-authoritative multiplayer
- Host-only simulation
- Fixed-tick authority at `10 Hz`
- Command-driven gameplay mutations
- Delta-oriented replication target
- Dedicated wire schema instead of mirroring internal state
- Generic local player ownership
- AI layered in as a command producer, not as a separate game architecture
- Lobby-code session flow
- Immediate loss on disconnect
- Trusted host boundary

## Current Foundation Work

The current codebase now treats these as core architecture constraints:

- Gameplay mutations should enter through a command queue instead of direct UI mutations.
- Simulation advances on fixed authority ticks instead of render-frame `dt`.
- The local human is no longer assumed to be player `1`.
- Multiplayer match modes exist at match-config level even though transport is not wired yet.

## Command Boundary

Gameplay-affecting actions should be represented as commands:

- `place_building`
- `start_base_upgrade`
- `start_research`
- `remove_research_queue_item`
- `set_production_enabled`
- `clear_waypoint_chain`
- `append_waypoint`
- `set_waypoint_chain`

UI state such as selection, camera, open panels, and placement mode remains local presentation state.

## Authority Model

- Only the authoritative runtime should call simulation ticks.
- Commands are queued for tick processing.
- AI should issue the same gameplay commands that a human player would issue.
- Future network transport should inject remote commands into the same queue instead of adding a second mutation path.

## Replication Target

Transport is not implemented yet, but the intended replication shape is:

- tick-indexed packets
- sparse deltas
- entity create/update/destroy sections
- system-level deltas for territory, player economy, and match state
- occasional baselines for recovery

## Out Of Scope In This Pass

- wire packet encoding
- snapshot interpolation
- client prediction
- reconnect handling
- spectators

## Status

Signaling is now implemented separately from gameplay transport:

- websocket signaling server
- host create lobby
- guest join lobby by code
- browser-side session UI and status reporting
- WebRTC offer/answer/ICE relay
- browser-to-browser data channel handshake

Gameplay transport is still pending:

- optimized command reliability rules
- more optimized authoritative delta replication
