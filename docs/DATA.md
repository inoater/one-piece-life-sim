# Writing game data

Everything the game knows lives in `/data` as JSON. Code never contains content (rule 1). Every file is
checked against a schema when the game starts, in `npm run validate`, in the pre-commit hook, in CI, and in
`vite build`; they all run the same function, so they cannot disagree.

## Layout

| Path                                                         | Holds                                                           | Status                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------- |
| `data/calendar.json`                                         | `canonYearOffset`, `presentTick`, months, seasons               | required                                          |
| `data/settings.json`                                         | tier cadence, save slots, skip lengths, UI tails                | required                                          |
| `data/character.json`                                        | caps, growth, talent tiers, life stages, derived                | required (Phase 1)                                |
| `data/creation.json`                                         | entry limits, canon modes, difficulty, wealth, family, backfill | required (Phase 1)                                |
| `data/appearance.json`                                       | appearance fields, options, the sentence                        | required (Phase 1)                                |
| `data/traits/`, `weapons/`, `events/`                        | one item per file, or an array of items                         | schemas exist                                     |
| `data/races/`, `birthplaces/`, `legacies/`                   | character genesis                                               | schemas exist (Phase 1)                           |
| `data/occupations/`, `names/`, `foci/`, `backstory/`         | character genesis                                               | schemas exist (Phase 1)                           |
| `data/life.json`, `activities/`, `jobs/`                     | the life loop                                                   | required (Phase 2)                                |
| `data/locations/`, `lanes/`, `vessels/`                      | the map's places, the sea lanes between them, ships             | required (Phase 3)                                |
| `data/travel.json`, `world.json`, `canon.json`               | voyages; factions, people, economy, news; the canon modes       | required (Phase 3)                                |
| `data/factions/`, `cast/`, `canon/`                          | factions and crews; the canon cast; the canon beats             | schemas exist (Phase 3)                           |
| `data/powers.json`, `personality.json`, `fruitMatchups.json` | power rules; personality and behaviour; fruit matchups          | required (Phase 4)                                |
| `data/fruits/`, `tracks/`, `techniques/`, `movesets/`        | Devil Fruits; power tracks; techniques; canon movesets by era   | schemas exist (Phase 4)                           |
| `data/news/`                                                 | _reserved_                                                      | **files here are rejected until a schema exists** |

A file may hold one object or an array of objects. Subfolders are fine. By convention a single-item file
is named after its id without the prefix: `data/traits/test_brawler.json` defines `trait_test_brawler`
(a mismatch is a warning).

## Ids

Canon entities use readable slugs with a type prefix: `char_`, `org_`, `ship_`, `item_`, `fruit_`, `loc_`
(`char_gol_d_roger`). Generated entities use a counter: `gen_000412`. Content records use `trait_`,
`weapon_`, `loc_`, `evt_`. All lowercase letters, digits and underscores. `npm run canon-lint` enforces
the canon rules (unique, typed, never in the `gen_` namespace) once lore exists.

## What an error looks like

```
data/events/test_crossroads.json
  error   conditions[0].trait: Unknown trait "trait_test_brawlr" (did you mean "trait_test_brawler"?)
  error   conditions[1].location: Unknown location "loc_test_harbour" (did you mean "loc_test_harbor"?)

Data is invalid: 2 problems in 1 file.
```

Every problem in every file is reported at once. Unknown fields are errors, so a misspelled field never
becomes a silently ignored one. A broken file stops `vite build` with this same message, and in
`npm run dev` it appears in the browser overlay.

## Cross-references

Schemas check each file alone; the loader then checks files against each other. An event may only name a
trait, island or follow-up event that exists (`conditions[].trait`, `conditions[].location`,
`effects[].eventId`, including inside `choices[]`). References are extracted explicitly per type in
`src/engine/data/refs.ts`; adding a new reference field is a deliberate edit there.

## Text templates

Event text, log lines and news may contain `{variables}`: `{date}`, `{year}`, `{month}`, `{monthName}`,
`{season}`, and since Phase 1 `{player.name}`, `{player.givenName}`, `{player.familyName}`,
`{player.race}`, `{player.home}`, `{legacy.parent}` ("your mother") and `{legacy.parentName}`.
Backstory text has its own set: `{age}`, `{home}`, `{race}`, `{familyName}`, `{parent}`,
`{parentName}`, `{sibling}`, `{other}`, `{monthName}`, `{season}`; the appearance sentence has
`{a}`, `{adjectives}`, `{noun}`, `{face}`, `{skin}`, `{hair}`, `{eyes}`, `{extras}`. Write `{{` and `}}`
for literal braces. A typo such as `{monthname}` is a validation error that
names the file and field, not "undefined" in the middle of a story. New variables are added to
`TEMPLATE_VARS` in `src/engine/template.ts`.

## Events (as of Phase 0)

```json
{
  "id": "evt_test_crossroads",
  "type": "personal",
  "title": "A test crossroads",
  "text": "Two paths open in {monthName}.",
  "trigger": "manual",
  "visibility": "public",
  "conditions": [{ "kind": "hasTrait", "trait": "trait_test_brawler" }],
  "choices": [
    {
      "id": "left",
      "label": "Take the left path",
      "effects": [
        { "kind": "setFlag", "flag": "dev.crossroads", "value": "left" },
        { "kind": "log", "text": "The left path was quiet." },
        { "kind": "schedule", "eventId": "evt_test_aftermath", "afterMonths": 2 }
      ]
    }
  ],
  "news": "Something happened ({date}).",
  "tags": ["dev", "personal"]
}
```

- **Works now:** firing when scheduled or forced; `effects` (`log`, `setFlag`, `schedule`); `choices`
  (an event with choices stops every time skip until the player decides); `news`; `visibility: "secret"`
  (true in the world, known to nobody: shown only in omniscient mode).
- **Validated but not yet evaluated (inert):** `conditions`, `weight`, `cooldown`. They belong to the event
  engine in Phase 3; the schema accepts them now so authors can write against the final shape.
- `afterMonths` counts from the month the effect is applied and must be at least 1, so a chain can never
  loop inside one tick. A secret event cannot have `news`.

## Character genesis (Phase 1)

How the files fit together, and the rules the loader enforces beyond each schema:

- **Races** give cap modifiers (percent), racial traits, three life-stage anchors, a lifespan and a
  centimetre range for each height class. Every race must be listed by at least one birthplace, and
  give a range for every height option.
- **Birthplaces** list the races born there, a trait pool, a name pool, and multipliers: on family
  legacies, backstory foci, backstory event tags and appearance options. `home` is how a story names
  it mid-sentence ("the village"); `bornIn` carries its preposition ("on an island in the New World").
- **Legacies** (family hooks) give starting Berries, a wealth shift, a trait pool, the parent who
  carries the legacy (or a guardian, for an orphan) and an event `chain` that fires at an age. Its
  `pastText` has no age in it: the backstory adds "At sixteen, ".
- **Backstory events** are written in the second person, past tense, as a full sentence. `ages` are
  human-equivalent years (a giant's are converted). A text that uses `{other}` needs a
  `relationship` (or `relationDies`) effect; `{parent}` needs `"parentAlive": true` or a
  `parentDies` effect; `{sibling}` needs `"hasSibling": true`. The schema checks all three.
- **Multiplier keys** for appearance are `"field.option"` (`"hairColor.white"`) or `"tag:name"`
  (`"tag:scar"`); both are checked against `appearance.json`.
- Every number is a design value to tune. `npm run genesis` and the Genesis debug tab show what
  potential the data produces for each race.

## The life loop (Phase 2)

- **`data/life.json`** holds every rule of a month: slots by stage, effort (Vigor, gain, pay, risk),
  exhaustion, mentors and breakthroughs, Health regeneration, injury severities and areas (with their
  names, scar and loss traits), illnesses, epidemics, the death-or-collapse chances at Health 0, the
  mortality table, money, the doctor, children, fame's Legacy share, gang names, the continue options,
  the epilogue and every line the loop writes.
- **Activities** (`data/activities/`) have a category, ages (human-equivalent), requirements, training
  gains, earnings or costs, risks and written **outcomes**. An outcome is a second-person, past-tense
  sentence with a weight, optional `statWeights` (a strong character wins more fights), conditions and
  effects. `"quiet": true` keeps an everyday outcome off the chronicle (it still shows on the month
  card). A text that names `{parent}`, `{friend}`, `{spouse}` and so on must be guaranteed that person
  by its conditions; the schema checks it, as it does for backstory text.
- **Jobs** (`data/jobs/`) have a minimum age, requirements (`anyOf` for alternatives: Sea Legs or
  Endurance 20), a wage range, side training, risks, flags they grant, an optional rank track, and
  outcomes for a month of shifts.
- **Requirements** read the home's `features` (each birthplace lists its coast, docks, school,
  doctor...), races, flags (a number flag passes at or above the value; a flag not on the character
  is looked for on the world, where legacy events put theirs), traits, stats, Combat Power, a job,
  people (`relation`, `noRelation`, `married`), health and money.
- **Effects** of outcomes, jobs and events: `train`, `berries`, `injury`, `illness`, `health`, `trait`,
  `flag`, `count`, `fame`, `infamy`, `opinion`, `relationship`, `potential`, `marry`, `conceive`,
  `joinGang`, `deed`, `arrest`, `schedule`. Events may use all of them in their choices (see
  `data/events/debt_collector.json`).
- Life text has its own variables (`LIFE_VARS` in `src/engine/template.ts`): the world's, plus `{age}`,
  `{ageWords}`, `{home}`, `{other}`, `{job}`, `{amount}`, the people, `{injury}`, `{illness}`, `{stage}`,
  `{title}`, `{cause}` and a few more.
- Every number is a design value. `npm run lives` and the Life debug tab show what they add up to.

## The world (Phase 3)

- **Places** (`data/locations/`) are the nodes of the travel graph: region, climate, population
  tier, wealth, danger (0 to 5, which sets how safe it is to live there), the faction that holds it
  at the start, features (the services: docks, a shipyard, a doctor, a Marine base, an underworld
  for the black market, a library...), the culture its people share (a birthplace, for names, races
  and trades), event tags (the local event pool), a Log Pose time (Grand Line islands), the Eternal
  Poses sold there and a position on the map. Every birthplace names the place it is (`location`).
  Canon places have `origin: "canon"`; the generic villages of the four seas are `"generated"`.
- **Lanes** (`data/lanes/`) join two places: sea miles, danger, current, and what they need
  (`none`, `log_pose`, `eternal_pose`, `coated_ship`, `sky_route`); `oneWay` (Reverse Mountain),
  `land` (walked), `traffic` (0: no ship takes travellers), `closedBy` and `needsFlag` with the
  planner's text. The loader fails if any place cannot be reached, or has no lane.
- **Vessels** (`data/vessels/`): speed, hull, crew, cargo, cost and where they are sold.
- **`data/travel.json`**: provisions, fares, wages, repairs, coating and poses; currents, winds and
  the navigator's bonus; the six travel modes; the captain's orders; region danger and voyage-event
  rolls; morale, starvation, scurvy, seasickness, wrecks, going overboard; the place at sea; lines.
- **`data/world.json`**: Tier 2 and Tier 3 people (how many per population tier, births and deaths,
  goals and the utility of each action), faction rules, the economy, news delays, how many random
  events a month, and climates.
- **Factions** (`data/factions/`): strength and its yearly trend, opinions of each other, the
  faction they answer to, and for crews (`kind: "crew"`) a captain, a line of succession, a founding
  date and `active` (a crew a beat founds starts inactive). `umbrella` counts a crew toward the
  pirates' strength, or a kingdom toward the kingdoms'.
- **The cast** (`data/cast/`): name, race, birth date (with `approx`), birthplace, prime stats and
  keyframes: from a month, where they are, as what, with what bounty, haki and fruit, flagged
  `approx` when the source is vague. Keyframes are in order and never overlap (canon lint). `ties`
  are the people who leave the story with them if they die early.
- **Beats** (`data/canon/`): a window, an anchor (`hard`, `soft`, `seed`), an optional `chance` (the
  Random-mode chance across the window), a place, roles (a character and substitutes, present or
  not), `requires`, `outcomes` and `onDiverge` (deaths, imprisonment, territory, factions, crews,
  flags, prosperity), news, and choices for a player who takes part (`participate` and `instigate`
  give the Combat Power needed; a choice with `diverge` stops the beat).
- **Events** grew the engine the Phase 0 schema promised: `trigger` (`random` for the player ashore,
  `voyage` at sea, `world` somewhere in the world, `arrival` on landing), conditions (about 30 kinds:
  place, sea, lane, travel mode, ship, age, stats, flags, canon mode, beats, a canon character here...),
  `weightMods`, `cooldown`, `once`, `roles` (`relation`, `stranger`, `canon`, `captain`, named in text
  as `{role.<name>.name}`, `.title`, `.they`, `.them`, `.their`), `where` (world events), choices with
  `requires` and a skill `check` with four bands, and effects on the vessel (`hull`, `supplies`,
  `crew`, `morale`, `delay`, `redirect`, `overboard`), the player (`bounty`) and the world (`faction`,
  `control`, `prosperity`, `population`, `localFlag`, `news`, `meet`).
- New text variables: `{place}`, `{destination}`, `{ship}` everywhere, and the canon lines' own
  (`CANON_VARS`: `{name}`, `{title}`, `{beat}`, `{cause}`, `{successor}`, `{crew}`, `{fruit}`).

## Powers (Phase 4)

- **Traits** now carry their mechanics: `statMods`, `potentialMods`, `trainingGainPct` and
  `trainingMods` (per stat), `derivedMods` (Max Health, Vigor, haki stamina, Combat Power),
  `checkBonuses`, `eventWeights` (also weighs activity outcomes by their tags), `immunities`
  ("seasickness" or an illness), `locks` (an activity, for good or for some months), `opinion` (what
  people of a group in personality.json feel; `firstImpression` only on meeting), `powerMods`
  (practice of a track, or `family:sword`), `flags`, `excludes`, `evolves` (into another trait when
  counters and stats are reached), `earn` (gained by itself), `drift` (a personality trait held while
  its hidden axis is past `gainAt`, lost back past `loseAt`), `hidden` with a `hint`, and the lines
  for gaining and losing it. The loader rejects a trait that does nothing, and two traits with one
  name (names label the modifiers).
- **data/personality.json**: the axes (courage, temper, honesty, mercy, generosity, pride, caution),
  the tags that nudge them (`{"kind": "drift", "tags": ["brave"]}` in any outcome, choice or check
  band), behaviour counters (by activity, category, tag, effort, at sea, or counted by effects), and
  the groups opinions are felt by.
- **Tracks** (`data/tracks/`): stages with `at`, `level`, `requires`, `techniques`, `combat`,
  `statMods`, `flags` and the chronicle line; `learn` (teacher at places, features or regions, with
  a fee and a multiplier; wake; fruit; innate; event), race rates and an outsider flag, `opens`,
  `speedStats`, `rust`, `ceilings`, `hidden`, `group`.
- **Techniques** (`data/techniques/`, and inside each fruit): form, tags, range, effects, the mastery
  or stage that teaches them; cost, power and accuracy may be left to the pricer in powers.json.
- **Fruits** (`data/fruits/`): type and Zoan kind, rarity, a unique `power` key, primitives,
  weaknesses, boosts, techniques, a `secret`, an awakening sentence, a Mythical Zoan's `will`,
  canon `holders` by date (a cast member, an object or animal with a body, or a name), and `start`.
- **Movesets** (`data/movesets/`): a canon character's eras, each with its techniques, signature,
  finisher, the stages of their tracks then, and their fruit's mastery.
- **data/powers.json**: practice weights, rust, talent ceilings, haki waking, fruit rules (curse,
  rebirth, prices, discovery, handover per canon mode, bodies), primitives, the generator's concepts,
  animals and naming grammars per culture, the pricer, the technique creator, movesets, generated
  fighters by occupation, and every line the powers write (the loader checks they are all there).
- New effects: `drift`, `behaviour`, `loseTrait`, `powerEvent`, `powerPoints`, `powerBreakthrough`,
  `learnTrack`, `findFruit`, `immerse`, `fruitSecret`, `fruitRumour`, `wakeHaki`. New conditions:
  `track`, `notTrack`, `fruitUser`, `mastery`, `fruitUnknown`, `fruitHasSecret`, `wildFruitHere`,
  `personality`, `counter`, `haki`. Requirements gain `tracks`, `fruitUser` and `gear`. Activities
  gain `practice`. Outcome text may use `{technique}`.

## Dev fixtures

Phase 3 adds a test crew, three test characters and a test duel beat (`dev: true`), and a dev place
and lane (tagged `dev`). They exist only in worlds with `dev.fixtures` set. Everything named
`test_*` is a fixture for the debug panel and the tests (a test entity whose strength is
`50 + 12 training + 8 Brawler + 4 Cutlass = 74`, a chain of events, a secret event). They contain no lore.
They are bundled into the worker in every build but cannot fire in production, because forcing an event is a
debug action the worker refuses. The test traits have `"weight": 0`, so character genesis never draws them. Delete them when real content makes them redundant, and update
`src/systems/devtools.ts` and the tests that name them.
