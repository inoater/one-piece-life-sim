# Phase 0 status report

**Status: complete against the plan's Phase 0 text.** Phases 1 to 3 are not started. This report says what
exists, how each claim was checked, what was decided where the plan was silent, what went wrong along the
way, and what was _not_ verified.

## "Done when", with evidence

| Plan says                                                        | Result                                                                                                                   | How it is checked (and how to re-run)                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| A headless run of 468 ticks finishes in under 2 seconds, no NPCs | **4 to 8 ms** in a cold process; 1,000 worlds in 1.4 s                                                                   | `npm run sim -- --seed x`; `tests/engine/determinism.test.ts` asserts < 2000 ms                                             |
| The same seed gives an identical state hash across two runs      | **Yes**: in-process, across separate processes, and for 1,000 seeds each run twice                                       | `npm run sim -- --seed b --worlds 1000 --probe --verify`; `tests/engine/determinism.test.ts`; `tests/engine/golden.test.ts` |
| Save, reload the page, and the state hash still matches          | **Yes, in a real browser**, and a resumed world then carries on exactly like one that never stopped                      | `npm run e2e` ("save, reload the page, and the state hash still matches"; "carries on exactly like one that never stopped") |
| A broken data file stops the build and names the file and field  | **Yes**: `vite build` exits non-zero with `file › field` and a "did you mean"; the pre-commit hook blocks the commit too | `tests/tools/build-gate.test.ts` runs the real `vite build` on a broken copy; hook verified with a real `git commit`        |
| The debug panel shows a modifier stack for a test entity         | **Yes**: `Strength 74 = 50 base + 12 training + 8 Brawler (trait) + 4 Cutlass (weapon)`, plus a hover tooltip            | `tests/ui/debug.test.ts`; `npm run e2e`                                                                                     |

Totals: **499 unit and integration tests** (26 files, about 35 s) and **20 browser tests** (about 20 s),
type-check clean under strict settings, `npm audit` reports 0 vulnerabilities.

## What was built, against the plan

Every item in the plan's Phase 0 section has a counterpart; see README for the map. In addition to the
listed items: an entropy probe (so determinism tests are not vacuous), a determinism and layering lint, a
golden session and golden save, atomic actions and atomic time skips, cancellable long runs, a main-thread fallback host, a
single-file preview build, CI and a Pages deploy workflow, and the end-to-end suite.

## Decisions where the plan was silent or ambiguous

1. **Keyed random streams instead of one sequential generator.** `fork('tick', n, step)` derives independent
   streams from the seed. This keeps the plan's `tick(state, data, rng) -> state` signature (the `rng` is the
   root stream) while making saves independent of RNG state and new systems unable to shift old dice.
2. **No approximated `Math`** in simulation code (`sin`, `exp`, `log`, `pow`, `**`), enforced by lint, with
   deterministic replacements in `dmath.ts`. Reason: ECMAScript lets engines differ in the last bit, which
   would break "same seed, same world" between browsers.
3. **Autosave is a request, not an action.** Step 8 returns an effect; the host writes. One autosave per time
   skip, however long. Autosave settings can never change a state hash.
4. **A tick processes the current month, then advances the clock.** So tick 0 is Year 0 month 1, and 468
   ticks leave the clock at the first month of the present, as the plan describes.
5. **Tier cadence** is `tick % every === 0`, so Tier 2 acts in January, April, July and October (aligned to
   calendar quarters, including tick 0). Cadence lives in `settings.json`.
6. **Entities carry a `tier` field**, and events/records carry `knownBy`. "Every fact" was read as entities
   and log records. News is public by nature; pending decisions are the player's.
7. **"Single column from day one; panels become tabs under 700 px"** was read as: from 700 px the chronicle
   and the side panel are side by side; below it one column with the sections as tabs.
8. **Skip to Next Event** stops after any event the player could see (public, or known to the player).
   Secret events and system lines do not stop it. It is capped at 468 months so an eventless world cannot loop.
9. **Reserved data folders** (`races`, `canon`, `fruits`, `news`) reject files until a schema exists, so
   content can never be added unvalidated.
10. **Event `conditions`, `weight` and `cooldown`** are validated and cross-referenced now but not evaluated
    (the candidate engine is Phase 3). `docs/DATA.md` marks them inert.
11. **`canonYearOffset` is 1484** (see question 1).

## What the tests caught while building (all fixed)

Real defects, found by tests rather than by reading code:

- The UI bundle pulled the whole engine into the main thread through an error class (323 KB); split so the
  main chunk is 30 KB (11 KB gzipped) and the engine lives only in the worker.
- After answering a decision, keyboard focus was lost (the "Next month" button was still disabled when focus
  was handed over). Now it waits until the button is usable.
- The debug modifier form accepted an empty value as `0`.
- If a worker crashed _after_ starting, calls in flight hung forever (the start-up error handler was never
  replaced).
- A skip that ended exactly on the present said "Advanced 468 months" instead of "Reached the present".
- Only a real browser caught this one: the Menu dialog overflowed short windows, leaving its last section
  unreachable. It is now a regression test at three window sizes, verified to fail against the old CSS.
- Three colour pairings failed WCAG contrast (control borders about 2.3:1, brass 2.9:1, system rule 2.25:1);
  corrected and now tested.

Two lessons about the tests themselves. A mutation check showed my first "actions are atomic" test would
pass even if actions were not atomic (every action validates before mutating), so a genuine half-way-failure
test replaced it. And the build-gate test first passed vacuously because the child process inherited
`VITEST` and switched the gate off; it now runs in a clean environment.

## Review pass after delivery

A second, independent pass re-ran everything (typecheck, validate, lint, 495 unit tests, 20 browser tests,
the production build, `npm run sim` at 1 and 1,000 worlds) and read the engine, worker, saves and UI against
the plan. All five "Done when" items held. One real defect turned up and was fixed:

- **A time skip that failed part-way left a half-ticked world.** Actions were atomic, but `SimCore.advance`
  mutated the live state in place. A step that threw in the middle of a month left the world at the wrong
  tick, silently dropped the event that was being fired, let the next skip carry on from the damage, and left
  the page's snapshot disagreeing with the worker. It cannot happen with validated data today (the template
  validator catches the obvious cause), but every system in Phases 1 to 3 is a new way to trigger it. Four
  tests were written first and three failed on the old code (world left at tick 4 after an error; the
  consumed event; the next skip landing on tick 8 instead of 4). `advance` now takes one checkpoint per
  skip and restores it on any error; a cancelled skip still keeps the months it finished.

Smaller corrections: a comment in `menu.ts` claimed Import asks for a second press (it does not, and
should not: the system file picker is the deliberate step), and the README did not say that GitHub Pages
must be switched to the "GitHub Actions" source before the deploy workflow can work.

Left alone on purpose: the `test_*` fixtures in the production worker (risk 5; they come out with Phase 3),
and `canonYearOffset` (question 1), which is a design decision, not a defect.

## What was not verified

- **Only Chromium was run.** Cross-engine determinism (Chrome, Safari, Firefox) holds by construction and by
  lint (integer arithmetic, no approximated maths), but it has not been observed on Safari or Firefox. A
  cheap, valuable next step is running `npm run e2e` against all three with Playwright.
- No real phone, no screen reader, and not Windows (the data reader normalises path separators, untested).
- The preview build has not been tried under a strict Content-Security-Policy beyond the inline fallback
  being unit-tested.
- Performance with thousands of entities cannot be measured until Phase 3 creates them.

## Risks to plan for

1. **Event log size.** Every save carries the whole log. Thousands of NPC events a year over 39 years will make
   saves large and slow `structuredClone`. Likely answer: archive old years into a separate store, keeping `seq` stable.
2. **Pure `tick` copies the state.** Fine for tests and one-offs; bulk runs mutate in place. If profiling says
   otherwise, only the clone line changes (see ARCHITECTURE).
3. **Comparators.** Any `.sort()` in a system must use a total order (ties broken by id), or order could
   differ. The lint does not check this.
4. **Golden session churn.** Every phase that adds systems will change the golden hash; that is intended, but
   update it deliberately, never to silence a failure.
5. **`test_*` fixtures ship in every build's worker** (they cannot fire in production). Remove them when real
   content exists.

## Questions for you

1. **`canonYearOffset`** (still open, and the one number in Phase 0 a reader of the World tab sees as a
   fact). It is 1484, set from memory. Searching found (fan-news sources, not a primary one) that the
   current story is dated 1524, Luffy's departure 1522, and God Valley "38 years before the current
   storyline". Which year your clock's endpoint should read as decides the offset:

   | Offset | Meaning                                                                      |
   | ------ | ---------------------------------------------------------------------------- |
   | 1484   | Year 38 = 1522: the endpoint is the story's start (the current value)        |
   | 1485   | Year 39 = 1524: the plan's "present begins at Year 39", on the current story |
   | 1486   | Year 38 = 1524: the last simulated year is the current story's year          |

   It only affects the "Canon year" row in the World tab and is one line in `data/calendar.json`.

2. **The file is titled "Phases 0 to 7" but contains only Phases 0 to 3**, and refers to Phase 4 (trait
   mechanics, Devil Fruit users sinking) and Phases 6 and 7 (tribes, avatar layers) without writing them.
   Do you have those sections? Nothing in Phase 0 depends on them, but they may constrain Phase 1 to 3 choices.
3. Is reading 7 above (two columns from 700 px) what you meant?
4. Should a seed field be part of the player-facing New Game screen in Phase 1 (it is debug-only now)?
5. Should "Skip to Next Event" also stop for events that merely happen near the player once Phase 3 adds
   locations, or only ones that involve them?

## Re-running everything

```bash
npm run check          # typecheck, validate, lint:sim, tests, formatting
npm run e2e            # build the preview and run the browser suite
npm run sim -- --seed demo --probe --verify
npm run build && npm run build:preview
```
