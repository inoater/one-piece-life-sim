# Phase 2 status report: the life loop

**Status: complete against the plan's Phase 2 text.** A character made by New Life now lives month
by month: a routine of activities by stage of life, effort and Vigor, training with diminishing
returns, jobs and money, injuries, illness and healing on schedule, friends, rivals, mentors,
sweethearts and children, aging, and death, after which the story carries on as an heir, a protégé,
a crewmate, a sibling or a newborn. At Year 39 an epilogue opens open-ended play. Phase 3 (travel,
the world, canon) is not started.

## "Done when", with evidence

| Plan says                                                                                       | Result                                                                                                                                                                                                                                                   | How it is checked (and how to re-run)                                                                                                           |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| A character lives from age 0 to death in one village with at least 40 distinct monthly outcomes | **Yes**: a human born in the East Blue village, never leaving, met **140** distinct outcomes before dying of old age at 94; an ordinary autopilot life meets 110 to 135                                                                                  | `tests/systems/life.test.ts` ("Done when: ... one village"); `npm run lives` reports outcomes per life                                          |
| A debug chart shows diminishing returns on a stat near its potential                            | **Yes**: Debug panel, Life tab. With 1 point a month toward 100: +0.5 a month at 50%, +0.2 at 80%, +0.01 past the soft cap                                                                                                                               | Life tab chart; `tests/systems/life.test.ts` checks the curve falls every month and drops to a tenth at 90%                                     |
| Injuries heal on schedule and scars become traits                                               | **Yes**: minor 1 month, serious 3, severe 12, the stat penalty expiring the same month; a severe wound can leave a scar trait (and a scar in the appearance) or cost an eye, an arm or a leg                                                             | `tests/systems/life.test.ts` (three severities; forced scar; forced loss)                                                                       |
| Death offers every continue option and applies the inheritance rules                            | **Yes**: all six options always listed, unavailable ones with the reason; Berries and 50% of fame (as "Legacy of ...") pass to an heir, protégé, crewmate or sibling; debts and bounty do not; the gang passes to a crewmate; a newborn inherits nothing | `tests/systems/life.test.ts`, `tests/ui/life.test.ts`; seen in a browser                                                                        |
| 1,000 headless lives give an average lifespan within 10% of each race's range                   | **Yes, every race** (table below)                                                                                                                                                                                                                        | `npm run lives -- --lives 1000 --race all`; the mortality model is also checked exactly per race and birthplace in `tests/systems/life.test.ts` |

"Within 10% of each race's range" is read strictly: the mean age at death lies within 10% of the
middle of the race's lifespan range (a human's 70 to 90 gives 72 to 88). Every mean is also inside
the range itself.

### `npm run lives -- --lives 1000 --race all --seed final`

| Race             | Lifespan range | Target (middle +/-10%) | Mean age at death | Median | 10th-90th percentile | Outcomes per life | Result |
| ---------------- | -------------- | ---------------------- | ----------------- | ------ | -------------------- | ----------------- | ------ |
| Human            | 70-90          | 72-88                  | **79.0**          | 82     | 64-92                | 128               | ok     |
| Fish-Man         | 80-110         | 85.5-104.5             | **91.7**          | 95     | 76-107               | 130               | ok     |
| Merfolk          | 80-110         | 85.5-104.5             | **92.9**          | 96     | 75-109               | 132               | ok     |
| Mink             | 70-100         | 76.5-93.5              | **83.0**          | 86     | 69-97                | 127               | ok     |
| Skypiean         | 70-90          | 72-88                  | **79.7**          | 82     | 65-92                | 127               | ok     |
| Dwarf (Tontatta) | 60-80          | 63-77                  | **68.7**          | 71     | 57-80                | 110               | ok     |
| Giant            | 250-300        | 247.5-302.5            | **262.0**         | 273    | 213-307              | 121               | ok     |
| Lunarian         | 400-800        | 540-660                | **566.7**         | 590    | 446-667              | 134               | ok     |

8,000 lives in 12 minutes on 11 worker threads (0.3 s for a dwarf's life, 3.5 s for a Lunarian's).
Causes are similar for every race: old age about 55%, a failing heart 20%, sickness 18%, accidents
and violence the rest.

## What was built, against the plan

| Plan item                                                                                             | Where                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Age stages (8, scaled per race through the anchors)                                                   | `data/character.json` (Phase 1), `src/systems/life/body.ts`, `upkeep.ts` (monthly growth and decline) |
| Monthly action system: slots, effort, Vigor, exhaustion, locks with reasons                           | `data/life.json`, `src/systems/life/activities.ts`, the Actions tab (`src/ui/screens/actions.ts`)     |
| Activity categories (9)                                                                               | `data/activities/` (51 activities, 159 written outcomes)                                              |
| Training formula, soft cap, breakthroughs                                                             | `src/systems/life/training.ts`                                                                        |
| Health, injuries (5 areas x 3 severities), illness, epidemics, Health 0, mortality                    | `src/systems/life/health.ts`, `data/life.json`, `src/systems/world.ts` (epidemics)                    |
| Medical care (cost, the doctor's Intellect)                                                           | `act_see_doctor`, `doctorVisit` in `activities.ts`                                                    |
| Jobs and money (the plan's 10 jobs), cost of living, loan sharks, collectors                          | `data/jobs/`, `src/systems/life/jobs.ts`, `money.ts`, `data/events/debt_collector.json`               |
| Death and continuation, inheritance, the recap                                                        | `src/systems/life/death.ts`, `src/ui/screens/end.ts` (route `#/end`)                                  |
| Epilogue at Year 39, open-ended play                                                                  | `life/openEnded` action, the epilogue in the chronicle (`src/ui/screens/feed.ts`)                     |
| Life log ("Age 7 · March"), colour by category, filters (all, personal, relationships, combat, money) | `src/ui/screens/feed.ts`                                                                              |
| Month-end card (stats, Berries, Vigor, injuries, decisions)                                           | the month report (`state.ts` `MonthReportSchema`), `src/ui/components/log-card.ts`                    |
| Health and Vigor bars in the header                                                                   | `src/ui/shell.ts`, `src/styles/life.css`                                                              |
| Headless lives (balance), lifespan histogram                                                          | `src/systems/life/headless.ts`, `autopilot.ts`, `tools/lives.ts`, the Life debug tab                  |

Also: the character sheet's Life section (Health, injuries, work, fame, infamy, debt, deeds), save
format version 3 with its migration, a golden session that now lives a job and a routine, and
`debug/injure` and `debug/kill` for looking at injuries and the death screen quickly.

## Decisions where the plan was silent or ambiguous

1. **The routine repeats.** Choosing activities every month would make "Skip 3 months" meaningless,
   so the plan is a routine that repeats until changed. One-off activities (seeing a doctor, joining
   a gang) drop out after they run. Locked activities in the routine are skipped and the month card
   says why.
2. **Vigor is a monthly budget**, the plan's "Vigor per month". Rest costs nothing. Spending past the
   pool sets Exhausted (-20% to every stat, as a named modifier); it lifts after a month with a
   restful activity or one that spends at most half the pool.
3. **Talent multiplies training too**, as Phase 1's growth rate already did ("race and talent
   multiplier applied to every training gain").
4. **Long-lived races grow and age per human-equivalent year, but train per real month.** A giant's
   month of drills is a month of drills. Natural growth, decline, illness and the mortality table run
   at the race's own pace (a giant lives through the table about a third as fast), so every race's
   life has the same shape over its own span.
5. **Mortality** is a yearly roll on the birthday from a table indexed by age as a share of the
   race's expected lifespan, times the home's safety, low Health, a few traits and the difficulty.
   Deaths of violence and accident also come from injuries during the month: at Health 0 the cause
   decides the chance of death (violence 50%, accident 30%) or a collapse, which can be a breakthrough.
6. **Cash and debt are separate.** Cash that falls below zero becomes debt with a loan shark (3% a
   month, from age 16); a family's debt from Phase 1 becomes the character's at 16. A collector (an
   event with choices) calls when the debt passes 3,000. Adults pay the cost of living from 18 (human
   years). A debt beyond what anyone will lend, with nothing in hand, means going hungry.
7. **Debts die with the debtor**; only Berries in hand pass on.
8. **Crewmates are gang members until Phase 3** brings ships and crews. The option is always listed,
   with the reason when there is no gang.
9. **Whoever carries on gets a full body from character genesis** for their age and home (so a
   sibling is exactly as strong as a new character of that age), keeps their name, people and traits,
   and knows what the last life knew, so the chronicle reads on (rule 4 still hides what nobody knew).
10. **Everyday outcomes are quiet**: on the month card, not in the chronicle, so the log reads as a
    life rather than a timesheet. "Skip to next event" stops on notable moments: injuries, new
    people, a job, a child, a death.
11. **The life log** puts the age in the month heading ("Age 7 · March, Year 12") instead of on every
    line; backstory lines already carry their own age.
12. **At sea**: the plan's "locked at sea" is wired (a flag and an `at_sea` activity tag) but nothing
    puts a character at sea until Phase 3. Seasickness and scurvy are defined and caught only at sea.
13. **Epidemics** are a small world system: rarely, the wasting fever reaches home for a few months
    and makes the news. Phase 3's world events will spread them between islands.
14. **The doctor's success chance is the local doctor's Intellect** as a percentage (50, 65 or 80 by
    the home's wealth); success takes two months off every injury and illness.

## Save format version 3

`character.life` (Health, injuries, illnesses, routine, job, debt, jail, gang, children on the way,
peak stats, deeds, the month report). `MIGRATIONS[2]` only raises the version: a version 2 world gains
its life block the first month it is played. `world_v1.opsim` and `world_v2.opsim` still load and
play; `world_v3.opsim` is the new golden save.

## Checked in a real browser

The dev build in the desktop app's browser pane: New Life, the planner (slots, effort, locked options
with reasons, Vigor against the pool), taking a job and being paid, the month card, a severe injury
locking physical activities, the Life debug tab's chart, a death opening the recap, carrying on as an
older sister who inherited the Berries, a reload resuming the new life, a 375 px phone width (no
horizontal scroll), light and dark themes, no console errors. Fixed along the way: planner and
epilogue buttons stuck disabled after time moved, the routine lost on reload (life actions now
autosave), the age repeated in backstory headings, a name repeated in the continue options.

## What was not verified

- `npm run e2e` was not run (Chromium for Playwright is not installed here), as in Phase 1.
- Only Chromium; no Safari, Firefox, real phone or screen reader.
- Balance beyond the plan's checks: an ordinary working life saves a lot (several hundred thousand
  Berries by old age), which is about right if Phase 3's ships cost what the plan says, but nothing
  spends it yet.

## Questions for you

1. **"Within 10% of each race's range"**: read as within 10% of the middle of the range (stricter than
   "inside the range, give or take 10%"). Both hold; say if you meant something else.
2. **Wealth**: should the cost of living be higher, so a fisher's life is tighter? One number per
   wealth level in `data/life.json`.
3. Phase 1's open questions (the Lunarian elder age, the human anchors, `naturalCeiling`) still
   stand; the life loop works with any answer.

## Re-running everything

```bash
npm run check                                   # typecheck, validate, lint:sim, 621 tests, formatting
npm run lives -- --lives 1000 --race all        # the lifespan check, on every core (about 12 minutes)
npm run lives -- --lives 50 --race race_human   # a quick look
npm run build && npm run build:preview
```
