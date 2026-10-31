# Phase 8 status report: blood (recruitment, crews and command)

**Status: complete against the plan's Phase 8 "Done when" list.** The people at the character's
side are full people now, and every group the player leads is built in one creator. Anyone worth
knowing can be recruited: people already met, a port's "Looking for a ship" list, defeated enemies
spared, the condemned in a Marine base's cells, captives on an underworld auction block, a rival
crew's unhappy member, deserters from the service, five hidden legends per world found by rumour
and exploring, and canon characters (diverging their story). Recruiting is a scene: a pitch that
lands or not by the candidate's values and nature, objections answered by a check, a promise, a
deed or a payment, and for someone worth having a joining condition, one of twenty kinds, run as a
personal quest with a tracker. A crew has a creed that binds, a command style, a structure, pay,
a home, roles, and positions aboard for four situations, each post feeding a system and each empty
one costing something. Crewmates are Tier 1 while they serve: they train on the player's rules,
teach each other their styles, wake haki, finish personal arcs, earn bounties and epithets, are
promoted, retire, leave for their own dreams and die. Missions, a fleet sworn with sake cups,
alliances, bases with rooms, prisoners, spies and betrayal are in. Phase 9 (careers and ranks) is
not started.

## "Done when", with evidence

| Plan says                                                                                                              | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | How it is checked (and how to re-run)                                                        |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Every recruit source produces candidates with a full profile and no template gaps                                      | **Yes**: a contact, a port's board, a Marine base's cells, an underworld auction, a defector, a recruiting mission's find, a spared enemy, a rival crew's member, a hidden legend and a canon character each give a recruit profile with a background, nine stats in words (exact once a crewmate), a word on their potential, five role fits each with its reason, values, eight pitches with their odds, and not one string in it with a brace, `undefined` or `NaN`. Every crew line written along the way has no gaps; the loader refuses a template with an unknown variable                                                                                                                                                                                    | `tests/systems/crew.test.ts` ("every source..."); `npm run validate`                         |
| About 20 kinds of joining condition each work end to end as a personal quest                                           | **Yes**: twenty kinds, one condition each (the loader refuses a kind with none). For each, a candidate names it, the tracker reads cleanly, the player does what it asks the way a player would (a real Phase 5 duel; driving bandits out of their home in a fight; paying a debt; finding a sister on another island; winning a master's blessing; carrying them somewhere; growing strong; becoming famous; a ship with a berth; a Devil Fruit; a graded sword; honour where they live; being there at their lowest; three lessons; bail at a Marine base; paying up front; earned trust over months; a doctor; beating them at their best stat), and they join                                                                                                    | `tests/systems/crew.test.ts` (20 cases, one per condition)                                   |
| The creator builds every kind of group, and breaking the creed costs loyalty in a seeded test                          | **Yes**: all eight kinds (pirate crew, Marine unit, mercenary company, hunter band, Revolutionary cell, Cipher Pol team, syndicate, trading house) are built with their own defaults; a Marine unit's and a Cipher Pol team's structure and pay and a cell's command are fixed, and changing them is refused with the reason. With "never kill" in the creed, a real fight whose beaten foe the player finishes costs a kind crewmate more than 5 Loyalty, traced to the record "You broke the crew's creed", and a cruel one far less. A crew file exported and imported starts a new life with the same companions by name, made fresh                                                                                                                             | `tests/systems/crew.test.ts` ("builds a ...", "breaking the creed...", "exports a crew...")  |
| In a 10-year headless run, crewmates train, learn a technique from each other, finish a personal arc and earn bounties | **Yes**: in seeded ten-year captaincies (the autopilot founds a pirate crew, recruits from the boards, answers doubts, works quests, sends errands, and moves port to port), crewmates' training rises, a style taught by a crewmate brings its techniques (logged as such), arcs are finished and outlaw crewmates earn bounties. Across 20 such lives (`npm run crew`, table below) every one of the 20 has crewmates whose training rose, personal arcs finished (median 18 a life) and bounties earned (median 10 crewmates); in 12 of 20 a crewmate also learned a technique from another's teaching (the other 8 never had a crewmate with a fighting style to teach). The test's three seeded lives all train and finish arcs, and at least one does all four | `tests/systems/crew.test.ts` ("in a ten-year headless run..."); `npm run crew -- --lives 20` |
| A delegated mission returns a report shaped by the member's stats                                                      | **Yes**: two crewmates sent to scout the same island, one sharp (Perception, Intellect, Speed 120) and one dull (3): the sharp scout's report is a success that names the place's people, its Marine base and who holds it; the dull one's fails and names its danger alone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `tests/systems/crew.test.ts` ("a mission's report...")                                       |
| A planted spy is caught in one crew and missed in another, by their stats                                              | **Yes**: the same spy planted in two crews whose captains differ only in Perception and Intellect: signs show in both, the sharp captain catches the spy (a traitor decision follows), the dull one never does in 30 months. The rule is one function for the player's crew and the world's crews (step 4, quarterly): the chance of seeing through a sign is above 85% for the one and under 10% for the other                                                                                                                                                                                                                                                                                                                                                      | `tests/systems/crew.test.ts` ("a planted spy...")                                            |
| Every post on the positions screen changes its system, and an empty post shows its cost                                | **Yes**: for each of the 27 posts in four situations, a full crew's line-up is set and then the post emptied: every effect it names changes, and the positions screen shows the post empty with its cost in words ("Nobody on the pumps: the hull takes 40% more from storms"). Every effect key is read by the system it names (the loader refuses a key no post feeds), and the numbers move: a purser's absence raises market prices, a lookout's lowers a Perception check at sea, the pumps' raises a storm's toll on the hull                                                                                                                                                                                                                                  | `tests/systems/crew.test.ts` ("every post...", "each effect key...")                         |

### `npm run crew -- --lives 20` (ten years from 22, a captain from the first month)

| Measure                       | Lives where it happened | Median a life | Most |
| ----------------------------- | ----------------------- | ------------- | ---- |
| Aboard at the end             | 20/20                   | 23            | 30   |
| The limit at the end          | 20/20                   | 24            | 30   |
| Joined                        | 20/20                   | 25            | 33   |
| Crewmates whose training rose | 20/20                   | 24            | 32   |
| Styles taught by a crewmate   | 13/20                   | 24            | 66   |
| Techniques learned            | 19/20                   | 40            | 99   |
| ...from a crewmate's teaching | 12/20                   | 38            | 90   |
| Personal arcs finished        | 20/20                   | 18            | 31   |
| Crewmates with a bounty       | 20/20                   | 10            | 18   |
| Missions back                 | 20/20                   | 11            | 24   |
| Joining quests done           | 20/20                   | 6             | 13   |
| Spies caught                  | 17/20                   | 1             | 5    |
| Betrayals                     | 0/20                    | 0             | 0    |
| Haki woken in a crewmate      | 19/20                   | 4             | 9    |

Joined by: the board 309, quests done 118, "take me somewhere" 20, a pitch to someone already known
17, defectors 9, the moment 3, the Recruit intent 3. Quests done, by kind: blessing 17, signing 17,
debt 12, duel 10, fame 10, strength 10, doctor 9, honour 7, home 6, teach 5, contest 4, kin 4,
escort 3, fruit 3, rival 3, prison 1. Nobody betrayed a captain in these lives: betrayal needs a
dishonest crewmate whose loyalty has fallen below 18, and an autopilot captain who pays and wins
keeps loyalty up; the code path of each betrayal kind is reached only in harder lives.

### Earlier phases still hold

`npm run check` passes: typecheck, data validation, canon lint, the source rules, 1,099 tests and
formatting. `npm run battle` gives Phase 5's fit (gamma 5.4). `npm run economy -- --lives 100`
gives exactly Phase 6's table (a caravel in a median of 2.0 to 4.1 years of hard work, no galleon
on wages). `npm run heart -- --lives 30` now does better than Phase 7's: a median of 20 kinds of
people reaching out (least 16, most 24), all 30 lives reaching 15 (26 of 30 before), since
crewmates have more to say. `npm run lives -- --lives 50 --race all` (the autopilot now founding a
crew now and then and captaining it for the rest of its life) keeps seven races' mean age at death
inside the Phase 2 bar: human 78.1, fish-man 92.7, merfolk 87.7, mink 87.2, skypiean 76.7, dwarf
66.0, Lunarian 572.9 (400 lives in 71 minutes on 11 workers). Giants came out at 240.9 over those
50, under the bar (247.5), as in Phase 7 (244); 200 giant lives give 250.8, inside it. `npm run
build` and `npm run build:preview` succeed. A whole headless life without a crew takes about 3.6 s
(4.5 s in Phase 7), one that captains a crew of 25 to 30 for decades about 5.4 s.

## What was built, against the plan

| Plan item                                                                                                                                                                                                                                                                                    | Where                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Recruits are full people: background, stats (exact for crewmates, words for strangers, sharpened by Observation, Intellect and time), hidden potential hinted, traits, personality and dream, role fit with reasons, powers once seen, status, ties, secrets, joining condition              | `systems/crew/view.ts` (`recruitView`), `#/recruit/<id>`                                                              |
| Where recruits come from: met people, boards (each quarter, by wealth, the recruiter), spared enemies, prisons and the condemned, auctions, rival crews (loyalty under 30), defectors, legends by rumour, canon characters                                                                   | `world.ts`, `recruit.ts`, `battle/player.ts` (the fate "Offer them a place"), `heart/effects.ts` (the Recruit intent) |
| Winning someone over: the pitch, objections and their answers, joining conditions (20 kinds), the moment, refusals remembered, limits (6 + Charisma / 10 + 4 a fame tier, officers, divisions)                                                                                               | `recruit.ts`, `quests.ts`, `data/crew.json` `recruit`, `data/conditions`                                              |
| The crew creator: eight kinds, name and symbol, creed, command, structure, pay, home, colours and dress, founding members; templates by kind; export and import                                                                                                                              | `creator.ts`, the Crew page                                                                                           |
| The creed binds: members who care lose loyalty when it is broken, gain it when it is kept                                                                                                                                                                                                    | `month.ts` (`crewHooks.deed`), `data/crew.json` `creed`                                                               |
| Running a crew: thirteen roles and a deck hand; morale, loyalty, shares, food and pay; grumbling, desertion, mutiny (against the first mate); decisions by the captain's word, a council or a vote; chemistry; traditions; the captain's log; the roster screen (sort, filter, pin, compare) | `roles.ts`, `month.ts`, `decisions.ts`, `ui/screens/crew.ts`                                                          |
| Positions aboard: 27 posts in four situations, the positions screen (a drawing of the ship, fit in words and numbers, empty posts' costs), presets by role with locks, line-ups that switch themselves, service mastery and titles, double duty, Marine ranks on posts                       | `posts.ts`, `data/crew.json` `posts` and `titles`                                                                     |
| Teammates grow: training plans, crewmates teaching each other, progression as for the player, role mastery and perks, personal arcs, bounties and epithets, fruits offered (some refuse), lives that change; everyone the player knows grows too, and a "People you know" feed               | `growth.ts`, `arcs.ts`, `bounty.ts`, `commands.ts` (`crew/offerFruit`), `month.ts` (`peopleMonth`)                    |
| Delegation: eight missions run on the member's stats, months away, a report and sometimes trouble; watch rotas fill themselves                                                                                                                                                               | `missions.ts`                                                                                                         |
| Fleets, alliances and subordinates: captains sworn with sake cups, officers given a ship of their own, fleet orders (patrol, raid, escort, hold, join the next battle), loyalty and ambition, breaking away; alliances for a goal, kept or betrayed                                          | `holdings.ts`                                                                                                         |
| Bases: four kinds, eight rooms with monthly bonuses and upkeep, raids                                                                                                                                                                                                                        | `holdings.ts`                                                                                                         |
| Prisoners, spies and traitors: held (a brig, a base's cells), questioned, ransomed, handed over, recruited, released; spies caught by the captain's eye; betrayal (selling out, a fruit stolen, the purse emptied, the ship taken)                                                           | `holdings.ts`, `spies.ts`                                                                                             |

Also: save format 9 with its migration; `npm run crew`; crew decisions in the feed like any other
decision; the headless autopilot can captain (`captain`) or found a crew now and then, recruit,
answer doubts, work quests and send errands (`quietCrew` turns it off); the debug command
`debug/plantSpy`; the Crew page (key C) and a recruit's profile linked from each person page.

## Decisions where the plan was silent or ambiguous

1. **A crew is an organization entity** with a `crew` block; a member's feelings stay on Phase 7's
   crewmate bars. Every kind of group uses the crewmate bond (a Marine unit's ranks live on its
   member records); the service's own chain of command is Phase 9's.
2. **Recruiting needs a crew**, so the first person won over founds one if the player leads none
   (a pirate crew named for the family). The Phase 7 Recruit intent is a pitch that landed: their
   doubts and condition follow.
3. **The pitch** scores the player's Charisma (half of it), what the pitch means to their three
   values (the first counts most) and their nature, what is between them (Affection, Trust,
   Respect), four points a fame tier, what is said of the player's honour there, half their
   loyalty to another captain against it, 12 for a defector, 10 for someone spared; 50 is even odds
   on the usual check curve. A refusal holds for six months against the same pitch unless the
   player has something new to show (a fame tier, a step in Combat Power, more crew, quests done).
4. **Joining conditions**: 55% of people name one (times 1.4 for someone at least 80% as strong as
   the player, or gifted; a legend always), chosen by their values and nature. "Take me somewhere"
   brings them aboard at once, bound for the place; the moment comes 4 to 8 months on and needs
   the player there.
5. **The creed**: each option says how much each personality axis cares; a member's care is 10
   plus that, and a broken rule costs 8 Loyalty times care / 30 (0 to 2), a kept one gives 4 the
   same way. Deed tags break or keep it: finishing the beaten (`kill`, `merciless`), crime
   (`prey`), an unfair split, drinking at sea, how a deserter is dealt with, running from a fight.
6. **Posts**: one person a post; deck hands (the hired crew) stand on hands' posts at a fit of 0.4,
   two a post; nobody holds more than two posts; in battle the captain stands only on the captain's
   deck. A filled post adds its value times the fit (fit / 80, at most 1.25); an empty one its
   cost. With no crew at all every key is 0, so lives without a crew play exactly as before.
7. **Growth**: someone who joins gets a hidden potential if they had none (generated people never
   did), and the body of numbers Phase 3 gives its named people if they lacked one; views read the
   same body without storing it. Training points 0.35 / 0.6 / 0.9 by effort times the stage's
   efficiency; a better partner multiplies up to 1.5; with no plan set, a crewmate trains beside
   whoever knows a style they lack; a style is taught 10% of months (15% with synergy).
8. **Bounties** belong to Phase 9; here an outlaw crew's fighters earn Combat Power x 120 Berries
   (times the role's weight) from battles won and their own arcs' fights, and an epithet at 10
   million (from a trait, the role, or a generic list).
9. **Arcs** are written in steps any life can meet (months aboard, a new place, a region, a fight
   of their own resolved in one roll with the crew behind them, training, talks, Berries from the
   purse, months in port); finishing raises a stat's potential 2 to 5% and Loyalty.
10. **Listings dissolve**: board, cell and auction people the player never met go back into the
    place's numbers when the list is remade; children under 14 see no lists.
11. **Spies**: the captain's eye is 0.55 Perception + 0.3 Intellect + 8 an Observation stage, less
    a tenth of their Trust in the spy; the cover 20 + 0.3 Charisma + 0.3 Intellect + 12 for deceit.
    A sign shows 18% of months; unseen, the spy reports (a record nobody knows).
12. **Discipline**: grumbling below morale 35, desertion below 22 for members under 30 Loyalty,
    mutiny below 12 (30% a month, times the watch's discipline) unless the first mate holds it.
13. **Decisions**: loot after a won battle (when pay is shares), a quarrel, a traitor, a crewmate's
    child, mutiny, the moment. A council or a vote adds "ask"; overruling what the crew would
    choose costs 5 (council) or 9 (vote) Loyalty each.
14. **The fleet**: a captain swears at Respect 40 or Fear 50; orders bring Berries with a risk;
    ambition grows 0.3 a month; below Loyalty 25 with ambition over 60, they break away. A fleet
    told to join the next battle brings ranks to the player's crew, sea and war battles.
15. **Bases**: raids 3% a month plus 1% a fame tier, more with nobody on watch; the walls and the
    armoury against 40 plus 10 a tier. **Prisoners**: a brig of two on any ship the player owns,
    six a level of a base's prison.
16. **People you know** are Tier 1 while close (family, mentors, rivals, lovers, students, or
    Affection 40); a quarter brings them a little growth and now and then news, heard in port.
17. **Canon characters**: in Canon mode, anyone cast in a pending hard beat refuses until it has
    happened; anyone who joins leaves the story (canon-diverged, logged).

## Save format version 9

`crew` on organization entities (kind, creed, command, structure, pay, home, members with role,
rank, officer, division, mastery, months at posts, titles, plan, mission, arcs, what they were
taught and when they are laid up; line-ups and locks per situation; morale, purse, unpaid months,
traditions, the captain's log, divisions, fleet, alliances, bases, prisoners, tallies),
`character.recruit` (pitches tried, refusals, objections answered, a joining quest),
`character.secret`, `state.crews` (boards, cells, auction blocks, legends), decisions marked
`crew`, and a battle's `posts`. Every field is optional, so `MIGRATIONS[8]` only raises the
version; `world_v8.opsim` loads and plays on in `tests/engine/golden.test.ts`; `world_v9.opsim` is
the new golden save.

## Checked in a real browser

The dev build in the desktop app's browser pane, on the save from Phase 7's check (a mink of Zou,
16): the Crew page shows the creator, its fields starting from the chosen kind's own ways (a
pirate crew's creed is not a Marine unit's); founding the Whitewhisker Pirates opened the crew's
tabs (the crew, its creed, morale and purse). The positions screen draws the ship with its stations
and lists every post: filled posts say what they add ("+15% rumours a month"), empty ones show
their cost in red ("No purser: you pay what the stalls ask"). A friend's recruit profile (from her
person page) shows her background, stats in words, role fits with reasons ("Musician: capable",
"has a song for every sea; loudmouth") and the eight pitches with their odds; pitching her "a
dream" landed and she joined, on the roster as Musician. At 375 px the page does not scroll
sideways; the posts table scrolls inside its own frame. No console errors from the current code.

Fixed along the way: the player's place was read as unset until they first moved (crew code now
asks the map, as the rest of the game does); people met in Phases 1 and 2 have no stats, so a
profile called them all weak with no fit for anything (views now read the body they would get);
a crew decision left waiting when the captain died stopped the headless runner; boards made a
thousand never-met people a life, three times slower, until they dissolved; the creator opened on
the first option of each rule rather than the kind's own.

## What was not verified

- `npm run e2e` was not run (Chromium for Playwright is not installed here), as before.
- The full lifespan sweep (`--lives 300 --race all`) was not run; 50 lives per race and 200 giant
  lives were (see "Earlier phases still hold"). It now takes about 70 minutes for 400 lives,
  against 31 in Phase 7, because the autopilot captains crews for whole lifetimes (a Lunarian's
  crew sails for five centuries).
- In the browser I founded a crew, used the positions screen and recruited by pitch; I did not
  play a joining quest, a mission, the fleet, a base, a prisoner or a spy by hand. Each is covered
  by a test, not seen on screen.
- Balance is first values: the autopilot's crews grow to about 25 in ten years (the limit rises
  with Charisma and fame); how often styles are taught; mission difficulties; raid chances.
- Only Chromium; no Safari, Firefox, real phone or screen reader.

## Questions for you

1. **Crew size**: a charismatic, famous captain can hold 25 to 30 before morale strains. That
   is a big crew next to the Straw Hats, small next to an Emperor's. Keep the plan's formula, or
   slow the fame tiers?
2. **Recruiting before founding**: the first recruit founds a pirate crew if the player has none.
   Should the creator open instead, so the player names the crew first?
3. **Board people dissolve** if never met. Someone coming back to a port a year later finds new
   faces; keeping them all would cost speed. Keep it as it is?
4. Phases 0 to 7's open questions still stand.

## Re-running everything

```bash
npm run check                          # typecheck, validate, canon lint, lint:sim, the tests, formatting
npm run crew -- --lives 20             # ten-year captaincies: training, teaching, arcs, bounties
npm run heart -- --lives 30            # Phase 7's people reaching out still hold
npm run economy -- --lives 100         # Phase 6's ship-price target still holds
npm run lives -- --lives 50 --race all
npm run build && npm run build:preview
```
