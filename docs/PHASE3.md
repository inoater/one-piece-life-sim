# Phase 3 status report: the world, travel, events and canon

**Status: complete against the plan's Phase 3 text.** The character now lives in a world: a map of
55 places joined by 83 sea lanes, voyages that take whole months in six ways of travelling, ships to
buy, crew, stock, repair and coat, factions with territory and an economy, about two thousand named
people who live by their goals over a million more kept as numbers, epidemics that travel the lanes,
news that reaches you late, a random-event engine with roles and skill checks, and the canon story:
45 famous characters on keyframes and 28 famous events, pushed by the canon mode, with a Divergence
Log of every way the world leaves the story. Phase 4 (trait mechanics, Devil Fruits, haki) is not
started.

## "Done when", with evidence

| Plan says                                                                                                | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                         | How it is checked (and how to re-run)                                                                                                         |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Sailing between two islands takes the computed number of months and locks the listed actions             | **Yes**: a voyage arrives on exactly the month the planner computed, for every way of travelling (the formula is applied month by month, because the wind follows the seasons). At sea, local work, school, shops, land crime, inland exploring, doctors and local social targets are locked with "At sea: N months to the next island"; training (at 70% for the body), study, ship duty, fishing, cooking, repairing, crafting, rest and shipmates stay open | `tests/systems/travel.test.ts` (computed months for crew, passenger and stowaway; the 45-day trip arriving on its second tick; the lock list) |
| At least 25 voyage events work, with checks that change ship, crew, supplies or arrival time             | **Yes: 27** (of 36 voyage events), each fired on a real voyage in a test and its check resolved until a band changed the hull, crew, morale, stores, destination or remaining miles                                                                                                                                                                                                                                                                            | `tests/systems/event-engine.test.ts`                                                                                                          |
| A test beat fires about 100% (Canon), about 70% (Probable) and under 20% (Random) across 100 seeded runs | **Yes: 100, 65 and 19 of 100** (the test duel). Across every real beat, Canon is 100%, Probable 60 to 81% for beats that stand alone, Random 0 to 19% (table below)                                                                                                                                                                                                                                                                                            | `tests/systems/canon.test.ts`; `npm run world -- --rates 100`                                                                                 |
| Killing a role-holder before a beat cancels or reassigns it, tags survivors `canon-diverged` and logs it | **Yes**: kill the captain and the substitute takes the role (logged as "Recast"); kill both and the beat is cancelled ("Test Captain was already dead"), the rival becomes `canon-diverged`, `onDiverge` runs, and every beat requiring it diverges too. Killing Silvers Rayleigh in Year 12 cancels Roger reaching Laugh Tale, and with it the crew breaking up                                                                                               | `tests/systems/canon.test.ts`                                                                                                                 |
| A 39-year run with no player ends with a readable world timeline                                         | **Yes**: Year 0 to the present in 0.2 s (7 s with every Tier 2 person), 28 famous events and about 450 headlines, in order, no unfilled text                                                                                                                                                                                                                                                                                                                   | `npm run world` (`-- --news` for every headline); `tests/systems/canon.test.ts`                                                               |

### `npm run world -- --rates 100` (how often each beat fired, of 100 worlds per mode)

| Beat                                         | Anchor | Canon | Probable | Random |
| -------------------------------------------- | ------ | ----- | -------- | ------ |
| The God Valley incident                      | hard   | 100%  | 71%      | 19%    |
| Garp, Hero of the Marines                    | soft   | 100%  | 41%      | 3%     |
| Totto Land is founded                        | soft   | 100%  | 53%      | 11%    |
| The Battle of Edd War                        | soft   | 100%  | 53%      | 15%    |
| Roger reaches Laugh Tale                     | hard   | 100%  | 76%      | 15%    |
| The Roger Pirates disband                    | hard   | 100%  | 52%      | 1%     |
| The execution of Gol D. Roger                | hard   | 100%  | 66%      | 13%    |
| The Golden Lion escapes Impel Down           | soft   | 100%  | 34%      | 0%     |
| The Buster Call on Ohara                     | hard   | 100%  | 73%      | 19%    |
| Portgas D. Rouge dies                        | hard   | 100%  | 100%     | 17%    |
| The fall of the Kozuki                       | hard   | 100%  | 75%      | 11%    |
| Fisher Tiger frees the slaves of Mary Geoise | hard   | 100%  | 76%      | 19%    |
| The death of Fisher Tiger                    | hard   | 100%  | 58%      | 4%     |
| The fall of Flevance                         | hard   | 100%  | 70%      | 16%    |
| Shanks gives away his arm and his hat        | soft   | 100%  | 58%      | 11%    |
| A noble boy's boat is fired on               | hard   | 100%  | 81%      | 9%     |
| Doflamingo takes Dressrosa                   | hard   | 100%  | 81%      | 16%    |
| Arlong takes the Conomi Islands              | hard   | 100%  | 45%      | 0%     |
| Teach kills Thatch                           | hard   | 100%  | 80%      | 15%    |
| A boy in a straw hat sets sail               | hard   | 100%  | 100%     | 17%    |
| Arlong Park falls                            | hard   | 100%  | 36%      | 0%     |
| The Alabasta civil war ends                  | hard   | 100%  | 75%      | 2%     |
| The Straw Hats storm Enies Lobby             | hard   | 100%  | 59%      | 1%     |
| Blackbeard captures Fire Fist Ace            | hard   | 100%  | 57%      | 5%     |
| The Summit War of Marineford                 | hard   | 100%  | 48%      | 1%     |
| Dressrosa is freed                           | hard   | 100%  | 62%      | 1%     |
| Wano is liberated                            | hard   | 100%  | 61%      | 0%     |
| The Egghead incident                         | soft   | 100%  | 64%      | 6%     |
| The test duel (fixture)                      | hard   | 100%  | 65%      | 19%    |

The lower Probable figures are chains: Arlong Park cannot fall unless Arlong took it, and that needs
Fisher Tiger's death, which needs his raid. A one-month window (Rouge, Luffy setting sail) is
certain in Probable, because six times its month's chance is above one.

### Phase 2's bar still holds

With random events, epidemics and climates now in every life, `npm run lives -- --lives 300 --race
all` keeps every race's mean age at death within 10% of the middle of its range: human 77.3,
fish-man 90.3, merfolk 92.4, mink 81.8, skypiean 79.7, dwarf 67.6, giant 262.8, Lunarian 570.3
(2,400 lives in 16 minutes on 11 workers).

## What was built, against the plan

| Plan item                                                                                                                                                      | Where                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| World map: a graph of about 45 nodes (built: 55) with region, climate, population, wealth, danger, controlling faction, services, local jobs, local event pool | `data/locations/`, `src/systems/places/`                                                          |
| Notable canon residents by era                                                                                                                                 | Derived from the cast's keyframes (not stored twice): a place's panel lists who is there now      |
| Edges: distance, danger 0-5, current, requirement                                                                                                              | `data/lanes/` (83), `src/systems/places/graph.ts`                                                 |
| Planning screen: reachable places, distance, months, supplies, danger, requirement                                                                             | `src/systems/voyage/plan.ts`; the Actions tab and the Map page's place panel                      |
| Duration formula; whole months; arrival on the computed tick                                                                                                   | `src/systems/voyage/progress.ts`                                                                  |
| Costs: provisions, port fees, repairs, fares, bribes (event choices)                                                                                           | `data/travel.json`, `src/systems/voyage/sea.ts`, `commands.ts`                                    |
| Log Pose recalibration (0-12 months), Eternal Poses                                                                                                            | `logPose` on places; `poseWait` in the planner; poses sold in ports                               |
| Six travel modes with their routes and risks                                                                                                                   | own ship, crew, passenger, stowaway, Marine transport, on foot                                    |
| Locked and available at sea                                                                                                                                    | the `at_sea` activity tag and `atSea` requirement; seven new ship-duty activities                 |
| The captain's monthly decision                                                                                                                                 | a standing order: hold, detour, resupply, push, turn back                                         |
| Random sea events (weather, hazard, encounter, ship and crew, discovery, social, canon-linked)                                                                 | `data/events/voyage_*.json`; canon-linked: a beat at either end of the lane is seen from the deck |
| 1 roll a month plus the danger modifier (East Blue +0 ... Calm Belt +1.5)                                                                                      | `data/travel.json` `regionDanger`, `story/select.ts`                                              |
| Overboard (rescue roll)                                                                                                                                        | the `overboard` effect: an Endurance roll (Phase 4 adds the fruit users' sinking)                 |
| Arrival: the new place, the missed headlines, the beats that happened meanwhile                                                                                | `voyage/sea.ts` `land`, `news.ts` `deliverWaitingNews`                                            |
| News reaches each place 0 to 3 months late                                                                                                                     | `news.ts`, world.json `news.delay`                                                                |
| Ships (the plan's table)                                                                                                                                       | `data/vessels/`                                                                                   |
| Factions (the plan's seven) with opinion as base plus modifiers                                                                                                | `data/factions/`, `src/systems/factions.ts` (plus 9 kingdoms and 14 canon crews)                  |
| Event engine: id, type, trigger, conditions, roles, weight, cooldown, choices, effects, news, tags                                                             | `src/engine/data/schemas.ts`, `src/systems/events.ts`, `src/systems/story/`                       |
| Candidates, conditions, weight modifiers, 0-3 for the player and some for the world                                                                            | `story/select.ts`; world.json `events`                                                            |
| Checks with four result bands                                                                                                                                  | `story/checks.ts`                                                                                 |
| Flags and chains; templates with names, pronouns and places                                                                                                    | `schedule` effect, `{role.x.name}`, `{place}` ...                                                 |
| Canon layer: modes, beat structure, player involvement (spectator, witness, participant, instigator)                                                           | `data/canon.json`, `data/canon/`, `src/systems/canon/beats.ts`                                    |
| Role-holder dead, elsewhere, outcome changed, early death                                                                                                      | `canon/beats.ts`, `canon/cast.ts` `killCharacter`                                                 |
| Canon cast with keyframes (location, affiliation, bounty, haki, fruit, status, approx)                                                                         | `data/cast/` (45), `canon/cast.ts`                                                                |
| Birth schedule; canon cutoff                                                                                                                                   | `spawnDueCast`; canon.json `cutoff` (Egghead, Year 38)                                            |
| Divergence Log screen                                                                                                                                          | `#/canon` (`src/ui/screens/canon.ts`)                                                             |
| Tier 2: goals and quarterly utility choices; Tier 3: counts by age and job, created when met; name pools; family links at birth                                | `src/systems/places/people.ts`, `residents.ts`, `life/people.ts`                                  |

Also: save format 4 with its migration; the World tab's powers, story and people; headlines with
where they came from and how late; the Map page with every place, the lanes, the ship at sea and
a place panel to sail from; `npm run world`; `debug/killEntity` and `debug/teleport`; epidemics that
spread along lanes; prosperity that sets prices and wages; ships that pass to an heir; shipmates who
can carry the story on.

## Decisions where the plan was silent or ambiguous

1. **Where you are replaces where you were born.** Phase 2 read everything a place decides (what
   there is to do, prices, safety, the doctor, who you meet) from the birthplace. Now a person has a
   place on the map, or the open sea; the birthplace keeps only what birth decides (how you grew up,
   your people's ways). Every birthplace names the map node it is.
2. **55 places, not 45**: the generic birthplaces needed nodes of their own (invented names such as
   Seabreeze Village, marked `generated`), and the canon cast needed Laugh Tale, Impel Down, Mary
   Geoise and a few more to stand on.
3. **A voyage is one lane.** The planner offers the places a lane reaches from here (the plan's
   "reachable nodes"); a longer trip is several voyages. The map shows every lane.
4. **The captain's decision is a standing order** (like the Phase 2 routine): it holds until changed,
   so "Skip 3 months" stays usable; detour, resupply and turn back apply once and revert to hold.
5. **The Calm Belt is crossed only by coated ships** (and Marine warships, which count as coated).
   The plan's requirement list has no separate "seastone hull".
6. **Who carries a traveller who is not the captain**: a merchant sloop for passengers and
   stowaways, a caravel for crew, a warship for Marines (travel.json `carriers`). Sailing as crew
   signs you on as a ship's hand; jobs that do not travel are left behind when you sail.
7. **"×6 weight" in Probable** is six times a beat's monthly chance, where the monthly chance spreads
   its Random-mode chance across the window. With the default chances that gives about 70% for a
   six-month window.
8. **Keyframes tell the story after each beat**, so a beat that fires late in its window would find
   its people already moved on. Someone still on the story's path counts as present if the story
   had them there when the window opened. (Found by measuring: without it, Probable worlds lost
   Luffy to a spurious "delay" and with him every later beat.)
9. **Who leaves the story when a beat diverges**: its role-holders, only when the story was broken
   (a role-holder lost, or the player stopped it). A beat that never came by chance, or fell with
   another, leaves everyone on the path they were on.
10. **Canon characters are protected** from ordinary mortality in Canon and Probable modes (they die
    in beats, or by someone's hand); in Random mode, and once they leave the story, they age and die
    like anyone.
11. **Rule 4 for world news**: world events and beats far away are known to nobody but the news;
    the player learns of them when the news arrives. A beat the player is at is known to them.
12. **Random events stop skips** (the plan: any event that needs a decision stops time-skipping).
    About 12% of months ashore bring an event; world events are not the player's and never stop.
    The same world event does not strike the same place twice within three years.
13. **A world built late has a past.** A life entered in Year 30 starts in a world that has played
    Years 0 to 30 without the player (canon beats, factions, world events, news). Tier 2 people are
    made as they are at the start, not simulated through those years.
14. **Bare worlds stay bare.** A world nobody lives in (the Phase 0 tools) has no map built unless a
    tool builds one, so Phase 0's "468 empty ticks" checks still mean what they meant.
15. **Two dev switches**: `dev.fixtures` (the test crew, cast, duel and harbour) and `dev.quiet` (no
    random events for the player), used by tests of other systems. Neither can be set in a
    production build.
16. **Approximate canon**: years count from God Valley (Year 0), canon dates are approximations
    flagged `approx`, the pre-timeskip journey is compressed into Year 36, and some events happen at
    a generic place where canon names somewhere off the map (Edd War at "Ironsong Island").

## Save format version 4

`state.canon` (each beat's fate and the Divergence Log), `state.eventState` (cooldowns),
`config.population`; `character.place`, `character.travel` (the voyage, poses, places visited),
`character.npc` (a Tier 2 person's goal); the `place`, `org` and `ship` blocks of location,
organization and ship entities; news with a place and a delivery month; decisions that remember who
an event cast. `MIGRATIONS[3]` adds the empty canon state, cooldowns and population; the world layer
and its past are built from game data when a version 3 world is opened. `world_v3.opsim` loads and
gets its world in `tests/engine/golden.test.ts`; `world_v4.opsim` is the new golden save (a full
world, 322 KB). An old save was also opened in the browser: it got 55 places, 23 organizations,
about 1,900 people and 14 years of history, and played on.

## Checked in a real browser

The dev build in the desktop app's browser pane, on a save from before Phase 3: the migration (save
format 4 in the World tab, the world built on load); the World tab's powers, story and people; the
Map page (every place, the lanes, the star where you are, the reachable lanes lit, the place panel
with its prosperity, news and planner); walking from Green Bit to Dressrosa across the bridge, the
route and marker during the trip, arriving on the computed month; the harbour panel with six routes,
every way of travelling, closed ways with reasons and ships for sale; a skip stopped by "Pirates in
the harbour", a check that failed and broke a leg; the Canon page and Divergence Log; a 375 px phone
width (no horizontal scroll); no console errors. A two-month skip with autosave in a full world took
about 0.2 s. Fixed along the way: on-foot trips said "at sea", the Actions tab stayed highlighted on
the Canon page, the place panel said "no lane leads here" while travelling there, the player's own
choices were filed under World in the chronicle, and the same famine could hit a place twice a year.

## What was not verified

- `npm run e2e` was not run (Chromium for Playwright is not installed here), as in Phases 1 and 2.
- Only Chromium, dark theme mostly; no Safari, Firefox, real phone or screen reader.
- On a phone the place panel covers the (short) map; it scrolls and closes, but a bottom sheet
  would be kinder.
- Balance of the new money flows (fares, wages, ship prices against Phase 2's savings) is only
  sketched: a fisher's savings buy a fishing boat in a few years, a galleon never.
- Tier 2 people do not sail month by month or fight at sea; they move a lane a quarter.

## Questions for you

1. **Probable mode** gives about 70% per beat, but famous chains (Arlong Park falls, Marineford) land
   between 36% and 60%. Is that the "familiar world with real surprises" you want, or should hard
   beats be certain in Probable unless the player or a death derails them?
2. **Canon dates**: years count from God Valley as Year 0, and the journey from Luffy setting sail to
   Marineford is compressed into Year 36. `canonYearOffset` (Phase 0's open question) only changes
   the displayed calendar year.
3. **Generic places** got invented names (Seabreeze Village, Harrowgate, Coldharbour, Palmhook
   Island, Tidebell Island, Bastion Port, Ironsong Island). Rename any you like in `data/locations/`.
4. Phases 0 to 2's open questions still stand.

## Re-running everything

```bash
npm run check                          # typecheck, validate, canon lint, lint:sim, 673 tests, formatting
npm run world                          # a 39-year world with nobody in it, as a timeline
npm run world -- --rates 100           # how often each beat fires per canon mode (about 45 s)
npm run world -- --mode probable --population full --news
npm run lives -- --lives 300 --race all
npm run build && npm run build:preview
```
