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

## Powers (Phase 4)

`src/systems/powers/` holds every power as one kind of thing: a **track** (data/tracks) of named
stages, each with a level (Novice to Grandmaster), a cumulative progress threshold, requirements
(stats, other tracks, a teacher, a place, gear, an event since the last stage, a breakthrough at a
plateau, hidden conditions) and what it unlocks (techniques, Combat Power, stat modifiers, flags).
`tracks.ts` is the one engine: opening a track, practice (`addProgress`: drills x1, sparring x1.5,
real fights x3, teaching x0.5, times the practice rate from race, stats, talent and traits, and the
teacher; fruit tracks count mastery 0 to 100 through the training formula's diminishing returns),
entering stages, breakthroughs, rust, and ceilings by race, body and talent. Activities practise a
track through their `practice` field (`practice.ts`), so a new style is data, not code.

**Haki** (`haki.ts`) is three tracks that open by waking, not by teaching: Train Spirit seeds, a
near-death moment, a crisis, a teacher's push. Conqueror's needs the hidden King's Qualities trait and
only wakes in a surge. **Devil Fruits** (`fruits.ts`, `catalogue.ts`) are entities (rule 2), one per
fruit, built with the world layer from data/fruits; canon users take theirs on their dates, pushed by
the canon mode like the beats; a death releases the fruit into an ordinary fruit somewhere, known to
nobody (rule 4); wild fruits are found or sold to black markets once a year. A generator builds new
fruits from power concepts no canon fruit uses. **Techniques** (`techniques.ts`) share one schema;
the pricer turns a technique's form, tags, effects and required mastery into cost, power and
accuracy, for data and for the technique creator alike. `battleActions` is the list Phase 5's battle
engine will read. **Movesets** (`movesets.ts`): the canon cast's by era (data/movesets), generated
fighters' built on demand from their tracks, fruit and temperament (rule 6: the same every time).

Every number a power changes is a modifier with a readable source (rule 3): stage Combat Power goes
on the `combatBonus` stat, which character.json's Combat Power adds through its `bonusStat`; traits'
changes to Max Health, Vigor and haki stamina go on their own bonus stats the same way.

**Traits** (`life/traits.ts`) are their mechanics: stat, potential and training modifiers, derived
bonuses, check bonuses (read by `story/checks.ts`), event and outcome weights, immunities, locks,
opinions others feel (on meeting someone), practice speed, conflicts and evolutions, each recorded
with where it came from. `life/personality.ts` keeps hidden counters that choices and outcomes tagged
"brave", "greedy" and so on nudge, and behaviour counters (months of Hard training, fights): crossing
a threshold grants or removes a personality trait, earns an earned trait, or evolves one.

The player's month runs the powers in step 1 (practice, inside the routine) and step 7 (stamina,
rust, fading moves, an eaten fruit being understood, haki seeds, personality); the world's fruits
move in step 4. The Powers page (`#/powers`) reads `snapshot.powers`; the Devil Fruit page
(`#/fruits`) asks `powers/fruits`, which shows only what the player knows unless omniscient.

## Battles (Phase 5)

`src/systems/battle/` is one engine for every fight. A **fighter** (`fighters.ts`) is a person as
they stand when it starts: their stats, Health, stamina, haki stages, fruit, weapon and moves, and
their power `k`, Combat Power over what their stats alone give. Every number in a fight is a stat
times `k`, so the plan's formulas (hit chance, damage, defence) mean the same for a bar brawl and
for two Emperors. **The exchange** (`engine.ts`): everyone declares; defences take hold; actions
resolve by initiative; then burns, stamina, overdrives running out, morale. It carries the Logia
rule, fruit matchups, guard, Armament coats, Observation reads, Conqueror's bursts, feints,
grapples and seastone, items, talk, flight, second winds, taking the blow for a friend,
combination attacks and tagging in. `ai.ts` decides for anyone not steered (by temperament, or the
player's quick-mode stance). **Scales** (`scales.ts`): duels and skirmishes are exchanges; a crew
battle pairs named fighters on a match-up board and resolves the rest at the fronts in rounds; a
naval battle is rounds of range, cannon, ram and boarding (which turns into a crew battle); a war is
fronts with strength, morale and commanders, the player's named duel on the front they stand at.

**The abstract resolver** (`battle.ts`) answers the same question in one roll, for fights nobody
plays: P = a^g / (a^g + b^g) on effective power (Combat Power, Health left, the Logia rule,
matchups). `npm run battle` fits g against the tactical engine over 1,000 pairings. Tier 2 people
and the canon cast fight by it (`world.ts`): hunts, raids, quarrels, trouble at sea, each logged with
its reason.

**The player's fights** (`player.ts`): an event choice, a canon beat or a debug command with a
`fight` builds a battle with the player on side 0. Tactical, it waits in `state.battle` behind a
decision marked `battle`, so time holds still and skips stop; each `battle/act` plays one exchange,
and the decision's one choice plays the rest (which is also how headless runs play it). When it
ends, `aftermath.ts` applies injuries (a roll for each big blow), Health, death, training, practice,
haki moments, fame, bounty and records; the event's result band or the beat's fate follows (through
`finish-hooks.ts`, a module with no imports so registration never meets a half-loaded module); a
winner who beat someone decides their fate. Activities with a `fight` (spars, brawls, contests,
a crew training day) are quick fights inside the month; a spar's partner sets its training.

**The ladder** (`ladder.ts`): the cast's `power` keyframes name a rung per era; when their own powers
do not reach it (or overshoot), a modifier, "Strength of their era", closes the gap, recalculated
whenever their powers change. Stage Combat Power in data/tracks was rescaled so a lifetime of haki,
fruit and style can climb from Thug to Peak.

## Hands (Phase 6)

`src/systems/hands/` is everything a person holds or owns. **Items are entities** (rule 2): every
weapon, piece of gear, treasure cache and map that matters carries an `item` block (its data id,
where it is or who carries it, grade, quality, edge, wear, blackness, curse, charges, wielders and
history). `items.ts` makes, gives, places and destroys them, and `syncGear` keeps what carrying
does in step: the counts fighting styles ask for (swords, a gun, a bow), the modifiers worn things
give (armour's weight, clothes, a prosthetic's restored strength), and the weapon term of Combat
Power. **Weapons** (`weapons.ts`) turn an item into the battle engine's weapon: family attack times
grade, quality, edge, black and curse, plus the wielder's skill with the family; up to three blades
are wielded. The engine adds skill to accuracy, armour to defence (none in the water), a hungry
blade's drain on haki, and dials and seastone gear as things to use (`kit`). `fight.ts` writes a
fight back: blades dull and wear (the best grades never break, black ones never chip), skill
grows, charges are spent, a sea fight's damage stays on the ship.

**The world's blades** (`swords.ts`) are built with the world layer: each canon weapon once,
following holder keyframes by date unless someone takes it off the story; the graded swords canon
counts but never names, with names of their own; caches of treasure (`treasure.ts`). A grade's
count can never be exceeded: swords are moved, sold, lost and destroyed, never copied, and
tempering a grade up is refused when the grade is full. A death leaves weapons where the person
fell; the player's pass to their heir.

**Curses** (`curses.ts`) set a flag the curses' events read, make monthly mischief, push a
bloodthirsty wielder toward Kill intent, and are tamed four ways. **Crafting** (`crafting.ts`) is
one schema: a project is started (materials bought), worked by the "Work on your project" activity
whose effort and commitment set the pace, and finished with the average of each month's quality
roll; schools speed it. **Ships** (`ships.ts`): the creator's maths (`designStats`), building at a
yard or by hand (a slipway month by month, a launch that trades in the old ship), refits, a ship's
history, upkeep, rot, care and the spirit that once keeps her afloat; a ship's speed, hull and
cargo stay the entity's stats, so the voyage code reads them as before (`shipNumbers`).
**Markets** (`market.ts`): trade goods priced by prosperity and stock, which trading moves and
months restore; gear sold by a place's trades; one-of-a-kind things on shelves. Gambling, Den Den
Mushi calls and Vivre Cards are `gambling.ts` and `gear.ts`.

The player's hands run in step 7 (`month.ts`: dials, a yard's month, a ship's month, curses, a
blade turning black) and through activities in step 1; the world's in step 4 (canon weapons,
markets, others digging). The Gear and Ship pages read `snapshot.hands`; the ship creator asks
`hands/design` for live numbers as the design changes.

**A month scaled by Vigor** (`life/drive.ts`): a deep pool opens overtime slots beyond the stage's
own, and a Hard slot may be pushed further, each point a Vigor more and a multiplier on training,
practice, pay and a project's pace. `resolveRoutine`, `setRoutine`, the life view and the planner
all read the same functions.

## The heart (Phase 7)

`src/systems/heart/` makes people people. **Profiles** (`profile.ts`): seven axes, three values, a
dream, likes, a voice (register, tic, laugh), a fear and a soft spot, made the first time the world
has reason to know someone, from a stream keyed to their id (so the same whenever it is made):
canon people from their voice pack, children from their parents, everyone else from their traits,
home and trade. The player's axes are their traits plus Phase 4's drift counters, every month.
Views read `heartOrRoll`, which never stores, so looking never changes the world.

**Relationships** (`bonds.ts`): each side of a tie keeps seven axes (Affection is the old
`opinion`; the rest live in `axes`), each a Stat whose modifiers are named for their source and
carry the `seq` of the log record behind them (rule 3 and rule 6 together). A bond kind is read
from the relation kind and shows bars: some are axes, the rest its own (on the other's record).
Time works on bases (shared history, a lover's jealousy, attraction), events on modifiers, which
wear toward nothing at the bond's pace. Labels and milestones are data. A monthly sweep stamps any
modifier written by code that did not know its record (a spar's aftermath) with the month's record
naming that person, so every axis traces.

**Talk** (`talk.ts`, data/intents): a check of a player stat against a difficulty from the other's
personality, feelings, values, mood and memories (or a Phase 5 fight), four bands, a line in their
voice (`speech.ts`: `{say.refuse}` is a refusal in their register, with their tic or laugh and
their mood on it), then effects (`effects.ts`), each traced to the talk's record. Information is
told as **facts** (`facts.ts`) with a truth value and a source; deceitful people lie; arriving where
a claim points shows it up. **Initiatives** (`initiatives.ts`, data/initiatives): each month (canon
people) or quarter (everyone else) someone close may reach out, picked by weight among what their
tie allows; with choices it is a decision marked `heart`, resolved here rather than by the event
engine. **Deeds** (`deeds.ts`): Phase 4's drift tags also weigh on the conscience (against one's
values it falls; below the line, guilt) and travel as reputation, place by place and along the sea
lanes; first impressions (`meet.ts`) read it. **Memory** (`memory.ts`) fades by kind, surfaces in
talk, and spreads as gossip (`scenes.ts`, with banquets and crew meetings). **Family**
(`family.ts`): heredity, adoption, wills, grief, the family name. **Companions** are people
flagged as animals. **The world** (`world.ts`): Tier 2 people befriend, fall out, duel and betray
each other a few pairs a quarter.

The player's heart runs in step 7 after the life loop (`month.ts`), the world's in step 4. A
module others call into at load (`hooks.ts`, no imports) lets Phase 4's drift tell the heart about
a deed and Phase 5's aftermath call a victory feast.

## Crews (Phase 8)

`src/systems/crew/` is everyone at the player's side. **A crew is an organization entity** with a
`crew` block (rule 2): its kind, creed, command, structure, pay, home, members, line-ups, log,
fleet, alliances, bases and prisoners. Who is in it is the members list; how each feels about the
captain stays on their Phase 7 crewmate bars (Loyalty, Morale, Respect, Belonging), so no number is
kept twice. The creator (`creator.ts`) builds every kind of group from data/crew.json, fixing what
a kind's template fixes, and exports and imports a crew file. Joining and leaving (`members.ts`)
make someone a crewmate both ways, Tier 1 while they serve, with a hidden potential and 1 to 3
arcs; a canon character who joins leaves the story.

**Recruiting** (`recruit.ts`, `quests.ts`, `world.ts`) is a scene: a pitch scored by the
candidate's values and nature, the player's Charisma and fame and what is between them; their
objections, each answered by a check, a promise, a deed or a payment; then for someone worth
having a joining condition, one of twenty kinds, run as a quest with a tracker. The world's side
makes the lists at the place the player stands (a port's board each quarter, a Marine base's cells,
an underworld auction) from Phase 3's named-person maker, and dissolves the unmet back into the
island's numbers when a list is remade (rule 5); it seeds five hidden legends per world, found by
rumour and exploring. A recruit's profile (`view.ts`) shows only what the player has learned
(rule 4): a stranger's stats are words, sharpened by Perception, Intellect, Observation and time.

**Positions** (`posts.ts`): a role says what someone is good at, a post where they stand. Each
situation (sea, battle, port, storm) has its own line-up; the auto-fill puts people at posts by
role each month, specialists first, locked posts kept, nobody on more than two posts. Each post
names effect keys, and `crewEffect(state, data, key)` (exported through `fx.ts`, the one module
older systems import) sums what the posts are worth: a filled post its value times the fit, an
empty one its cost. With no crew it is 0, so a life without one sails by Phase 3's numbers. The
voyage's pace, the sea's events, checks at sea, storms, the month at sea, a sea fight's guns, aim,
boarding and fires, market prices and the port's lists each read their own keys; the value is
cached per month and line-up, since the voyage planner asks many times over.

**The month** (`month.ts`, step 7 after the heart's): lists and legends, quests, the people the
player knows (Tier 1 while close, their news reaching port), then the crew's: the dead mourned,
everyone aboard where the captain is, posts filled and served (role mastery, titles), pay, morale
and loyalty, grumbling, desertion and mutiny (against the first mate), chemistry (synergy makes two
crewmates friends, which Phase 5's bonds read for combination attacks; friction a quarrel to
settle), every crewmate's training (`growth.ts`: Phase 2's formula, Phase 4's tracks and haki
seeds, styles taught by crewmates), their arcs (`arcs.ts`), bounties and epithets, lives changing,
missions back (`missions.ts`), the fleet, alliances, bases, prisoners (`holdings.ts`), spies and
betrayal (`spies.ts`, the same detection rule for the world's crews in step 4), and the port.
Decisions marked `crew` (`decisions.ts`) are resolved here: the captain rules or asks, as the
creed's command style says, and a crew remembers being overruled. `hooks.ts` (no imports) lets the
heart's Recruit intent, a deed, a talk and a fight's end reach the crew.

## Performance (Phase 8)

A whole headless life (birth to death, the same seeds) takes about 3.6 s, against 4.5 s in Phase 7,
when the autopilot does not captain; a life that captains a crew of 25 to 30 for decades takes
about 5.4 s. Two things kept it there: listed people the player never meets dissolve back into the
place's numbers when the list is remade (before that, a life made a thousand people it never met
and ran three times slower), and the auto-fill scores posts with the role fit's number alone,
without writing its reasons. A ten-year captaincy (`npm run crew`) takes about two seconds.

## Performance (Phase 7)

A whole headless life (birth to death, about 84 years) took 2.8 s with Phase 6's code and takes
3.9 s now, 4.5 s with the autopilot talking to people most months (the same six seeds, the same
machine, one after the other). About a fifth of a life's time is the heart's month (drift,
milestones, people reaching out, gossip); the rest of the rise is what the heart makes happen
(decisions, duels, people met). People apart from the player are updated a quarter at a time,
three months' worth at once (rule 5). A ten-year adult life takes well under a second; 30 of them,
`npm run heart`, 18 s. Hearts are made only when needed, so a full world's save grows
by the people who meet the player or each other.

## Worker protocol

`src/worker/protocol.ts` types every request and response (`boot`, `newWorld`, `advance`, `dispatch`,
`inspect`, `listEntities`, `queryLog`, `saves/*`, ...). Requests run one at a time inside `SimCore`; only
`cancel` jumps the queue. Actions are applied to a clone and swapped in only on success, so a failing action
(even one that fails halfway) leaves the world untouched. The UI never receives the whole state, only a
`Snapshot` projection (header facts, the last 300 visible log lines, counts), which keeps messages small
when the world has thousands of entities.

## Performance (Phase 6)

A world gains about 190 item entities (canon weapons, graded swords, caches). A headless life is
the same speed as before Phase 6 (2.87 s against 2.88 s for the same seeds); the economy sweep's
1,000 lives of 15 years take about two minutes on 11 workers.

## Performance (Phase 5)

A 40-year headless life takes about the same as in Phase 4 (a month's spar is a few dozen
exchanges); a full world's 39 years about 13 s, a little more than Phase 4 for its NPC fights,
which take one roll each. A duel of about ten exchanges takes well under a millisecond, so the
1,000-pairing calibration runs in under half a second.

## Performance (Phase 4)

Phase 4 adds about 160 fruit entities to every world and a few hundred powers blocks. A 40-year
headless life went from 0.9 s to about 1.4 s; most of the rise was systems that sort every entity id
each month, which `entityIds` now caches (exactly: reused only while the key list is identical). A
full world's month is about 30 ms. Generated fighters' movesets are built when looked at, not
stored, so a full world's save grows by little.

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
