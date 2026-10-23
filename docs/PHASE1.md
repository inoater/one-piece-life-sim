# Phase 1 status report: character genesis

**Status: complete against the plan's Phase 1 text.** New Life turns seven screens of choices into a
full text character sheet: race, birthplace, family, hidden potential and talent, an entry year and
age with a simulated backstory, and a written appearance. Phase 2 (the life loop) is not started.

## "Done when", with evidence

| Plan says                                                                            | Result                                                                                      | How it is checked (and how to re-run)                                                                 |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| New Life produces a full sheet in under 200 ms                                       | **6 to 17 ms** for the slowest entries (age 80, every race), sheet included                 | `npm run genesis`; `tests/systems/genesis.test.ts` asserts < 200 ms; the preview pane shows the time  |
| 1,000 rolls per race match the cap table in a debug histogram                        | **Every race within 0.7%** of its race cap (Ordinary talent), talent tiers at their chances | Debug panel, Genesis tab (table + histogram); `npm run genesis`; one test per race                    |
| Entry ages 0, 16, 30 and 60 give clearly different stats and backstories             | **Yes**: physical stats x3+ from 0 to 16, more by 30, decline at 60; longer pasts each time | `tests/systems/genesis.test.ts` ("Done when: entry ages ...")                                         |
| Every race and birthplace pair produces an appearance sentence with no template gaps | **Yes**: all 22 allowed pairs x 6 ages x 3 pronouns, plus every option of every field       | `tests/systems/genesis.test.ts` (no `{`, `undefined`, double spaces, stray commas; starts "A"/"An")   |
| The Giant newborn warning appears                                                    | **Yes**, with two suggested entry ages (grown by the present: 1; young adult: 55)           | `tests/systems/genesis.test.ts`; `tests/ui/new-life.test.ts` clicks the suggestion; seen in a browser |

Totals: **557 unit and integration tests** (29 files, about 20 s), typecheck clean, `npm run validate`
clean (121 data files), `npm run lint:sim` clean, production and preview builds succeed, `npm audit` 0.

## What was built, against the plan

| Plan item                           | Where                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| Creation flow (7 steps, live sheet) | `src/ui/screens/new-life.ts` (route `#/new`), `src/ui/components/sheet.ts`                         |
| Races at launch (8)                 | `data/races/` (cap modifiers, innate traits, anchors, lifespan, heights)                           |
| Birthplaces (10 + 3)                | `data/birthplaces/`, filtered by race (`races` field)                                              |
| Stats, derived values, potential    | `data/character.json`, `src/systems/genesis/generate.ts`, `sheet.ts`                               |
| Hidden talent tiers and hints       | `data/character.json` (`talentTiers`); hidden in `character.hidden`, shown only in omniscient mode |
| Family and background               | `data/legacies/`, `data/occupations/`, `data/names/`, `src/systems/genesis/family.ts`              |
| Entry year/age, backfill, focus     | `src/systems/genesis/generate.ts` (`liveYear`), `data/foci/`, `data/backstory/` (117 events)       |
| Lifespan and Giant warnings         | `src/systems/genesis/warnings.ts`                                                                  |
| Appearance generator                | `data/appearance.json`, `src/systems/genesis/appearance.ts`                                        |
| Starting traits (~25 launch + more) | `data/traits/` (racial, innate, birth, family, quirks, backstory)                                  |
| Legacy event chain "fires later"    | `chain` in each legacy; `data/events/legacy_*.json`, fired by the Phase 0 event scheduler          |

Also added: a Genesis tab in the debug panel, `npm run genesis` (cap-table check, timing, and
`--sample` to print a character), the `genesis/*` worker operations, the player's age, location and
Berries in the masthead, a "New life" entry in the Menu, and save format version 2 with its migration.

## Decisions where the plan was silent or ambiguous

1. **Potential sets the ceiling; natural growth goes halfway.** The plan says natural growth lifts
   current toward potential and training adds on top, and gives Phase 2 job requirements such as
   "Strength 20 at 14" and "Combat Power 250+ for a mercenary". If natural growth aimed at full
   potential, every untrained 30-year-old would qualify as a mercenary. So natural growth aims at
   `naturalCeiling` (0.5) x potential, and training fills the rest. A 16-year-old fighter has a
   Strength around 40; an ordinary 30-year-old fighter has a Combat Power around 230 to 270. One number
   in `data/character.json`.
2. **The race anchors versus the human stage table.** The race table gives humans 12 / 20 / 60
   (child ends, prime starts, elder starts), but the stage table puts Prime at 30 and Elder at 65.
   They cannot both be stage boundaries. I read the race table's three numbers as anchor points and
   map every human stage boundary through them piecewise-linearly, which leaves the human stage table
   exactly as written and scales every other race "in proportion". A giant of 40 is a human of 12.
3. **Long-lived races grow per human-equivalent year.** A giant's childhood lasts 40 years. Growth,
   training and the chance of backstory events in each real year are scaled by how much of a human
   year it represents, so a giant of 40 is as grown as a human of 12, not three times more.
4. **"Two innate traits (race plus birth)".** Races have one to three racial traits (Fish-Man: water
   breathing, swimming, Fish-Man Karate). Those come with the race and use no slot. The two innate
   traits are then one "nature" trait (Sturdy, Quick Learner, Lucky, ...) and one from the
   birthplace's pool; then one from the family legacy and, 55% of the time, a quirk.
5. **Talent is tied to the seed alone.** Rerolling race, birthplace, family or backstory never
   changes the hidden talent tier, so it cannot be fished for; a new seed rolls a new one.
6. **Every roll has its own keyed stream.** Each appearance field, the race, birthplace, family,
   name and each backstory year draw from their own stream (Phase 0's `rng.fork`). Rerolling one field
   changes that field only; a test proves it.
7. **The world starts at the entry month.** Entry month = the character's birth month, so "birth
   year = entry year - entry age" holds exactly and the age at entry is exactly the chosen age. The
   backstory is written into the log at its real (often negative) ticks, known only to the player.
   Phase 3 will have to simulate the world from tick 0 to the entry month first.
8. **Extra birthplaces.** The plan's ten birthplaces leave Giants (Elbaf is mentioned), Minks and
   Dwarves without a home. Added: the highlands of Elbaf, Zou, and Green Bit.
9. **Debt.** An "In debt" family starts with negative Berries; the player inherits the family purse.
10. **Name order and language.** Name pools are generic, non-canon names flavoured by region; Wano
    writes the family name first.
11. **The legacy chain** is scheduled for the month the character reaches its age (in human terms).
    If that month is before the story starts, its sentence joins the backstory instead. The fisher
    and craftsman chains need the parent alive.
12. **Difficulty in Phase 1** changes starting Berries, how hard pasts are ("hardship" events) and,
    slightly, potential. Its mortality and danger values are stored for Phases 2 and 3.
13. **Canon mode** is chosen and saved with the world (`state.config`); it does nothing until the
    canon layer exists (Phase 3). The World screen says so.
14. **A bare URL opens New Life** when there is nothing to resume. A link to a particular screen
    (`#/feed`, `#/world`) is respected, so an empty world can still be watched.

## Save format version 2

`state.config` (canon mode, difficulty, rare races) and an optional `character` block on entities.
`MIGRATIONS[1]` gives old worlds the default configuration. `world_v1.opsim` still loads (tested);
`world_v2.opsim` is the new golden save. The golden session now starts with a fixed New Life.

## Also fixed

- Six Phase 0 tests failed on Windows: they made a directory symlink, which needs administrator
  rights there. They now use a junction on Windows (`tests/helpers/project.ts`).

## Checked in a real browser

The dev build, in the desktop app's browser pane: the full flow (Giant, Year 0, age 0, the warning,
the "young adult" suggestion, Review, Start), the chronicle and Character tab afterwards, a page
reload resuming the life with a matching state hash, the Genesis debug tab, a 375 px phone width (no
horizontal scroll), the dark theme, and no console errors. Fixed along the way: missing accessible
names on the step buttons and number fields, family members sharing a given name, a duplicated
note, and an age that read 38 in one place and 39 in another.

## What was not verified

- **`npm run e2e` was not run**: Chromium for Playwright is not installed on this machine. The e2e
  helper now opens `#/feed` (Phase 0's checks are about the empty world); run
  `npx playwright-core install chromium` and `npm run e2e` before relying on it.
- Only Chromium (the app's browser pane) was used; no Safari, Firefox or real phone; no screen reader.
- Balance beyond the plan's own checks (are 30-year-old fighters too strong for Phase 2's jobs?)
  can only be judged once Phase 2 exists.

## Questions for you

1. **The plan's Lunarian numbers disagree with themselves**: elder years start at 500 but the
   lifespan is 400 to 800, so a Lunarian can die of old age before becoming old. Kept as written.
   Should elder start lower (say 300), or the lifespan be 600 to 900?
2. **Human anchors**: is decision 2 (12 / 20 / 60 as anchor points, the stage table unchanged) what
   you meant, or should the human stage table move to Prime at 20 and Elder at 60?
3. **`naturalCeiling` 0.5** (decision 1) is the number that most shapes how strong a new character
   is. Tune it once Phase 2's jobs and training exist.
4. Phase 0's open question on **`canonYearOffset`** (1484) still stands; it now shows on the Entry
   screen ("Year 14 is 1498 on the old calendar").

## Re-running everything

```bash
npm run check                    # typecheck, validate, lint:sim, 557 tests, formatting
npm run genesis                  # cap table for every race, New Life timing
npm run genesis -- --sample --seed demo --race race_giant --age 55 --omniscient
npm run build && npm run build:preview
npm run e2e                      # needs: npx playwright-core install chromium
```
