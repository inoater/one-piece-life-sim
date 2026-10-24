# One Piece Life Sim

A static-site life simulation. **Phase 0** (the bones) gives a world that ticks through 468 months
(Year 0 to Year 38, then the present), saves, reloads and replays identically, behind a UI shell and a
debug panel. **Phase 1** (character genesis) adds New Life: race, birthplace, family, hidden potential,
an entry year and age with a simulated backstory, and a written appearance, as a full character
sheet. **Phase 2** (the life loop) lets that character live month by month: a routine of activities
by life stage, effort and Vigor, training with diminishing returns, jobs and money, injuries,
illness and healing, relationships, aging and death, and carrying on as an heir. **Phase 3** (the
world) puts that life on a map of 55 places joined by sea lanes: voyages that take whole months in
six ways of travelling, ships to buy and crew, factions, territory and an economy, two thousand
named people living by their goals, a random-event engine with skill checks, and the canon story,
pushed by the canon mode, with a Divergence Log of every way the world leaves it. Status reports:
`docs/PHASE0.md` to `docs/PHASE3.md`.

## Quick start

```bash
npm install          # also points git at .githooks (the pre-commit data check)
npm run dev          # http://localhost:5173 opens New Life; debug panel on (press ` to toggle)
npm test             # 621 unit and integration tests, about a minute
npm run check        # typecheck, validate data, source rules, tests, formatting
```

Node 20 or newer (`.nvmrc` pins 22).

## Scripts

| Command                 | What it does                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run dev`           | Dev server. Validates `/data` at start and on every change; problems show in the browser overlay.                                          |
| `npm run build`         | Typecheck, then a production build in `dist/`. **Fails if any data file is invalid.** No debug panel.                                      |
| `npm run build:preview` | One self-contained HTML file with the debug panel: `dist-preview/opsim-preview.html`.                                                      |
| `npm run validate`      | Every JSON file against its schema, plus references between files; then canon lint. Exit 1 on any problem.                                 |
| `npm run lint:sim`      | Determinism and layering rules (see below).                                                                                                |
| `npm run sim -- ...`    | Headless simulation: `--seed s --ticks 468 --worlds 1000 --verify --probe --json`.                                                         |
| `npm run genesis`       | Phase 1 checks: 1,000 potential rolls per race against the cap table, New Life timing. `-- --sample` prints a character.                   |
| `npm run lives`         | Phase 2 balance: whole headless lives per race on every core: `-- --lives 1000 --race all`. Lifespans, causes, outcomes.                   |
| `npm run world`         | Phase 3: Year 0 to the present with nobody in it; prints the world's timeline. `-- --rates 100`: how often each beat fires per canon mode. |
| `npm test`              | Vitest: engine, systems, data, saves, worker, UI (happy-dom), tools, golden fixtures.                                                      |
| `npm run e2e`           | Real-browser tests (Playwright). First time: `npx playwright-core install chromium`.                                                       |
| `npm run golden:update` | Re-record the golden session after a deliberate behaviour change. See `docs/SAVES.md`.                                                     |

## Where things live

```
index.html
src/engine/    clock, rng, tick runner, modifier stacks, event log, saves, data loading, the autosave step  (no game rules)
src/systems/   seven of the eight pipeline steps (actions, travel, population, world, events, news, aging)  (game rules)
src/systems/genesis/  character genesis: New Life options, family, backfill, appearance, the sheet
src/systems/life/     the life loop: routine, training, health, jobs, money, family, death, the page's view
src/core.ts    wires engine + systems: tick(state, data, rng) -> state
src/worker/    runs the simulation off the main thread; the typed message protocol
src/ui/        hash router, shell, screens (New Life at #/new), menu, debug panel (vanilla DOM)
src/styles/    design tokens and CSS (cascade layers)
data/          calendar, settings, character (growth, talent, stages), creation (entry, wealth, family), appearance,
               life (slots, effort, health, money, death); races/ birthplaces/ legacies/ occupations/ names/ foci/
               backstory/ activities/ jobs/ traits/ events/ weapons/ locations/
               (canon/ fruits/ news/ reserved)
tools/         validate-data, headless-sim, canon-lint, lint-sim, update-golden, build helpers
tests/         engine/ worker/ ui/ tools/ e2e/ fixtures/golden/
docs/          ARCHITECTURE, DATA, SAVES, DESIGN, PHASE0 and PHASE1 (status reports)
```

## The plan's seven rules, and where each is enforced

| Rule                              | Where it lives                                                  | What fails if it is broken                              |
| --------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| 1. Data, not code                 | `data/**`, `src/engine/data/schemas.ts`                         | Build, `npm run validate`, pre-commit hook              |
| 2. One entity model               | `src/engine/state.ts`, `ids.ts`                                 | State schema (on every load), canon lint                |
| 3. Every number is base + mods    | `src/engine/stats.ts`, `ui/components/breakdown.ts`             | `tests/engine/stats.test.ts`                            |
| 4. Truth vs knowledge (`knownBy`) | `src/engine/knowledge.ts`; omniscient toggle in the debug panel | `tests/engine/events.test.ts`, `tests/ui/shell.test.ts` |
| 5. Simulation tiers               | `data/settings.json` `tiers`, `src/engine/entities.ts`          | `tests/engine/tick.test.ts`                             |
| 6. Seeded randomness + event log  | `src/engine/rng.ts`, `log.ts`, `dmath.ts`                       | Determinism and golden tests; `npm run lint:sim`        |
| 7. Engine never touches the page  | `src/worker/`, `tools/lib/source-lint.ts`                       | `npm run lint:sim` (layering)                           |

## The determinism contract

A world is reproduced by **seed + game data + engine version**. Saves record all three; loading a save
made with different content warns instead of silently producing a different world. Two things make
"same seed, same world" hold across browsers, and both are enforced by `npm run lint:sim`:

- Randomness is **keyed**: `rng.fork('tick', 12, 'rollEvents')` derives an independent stream from the
  seed, so adding a system never shifts the dice of an existing one, and saves need no RNG state.
- Simulation code may not use `Math.sin/exp/log/pow`, `**`, `Math.random`, `Date` or the DOM. ECMAScript
  lets engines differ in the last bit of those functions. Use `src/engine/dmath.ts` instead.

## Extending it

- **Add content** (a trait, a weapon, an island, an event): add a JSON file under `data/`. See `docs/DATA.md`.
- **Add a system**: write a `TickStep` and add one line to the list in `src/systems/index.ts`.
- **Change the saved shape**: bump `SAVE_VERSION`, add a migration. A test fails until you do. See `docs/SAVES.md`.
- **Add a field to a data type**: add it to its schema first; unknown fields are errors by design.

## Hosting

`npm run build` produces a static `dist/` that works from any path (`base: './'`, hash routes, no server
logic): GitHub Pages (`.github/workflows/deploy.yml` is included), Netlify, or Cloudflare Pages.
Saves live in the player's own browser (IndexedDB); there is no backend.

For GitHub Pages, switch it on once before the first deploy: repository **Settings, Pages, Source:
"GitHub Actions"**. Until then the deploy job fails with a 404 from `deploy-pages`, which looks like a
bug in the workflow but is only the missing setting.

## Licences

Code: unlicensed (yours). Fonts in `src/assets/fonts/` are Literata and Hanken Grotesk, under the SIL Open
Font License 1.1 (licence files alongside).
