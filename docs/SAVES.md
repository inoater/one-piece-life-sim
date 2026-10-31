# Saves

## What is stored

Three rotating autosave slots (`auto-1` to `auto-3`), ten manual slots (`manual-1` to `manual-10`), in
IndexedDB, plus export and import of single `.opsim` files. Slot counts, the import size limit and the
autosave cadence come from `data/settings.json`. If IndexedDB is unavailable (some private modes) the game
falls back to memory and says so in the Menu.

An autosave happens at the end of any time skip that ran at least one month, and after answering a decision.
A skip of 100 months makes **one** autosave, not 100. Autosaves go to an empty slot first, then overwrite the
oldest. A failed autosave never interrupts play; it is reported in the world panel.

## The `.opsim` file

```
bytes 0-4   "OPSIM"             magic
byte  5     1                   container version
bytes 6-    gzip( UTF-8 JSON )  made with the browser's CompressionStream
```

The JSON is an _envelope_:

| Field                   | Meaning                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `format`                | `"opsim"`                                                            |
| `saveVersion`           | version of the saved shape; every bump needs a migration             |
| `engineVersion`         | informational                                                        |
| `dataHash`              | fingerprint of the game content the world was made with              |
| `seed`, `tick`, `label` | shown in the slot list without opening the state                     |
| `createdAt`             | wall-clock milliseconds; metadata only, never part of the state hash |
| `integrity.stateHash`   | canonical hash of `state`, verified on load                          |
| `state`                 | the world state (see `src/engine/state.ts`)                          |

No RNG state is saved: randomness is derived from the seed and the tick (see ARCHITECTURE).

## Loading, step by step

decode container, parse JSON, **verify the checksum against the state exactly as written**, migrate to the
current version, validate against the schema, report. Every step fails with a typed `SaveError` the UI can
explain: `not-opsim`, `unsupported-container`, `too-large`, `corrupt`, `checksum`, `invalid`, `version`,
`slot`. A failed load changes nothing.

The load report says whether the loaded state hashes to what was stored (`hashMatches`, false after a
migration, by design) and whether the game content has changed since (`dataHashMatches`). A content change
loads with a warning: the same seed on different data is a different world.

Imports are untrusted input: the file size and the decompressed size are both capped (a tiny file that
expands to gigabytes is rejected mid-stream), and unknown fields in the state are errors.

## Version history

| Version | Phase | What changed                                                                                         |
| ------- | ----- | ---------------------------------------------------------------------------------------------------- |
| 1       | 0     | The first format                                                                                     |
| 2       | 1     | `state.config` (canon mode, difficulty); `character` on entities                                     |
| 3       | 2     | `character.life` (health, injuries, routine, job, debt, deeds); no data is moved                     |
| 4       | 3     | `state.canon`, `state.eventState`, `config.population`; places, factions, ships, travel, news places |
| 5       | 4     | `character.powers`, `traitInfo`, `personality`; `fruit` entities; no data is moved                   |
| 6       | 5     | `state.battle`, `character.fights`, `counters.battleId`; decisions marked `battle`                   |
| 7       | 6     | `item` entities, `character.hands`, a ship's design and spirit, market supply; no data is moved      |
| 8       | 7     | `character.heart`, relationship axes, bars and milestones, a modifier's `seq`; no data is moved      |
| 9       | 8     | `crew` on organizations, `character.recruit` and `secret`, `state.crews`, decisions marked `crew`    |

A version 2 world gains its life block the first month it is played (full Health, an empty
routine): `world_v2.opsim` is loaded and lived for three months in `tests/engine/golden.test.ts`.
A version 3 world gains its map, factions, canon cast, history and people when it is opened (or
the first month it is played, headless): `world_v3.opsim` is loaded and lived in the same test.
A version 4 world gains its Devil Fruits (one entity per canon fruit, the canon users of its month
holding theirs), the canon cast's powers by era and its fighters' powers the first month it is
played: `world_v4.opsim` is loaded and lived in the same test.
A version 5 world has no fight under way and its battle counter starts at 0; the canon cast are put
on their rungs of the ladder the first month it is played: `world_v5.opsim` is loaded and lived in
the same test.

A version 6 world is unchanged by its migration (every Phase 6 field is optional). The first month
it is played it gains its blades and treasure, and the player's gear bought as counts in Phases 4
and 5 becomes items: `world_v6.opsim` is loaded and lived in the same test.

A version 7 world is unchanged by its migration too (every Phase 7 field is optional). Hearts are
made the first time the world has reason to know someone (the player and the people around them
on the first month; anyone who reaches out, gossips or marries); an old relationship's opinion is
its Affection and its other axes start at rest; romance stays on. A tie made before meeting
records were kept traces its base to the first record naming both. `world_v7.opsim` is loaded and
lived in the same test; `world_v8.opsim` is the new golden save.

## Changing the saved shape

1. Change `src/engine/state.ts` (or the envelope).
2. Raise `SAVE_VERSION` in `src/engine/version.ts`.
3. Add `MIGRATIONS[oldVersion]` in `src/engine/saves/migrations.ts`: it receives and returns the whole
   envelope, and must return `saveVersion: oldVersion + 1`.
4. Run `npm run golden:update`.

`tests/engine/saves.test.ts` fails if any version below the current one has no migration. The `world_v1.opsim`
fixture in `tests/fixtures/golden/` is never regenerated, so it proves old files still load after every
bump; `golden:update` writes only the fixture for the current version.

## The golden session

`tools/lib/golden-session.ts` is a fixed scripted play session (spawn, force events, decide, add a modifier,
run 223 months). Its final state hash is recorded in `tests/fixtures/golden/golden.json` and replayed in
`tests/engine/golden.test.ts`. If the replay hash changes, either behaviour changed on purpose (run
`npm run golden:update`, and bump the save version if the shape changed) or determinism broke by accident
(find out why; do not just update the file). Expect to update it whenever a phase adds systems.
