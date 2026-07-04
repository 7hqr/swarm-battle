# SwarmBattle TODO

## Purpose

Track the remaining near-term priorities after the mobile-base pass, roster rebuild, and first AI structure pass.

The roadmap should reflect dependency order. Simulation correctness and broad performance work come before AI rebalance, and all of that comes before UI cleanup or later visual polish.

## Active Roadmap

## Phase 1: Combat Facing Follow-Through

### Goal

Make the single facing model fully consistent so combat readability and actual attack behavior match.

### TODO

- [x] Make attack aiming respect unit turn-rate and facing before firing so attacks do not begin while the facing indicator points elsewhere
- [x] Audit projectile spawn, attack timing, and facing presentation around that change so no stale split between movement-facing and attack-facing behavior remains

### Notes

- Combat readability should still favor one obvious facing model
- If the simulation requires a turn-before-fire gate, it should be implemented centrally instead of as per-unit exceptions
- Unit attack resolution now rotates toward the target with the existing movement turn-rate limit before firing, keeping projectile spawn and the facing indicator on the same heading model

## Phase 2: Zoomed-Out Render Performance Pass

### Goal

Reduce the full-battlefield render cost so zoomed-out observation remains cheap enough for normal play and AI tuning.

### TODO

- [x] Profile zoomed-out rendering and identify which passes scale badly when most of the map is visible
- [x] Reduce or cache the dominant zoomed-out draw costs, especially territory or other dense full-map passes that are cheap when zoomed in and expensive when zoomed out
- [x] Keep the performance panel metrics useful enough to confirm the winning render path instead of guessing
- [x] Reevaluate other zoomed-out render passes now that territory is no longer dominant, with background grid rendering as the next likely target

### Notes

- The current symptom is specifically worse when zoomed all the way out, so the first suspect is world-space drawing cost rather than raw unit simulation cost
- Prefer render-path simplification or caching over adding adaptive quality fallbacks that hide the underlying cost
- The performance panel now exposes a dedicated render breakdown, and the territory pass now caches the expensive cell fill layer while keeping ownership outlines live for readability

## Phase 3: AI Rebalance Against Revised Progression

### Goal

Stabilize the core AI macro systems against the rebuilt tech tree, territory economy, and main-base gameplay before resuming broader personality variance.

### TODO

- [x] Rework AI research plans, timing targets, and role biases so they fit the current roster and unlock structure
- [x] Reevaluate AI spending priorities for base upgrades, tech upgrades, and production expansion against the revised economy curve
- [x] Revalidate AI composition and counter-selection assumptions against the current unit roles and tech outcomes
- [x] Fix the repeatable main-base routing failures that leave the AI base stuck on its own early factory placements or nearby map geometry
- [x] Improve AI-vs-AI panel clarity so macro intent, blockage, and territory behavior are easier to audit before deeper tuning
- [ ] Fix macro stalling so AIs with strong income do not stop expanding, upgrading, or adding production after an early factory pair
- [ ] Rework waypoint planning so AIs value side-lane and uncontested territory capture instead of defaulting too hard to centerline pressure
- [x] Tighten tech-center placement so key tech infrastructure is treated as a high-value structure instead of routine frontline production
- [ ] Raise objective valuation so rich cells and global capture points are contested intentionally rather than claimed mostly by chance
- [ ] Run a focused AI-vs-AI balance pass once the core macro, routing, and observation issues above are stable enough for efficient iteration

### Notes

- Start with data in `aiProfile` and other planning inputs before broad heuristic rewrites
- Only change heuristic code where the new progression model made previous assumptions invalid
- Doctrine variance is temporarily disabled so AI debugging runs through one explicit baseline profile until the core macro and movement systems are stable enough to tune cleanly
- The AI-vs-AI panel clarity pass should stay scoped to debugging utility first; decide exact UI changes at implementation time instead of locking them in early
- Base relocation no longer self-repels through waypoint sanitization, and stalled committed routes can now replan instead of staying permanently locked to a blocked waypoint
- Macro debug tracing now supports focused AI economy audits so future spending deadlocks can be diagnosed from scoring and runway data instead of screenshots alone
- Tech-center placement now filters out forward production anchors and heavily biases protected, base-adjacent building clusters over frontline territory gains

## Phase 4: UI Readability Cleanup

### Goal

Trim noisy selection metadata and remove small layout instability in the bottom command bar.

### TODO

- [ ] Remove extraneous selection-panel metadata that does not help command decisions, especially generic fields like owner or internal state where they add noise
- [ ] Fix the bottom bar height shift that occurs when selecting the main base
- [ ] Recheck selection-panel copy after the cleanup so important base, production, and research information still has a single clear place to live

### Notes

- This is cleanup, not a driver of simulation or AI behavior
- Prefer removing low-value UI output over restyling it

## Phase 5: Visual And Map Follow-Through

### Goal

Improve readability and presentation after the current gameplay systems are stable enough to support a cleaner visual pass.

### TODO

- [ ] Plan and execute a visual overhaul
- [ ] Reevaluate terrain authoring for future map generation once the gameplay loop is stable

### Notes

- Terrain changes should support the gameplay loop, not fight it
- Visual work should improve clarity first and flavor second

## Completed

### Mobile Base Polish

- [x] Refine main-base relocation pathing around nearby factories and terrain so large-body routing is consistently reliable

### Roster And Combat Identity Pass

- [x] Rename `basic_melee` to `basic` across data, gameplay, AI, UI, and docs
- [x] Rework baseline unit statlines around the revised roster roles, including a broad HP reduction and lower stickiness on the basic unit
- [x] Convert the basic unit from strict melee to very short range
- [x] Collapse combat facing back to a single movement-and-firing direction for clearer macro readability
- [x] Tune movement turn rates by role so swarm wrapping, flank pressure, and wall behavior read clearly
- [x] Add chaining-weapon behavior for `anti_swarm`
- [x] Rework research direction around role-sharpening and weakness-covering autonomous upgrades
- [x] Add the first research behaviors needed by the new roster, such as chain-weapon branches and frontline reactive defenses
- [x] Do a dedicated post-pass on frontline accumulation, reinforcement tempo, and overall tug-of-war pacing

## Parked

- [ ] Do a post-rebalance AI balance pass on production-count scaling, reserve tuning, and long-match macro conversion so high-income AIs do not drift back into stockpiling or factory spam
- [ ] Improve main-base relocation target quality further so forward-support positions read intelligently around live terrain and newly built structures, not just safely
- [ ] Reintroduce doctrine differentiation once the baseline AI profile is stable enough that personality variance will not hide core system issues
- [ ] Do a broader unit movement performance and intelligence pass after the combat-facing and AI-rebalance follow-ups are in place
- [ ] Revisit deeper target-switching and autonomous targeting behaviors once further unit-role refinement creates a stronger need for them

## Guardrails

- Do not add scripted openings, hidden objectives, or other hardcoded strategic rails to make the AI look smarter
- When doctrine variance returns, personality should drive variation while map state and game state still drive decisions
