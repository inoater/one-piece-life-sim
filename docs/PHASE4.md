# Phase 4 status report: traits, Devil Fruits, haki and fighting styles

**Status: complete against the plan's Phase 4 "Done when" list, with one shortfall in size: 136
canon Devil Fruits, not the plan's "about 200".** The character now has powers. 150 traits carry
real mechanics, and personality traits come and go with the choices a life makes. Everyone carries
the three seeds of haki, and Conqueror's wakes only in those born with King's Qualities. Every canon
fruit is one entity in the world, held by its canon users on their dates and reborn somewhere
unknown when a user dies; a generator makes new ones from power concepts no canon fruit uses. Every
power (haki, the three fruit types, the Six Powers, swordsmanship and its schools, Fish-Man Karate
and Jujutsu, Black Leg, Electro, Sulong, Okama Kenpo, Dragon Claw, Life Return, Mantra, guns,
bows, brawling, naval tactics) climbs the same engine of tracks and stages. Techniques share one
schema and one pricer; 40 canon fighters have movesets by era; generated fighters get movesets that
fit them; the player can invent a technique. Dates now read in Sea Circle years. Phase 5 (the battle
system) is not started.

## "Done when", with evidence

| Plan says                                                                                                                                      | Result                                                                                                                                                                                                                                                                                                                                                                                | How it is checked (and how to re-run)                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 150 traits load, each with a passing rule test                                                                                                 | **Yes: 150** (plus the two dev-fixture traits), in 13 categories including personality, earned, reputation, hidden and power. Each has its own test: every stat, potential, training, derived, check, event-weight, outcome-weight, immunity, lock, opinion, practice and flag the data gives is measured before and after the trait. The loader rejects a trait that does nothing    | `tests/systems/traits.test.ts` ("trait_x does what its data says", one per trait) |
| Personality drift grants and removes traits in a 39-year headless life                                                                         | **Yes**: in 20 lives of 39 years, 86 personality traits were gained and 18 lost; 14 lives both gained and lost one. Earned traits (Scrapper, Bookworm, Old Salt ...) and evolutions (Scrapper into Street Fighter into Iron Fist) come from behaviour counters                                                                                                                        | `tests/systems/traits.test.ts`; `npm run powers -- --drift 20`                    |
| Every canon fruit and 1,000 generated fruits validate; no generated fruit duplicates a canon power                                             | **Yes**: 136 canon fruits (87 Paramecia, 37 Zoan, 12 Logia) with 291 techniques between them, one power key to a fruit. 1,000 generated fruits validate against the same schema in under 0.2 s; none takes a canon power or a canon name                                                                                                                                              | `tests/systems/fruits.test.ts`; `npm run powers`                                  |
| A fruit user's death returns the fruit to the world; a 39-year run never holds two copies                                                      | **Yes**: a death puts the fruit into an ordinary fruit somewhere (near the death, near trade, or anywhere), known to nobody. In a 39-year full world: 171 fruits, at most one copy of any one in any year, 27 returned to the world on a death. Canon successions follow (Ace's Flame-Flame Fruit to Sabo, Whitebeard's Tremor-Tremor Fruit to Blackbeard)                            | `tests/systems/fruits.test.ts`; `npm run powers -- --world`                       |
| A fruit user overboard drowns without a rescuer and lives with one                                                                             | **Yes**, on several seeds each way; anyone else still gets Phase 3's swimming roll                                                                                                                                                                                                                                                                                                    | `tests/systems/fruits.test.ts`                                                    |
| Haki wakes under each documented trigger; Conqueror's never wakes without King's Qualities across 10,000 lives                                 | **Yes**: Armament and Observation wake from Train Spirit seeds, a near-death moment, a crisis protecting someone and a teacher's push; Conqueror's in a surge. In 10,000 lives from character genesis (none born with King's Qualities, which is one in a few million) every trigger was tried five times: Conqueror's woke in 0 of them. Given the trait, 100 of 100 lives woke it   | `tests/systems/powers.test.ts`; `npm run powers -- --kings 10000`                 |
| Each fighting style is learnable from its teacher and place, and its techniques appear on the sheet                                            | **Yes**: for every taught track, a character at a teaching place with the fee and the requirements begins it and its first techniques show on the Powers page; nowhere near a teacher it says "No teacher here". Styles only an event opens (Okama Kenpo, Dragon Claw, Oden's style, Sulong) open from their events. Minks are born with Electro, Skypieans with Mantra               | `tests/systems/powers.test.ts`                                                    |
| Every haki, fruit, Six Powers, sword, Fish-Man Karate and Jujutsu track can be climbed stage by stage; a plateau breaks only on a breakthrough | **Yes**: each of these tracks is climbed from its first stage to its last, every requirement met in turn; at every plateau, practice alone stalls the track at its threshold until a breakthrough. Unused tracks rust inside a stage, never below it; race and talent set ceilings                                                                                                    | `tests/systems/powers.test.ts` (one test per track)                               |
| 40 canon movesets load by era                                                                                                                  | **Yes: 40**, from Roger and Xebec to Luffy and Law, each era's techniques, signature, finisher, stages and fruit mastery. Met in an era, a character knows exactly that era's moves and nothing from a later one                                                                                                                                                                      | `tests/systems/powers.test.ts`                                                    |
| 1,000 generated fighters get movesets that fit their style, fruit and personality                                                              | **Yes**: each moveset uses only techniques of their tracks and fruit; a hot-headed fighter leans to offence and a cautious one to defence; names follow culture (a Wano fighter and a Fish-Man do not sound alike); the same fighter gets the same moveset every time                                                                                                                 | `tests/systems/powers.test.ts`                                                    |
| A player-invented technique is priced from its parts and appears in battle                                                                     | **Yes, as far as Phase 4 has a battle**: the creator prices a technique from its form, tags, effects and mastery with the pricer the data uses; practice turns the draft into a move; it is then in `battleActions`, the list Phase 5's battle engine reads, and is chosen and used in a scripted fight. Combination techniques need a partner close enough and land in both movesets | `tests/systems/powers.test.ts`                                                    |

## What was built, against the plan

| Plan item                                                                                                        | Where                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Traits, fully: every mechanic the plan lists, gained by birth, upbringing, events, behaviour and drift           | `data/traits/`, `src/systems/life/traits.ts`, `personality.ts`; the sheet shows each trait's effects and where it came from |
| Personality axes and drift; behaviour counters; earned and evolving traits; reputation traits                    | `data/personality.json`, `life/personality.ts`; outcomes and choices carry `drift` tags                                     |
| Devil Fruit types and sub-types, including SMILEs (about 10% work)                                               | `data/fruits/`, `powers/fruits.ts` `eatFruit`                                                                               |
| One fruit, one world; rebirth; one fruit per eater; the Blackbeard anomaly as a hidden condition                 | `powers/fruits.ts`; a fruit is an entity with a history                                                                     |
| Eating unknown fruit; identifying it (encyclopedia, scholar, 1 to 6 months)                                      | `identifyCommand`, `discoveryMonth`; the Devil Fruit page                                                                   |
| The curse: sea water and seastone take 90% of every stat; overboard drowns without a rescuer                     | `curse`, `fruitUserOverboard`; arrests now use seastone                                                                     |
| Ways to get one: finds, chests, black markets, auction, gift, theft, a canon beat, inheritance                   | `data/events/powers.json`, `buyFruitCommand`, Dressrosa's colosseum prize, `passCarriedFruits`                              |
| Objects and animals with a body (Lassoo, Funkfreed)                                                              | powers.json `fruit.bodies`                                                                                                  |
| Mastery 0 to 100 by the training formula; techniques at mastery thresholds; renaming                             | the fruit tracks (`data/tracks/paramecia.json` ...), `renameMove`                                                           |
| Awakening: mastery 90, Willpower 70, a breakthrough                                                              | each fruit track's last stage; the awakened stat boosts in powers.json                                                      |
| Mythical Zoan wills; matchups in data                                                                            | `evt_mythical_will`; `data/fruitMatchups.json` (Phase 5 reads it)                                                           |
| The catalogue: canon fruits with type, rarity, primitives, techniques, weaknesses, holders by date, `approx`     | 136 fruits; holders by date, including people the cast does not have (they are kept as names)                               |
| The generator: about 60 primitives, name patterns, a type, a weakness and 6 to 10 techniques                     | `powers/catalogue.ts`; powers.json `primitives` (60) and `generator`                                                        |
| A Devil Fruit page: known fruits, users, last known place, the encyclopedia, rumours                             | `#/fruits` (`src/ui/screens/fruits.ts`)                                                                                     |
| Haki: three colours, their levels, King's Qualities, Mantra, the Voice of All Things, Ryuo, haki stamina, waking | `data/tracks/armament.json`, `observation.json`, `conqueror.json`, `mantra.json`; `powers/haki.ts`                          |
| Haki in Combat Power                                                                                             | stage `combat` values on the `combatBonus` stat, added by character.json's Combat Power                                     |
| Fighting styles as data: teacher, place, requirements, technique tree, training activity                         | `data/tracks/`, `data/techniques/`, activities' `practice` field                                                            |
| How every power grows: practice kinds, teachers, plateaus and breakthroughs, rust, ceilings                      | `powers/tracks.ts`                                                                                                          |
| The Six Powers, one track each, Rokuogan for mastering all six                                                   | `soru`, `geppo`, `tekkai`, `shigan`, `rankyaku`, `kami_e` tracks; `powers/month.ts`                                         |
| Swordsmanship and its schools (two swords, three swords, iai, Oden's style, Asura)                               | `data/tracks/swordsmanship.json` and the school files                                                                       |
| Movesets: canon by era, generated by style, fruit and temperament; signature and finisher; fading                | `data/movesets/`, `powers/movesets.ts`, `techniques.ts`                                                                     |
| The technique creator; combination techniques                                                                    | `inventCommand`, `draftsMonth`, `combineCommand`; the Powers page                                                           |
| Sea Circle years (the plan's first change of Phase 4)                                                            | `data/calendar.json` `canonYearOffset` 1486, `era` "SC"; every date in the game                                             |

Also: save format 5 with its migration; the Powers page (`#/powers`, key 7) and the Devil Fruit page
(key 8); the sheet's trait effects, origins and hints of hidden traits; a Combat Power line that
names what adds to it; `npm run powers`; debug actions to wake haki, give a fruit and add practice to a
track.

## Decisions where the plan was silent or ambiguous

1. **One engine for every power.** Haki, fruits and styles are all tracks of stages; a fruit's
   mastery 0 to 100 is its track's progress, so "techniques at mastery thresholds" and "stages
   gated by requirements" are the same thing. The plan's per-power tables are the stages' data.
2. **Practice is an activity's `practice` field** (drill x1, spar x1.5, a real fight x3, teaching
   x0.5). Real fights come from events until Phase 5's battles count them.
3. **Generated fighters are not stored.** A Tier 2 fighter's tracks are stored; their moveset is
   built when someone looks, always the same for the same person (rule 6), so a full world's save
   grows by little.
4. **Who knows which fruit.** The cast's fruits are public knowledge (they are famous); canon users
   known only by name, reborn fruits, wild fruits and generated ones are known to nobody until a
   rumour, a find, a market or the encyclopedia (rule 4). A fresh life in 1500 SC knows of 16
   fruits.
5. **A canon user waits for their fruit.** A canon handover (Sabo's Flame-Flame Fruit) happens only
   once the previous user has let it go; if the player or chance put the fruit elsewhere, the
   handover is a divergence. The chance it happens at all follows the canon mode (always, 80%, 15%).
6. **Generated fruits in every world**: 24 are made with the world (80 in Random mode), so
   reborn and wild fruits are not only canon ones. They never take a canon power, name or concept.
7. **Haki stamina is hidden until haki wakes**: a page full of stamina for a power you do not have
   would mislead.
8. **Hidden traits are hinted, never named**: King's Qualities shows on the sheet as "Some days a room goes
   quiet when you are angry, and you do not know why"; its name appears only to an omniscient view.
9. **Personality is hidden axes, not visible bars.** Tags in outcomes and choices nudge seven axes
   that slowly fall back towards zero; a trait comes when an axis passes its threshold and leaves
   when it falls back past a lower one, so a trait is not lost the month after it is gained.
10. **"Appears in battle"** is read as: in the list of actions the battle engine will read, chosen by
    the same rule a fighter uses, and used in a scripted fight. The battle itself is Phase 5.
11. **Sea Circle years**: 1486 SC is Year 0 (God Valley). Only display changes: saves, data and
    keyframes still count game years from 0, and the new-life page picks the year in SC.
12. **136 canon fruits**, not about 200: I wrote the fruits I could describe with confidence (type,
    power, techniques, users and dates). The schema and tests take any number; the rest are data.

## Save format version 5

`character.powers` (tracks, fruit, stamina, moves, drafts, the fruits known and rumoured, gear),
`character.traitInfo` (where each trait came from), `character.personality` (axes and counters);
`fruit` entities with their container, user, place, price and history; a `fruit` kind of
divergence. `MIGRATIONS[4]` moves no data: a version 4 world gets its fruits, its canon cast's
powers by era and its fighters' powers the first month it is played. `world_v4.opsim` loads and
gets them in `tests/engine/golden.test.ts`; `world_v5.opsim` is the new golden save (370 KB).

## Performance

A 40-year headless life takes about 1.4 s (0.9 s in Phase 3); a 39-year world with every Tier 2
person about 9 s. Most of Phase 4's first cost was systems that sorted every entity id each month;
`entityIds` now caches the sorted ids exactly (reused only while the key list is unchanged).

## Checked in a real browser

The dev build in the desktop app's browser pane: a save from before the last changes resumed (its
Powers page: Electro at "A spark", Naval tactics, the haki that sleeps); a new life started through
the New Life page; the Devil Fruit page (16 fruits known in 1500 SC, the cast's); a three-month
skip; the Powers page for a merfolk on Fish-Man Island, listing what could be learned and why not
(Black Leg: "No teacher here"; Electro: "Not open to a Merfolk"); a 375 px phone width with no
horizontal scroll; no console errors. Fixed along the way: every canon user's fruit was public
knowledge (a Wano mink "knew of" 108 fruits), and the race lock read "Not for Merfolks".

## What was not verified

- `npm run e2e` was not run (Chromium for Playwright is not installed here), as in Phases 1 to 3.
- Awakening gives stat boosts only. The plan's awakened effects on the world (Paramecia reshaping
  terrain, a Logia freezing a sea lane, a Zoan's rampage risk and faster recovery) need Phase 5's
  battles and Phase 6's world objects.
- Balance: how fast tracks climb, technique prices and fruit prices are first values, not tuned
  against play. Combat Power's haki and style bonuses wait for Phase 5 to mean something.
- Fights count as practice only when an event says so, until Phase 5.
- Only Chromium; no Safari, Firefox, real phone or screen reader.

## Questions for you

1. **The catalogue**: 136 canon fruits instead of about 200. Should the next pass fill it out to the
   latest chapter (Phase 11, "Memory", covers the full canon), or now?
2. **Generated fruits per world**: 24 (80 in Random mode). More makes the world feel larger and
   rumours less certain; fewer keeps it closer to canon.
3. **Personality drift speed**: in a 39-year life, about four personality traits are gained and one
   lost. Faster drift makes choices matter sooner; slower makes a trait feel earned.
4. Phases 0 to 3's open questions still stand.

## Re-running everything

```bash
npm run check                          # typecheck, validate, canon lint, lint:sim, 960 tests, formatting
npm run powers                         # the catalogue and 1,000 generated fruits
npm run powers -- --kings 10000 --drift 20 --world
npm run world                          # a 39-year world with nobody in it, as a timeline
npm run lives -- --lives 300 --race all
npm run build && npm run build:preview
```
