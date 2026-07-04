# SwarmBattle V1 Spec

## Vision

SwarmBattle is a macro-first real-time strategy game focused on planning, production, and territorial pressure rather than per-unit control. The player wins by making better strategic commitments than the opponent: expanding at the right time, building the right unit mix, and directing the swarm toward the right fronts.

V1 is intentionally narrow:

- Single-player vs AI
- One faction
- Mirror-match test setup rather than a fully themed faction
- One map
- 10 to 20 minute matches
- Low or no meta progression
- No required per-unit micro

## Design Pillars

- Planning over execution. The game should reward long-horizon decisions more than click speed.
- Constant pressure. Armies are produced continuously and naturally create a tug-of-war over map space.
- Swarm fantasy. Units should feel numerous, disposable, and part of a larger mass rather than precious individuals.
- Open battlefields. The map should support several viable expansion and attack patterns instead of a single scripted solution.
- Low micro ceiling. The player should not need to babysit units to play correctly.

## Player Fantasy

The player is not a field commander manually controlling squads. The player is directing a living war machine: building hatcheries, setting production, deciding where the swarm flows, and choosing when to hold territory versus when to mass for a decisive push.

## Match Structure

### Starting State

- Each side begins with one main base structure.
- Each side begins with basic worker/economy capability and at least one production structure.
- The initial map state should create immediate expansion choices rather than a long safe opening.

### Primary Win Condition

- Destroy the opponent's starting base.

### Loss Condition

- Lose your starting base.

Additional win conditions may be explored later, but V1 should ship with one clear objective.

## Core Loop

1. Expand to claim additional resource income.
2. Spend income on production, Armories, and main base upgrades.
3. Route new units toward one or more fronts.
4. Trade territory through constant combat pressure.
5. Rebalance production or pause pressure to mass units for a stronger push.
6. Break through and destroy the enemy base.

## Command Model

V1 should avoid direct unit control as a core expectation.

### Player Controls

- Place buildings
- Use build hotkeys for production structures and Armories
- Set production priorities and automation rules
- Assign rally/waypoint paths for production buildings
- Redirect future reinforcements to different fronts
- Temporarily hold or stage forces by routing them to safe positions
- Expand, upgrade the base, or invest in the Tech Center based on current map state
- Pan and zoom the battlefield view without changing simulation state

### Explicit Non-Goals

- No per-unit active ability usage
- No required stutter stepping, focus fire, or spell timing
- No squad micromanagement as a baseline interaction

## Unit Behavior

Units should be individually simple and largely autonomous.

- Units automatically follow their assigned waypoint path.
- Units automatically acquire and attack nearby enemies.
- Units should prefer staying with local friendly mass when possible, rather than behaving like lone skirmishers.
- Combat resolution should be readable at a glance.

The player should influence battle outcomes mostly before the fight begins: by composition, route choice, timing, and reinforcement flow.

### Engagement Stickiness

Combat should form recognizable fronts rather than constant pass-through skirmishing.

- Once units engage, they should tend to remain locally committed for a meaningful amount of time.
- Disengaging should be possible, but it should usually cost territory and initiative.
- Units should not constantly drop targets and leak through enemy lines unless that behavior is part of their role.

Stickiness should be controlled through several tunable unit-level stats rather than one global rule:

- Aggro persistence
- Leash distance
- Attack range
- Move speed
- Collision or crowding behavior
- Target switching logic
- Time-to-kill

Different units can use different values for these stats to create distinct battlefield behaviors without requiring manual control.

## Fronts and Pressure

The game's central interaction is pressure routing rather than unit babysitting.

### Recommended V1 Model

- Each production building auto-produces continuously or near-continuously.
- Each production building has an assigned waypoint chain.
- Waypoint chains can terminate at a staging point, choke, expansion, or enemy approach, after which units continue pressuring the enemy base.
- Reassigning a building's route changes where future pressure is applied.

This creates the desired tug-of-war dynamic:

- Committing production to one front weakens others.
- Pooling units means routing them to a staging area instead of the contested line.
- Backing off a front cedes space because enemy reinforcements continue arriving.

### Production Automation

V1 should use fully automatic production rather than manually refilled queues.

- Production buildings should keep producing based on the player's configured unit choice or ratio.
- Resources are consumed automatically when available.
- The player should not need to refill a short queue by hand every time it empties.
- Strategic decisions come from production allocation, composition, expansion, and route control rather than upkeep clicks.

Unlimited waypoint chains are acceptable for V1 as long as the UI remains readable and fast to manage.

## Economy

V1 should use a single primary resource.

### Economy Goals

- Easy to read
- Strong enough to make expansion matter
- Limited enough to force tradeoffs between greed, army, base upgrades, and Tech Center upgrades

### Recommended Structure

- The map should contain broad contested space that armies can gradually convert into owned territory.
- Territory is claimed gradually by unit movement and nearby constructed buildings.
- Expansions should be valuable enough that map control matters more than passive base income.

Limited income is the main pressure source that keeps automation meaningful:

- The player should not be able to fully fund every structure at once.
- Resource shortages should force real tradeoffs between army output, expansion, base upgrades, and Tech Center upgrades.
- When resources are constrained, choosing which buildings or unit lines remain active becomes a strategic commitment.

## Buildings

V1 should keep the building set small.

### Minimum Building Set

- Main base
- Core production structure
- Advanced production structure
- Tech Center
- Optional static defense structure

Static defense should be limited. Too much defense undermines the game's pressure-focused identity.

### V1 Production Building Model

V1 should use two production building classes for testing:

- Core production building
- Advanced production building

Production buildings should be single-purpose, with each factory type tied to one unit.

Production buildings should be a meaningful commitment:

- Expanding production should cost enough that sprawl does not come for free.
- Adding a new production line should compete with expansion, base upgrades, and Tech Center spending.

Advanced units should require both:

- An advanced production building
- The required main base tier

### Provisional Production Split

Core production building:

- Basic general-purpose unit
- Disposable swarm unit
- Ranged damage unit

Advanced production building:

- Tanky frontline unit
- Anti-swarm unit
- Anti-tank unit

## Faction Scope

V1 uses one mirror-match roster only.

### Roster Goals

- Strong swarm identity
- Easy to understand production flow
- Broad enough to create real composition decisions
- Generic enough to test systems before factional identity is added

### Unit Roster Target

- 6 units total for the first pass
- Clear battlefield roles
- Mostly soft counters, not hard invalidation

### Provisional V1 Role Set

- Basic general-purpose unit
- Tanky frontline unit
- Disposable swarm unit
- Ranged damage unit
- Anti-swarm unit
- Anti-tank unit

Only the basic unit should be available by default. The rest should come online through Tech Center construction, Tech Center levels, and production progression.

### Roster Constraints

- The swarm unit should be the roster's most disposable unit.
- The basic unit should remain clearly disposable-adjacent and should not stay sticky for long once fights start scaling up.
- The basic unit should remain relevant as an early pressure piece, but pure basic-unit play should usually lose to better composition.
- Some units should be slow, expensive, and powerful enough to create timing windows.
- Both high-density weak swarms and lower-density stronger armies should be viable outcomes.
- V1 should stay fully ground-based.
- The basic unit should use very short range instead of strict melee so it can contribute without becoming a collision-heavy glue unit.
- The tanky frontline unit should act as a true wall first and a damage dealer second.
- Specialist counter units should still be reasonably serviceable into neutral targets.

### Macro-First Unit Design Principles

SwarmBattle is a macro game with very little micro.

- The player does not control individual units after production.
- The player expresses strategy through production, unlock timing, and building waypoint routing.
- Unit identity should come from autonomous battlefield behavior rather than manual tactics.

This means unit and research design should avoid relying on concepts that require manual squad handling.

- No research should assume formation control, stance toggles, manual flanks, or ability timing.
- Research should express itself through stat changes, target selection, movement behavior, pursuit behavior, on-hit effects, on-death effects, or production tempo.
- Every upgrade should be understandable from watching autonomous combat resolve.

### Revised V1 Roster Roles

Basic unit:

- Early pressure and first territory contact.
- Cheap, dependable, and common.
- Very short range rather than pure melee.
- Should establish initial map presence, not remain a dominant all-purpose combat unit.

Disposable swarm unit:

- Fastest map-control and wraparound pressure unit.
- The roster's most disposable body.
- Should punish slow-firing enemies through numbers.
- Should be a viable flood strategy that demands a response.

Ranged damage unit:

- Fragile payoff backline.
- Converts stable protection into meaningful kills.
- Should be decisive when screened and vulnerable when exposed.
- Should accumulate more slowly than frontline units.

Tanky frontline unit:

- True wall and anchor unit.
- Buys time and space for support units.
- Should be difficult to dislodge but should not also be the roster's best general DPS piece.
- Later research may bend it into alternate wall-adjacent identities without changing its baseline role.

Anti-swarm unit:

- Density punisher using a chaining weapon rather than blast AOE.
- Best when enemy units are packed tightly together.
- Should discourage pure flood play without becoming generic ranged DPS.
- Research can push it toward more chain coverage or fewer, harder-hitting jumps.

Anti-tank unit:

- Precision breaker for durable, high-value targets.
- Best expressed as a slow, deliberate sniper-style unit or similar high-commitment heavy-target killer.
- Should win through shot value rather than general sustained DPS.
- Should remain inefficient into floods and forced retargeting.

### Research Direction

Unit research should follow two patterns only:

- Push a unit further into its current strength.
- Offset a specific weakness without deleting the unit's intended counterplay.

Examples that fit this model:

- More chain jumps for anti-swarm.
- Fewer but stronger chain jumps for anti-swarm.
- Death explosion or reflect damage for frontline.
- Faster production or slightly longer short range for the basic unit.
- More alpha strike or armor-break for anti-tank.

Examples that do not fit this model:

- Formation discipline upgrades.
- Tactical surround upgrades that assume direct unit handling.
- Anything that expects the player to manually trigger the unit's payoff in combat.

### Turn Rate As A Core Role Axis

Movement turn rate should remain part of the roster's core role definition.

- Movement turn rate shapes flanking, wraparound pressure, route responsiveness, and how cleanly units stay engaged while maneuvering.

High-level role targets:

- Swarm should have the highest movement turn rate for wrap pressure and rapid local engagement.
- Basic should have strong movement responsiveness for early pressure.
- Ranged damage should turn more slowly so flanks matter.
- Tanky frontline should move slowly and turn slowly, reinforcing its wall identity.
- Anti-swarm should turn responsively enough to capitalize on dense targets.
- Anti-tank should turn slowly enough that wraps, distractions, and target disruption matter.

### Starting Unlock State

- The only unit available at match start is the basic unit.
- Every other unit should be gated behind Tech Center access, even if its production building already exists or is affordable.

## Information Model

V1 starts with no fog of war.

### Consequences

- Planning is based on visible commitments, not hidden information.
- Strategic depth must come from timing, territory, production, and travel distance.
- The game loses scouting as a decision layer, so map geometry and production commitment become more important.

This is acceptable for V1 as long as the game still forces meaningful commitment.

## Tech Center And Base Tiers

The Tech Center should own unit, building, and research unlock progression. Main base upgrades should remain a separate stat-scaling axis for the base itself.

### V1 Progression Goals

- Create timing windows
- Enable strategic pivots
- Offer counters to visible enemy plans
- Preserve the importance of territory, production, and reinforcement flow
- Let players respond to opponent composition within roughly 2 minutes in a typical match

### Long-Term Progression Direction

Base tiers and Tech Center upgrades should support macro strategy rather than replace it.

- Tech Center timing and level-ups should unlock new pressure patterns, counters, and timing attacks.
- Tech Center choices should improve already-unlocked units through branching research nodes.
- A player should be able to pivot in response to an opponent's strategy, but delayed pivots should carry real map-control consequences.
- Upgrade timing should not become a deterministic build-order race with one correct opener.
- Expansion timing, unit ratios, Tech Center timing, Tech Center level timing, base stat timing, and research priorities should remain similarly important strategic dimensions.

### V1 Progression Scope

V1 progression scope is focused:

- Main base upgrades improve the main base's own durability and combat stats.
- The main base weapon is a center-mounted turret with limited turn rate and post-shot unit-priority retargeting, with separate tuning for proximity pressure, current-target stickiness, and structure deprioritization.
- Tech Center tiers unlock new units, buildings, and research branches.
- Tech Center research contains branching non-repeatable upgrades for unlocked units.
- Each player may own only one Tech Center.
  - Each unlocked unit owns its own branch column rather than sharing a broad mixed-role branch.
- Branches should read as baseline upgrades, then specialization forks, then branch-local follow-up nodes.
- Mutual exclusivity should live inside a unit branch to force specialization choices without creating cross-branch dependency webs.

Base upgrade and Tech Center choices should involve real commitment rather than being trivially reversible.

### Provisional V1 Progression Layers

Layer 1: early foundation

- Basic stat improvements
- No new unit unlocks

Tech Center Level 1: production escalation

- Unlock disposable swarm and ranged damage from core production
- Reveal the first row of their research, with deeper rows gated by later Tech Center levels

Tech Center Level 2: specialist access

- Unlock advanced production and the three advanced units

Tech Center Levels 3 and 4: specialist scaling

- Each row deeper in a branch requires one more Tech Center level

This structure should support a clear early-to-midgame arc:

- Early game centers on basic-unit pressure and expansion.
- Midgame opens broader production and stronger composition pivots.
- Specialist counters arrive late enough to create timing windows, but early enough to matter in a 10 to 20 minute match.

## Map Design

V1 should ship with one handcrafted map.

### Map Requirements

- Multiple expansion paths from the starting area
- Several attack routes between players
- Contested central or side objectives created by resource placement
- Space wide enough for the swarm fantasy to read clearly
- No obviously correct clearing order

The map should feel like a strategic space, not a mission puzzle.

## AI Scope

AI is required for V1 testing and first playable.

### V1 AI Goals

- Expand predictably but competitively
- Favor maintaining positive resource income before upgrading the base, using the Tech Center, or adding more production
- Maintain continuous production
- Reassign pressure between fronts
- Occasionally stage a larger push instead of trickling forever

The AI does not need advanced deception or tactical micro. It only needs to exercise the same macro systems as the player.

## V1 Success Criteria

V1 is successful if:

- Matches consistently produce shifting front lines
- The player wins by better production, expansion, and routing decisions
- The player rarely feels punished for not micromanaging units
- Different attack directions and expansion timings feel viable on the same map
- Pooling for a push versus maintaining frontline pressure is a meaningful tradeoff
- Base tier and Tech Center pivots happen fast enough to matter during a 10 to 20 minute match

## Anti-Goals

V1 should avoid:

- Puzzle-like mission scripting
- Heavy meta progression
- Complex hero units
- Large numbers of activated abilities
- Hidden fallback systems that play the game for the player
- Hard counter relationships that make one answer mandatory
- Production building spam becoming the dominant form of macro

## Open Design Questions

These should be resolved before implementation moves too far:

1. What exact stat upgrades, base tier costs, and Tech Center cost values belong in each progression layer?
2. Does the game need any explicit front-control tool beyond waypoints, such as hold zones or attack beacons?

## Mirror-Match Test Priorities

The first playable should primarily test:

- Whether front lines shift naturally under constant reinforcement
- Whether pooling versus trickling creates real strategic tradeoffs
- Whether base tier and Tech Center pivots happen fast enough to answer visible threats
- Whether the basic unit stays relevant without dominating all compositions

## First Playable Defaults

These decisions are intended to unblock implementation. They are defaults for round 1, not final balance commitments.

### Territory Model

Territory should use a lightweight control model in V1.

- Territory is tracked directly in map cells and shifts through army presence, path control, and nearby constructed buildings.
- Each side begins with a small claimed area around the main base so the opening buildout is not blocked.
- Claiming territory means safely operating in an area, routing reinforcements through it, and maintaining nearby force or building presence there.
- Losing territory means enemy pressure makes those actions unsafe or unsustainable.
- Buildings are placed freely inside owned territory using radius-based placement and spacing checks, and live structures physically block unit movement. Territory cells should be small enough that the grid reads as map control, not as an implied building-placement lattice.

This keeps the game focused on pressure and map control without turning territory into a separate command layer.

### Production Configuration

V1 should use single-purpose production buildings.

- Each production building produces exactly one unit type.
- The building auto-produces that unit whenever resources are available.
- Changing production means adding or disabling specific factory lines.
- Ratio-based production can be added later above the factory layer if the macro model needs more expressive power.

### Waypoint Model

V1 should support unlimited waypoint chains with simple editing rules.

- A production building stores one ordered waypoint chain.
- Newly produced units emerge from the center of their factory, exit the structure into open space, and then follow the chain in order.
- When a unit reaches the final waypoint, it continues toward the enemy base and engages enemies normally along the way.
- Reassigning a chain affects future units only.

V1 does not need advanced front-control tools beyond waypoints.

### Base Tier And Tech Center Structure

Tech Center tiers should own unlock progression, while the Tech Center research tree should own branching unit-stat and production-scaling choices.

- The main base and basic production start available without a Tech Center.
- Building a Tech Center unlocks swarm and ranged production plus the first research row.
- Tech Center Level 2 unlocks advanced production and advanced units.
- Each research row below the first requires one more Tech Center level.
- Main base upgrades are parallel economic and survivability investments rather than the tech gate.
- Tech Center branches should never depend on other branches.
- A branch should usually read baseline -> baseline -> specialization fork -> follow-up.

This creates commitment while still allowing pivots within a match.

### Research Presentation Direction

The current preferred presentation is a research modal with a navigable canvas.

- Each unit branch appears as its own visual column.
- The player should pan and zoom the research canvas directly.
- Dependency lines should remain local to the branch being viewed.
- Active research and queue state should sit beside the canvas instead of reflowing the tree itself.

### Engagement Defaults By Role

Basic unit:

- Low-to-medium stickiness
- Early pressure and short-range frontline presence

Disposable swarm unit:

- Low stickiness
- Fast reinforcement, high model count, and strong wrap pressure

Ranged damage unit:

- Medium stickiness
- Fragile payoff backline that prefers fighting behind a friendly line

Tanky frontline unit:

- High stickiness
- Slow, durable, and difficult to dislodge

Anti-swarm unit:

- Medium stickiness
- Best when chaining through dense groups from behind protection

Anti-tank unit:

- Medium-low stickiness
- Precision heavy-target breaker with slow, deliberate firing windows

### Minimal Building Set For Implementation

The first playable only needs:

- Main base
- Core production building
- Advanced production building
- Tech Center

Static defense should be omitted from the first playable unless testing proves expansions collapse too quickly to be interesting.

### Minimal System Scope

The first implementation pass should include:

- One handcrafted map
- One resource type
- AI opponent using the same production, base tier, and Tech Center rules as the player
- Six-unit mirror-match roster
- Automatic production
- Waypoint-based reinforcement routing
- Main base tiers and a branching Tech Center tree with placeholder balance data

The first implementation pass should exclude:

- Fog of war
- Air units
- Hero units
- Global ratio-based production logic
- Formal zone control or capture-point systems
- Additional factions

## Current V1 Direction

Based on current discussion, V1 should prioritize:

- One faction with a strong swarm identity
- Single-player vs AI
- No fog of war
- Open map with contested expansions
- Continuous automatic production-based pressure
- Front control through production routing and unlimited waypoints
- Limited income as the core source of strategic pressure
- Sticky frontline combat with unit-level behavior tuning
- Minimal micro and no squad-management layer
