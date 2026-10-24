# Phase 5 status report: the battle system

**Status: complete against the plan's Phase 5 "Done when" list.** The character now fights. One
battle engine plays a bar brawl, a duel, a skirmish, a crew battle run from a match-up board, a sea
fight between two ships that turns into a fight on the decks, and a war of fronts. The player
chooses every exchange in a tactical fight, or sets a stance and lets it play. The plan's formulas
are all tunable in `data/battle.json`: initiative, hit chance, damage, the Logia rule, fruit
matchups, stamina, overdrive forms and the second wind. Fights leave Phase 2 injuries and scars,
train the body and the powers used, wake haki in the right moments, and earn fame and bounties.
Deaths happen only where someone meant to kill, or where the sea takes a fruit user nobody pulled
out. Sparring trains by how strong the partner is and kills nobody. The canon cast stand on a power
ladder by era. Tier 2 people hunt pirates, raid towns, settle scores and meet trouble at sea by the
same rules, in one roll fitted to the tactical engine. Phase 6 (weapons, gear, the ship creator,
the economy) is not started.

## "Done when", with evidence

| Plan says                                                                                                     | Result                                                                                                                                                                                                                                                                                                                                                                                    | How it is checked (and how to re-run)                                                       |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| One engine resolves a duel, a skirmish, a crew battle, a naval battle and a war in seeded tests               | **Yes**: each scale is built from an event-style `fight`, run to its end, and gives the same result and the same log twice from the same seed. A tactical fight holds time still behind its decision, plays one exchange per action, and its one choice plays the rest out (which is how headless runs play it). A second fight that comes due while one is held open plays out by itself | `tests/systems/battle.test.ts`                                                              |
| A Logia user takes no damage from an unhaki'd attack and full damage from a coated one                        | **Yes**: twenty plain blows pass straight through a Logia and do nothing; coated in Armament, each of the same blows does exactly what it does to the same fighter without the fruit. Water, a weakness, a haki technique or seastone also land                                                                                                                                           | `tests/systems/battle.test.ts`                                                              |
| Abstract and tactical resolvers agree within 5 points over 1,000 seeded pairings                              | **Yes**: overall 47.9% against 48.7% for the first side; by band of odds the largest gap is 2.9 points (table below). The resolver's gamma, 5.4, is the one that fits the tactical engine best                                                                                                                                                                                            | `tests/systems/battle.test.ts` (overall and four bands, at most 5 points); `npm run battle` |
| Fights leave Phase 2 injuries and scars, and Spare intent never kills outside field deaths                    | **Yes**: a hard fight leaves injuries caused by violence, and over the following months some heal into scars. 1,000 fights where both sides mean to spare kill nobody on land; in the water, a fruit user who falls with nobody to dive in drowns (a field death), whatever anyone meant                                                                                                  | `tests/systems/battle.test.ts`                                                              |
| Every canon cast member's Combat Power keyframes place them on the ladder for their era                       | **Yes**: every living cast member (fixtures aside), checked every year and at every rung change from 1486 to 1524 SC, stands on the rung their data gives. More than 500 checks, no misses                                                                                                                                                                                                | `tests/systems/battle.test.ts`; `npm run battle -- --ladder`                                |
| A 39-year world logs at least 200 NPC fights with readable reasons                                            | **Yes: 1,682** in a full world (58 hunts, 1,262 quarrels, 39 raids, 323 at sea; 65 ended in a death). Every one says why: "a Marine on patrol", "a bounty hunter after the 30 million Berries on their head", "an old score to settle", a crew raiding a town, pirates at sea                                                                                                             | `tests/systems/battle.test.ts`; `npm run battle -- --world`                                 |
| A crew battle runs from the match-up board, with a combination attack and a member taking a blow for a friend | **Yes**: the board pairs three duels and sends the fourth crewmate to the fronts, where the rank and file fight in rounds; across twelve seeded battles, combinations land ("strike as one") and crewmates throw themselves in front of blows meant for friends, and every battle ends                                                                                                    | `tests/systems/battle.test.ts`                                                              |
| A thousand seeded spars kill nobody and train faster against stronger partners                                | **Yes**: 1,000 spars of every kind (each stop rule, a fifth of them in the water, fruit users among them) kill nobody, and sixty months of the player sparring never kill them. A partner 20% stronger trains x2, an even one x1, a much weaker one x0.2; a year of sparring with a strong mentor builds more than a year with a weak one                                                 | `tests/systems/battle.test.ts`; `npm run battle -- --spars 1000`                            |

### `npm run battle`: tactical against abstract, 1,000 pairings

| Odds (abstract) | Pairings | Abstract | Tactical | Gap | Exchanges |
| --------------- | -------- | -------- | -------- | --- | --------- |
| 0 to 10%        | 328      | 2.1%     | 2.4%     | 0.3 | 4.9       |
| 10 to 25%       | 78       | 17.6%    | 20.5%    | 2.9 | 8.1       |
| 25 to 50%       | 123      | 37.7%    | 39.0%    | 1.3 | 8.0       |
| 50 to 75%       | 109      | 62.5%    | 61.5%    | 1.1 | 8.0       |
| 75 to 90%       | 72       | 82.6%    | 83.3%    | 0.7 | 7.6       |
| 90 to 100%      | 290      | 98.0%    | 99.3%    | 1.3 | 4.9       |

With gamma 5.4, a fighter 25% stronger wins about three fights in four, and one twice as strong
almost always. An even duel lasts about eight exchanges.

### The ladder by era (`npm run battle -- --ladder`, the top of it)

|         | Peak                                                        | Monster                                   |
| ------- | ----------------------------------------------------------- | ----------------------------------------- |
| 1486 SC | Roger 12,701, Garp 10,080, Rayleigh 10,080                  | Whitebeard, Big Mom, Shiki, Sengoku, Kong |
| 1510 SC | Kaido 11,528, Whitebeard 10,213, Garp 10,080, Big Mom 9,056 | Rayleigh, Mihawk, Shiki, Sengoku          |
| 1522 SC | Kaido, Whitebeard, Mihawk, Shanks, Big Mom                  | Rayleigh, Marco, Shiki                    |

### Phase 2's bar still holds

With fights in every life, `npm run lives -- --lives 300 --race all` keeps every race's mean age at
death within 10% of the middle of its range: human 77.7, fish-man 91.5, merfolk 90.6, mink 80.7,
skypiean 77.7, dwarf 68.4, giant 254.7, Lunarian 566.2 (2,400 lives in 30 minutes on 11 workers).
Getting there found three real problems (see decisions 6, 7 and 9).

## What was built, against the plan

| Plan item                                                                                                                                                           | Where                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Scales: duel, skirmish, crew battle, naval battle, war                                                                                                              | `src/systems/battle/engine.ts`, `scales.ts`                                                                                                 |
| The exchange: initiative, the ten actions, the formulas, all in data                                                                                                | `engine.ts`, `data/battle.json`                                                                                                             |
| Logia rule, matchups, stamina, overdrive modes, second wind, injuries from big hits                                                                                 | `engine.ts` (`canTouch`, `matchupOf`, `drop`), `aftermath.ts`                                                                               |
| Intent (spare, capture, kill), endings, the fate of the beaten                                                                                                      | `engine.ts`, `player.ts` (`applyFate`)                                                                                                      |
| Fights grant training, fruit mastery, haki progress, fame, infamy, bounty, news                                                                                     | `aftermath.ts`                                                                                                                              |
| Three ways to play: tactical, quick (four stances), narrated                                                                                                        | `player.ts`, `ai.ts`, `world.ts`                                                                                                            |
| The abstract resolver, calibrated against the tactical engine                                                                                                       | `battle.ts` (`winChance`, `resolveAbstract`); `npm run battle`                                                                              |
| Tier 2 people fight, sail and die by the same rules                                                                                                                 | `world.ts`, `places/people.ts` (hunts, raids, quarrels, trouble at sea)                                                                     |
| The power ladder; Combat Power with weapon, haki and fruit terms; the cast by era                                                                                   | `ladder.ts`; `data/tracks` rescaled; weapons' `combat`; cast `power` keyframes                                                              |
| Naval battles: range, cannons, ramming, boarding, fires, sinking, weather; fruit users on a sinking ship                                                            | `scales.ts` (`navalRound`, `sinkShip`)                                                                                                      |
| Wars: fronts, morale, commanders, a Conqueror's burst breaking a weak front, where the player stands                                                                | `scales.ts` (`warRound`, `placeAtFronts`), `battle/front`                                                                                   |
| Arenas and contests: colosseum, Davy Back Fight, sumo, pit fights                                                                                                   | `data/battle.json` `contests`, `spar.ts` (`runContest`); the Dressrosa colosseum, a Davy Back Fight at sea, pit fights and dojo tournaments |
| Team battles: roles and zones, the match-up board, team orders, combinations, taking the blow, tagging in, side morale                                              | `engine.ts`, `scales.ts`, `battle.ts` (`setBonds`)                                                                                          |
| Sparring: Spare with a stop rule, a tenth of the injuries, training by partner, mentors count as teaching, relationships, group training, dojo tournaments, records | `spar.ts`, `aftermath.ts`; `act_spar`, `act_play_fight`, `act_crew_training`, `act_dojo_tournament`; records on the sheet                   |
| UI: the battle screen with bars, chances in words and numbers on hover, the running log; the post-fight card                                                        | `src/ui/screens/battle.ts` (in the chronicle where a decision would be); the Powers page's fighting section                                 |

Also: save format 6 with its migration; the canon story's fights (Marineford's "Get Ace off the
scaffold" is now a war on three fronts, and the beat diverges only if the player's side wins; the
Dressrosa colosseum is a contest whose prize is the Flame-Flame Fruit); nine combat checks in
events are now fights; fight kit to buy (field medicine, smoke bombs, a baby Den Den Mushi to call
help); debug buttons for a fight at every scale; `npm run battle`.

## Decisions where the plan was silent or ambiguous

1. **Power, not stats, decides a fight.** Every number in a fight is a stat times the fighter's
   power (Combat Power over what their stats alone give), so an Emperor's haki and fruit count in
   every blow and the same formulas serve a thug and Kaido. The plan's hit chance "(accuracy -
   evasion) / 2" is written relative to the larger of the two, which is the same near 100 and holds
   at every rung.
2. **How sharp the odds are** is a design choice: the first version of the engine let a fighter 25%
   stronger win 99% of the time. Blows now depend more gently on attack against defence, and one
   in five blows tells (double damage), so the stronger fighter usually but not always wins
   (gamma 5.4).
3. **The ladder needed Phase 4's numbers rescaled.** Stage Combat Power from tracks topped out at
   about 70; a lifetime of haki, fruit and style could not reach the plan's Peak (9,000). Stage
   values now grow steeply with level (Armament: 35 at its first stage, 3,000 at its last).
4. **The cast's era rungs are data, their powers explain most of it.** Where their own powers
   miss their rung, a modifier named "Strength of their era" closes the gap, and it is
   recalculated whenever their powers change.
5. **A tactical fight is a decision.** It waits behind a decision marked `battle`, so the Phase 0
   rule that a skip stops for a choice covers fights too, and headless runs play them through the
   same choice. Its panel stands in the chronicle where the decision card would be, which keeps it
   usable at phone width.
6. **Injuries are rolls.** "Any hit worth more than 15% rolls an injury" is a roll scaled by the
   hit's size, at most two a fight, recorded without taking Health again (the blow already did). A
   knockout leaves a quarter of Health: at 2%, lives were ending at 20 from the next scrape, and
   giants, who fight for two centuries, fell below their lifespan bar.
7. **A spar costs bruises**: 15% of the Health it took stays lost. A monthly spar to the first
   knockdown left people at the edge of death. **A fight with a stop rule is a bout**, fought as a
   spar (a challenge from "a fighter far above you", a contest).
8. **Event fights replace their checks, keeping their bands.** The bands' own injuries were
   removed, because the fight's blows injure.
9. **Slavers mean to capture.** With kill intent they were killing a tenth of all village lives
   before 35.
10. **Most grudges never come to blows.** Tier 2 people choose to go after a rival often (Phase 3);
    one quarter in seven turns into a fight, so the log is not swamped (about 43 NPC fights a year).
11. **Contests of several rounds play in quick mode**, round by round, Health carried over.
12. **A second fight while one is held open** plays itself out and its beaten are let go, rather
    than opening a second fight or a second fate choice.
13. **Raids never hit strongholds** (Impel Down, Marineford, Enies Lobby, Mary Geoise).
14. **Crewmates for the player** are the ship's hired hands as rank and file, and friends at the
    same place as named fighters; recruiting a crew is Phase 8. Bonds are relationship opinions
    until Phase 7 adds bond bars.

## Save format version 6

`state.battle` (the player's tactical fight in progress, or waiting on the fate of the beaten,
with its post-fight card), `character.fights` (won, lost, drawn, spars, and against whom),
`counters.battleId`, and pending decisions marked `battle`. `MIGRATIONS[5]` adds `battle: null`
and the counter; the cast are put on their rungs the first month a version 5 world plays.
`world_v5.opsim` loads and plays on in `tests/engine/golden.test.ts`; `world_v6.opsim` is the new
golden save (about 410 KB). A version 5 save was also opened in the browser and played on.

## Checked in a real browser

The dev build in the desktop app's browser pane, on a save from before Phase 5: it loaded (save
format 6 after migration); a skirmish against three thugs from the debug panel showed the battle
panel in the chronicle (both sides, Health and stamina bars, the target outlined, the actions with
their chances in words and as numbers on hover, the log); Strike played an exchange; the loss was
summed up in the chronicle with its injuries, Health and Berries taken, and the near-death moment
woke Armament Haki. A sea fight: the ships, hull bars, range, closing and firing, boarding into a
deck fight with the match-up board and the odds in words ("hopeless"), and the pirates left off the
board "At the fronts". A war played out after the (badly hurt) player went down. A 375 px phone
width: the sides stack and nothing scrolls sideways. No console errors. Fixed along the way: the
battle panel's buttons stayed disabled after a fight began (the chronicle now redraws when the app
stops being busy); a long chronicle stretched the whole page below the controls (screen-reader
labels were positioned against the page, not the panel); ships never closed range (the direction
was inverted); "3 thugs wins"; "the 10 pirates's caravel"; "died of killed in a fight".

## What was not verified

- `npm run e2e` was not run (Chromium for Playwright is not installed here), as before.
- I did not win a tactical fight in the browser; the fate choice is covered by a unit test and a
  UI test, not seen on screen.
- Balance: how often an ordinary life fights, and how much a fight pays and costs, are first
  values. Headless lives pick fight choices at random, so they fight more than a careful player.
- Awakened fruits' effects on the world, Mythical Zoan wills in a fight, cursed blades and armour
  are not in battles (Phase 6 and later). Talk in a fight is a simple Charisma roll until Phase 7.
- Only Chromium; no Safari, Firefox, real phone or screen reader.

## Questions for you

1. **How sharp should odds be?** At gamma 5.4 a fighter a quarter stronger wins three times in
   four. Sharper makes the ladder feel rigid; flatter makes upsets common.
2. **NPC fight volume**: about 43 a year in a full world. More fills the news and the log; fewer
   keeps them for the notable.
3. **Tactical or quick by default**: duels open tactical, everything else quick, until the player
   sets a preference on the Powers page. Would you rather every fight ask?
4. Phases 0 to 4's open questions still stand.

## Re-running everything

```bash
npm run check                          # typecheck, validate, canon lint, lint:sim, 989 tests, formatting
npm run battle                         # 1,000 pairings, tactical against abstract, and the gamma that fits
npm run battle -- --spars 1000 --world --ladder
npm run powers -- --kings 10000 --drift 20 --world
npm run lives -- --lives 300 --race all
npm run build && npm run build:preview
```
