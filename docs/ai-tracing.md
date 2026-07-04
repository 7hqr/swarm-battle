# AI Tracing

SwarmBattle now treats AI tracing as explicit match setup data instead of hidden URL or localStorage flags.

## Workflow

1. Open `Vs AI` or `AI Test Match`.
2. In setup, reveal `AI Trace` with the button or `T`.
3. Configure the trace:
   - choose the target player
   - apply a preset or toggle categories manually
4. Start the match.
5. Pause or finish the match, reveal `Trace Capture` if needed, and use `Download Trace`.

Each export writes a JSON payload with:

- export timestamp
- match mode, map, difficulty, and elapsed match time
- the active trace configuration
- collected trace entries

## Categories

- `macro`: top approved and rejected strategic actions
- `macro_audit`: economy and commitment audit detail
- `placement`: chosen build location, anchor set, blocked-placement counts, and top scored alternatives
- `base`: base relocation decisions
- `base_route`: requested and sanitized waypoint routes
- `base_move`: live base movement and path status

## Notes

- Starting a new match clears the previous trace buffer.
- The setup and runtime trace panels start hidden by default.
- `Clear Buffer` only clears captured entries. It does not change the selected trace profile.
- The console helper remains available at `window.swarmBattleAiTrace` for direct inspection.
