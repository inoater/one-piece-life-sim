# Phase 6 status report: weapons, cursed blades, gear, ships and treasure

**Status: complete against the plan's Phase 6 "Done when" list, plus the month scaled by Vigor you
asked for.** The character's hands are full now. Every weapon, piece of gear, treasure cache and
map that matters is an entity with a story: a sword has a family, a grade, a maker's quality, an
edge that fights dull, wear that can break it, years of Armament that can turn it black, perhaps a
curse, and a list of the hands it has passed through. The twelve Supreme, twenty-one Great and
fifty Skillful blades exist exactly once each, the canon ones following the story by date. Four
curses fire their own events and are tamed four ways. Dials, seastone nets and stimulants are
used in fights; meals and medicines work for months; a Den Den Mushi calls the people you know; a
Vivre Card points to its owner and burns low as they fade. Ships are designed in a ship creator
with live numbers, built at a yard or by hand, refitted, damaged in sea fights, repaired, and may
gain a spirit. Six crafts share one schema. Markets price thirteen trade goods by prosperity and
supply; treasure is real and once dug up is gone; dice dens cheat. An economy pass puts a caravel
three to five years from a hard-working East Blue job, and a galleon out of reach of wages alone.
Phase 7 (character interaction) is not started.

## What you asked for: a month scaled by Vigor

You asked for actions each month to scale with Vigor: more actions, boosts or multiplications, and
an adjustable commitment past Hard. Both are in, in `data/life.json` `drive` and
`src/systems/life/drive.ts`:

| Mechanism          | How it works (design values, all in data)                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overtime slots** | One extra slot for every 5 Vigor in the pool, up to 3, for anyone whose stage has at least 2 slots of its own (adolescents and up). An overtime slot costs 1 Vigor more than its effort. A pool of 7 gives 4 slots a month, 12 gives 5, 15 gives 6.                                                                                                                               |
| **Push past Hard** | A Hard slot can be pushed +1, +2, +3, +4: each point costs one more Vigor and multiplies what the slot gives (training, power practice, a job's pay, a craft's or a ship's pace) by +30%, +25%, +20%, +15% (so Hard ×1.5 becomes ×1.95, ×2.33, ×2.63, ×2.85). Pay rises 12% a point and risk 30% a point. How far you may push is one point per 3 Vigor (a pool of 12 allows +4). |
| **Still a budget** | Spending past the pool still leaves you exhausted (−20% to everything, an injury chance), so a deep pool buys you choices, not free months. A pool that shrinks (exhaustion, an injury) skips the overtime it no longer covers and clamps the push, with a line on the month's card.                                                                                              |

The planner shows the overtime slots after the stage's own (dashed, "Overtime: +1 Vigor"), and a
"Push past Hard" stepper under any Hard slot with the Vigor it costs, the multiplier, the pay and
the risk. Work shifts and project work may fill several slots (another shift is another wage),
which is what "hard-working" means in the economy sweep.

## "Done when", with evidence

| Plan says                                                                                                          | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | How it is checked (and how to re-run)                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Every graded sword and every canon weapon is a tracked entity, and grade counts never exceed canon's in 100 worlds | **Yes**: a world is built with each of the 22 canon weapons once (origin canon) and each counted grade full: 12 Supreme (5 canon, 7 generated), 21 Great (6 + 15), 50 Skillful (3 + 47), and 60 lesser graded blades, every generated one with a name of its own. Across 100 worlds (every entry year from 1486 to 1523 SC) no grade ever holds more. Canon blades follow the story: Yubashiri is destroyed at Enies Lobby, Enma passes to Wano, Yoru stays with Mihawk. Tempering a blade into a full grade is refused                                                 | `tests/systems/hands.test.ts`                                                         |
| Each curse type fires its events, and taming changes its effects in seeded tests                                   | **Yes**: carrying an untamed blade sets its curse flag and its events fire within four years (Sandai Kitetsu's misfortune, Enma's haki hunger). Misfortune: a lucky test of fate tames it, the flag goes and the blade cuts harder; an unlucky one costs an arm and the curse stays. Haki hunger drinks haki every cut until Willpower 90 and Armament at its fourth stage master it, then the drain is gone. Bloodthirst turns Spare into Kill on a failed Willpower check, six refusals tame it. Haunting is quieted by a priest's rite, only where the rite is known | `tests/systems/hands.test.ts`                                                         |
| A ship can be built, refitted, damaged in a Phase 5 battle and repaired by a shipwright                            | **Yes**: a designed caravel (hardwood, 110% length, a galley, six cannon) is paid for at Water 7, launched months later with her own name and numbers, refitted with twelve cannon and a sick bay (a month in the yard), fights pirates in harbour (her own hull and guns go in, and the damage stays on her, with a line in her history), and a shipwright mends her to her full hull. A sloop built by the player's own hands is launched after months of "Work on your project" at her yard. A loved ship's spirit keeps her afloat once, never twice                | `tests/systems/hands.test.ts`                                                         |
| Craft every item type at least once in a headless test, with quality varying by skill                              | **Yes**: every one of the 33 recipes that is not story-locked (smithing 11, gunsmithing 4, shipbuilding 3, medicine 5, cooking 4, invention 6: weapons, armour, prosthetics, medicine, meals, dials, a weather staff, navigation) makes its thing. Over eight katanas each, a master's average quality is more than 20 points above a beginner's; a katana made at quality 85 or better earns a grade                                                                                                                                                                   | `tests/systems/hands.test.ts`                                                         |
| A headless economy sweep of 100 lives per job meets the ship-price targets above                                   | **Yes** (table below): every honest job open in an East Blue village affords a caravel in a median of 2.0 to 4.1 years of hard work, and none affords a galleon on wages within 15 years                                                                                                                                                                                                                                                                                                                                                                                | `npm run economy -- --lives 100`; a three-life check in `tests/systems/hands.test.ts` |

### `npm run economy -- --lives 100` (15 years from 16 in an East Blue village, buying nothing)

| Job                                 | Could work it | Afford a caravel | Median years | Galleon within 15 years | Berries at 5 years |
| ----------------------------------- | ------------- | ---------------- | ------------ | ----------------------- | ------------------ |
| Dockworker                          | 100/100       | 100%             | 2.5          | 0%                      | 293,058            |
| Farmhand                            | 100/100       | 98%              | 4.1          | 0%                      | 178,916            |
| Fisher                              | 100/100       | 99%              | 3.0          | 0%                      | 239,330            |
| Ship's hand                         | 100/100       | 98%              | 2.0          | 0%                      | 365,634            |
| Shop apprentice                     | 100/100       | 100%             | 3.3          | 0%                      | 222,749            |
| Street thief (crime)                | 100/100       | 100%             | 2.7          | 0%                      | 280,258            |
| Bounty hunter, mercenary (fighting) | 0/100         | -                | -            | -                       | -                  |
| Marine recruit, smith apprentice    | 0/100         | -                | -            | -                       | -                  |

The last four cannot be had in a village at 16 (Combat Power, a Marine town, a smithy), as their
requirements say. 1,000 lives take about two minutes on 11 workers. The first run, with a galleon at
one million, had 62% of ship's hands affording one on wages alone; the galleon went back to the
plan's two million.

### Earlier phases still hold

`npm run check` passes: typecheck, data validation, canon lint, the source rules, 1,033 tests and
formatting. `npm run battle` gives exactly Phase 5's table (gamma 5.4, largest gap 2.9 points).
`npm run lives -- --lives 300 --race all` keeps every race's mean age at death inside its Phase 2
bar: human 77.9, fish-man 92.3, merfolk 90.9, mink 80.6, skypiean 77.9, dwarf 68.6, giant 254.2,
Lunarian 560.4 (2,400 lives in 37 minutes on 11 workers). `npm run build` and `npm run build:preview`
succeed.

## What was built, against the plan

| Plan item                                                                                                                                                               | Where                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Weapons: six families, a weapon an entity with family, grade, material, quality, sharpness, durability, a name, past wielders and its own modifiers                     | `data/weapons` (54: 4 kept, 24 ordinary arms, 22 canon, 4 grade templates), `systems/hands/items.ts`, `weapons.ts`                      |
| Weapon skill per family, separate from stats: grows with drills and fights                                                                                              | `hands.skills`; "Weapon drills", blade drills and marksmanship; `fight.ts`                                                              |
| Sword grades: 12, 21, 50 tracked entities; Graded; Ungraded                                                                                                             | `systems/hands/swords.ts`, loader checks, `data/hands.json` `grades`                                                                    |
| Black blades: a slow counter of months coated by a strong wielder; +damage, never chips                                                                                 | `month.ts` (`blackBladeMonth`), `weapons.ts`, `fight.ts`                                                                                |
| Cutting a grade up: a master's long work at a master smith's forge                                                                                                      | `crafting.ts` (`startTemper`, a "temper" project), Wano and Elbaf                                                                       |
| Cursed blades: misfortune, haki hunger, bloodthirst, haunting, each with modifiers, an event pool and a taming condition                                                | `curses.ts`, `data/hands.json` `curses`, `data/events/hands.json`                                                                       |
| Seastone: cuffs, nets, bullets, blade edges, a hull coating                                                                                                             | `data/items/gear.json`, the battle engine's `net`, a seastone keel room                                                                 |
| Dials with charges: Flame, Impact, Reject, Breath, Lamp, Tone, Axe, Jet, Heat, Flash, Milky                                                                             | `data/items/dials.json`; used in fights, refill by sun or by blows taken (`gear.ts`)                                                    |
| Den Den Mushi: call anyone whose number you have; visual, transmitting (story-locked), silencing, and a black one that hears all the news                               | `gear.ts` (`call`), `news.ts` (`wiretapped`)                                                                                            |
| Vivre Cards: point to their owner and burn down as their life fades                                                                                                     | `gear.ts` (`getVivreCard`, `readVivre`), made in the New World                                                                          |
| Navigation: charts and a navigator's kit; science: prosthetics, cyborg parts (Phase 9 opens the path), medicines; Germa raid suits, Pacifista and Seraphim story-locked | `data/items/gear.json`, `body.json`                                                                                                     |
| Clothing and armour: light armour (none in the water), clothes for looks and reputation                                                                                 | `armourOf`, the battle engine's defence; clothing's Charisma                                                                            |
| Ships, fully: shipwrights build, repair and refit; hull material, size, rigging, cannons, figurehead, coating; rooms; naming; history; the death of a famous ship       | `systems/hands/ships.ts`, `data/ships.json`                                                                                             |
| The ship creator: hull and length, material, rig, extra drive, rooms, weapons, figurehead, look; live stats; warnings beyond the shipwright's skill or the yard's size  | `designStats`, `hands/design` request, `src/ui/screens/ship.ts`                                                                         |
| Blueprints: save, share as files, famous designs as items                                                                                                               | saved designs, import and share as text; Marine warship plan, Galley-La caravel, treasure-tree galleon                                  |
| Building takes months at a yard; money or hands speed it                                                                                                                | yard builds (`yardMonth`, `hastenBuild`), building by hand (`buildMonth`)                                                               |
| A ship's spirit: a hidden condition that once saves her from sinking                                                                                                    | `shipMonth` (care, waking), `spiritSaves` (wrecks, sea fights)                                                                          |
| Marines sail standard designs by rank                                                                                                                                   | `data/ships.json` `standard` (officer, captain, vice admiral); issued in Phase 9                                                        |
| Crafting: one schema; masters and schools are places; cooking's meals with monthly buffs                                                                                | `data/recipes`, `crafting.ts`, `hands.json` `schools` (Wano, Elbaf, Water 7, Weatheria, Skypiea, Drum, the Baratie, Egghead, Loguetown) |
| Treasure: maps (true, partial, fake), caches, sunken ships, ruins, ancient gold on a sky island; once dug up it is gone                                                 | `treasure.ts`; 36 caches by region and three famous ones (Shandora's gold, Moria's plunder, a noble's treasure ship)                    |
| Markets: by prosperity and trade links; prices move with supply; the black market                                                                                       | `market.ts`, 13 trade goods, gear by a place's trades, one-of-a-kind blades on shelves                                                  |
| Trade: cargo carried between places for profit, with real risk on the way                                                                                               | `tradeGood`, cargo in the hold, pirates who want your hold (`evt_voyage_cargo_pirates`)                                                 |
| Gambling: dice dens, rigged and fair                                                                                                                                    | `gambling.ts`, wherever there is an underworld or an arena                                                                              |
| Balance target: a caravel in 3 to 5 years, a galleon a mark of real success                                                                                             | the economy pass (decision 11), `npm run economy`                                                                                       |

Also: save format 7 with its migration; the Gear page (`#/gear`, key 9) and the Ship page
(`#/ship`, key 0); three new effects (`findItem`, `treasureMap`, `cargo`) used by eight new events
(curses, a dying sailor's map, a wreck to dive, pirates after the cargo) and by the old bottle-map
event (its X is now a real map); debug buttons to give weapons and gear and set craft skills; the
Powers page's gear shop now sells items, only where they are sold.

## Decisions where the plan was silent or ambiguous

1. **Items are entities only when they matter.** Every weapon and piece of gear the player holds,
   every graded and canon weapon, every cache and map is an entity. Tier 2 fighters without items
   fight with their occupation's plain weapon (data), so a world does not hold thousands of cutlasses.
   An ordinary thing sold or used up is removed; a graded blade sold goes on that dealer's shelf.
2. **Grade counts are "how many exist".** A destroyed blade frees its place, which only tempering can
   fill; a grade that is full refuses tempering. A katana made at quality 85 or more earns the
   uncounted "Graded".
3. **Canon weapons follow keyframes until someone takes them off the story** (the player, or anyone
   the frames do not name); after that they are ordinary entities. Holders the world does not
   simulate (Zoro, Kuina, Tashigi, Hiyori) are names on the blade, not people. Every frame where the
   manga is vague is `approx`; the grades of Kikoku, Gryphon and Roger's sword are not stated in the
   manga and are guesses (Great).
4. **A weapon's attack** is family attack plus its own, times grade, quality (0.7 at 0, 1.3 at 100),
   edge (dull below 40: ×0.8), black (+25%) and curse, plus skill (0.15 a point); skill also adds
   accuracy. Up to three blades are wielded; the second and third add a fifth of their edge each.
5. **Curses act on whoever carries the blade**, not only in a fight: a flag the events read, a
   monthly mischance. Taming differs by curse, as the plan's table says; misfortune's test can be
   tried once a month.
6. **Dials are fight kit with charges**: Flame and Heat burn, Lamp and Flash blind, Breath and Jet are a
   burst of evasion, Impact and Reject strike (Reject hurts its user); Impact and Reject refill by
   taking blows in a fight, the rest by themselves. The battle engine's item list grew to read them.
7. **The ship's design decides her stats; the voyage code still reads the entity's stats**, so Phase 3
   needed only the places that assumed a stock vessel's numbers (`shipNumbers`). Refits keep the hull,
   length and material: changing those is a new ship. Launching a new ship trades the old one in.
8. **A ship's spirit** wakes after five years of care (repaired, crewed, never left to rot), with a 3%
   chance a month, and is never named on the page (rule 4: a hidden condition). It saves her once,
   from a wreck or a sea fight.
9. **Crafting is a project, worked by an activity.** Effort and commitment past Hard set the pace, so
   the Vigor drive and crafting meet. Materials are bought from the market where the work starts, or
   taken from the hold; a recipe that needs goods nobody sells there says so.
10. **Trade goods are made and wanted by features and regions**, so the routes are geography: spices
    from the jungles and the South Blue to the cold islands, dial shells from the sky to the Grand
    Line. Stock moves by a share per unit (more in small places) and drifts back 18% a month.
11. **The economy pass lowered ship prices, not raised wages**: a dinghy 3,000, a fishing boat
    15,000, a sloop 50,000, a caravel 140,000; the galleon stays 2,000,000 (the warship plan 3,500,000
    to build). Wages, living costs and every other price are as Phase 2 set them. "A hard-working
    East Blue crew" is read as one hard-working person with a job until Phase 8 brings crews.
12. **A treasure map points at a real cache, at a cache's island only (partial), or at nothing
    (fake)**; three months searching where a fake points shows it up. Sunken caches need gills, a
    diving bell, or a coated ship moored there. Others dig too: 4% of caches a year, news when rich.
13. **The Vigor drive** takes overtime slots from the pool, not from free time: the stage's own slots
    stay what Phase 2 set, and a child's single slot never stretches.

## Save format version 7

The `item` block of item entities; `character.hands` (items carried and wielded, armour, weapon and
craft skills, the project, a ship on the slipway, cargo and what it cost, saved designs, contacts,
tallies); a ship's `design`, `care`, `spirit`, `refitUntil`, `builtTick` and `history`; each
place's `market` stock; a routine slot's `commit`; a fighter's weapon accuracy, drain and items,
and armour. Every field is optional, so `MIGRATIONS[6]` only raises the version; the first month a
version 6 world plays it gains its blades and treasure, and the player's gear bought as counts in
Phases 4 and 5 becomes items. `world_v6.opsim` loads and plays on in `tests/engine/golden.test.ts`;
`world_v7.opsim` is the new golden save (about 430 KB).

## Checked in a real browser

The dev build in the desktop app's browser pane, on a version 6 save from before Phase 6: it
resumed and migrated, and the first month built the hands layer. The Gear page lists the market at
Green Bit (prices by the place's prosperity), trade goods with buy and sell prices, the workshop and
the skills; a hearty stew was bought (364 Berries) and eaten. The Ship page's creator answers each
change with live numbers (a caravel with a galley: 148,000 Berries, 4 months, 170 miles a month,
"There is no yard here"). The planner showed two overtime slots for a pool of 10 and the "Push past
Hard" stepper (+2: 5 Vigor, gains ×2.33, pay +24%, risk +60%). At 375 px neither page scrolls
sideways. No console errors. Fixed along the way: the new pages were drawn but hidden (they needed
their own layout rule), and kinds read "den_den".

## What was not verified

- `npm run e2e` was not run (Chromium for Playwright is not installed here), as before.
- I did not play a whole trading voyage, a tempering, or a ship built by hand in the browser; they
  are covered by unit tests, not seen on screen.
- Balance beyond the ship-price target is first values: how rich treasure makes you, how profitable
  trade is, gambling's house edge, how often curses bite.
- Tier 2 people carry graded swords but do not buy, sell, craft or trade; the canon cast's swords
  follow keyframes only. Crews sharing a hold, cook and shipwright roles are Phase 8.
- Only Chromium; no Safari, Firefox, real phone or screen reader.

## Questions for you

1. **The Vigor drive's numbers**: an overtime slot per 5 Vigor (up to 3) and a push point per 3 Vigor
   (up to +4). More generous makes Endurance the best stat; stingier makes the drive rare.
2. **Ship prices**: I lowered ships rather than raising wages. Raising wages instead would keep the
   plan's table but move every other price in the game.
3. **Sword grades the manga never states** (Kikoku, Gryphon, Roger's Ace) are Great here. Keep, or
   leave them ungraded until canon says?
4. Phases 0 to 5's open questions still stand.

## Re-running everything

```bash
npm run check                          # typecheck, validate, canon lint, lint:sim, the tests, formatting
npm run economy -- --lives 100         # the ship-price target, per job
npm run battle                         # tactical against abstract still agree
npm run lives -- --lives 300 --race all
npm run build && npm run build:preview
```
