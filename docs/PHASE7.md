# Phase 7 status report: the heart (character interaction)

**Status: complete against the plan's Phase 7 "Done when" list.** People feel like people now.
Everyone, canon or generated, has a personality: seven axes, three values, a dream, likes and
dislikes, a voice with a register, a tic or a laugh, a fear and a soft spot. Every relationship
holds seven axes (Affection, Trust, Respect, Fear, Rivalry, Attraction, Debt), each a stack of
modifiers named for what caused them and traced to the logged event behind each one, and every
bond kind (friendship, romance, crewmate, student, mentor, rival, family, superior, subordinate,
companion) shows its own bars and fires its milestones. People remember what the player did and
bring it up, gossip spreads it, and what is said of the player travels the sea lanes place by
place. The player can say 42 things to anyone (here, or over a Den Den Mushi with their number), and
the answer comes in the other's own words; a deceitful person lies, and the player keeps the claim
with who told it. People reach out in 28 ways, from a letter home to a creditor's collectors.
Banquets, crew meetings, conscience and guilt, romance (opt-in), marriage, divorce, widowhood,
adoption, wills, children who take after their parents, and animal companions are in. Phase 8
(recruitment and crews) is not started.

## "Done when", with evidence

| Plan says                                                                                                                | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | How it is checked (and how to re-run)                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Every axis on a relationship opens a tooltip that traces each modifier to a logged event                                 | **Yes**: every modifier on every axis carries the `seq` of the record that caused it (the last one, when several added to it); a trait's first impression traces to the meeting. After a lived decade (autopilot talking most months, three years away), every modifier on every axis of every relationship, both sides, names a record that exists. The person page's meters open the breakdown on hover or focus: base (since you met) plus each modifier with its date and what happened | `tests/systems/heart.test.ts`; `tests/ui/heart.test.ts` (the tooltip names the talk); seen in the browser |
| Every intent in the table works with checks and text for at least 6 distinct personality profiles, with no template gaps | **Yes**: six people, one in each register (formal, rough, cheerful, archaic, plain, cold), with tics or laughs and six moods, each answer every band of every one of the 42 intents: the odds are a chance between 0 and 1 with words, the text has no gap, `undefined` or brace, and the effects apply. The loader refuses an intent without all four bands, a register without all twenty speech acts, or a template naming an unknown variable                                           | `tests/systems/heart.test.ts`; `npm run validate`                                                         |
| A deceitful NPC tells the player something false, and the player's knowledge records the false fact and its source       | **Yes**: an NPC with honesty −95 asked where someone is names the wrong island; the player's facts keep the claim, who told it and when; the player's view does not show it is false, the omniscient view does. Going there finds the lie out: a line in the chronicle and Trust lost in the liar, traced to that line                                                                                                                                                                      | `tests/systems/heart.test.ts`                                                                             |
| NPCs start at least 15 kinds of interaction with the player in a 10-year headless life                                   | **Yes**: five seeded test lives (22 to 32, three of those years away from home, the autopilot trying everything): the middle one and at least three of the five reach 15 kinds. Across 30 such lives (`npm run heart`) the median is 17 kinds, the least 14, the most 20; 26 of 30 reach 15 (table below). The guilt event is the player's own and is not counted                                                                                                                           | `tests/systems/heart.test.ts`; `npm run heart -- --lives 30`                                              |
| Children inherit traits, potential leanings and appearance IDs in seeded tests                                           | **Yes**: over 40 seeded children of two parents with a heritable trait and high Strength potential, between 15% and 70% inherit the trait (35% chance each), more than three quarters of appearance fields come from a parent, and potential lands near the parents'. A child born in the life loop takes after the player and their spouse, with a personality of their own. Carrying on as that child keeps their looks and pulls their genesis-made potential toward what they inherited | `tests/systems/heart.test.ts`                                                                             |
| Every bond kind shows its bars with breakdowns, and each milestone fires at its threshold                                | **Yes**: each of the ten bond kinds shows exactly its bars on the person page, each with a breakdown. Each of the 22 milestones (close friend, together, nakama, graduation, a secret taught, nemesis, estrangement, mutiny...) does not fire two points short of its threshold and fires at it                                                                                                                                                                                             | `tests/systems/heart.test.ts`                                                                             |
| Acting against a person's values lowers their conscience bar and fires a guilt event                                     | **Yes**: a player who values peace, family and justice and acts cruelly sees their conscience fall below the line, Willpower lost for six months ("Guilt") and a guilt decision (confess, make amends, bury it); confessing eases it. A kind NPC who values justice made to burn a village feels guilt too (logged, known to nobody), loses Willpower and grows harder                                                                                                                      | `tests/systems/heart.test.ts`                                                                             |

### `npm run heart -- --lives 30` (ten years from 22, three away, the autopilot trying everything)

Kinds of initiative people started, per life: least 14, median 17, most 20; 26 of 30 lives reach 15. Milestones reached: 15.3 a life. Talks: 155 a life. 30 lives in 18 s.

| Initiative                          | Lives it happened in |     | Initiative                   | Lives it happened in |
| ----------------------------------- | -------------------- | --- | ---------------------------- | -------------------- |
| A debt repaid                       | 30/30                |     | A letter from your rival     | 17/30                |
| A gift arrives                      | 30/30                |     | A quarrel with a sibling     | 17/30                |
| Someone asks you for a loan         | 30/30                |     | Your child wants to learn    | 12/30                |
| A friend asks for help              | 29/30                |     | A letter from your love      | 11/30                |
| A friend drops by                   | 29/30                |     | An apology                   | 9/30                 |
| Your teacher sends for you          | 29/30                |     | A crewmate in good spirits   | 9/30                 |
| Someone confesses                   | 27/30                |     | Your student wants a lesson  | 9/30                 |
| A crewmate wants a fair share       | 27/30                |     | A creditor wants paying      | 7/30                 |
| An old friend, found again          | 27/30                |     | An admirer wants to join you | 6/30                 |
| A letter from home                  | 25/30                |     | An enemy makes a threat      | 6/30                 |
| A rival challenges you              | 25/30                |     | A crewmate wants to leave    | 5/30                 |
| A jealous lover                     | 23/30                |     | A proposal                   | 3/30                 |
| Someone wants to learn from you     | 23/30                |     | Come home                    | 1/30                 |
| Your companion brings you something | 22/30                |     | A crewmate plots against you | 0/30                 |
| Cheated by someone you trusted      | 18/30                |     |                              |                      |

"A crewmate plots against you" needs a dishonest crewmate whose loyalty has fallen to 20, which
these lives (with no crews to speak of until Phase 8) never produce; the test of the loader and of
every initiative's requirements covers it.

### Earlier phases still hold

`npm run check` passes: typecheck, data validation, canon lint, the source rules, 1,053 tests and
formatting. `npm run battle` gives exactly Phase 5's table (gamma 5.4, largest gap 2.9 points).
`npm run economy -- --lives 100` gives exactly Phase 6's table (a caravel in a median of 2.0 to 4.1
years of hard work, no galleon on wages). `npm run lives -- --lives 50 --race all` (the autopilot
now talking to people, and people reaching out) keeps seven races' mean age at death inside the
Phase 2 bar: human 79.3, fish-man 93.4, merfolk 90.2, mink 86.5, skypiean 79.1, dwarf 67.9,
Lunarian 563.5 (400 lives in 31 minutes on 11 workers). Giants came out at 244 over those 50, just
under the bar (247.5); 200 giant lives give 254.7, inside it and the same as Phase 6's 254.2, and no
giant died in a fight, so the miss was a small sample. `npm run build` and `npm run build:preview`
succeed.

## What was built, against the plan

| Plan item                                                                                                                                              | Where                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Personality: seven axes, values ranked, a dream, likes and dislikes, a voice (register, tic, laugh), fears and soft spots                              | `systems/heart/profile.ts`, `data/heart.json`                                                                                              |
| Canon profiles from data (Phase 11 writes the rest); generated ones from region, family and traits, drifting with their lives                          | 20 canon voice packs in `data/heart.json` `canon`; `rollProfile`; guilt drifts an NPC's nature                                             |
| The player's personality as traits plus the drift counters, shown as tendencies ("You are honest to a fault")                                          | `syncPlayerProfile`, `tendencies`; the People page                                                                                         |
| Relationships: seven axes, each base plus modifiers ("Trust 62 = 20 base + 30 you saved my life")                                                      | `systems/heart/bonds.ts`; `RelationshipSchema.axes`                                                                                        |
| Labels from axes and history: stranger to spouse, nakama, sworn sibling, nemesis, master and servant, family                                           | `data/heart.json` `labels`, `labelOf`                                                                                                      |
| Relationship bars for every bond, tooltips, thresholds that fire milestones, drift back to rest                                                        | `data/heart.json` `bonds`, `month.ts` (`driftPair`, `milestonesPair`)                                                                      |
| Drift: friendship slowly, romance faster apart, rivalry barely                                                                                         | `relationship.driftByBond` (0.6, 1.6, 0.15)                                                                                                |
| Morale bars: personal, and the player's in the header; group morale                                                                                    | `heart.morale`, the masthead's Morale; a crewmate's Morale bar                                                                             |
| Conscience: deeds against one's values lower it; guilt, lost Willpower, drift; living by them raises it                                                | `systems/heart/deeds.ts`, the `ini_guilt` decision                                                                                         |
| Memory: what, when, how much, how fast it fades (grudges slower); surfaces in talk; spreads as gossip; tied to the log                                 | `systems/heart/memory.ts`, `scenes.ts` (`gossipQuarter`)                                                                                   |
| Conversation: the Interact panel's intents in six groups, each a check with four bands, text and effects                                               | `data/intents` (42), `systems/heart/talk.ts`                                                                                               |
| Knowledge flows through talk: facts with a truth value; lies and wrong rumours; who told them                                                          | `systems/heart/facts.ts`; rumours of fruits join the Devil Fruit page's                                                                    |
| Dialogue from a template grammar by intent, personality, relationship, mood and outcome; canon voice packs                                             | `systems/heart/speech.ts` (`{say.act}`), `data/heart.json` `registers` and `canon`                                                         |
| Mood for a month after events, colouring every exchange                                                                                                | `heart.mood`, mood openers and difficulty                                                                                                  |
| Remote talk with a Den Den Mushi number, slower and colder                                                                                             | `remote` intents: harder by 8, half the effect; Phase 6's call now moves Affection traced to the call                                      |
| People act on you: Tier 1 monthly, Tier 2 quarterly, by relationship and personality                                                                   | `data/initiatives` (28), `systems/heart/initiatives.ts`                                                                                    |
| NPCs hold relationships with each other; marriages, betrayals and duels make news                                                                      | `systems/heart/world.ts`                                                                                                                   |
| Banquets after a victory; crew meetings and votes; gossip each quarter                                                                                 | `scenes.ts`; a won crew, naval or war battle ends in a feast                                                                               |
| Reputation per place and faction (and family name): honourable or treacherous, kind or cruel, brave or cowardly, generous or greedy; first impressions | `deeds.ts` (`deedReputation`, `spreadReputation`), `meet.ts`                                                                               |
| Romance (opt-in, on by default, adults only), courtship, marriage, children, divorce, widowhood, adoption                                              | the `romance` setting, `confess`/`propose`/`marry`/`part_ways`, `family.ts`                                                                |
| Children inherit traits, potential leanings, personality leanings and appearance ids                                                                   | `inheritFrom`, `keepInheritance`                                                                                                           |
| Family feuds, inheritances and wills; a family name's reputation across generations                                                                    | a will's heir comes first when the story carries on; the `family:` reputation passes on; a killed relative's kin remember (memory, gossip) |
| Animal companions: pets, mounts, fighting partners, a personality and a relationship, some eat Devil Fruits                                            | `systems/heart/companions.ts`, nine species; fighting partners stand with the player in a fight                                            |
| UI: a person page (portrait slot, axes with breakdowns, memories, known facts, mood, intents with chances in words); Contacts; a relationship web      | `#/people`, `#/person/<id>` (`src/ui/screens/people.ts`), key P                                                                            |

Also: save format 8 with its migration; `npm run heart`; heart decisions in the feed like any
other decision; the headless autopilot talks to the people around it (and, now and then, buys a
pet or asks for a loan), so balancing lives include the heart; the debug command `debug/heart`.

## Decisions where the plan was silent or ambiguous

1. **Affection is the old opinion.** Every system since Phase 1 reads `opinion`; it is now the
   Affection axis, and the other six live beside it. Nothing had to move.
2. **Tracing**: a modifier carries the `seq` of the latest record that added to it (one modifier per
   source, adding up: "Chat +12, last October 1500"). Time works on bases, not modifiers (shared
   history filling, a lover's jealousy growing apart, attraction between people who get on), and a
   base traces to the meeting. A modifier written by code that does not know its record (Phase 5's
   spar aftermath) is stamped at the month's end with the month's record naming that person.
3. **Bars live on the other person's side** (their Devotion, their Jealousy), with the axes they
   show. Debt reads their way: positive, they owe the player.
4. **Hearts are made when needed**, deterministically from the person's id, not for all 2,000 Tier 2
   people at once: the player and their circle on the first month, anyone who reaches out, gossips,
   marries or meets someone. Views read a heart without storing it, so looking never changes the
   world (a determinism rule this phase nearly broke, see "Fixed along the way").
5. **Talk limits**: three talks with one person a month, each intent once. Information intents
   always cost a check; a deceitful person (honesty below −25) lies 70% of the time, anyone with
   honesty below zero who distrusts the player half that.
6. **Romance stages**: courting (a confession), together (a milestone: Affection 50, Passion 45),
   engaged (a proposal), married (a wedding, 3,000 Berries). A quarrel when Jealousy reaches 55; a
   break-up when Affection and Commitment fall away. Courting someone else makes a lover jealous.
7. **People reaching out** are scored like Phase 3's goals: each person rolls 20% a month (canon) or
   a quarter (everyone else), times how strongly they feel, then picks by weight among the 28 kinds
   their tie allows; two a month at most; none in a quiet world (`dev.quiet`), as with random events.
8. **Crews, recruitment and passage are only relationships here** (a crewmate, a captain): what a
   crew does is Phase 8's. A crewmate's bars and the nakama milestone already work.
9. **Companions are people flagged as animals**, with the owner's race for the engine's sake but
   their own lifespan, stats and a species; they take no part in talk beyond the friendly intents.
10. **Reputation** is four numbers per place, faction and family name, from deed tags (the same ones
    Phase 4's drift reads); it spreads 30% a quarter along the sea lanes to places that have heard
    less, fades 10% a year, and is what first impressions read.

## Save format version 8

`character.heart` (profile, mood, morale, conscience, memories; for the player, facts learned, the
reputation, talk this month, the heir), a relationship's `axes`, `bars`, `metSeq`, `lastSeen`,
`milestones`, `romance` and `sworn`, a modifier's `seq`, the relation kinds crewmate, superior,
subordinate, former, companion and owner, decisions marked `heart`, and the world's `romance`
setting. Every field is optional, so `MIGRATIONS[7]` only raises the version; `world_v7.opsim`
loads and plays on in `tests/engine/golden.test.ts`; `world_v8.opsim` is the new golden save.

## Checked in a real browser

The dev build in the desktop app's browser pane: a new life (a mink of Zou, 16) shows Morale in the
masthead. The People page shows who the player is ("No flag, rule or order holds you for long",
values, dream, voice), what is said of them here, five contacts with labels, the web, and the
scenes (a feast for five, pets to be had). A friend's page shows nature, values, likes, every axis
and bar, the milestones with what each needs, and the intent menu with chances in words ("almost
certain", "even odds", "Their trust is too low"). Chatting with her moved Affection from 41 to 44,
and its tooltip read "Chat +3: October 1500 SC: A good talk with Willow Ridgehorn, about old
legends mostly. “Oh, it's you! Perfect timing!”". A brother asked to borrow money (a decision in
the feed); lending it, he answered in his rough register. At 375 px neither page scrolls sideways.
No console errors.

Fixed along the way: the People page was empty until the first month (the player's heart is now
made at creation); the odds on a person page made that person's heart while drawing the page (a
view changing the world; views now read without storing); mentors were labelled "Student" (the
label rule was the wrong way round); a duel started by an effect replayed the talk that started it
when it ended, forever.

## What was not verified

- `npm run e2e` was not run (Chromium for Playwright is not installed here), as before.
- The full lifespan sweep (`--lives 300 --race all`, about 50 minutes now) was not run; 50 lives
  per race and 200 giant lives were (see "Earlier phases still hold").
- I did not play a romance from confession to a wedding, a companion eating a fruit, an adoption or
  a will by hand in the browser; they are covered by unit tests, not seen on screen.
- Balance is first values: how often people reach out, how fast bonds fade, how easily people lie,
  how much a feast costs.
- Only Chromium; no Safari, Firefox, real phone or screen reader.

## Questions for you

1. **How often people reach out**: about once or twice a month for someone with a dozen people in
   their life. More makes the feed busy; fewer makes the 15-kinds bar harder to reach.
2. **Romance** is on by default for adults, as the plan says. Should a new life ask, in New Life?
3. **Canon voice packs** use the characters' signature laughs and almost no lines of their own. Keep
   it that way until Phase 11, or write a few more?
4. Phases 0 to 6's open questions still stand.

## Re-running everything

```bash
npm run check                          # typecheck, validate, canon lint, lint:sim, the tests, formatting
npm run heart -- --lives 30            # people reaching out in ten-year lives
npm run economy -- --lives 100         # Phase 6's ship-price target still holds
npm run lives -- --lives 300 --race all
npm run build && npm run build:preview
```
