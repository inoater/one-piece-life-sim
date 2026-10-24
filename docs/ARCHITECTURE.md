# Architecture

## Layers

Dependencies point inward only. `tools/lib/source-lint.ts` checks this on every run of `npm run lint:sim`
and in the test suite.

```
  ui  ──►  (types and four tiny pure helpers only)
   │
   ▼  messages (structured clone)
 worker  ──►  core  ──►  systems  ──►  engine
 (SimCore, protocol)    (game rules)    (infrastructure)
```

| Layer     | May import                                                                                          | Holds                                                                     |
| --------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `engine`  | `engine`, `zod`                                                                                     | clock, RNG, tick runner, stats, log, data loader, saves. No game rules.   |
| `systems` | `engine`, `systems`, `zod`                                                                          | the eight pipeline steps, events, decisions, actions, dev fixtures        |
| `core.ts` | engine, systems                                                                                     | `tick(state, data, rng) -> state` and `advance`                           |
| `worker`  | all of the above                                                                                    | `SimCore` (one world, queries, saves), the protocol, the Web Worker entry |
| `ui`      | `ui`; **types** from anywhere; `worker/protocol`, `worker/sim-error`, `engine/hash`, `engine/stats` | screens and the shell                                                     |

The UI reaches the simulation through one interface, `SimHost` (`src/ui/host.ts`), with two
implementations: `WorkerSimHost` (normal) and `InlineSimHost` (same engine on the main thread, used when a
Web Worker cannot start, and by tests). Both hand back structured clones, so the page never holds a live
reference into the simulation.

## The tick

`tick(state, data, rng)` is pure: it clones the state, runs the pipeline, returns the new state. A tick
processes the month `state.tick` and then advances the clock, so 468 ticks from Year 0 process Years 0 to 38
and leave the clock on tick 468 (the first month of the present).

| #   | Step             | Behaviour (as of Phase 3)                                                                   |
| --- | ---------------- | ------------------------------------------------------------------------------------------- |
| 1   | `resolveActions` | Builds the world layer if missing; queued actions; the player's routine (Phase 2)           |
| 2   | `advanceVoyages` | The player's month at sea, or wages for a moored ship (Phase 3)                             |
| 3   | `npcDecisions`   | Tier 1: the canon cast follows keyframes (monthly). Tier 2: goal-driven choices (quarterly) |
| 4   | `updateWorld`    | Entropy probe; canon births; factions, territory, economy; Tier 3; epidemics; Tier 2's year |
| 5   | `rollEvents`     | Canon beats; scheduled events; the player's arrival, voyage or local events; world events   |
| 6   | `compileNews`    | News items, each with a place and the month it reaches the player                           |
| 7   | `aging`          | The life loop's month: growth, birthdays, healing, money, births and deaths (Phase 2)       |
| 8   | `autosave`       | **Requests** a save by returning an effect; never writes anything itself                    |

A system is a `TickStep { id, run(state, ctx) }`. Adding one is one line in `src/systems/index.ts`. Steps
mutate the draft they are given; `runTick` clones first, `runTickInPlace` does not (the host uses it for
bulk advances to avoid copying every month). A test proves both give identical hashes.

### Time controls

`advanceBatch` runs a bounded number of ticks and reports why it stopped: `completed`, `decision`, `event`
or `present`. Every plan stops on a decision, so a skip cannot run past a choice the player must make.
`SimCore.advance` calls it in chunks, yielding to the event loop between them, so a 468-month run never
freezes the page and can be cancelled. The result never depends on how the work was chunked (tested).

A skip is all-or-nothing, like an action. Systems mutate the state in place, so one that throws in the
middle of a month would leave a half-ticked world. `SimCore.advance` therefore takes one checkpoint
(`structuredClone`) per skip request, not per month, and restores it on any error: the world, the
scheduled events and the autosaves are exactly as they were before the click, and the page's snapshot
still agrees with the worker. A cancelled skip is not an error and keeps the months it finished. The
price is one state copy per click, the same trade `dispatch` makes (see Performance).

## Determinism

1. **Keyed random streams** (`src/engine/rng.ts`). `Rng.root(seed).fork('tick', t).fork(stepId)` derives a
   stream from a _path_, not from how much was drawn before. Forking does not consume the parent. Therefore
   a new system cannot disturb existing ones, the player choosing differently cannot disturb what the rest of
   the world rolls, and a save needs only the seed. Core generator: sfc32 seeded from a 128-bit hash of the
   path, cross-checked against an independent reference implementation.
2. **No approximated maths in simulation code.** `Math.sin/cos/exp/log/pow`, `**` and friends are allowed to
   differ between JavaScript engines. `src/engine/dmath.ts` provides deterministic `dexp`, `dlog`, `dpow` and
   `ipow` built only from exactly-specified operations. The lint forbids the rest in `src/engine`,
   `src/systems` and `src/core.ts`, together with `Math.random`, `Date`, `performance`, `crypto` and every
   DOM or timer API.
3. **State is plain JSON, hashed canonically** (`canonical.ts`): sorted keys, and anything that would
   silently change meaning when saved (NaN, `undefined` in arrays, Map, Date, class instances) throws with
   the path. Never rely on object key order in logic; use `entityIds(state)`, which is sorted.
4. **Time comes from the tick.** Wall-clock time appears only in save metadata and in host pacing.

The entropy probe (`dev.probe` flag) exists because an empty world consumes no randomness, which would make
"same seed, same hash" pass even with a broken RNG. With the probe on, every tick draws numbers and folds them
into the state, so the determinism tests are meaningful. A test confirms they fail when one stream is tampered with.

## State

`src/engine/state.ts` is the single source of truth: a Zod schema, with types inferred from it, validated on
every load. Highlights: entities in a plain object keyed by id; a stat is `{ base, mods[] }` with
`final = (base + flats) x (1 + percentages / 100)`; log records carry `cause` and `causeSeq` so "why did this
happen?" can be walked back (`explainChain`); every record and entity carries `knownBy` (rule 4).

Fields beyond the plan's list, and why: `tier` (rule 5 needs it), `counters` (stable ids), `openEnded`
(Phase 2 epilogue), `scheduled`/`pending`/`queue` (event scheduler, decisions, queued actions), `seq`,
`cause`, `causeSeq`, `knownBy` on log records.

## Character genesis (Phase 1)

`createLife(data, options)` in `src/systems/genesis/generate.ts` is one pure function from New Life
options to a world: it creates the world at the entry month, the player (with hidden potential and
talent), their family, and their past, one compressed pass per year lived before entry (natural
growth by life stage, training shaped by birthplace, family and focus, 0-3 backstory events), then
appearance, starting Berries and the written backstory. The New Life preview calls the same function
(`genesis/preview`) on a throwaway world, so the preview is exactly what `genesis/start` makes.

Every random choice has its own keyed stream under `fork('genesis', ...)`: rerolling one section or
one appearance field changes only what depends on it, and the talent tier is keyed to the seed
alone. The sheet the page shows (`systems/genesis/sheet.ts`) carries every stat's breakdown and every
derived value's formula (rule 3), and includes potential, talent and Luck only in omniscient views
(rule 4).

## The life loop (Phase 2)

`src/systems/life/` lives in two pipeline steps. Step 1 (`resolveActions`) runs the player's
routine: each activity, up to the slots their stage allows, costs Vigor by effort, trains its stats
through the training formula, may earn or cost Berries, draws one written outcome and rolls its
risks; spending past the Vigor pool leaves the character exhausted. Step 7 (`aging`) is the passing
of the month: natural growth and decline, birthdays and stages, illness and healing on schedule,
money (cost of living, debt, interest, the collector), children and siblings born, relatives' deaths
and, on each birthday, the yearly mortality roll. A world system in step 4 brings epidemics.

Everything that changes a life goes through one effect function (`life/effects.ts`), shared by
activity outcomes, job shifts and event choices, so a collector's beating and a sparring accident
are the same injury. Locks (why an activity or a job cannot be done) come from one function that
both the month and the planner call, so the page never offers what the month will refuse.

When the player's character dies, `advance` stops with `ended` (an injected `halted` predicate, like
`resolveDecision`) until the player chooses who to carry on as (`life/death.ts`). Carrying on gives
the chosen person a full body made by character genesis for their age and home, keeps who they
already were, applies the inheritance rules, and lets them know what the last life knew, so the
chronicle reads on.

`life/headless.ts` runs whole lives with an autopilot for the balancing tool (`npm run lives`,
worker threads on every core) and the tests.

## The world (Phase 3)

`src/systems/places/` holds the map: the travel graph (`graph.ts`: lanes from a place, shortest
distances, news delays), where a person is (`place.ts`: the life loop's `Person.place`, a map node or
the open sea, replacing the birthplace for everything a place decides), building the world layer and
its past (`setup.ts`, `history.ts`), Tier 2 and Tier 3 people (`people.ts`, `residents.ts`), the
views and the timeline. `src/systems/voyage/` is travel: the planner (`plan.ts`, the one function
both the page and the actions ask), the month at sea (`sea.ts`), progress maths (`progress.ts`),
commands and views. `src/systems/story/` is the event engine: context, conditions, selection and
weights, roles, skill checks, world effects. `src/systems/canon/` is the cast (keyframes, deaths) and
the beats. `src/systems/factions.ts` is factions and territory.

**The world layer** is built once per world that someone lives in: location entities for the 55
places, organization entities for the factions and canon crews, the canon cast born by then; then
`runHistory` plays Year 0 up to the world's first month with a pipeline of the world's steps only
(no player, no voyages, no autosave), using the same keyed random streams; then the Tier 2 people
are made. A bare world (the Phase 0 tools) stays bare: world systems and random events only run once
the layer exists. A save from before Phase 3 gets its layer when it is opened.

**Canon beats** run first in step 5. A beat waits for what it requires, fills its roles (dead:
substitute or cancel; elsewhere: travel at canon speed and delay up to six months, or cancel; someone
still on the story's path counts as present if the story had them there when the window opened),
and then happens if the canon mode says so this month (Canon: hard and soft on their date; Probable:
six times the ordinary chance; Random: the ordinary chance). A player present takes part through a
decision, or witnesses it; one sailing past sees it from the deck; everyone else reads the news. A
beat that does not happen is a divergence: logged with kind, cause and month, its `onDiverge` applied,
every beat requiring it diverging at once, and (when the story was broken: a role-holder lost, or the
player's doing) its survivors leave the story. Every non-player death goes through
`killCharacter`, so an early canon death is always noticed (fruit, successor, news, ties).

**Knowledge** (rule 4): world events and beats are logged known to nobody, unless the player is
there; the news carries them, late by distance, and not at all at sea until landfall.

## Worker protocol

`src/worker/protocol.ts` types every request and response (`boot`, `newWorld`, `advance`, `dispatch`,
`inspect`, `listEntities`, `queryLog`, `saves/*`, ...). Requests run one at a time inside `SimCore`; only
`cancel` jumps the queue. Actions are applied to a clone and swapped in only on success, so a failing action
(even one that fails halfway) leaves the world untouched. The UI never receives the whole state, only a
`Snapshot` projection (header facts, the last 300 visible log lines, counts), which keeps messages small
when the world has thousands of entities.

## Performance (Phase 3)

A full world has about 2,000 Tier 2 people and 2 MB of state. A month takes about 25 ms in Node
(Tier 2 choices are quarterly), a year's skip about 0.3 s, and a whole 39-year world with every
person about 7 s (0.2 s without them). Building the world layer for a life entered in Year 30 (the
past and the people) takes about 0.25 s. A save of that world gzips to about 320 KB. Headless lives
and the page's tests use worlds without Tier 2 people (`population: "none"`).

## Performance (Phase 0)

468 months with no NPCs take 4 to 8 ms in a cold process (the target was under 2 seconds). 1,000 worlds
take about 1.4 seconds. Today `runTick` copies the state with `structuredClone`; with ~2,200 entities
that will matter for _pure_ ticks but not for bulk runs, which mutate in place. If profiling later says
otherwise, only the cloning line changes: systems already mutate a draft, so swapping in structural sharing
(Immer or Mutative) needs no system code to change. The per-skip checkpoint in `SimCore.advance` is a
second copy of the same kind, taken once per click; measure it again when a world holds thousands of
entities, and if it shows up, replace it with the same structural sharing.

## Build

Vite 8. `vite build` runs `tools/validate-data.ts` as a subprocess from a small plugin, so the build gate is
literally the same program as `npm run validate`. `--mode preview` embeds the worker as a blob and
`tools/inline-html.ts` folds the result into one HTML file. In production builds `__DEBUG_PANEL__` is
`false`, the debug panel is never imported, and the worker refuses `debug/*` actions.
