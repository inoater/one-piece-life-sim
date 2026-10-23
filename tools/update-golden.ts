import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hashValue } from '../src/engine/canonical';
import { loadGameData } from '../src/engine/data/loader';
import { serializeSave } from '../src/engine/saves/manager';
import { ENGINE_VERSION, SAVE_VERSION } from '../src/engine/version';
import { GOLDEN_SEED, playGoldenSession } from './lib/golden-session';
import { readDataDir } from './lib/read-data';
import { renderIssues } from './lib/report';

/**
 * npm run golden:update
 *
 * Re-records tests/fixtures/golden/golden.json (the expected hash of the scripted session) and
 * writes the golden save for the CURRENT save version. Older versions' saves are never touched:
 * they are what proves old files still load after a version bump.
 */

const root = resolve(process.cwd());
const loaded = loadGameData(readDataDir(root));
if (!loaded.ok || !loaded.data) {
  console.error(renderIssues(loaded.issues));
  process.exit(1);
}

const state = playGoldenSession(loaded.data);
const dir = join(root, 'tests', 'fixtures', 'golden');
mkdirSync(dir, { recursive: true });

const golden = {
  note: 'Recorded by `npm run golden:update`. See tools/lib/golden-session.ts before changing this by hand.',
  seed: GOLDEN_SEED,
  saveVersion: SAVE_VERSION,
  engineVersion: ENGINE_VERSION,
  finalTick: state.tick,
  stateHash: hashValue(state),
  counts: {
    log: state.log.length,
    news: state.news.length,
    entities: Object.keys(state.entities).length,
  },
  probe: { acc: state.flags['dev.probe.acc'], draws: state.flags['dev.probe.draws'] },
};
writeFileSync(join(dir, 'golden.json'), JSON.stringify(golden, null, 2) + '\n');

const { bytes } = await serializeSave(
  state,
  { dataHash: loaded.dataHash, label: 'golden', now: 1_700_000_000_000 },
  { maxCompressedBytes: 64 << 20, maxDecompressedBytes: 256 << 20 },
);
writeFileSync(join(dir, `world_v${SAVE_VERSION}.opsim`), bytes);

console.log(
  `Golden session: tick ${golden.finalTick}, ${golden.counts.log} log records, hash ${golden.stateHash}`,
);
console.log(
  `Wrote tests/fixtures/golden/golden.json and world_v${SAVE_VERSION}.opsim (${bytes.byteLength} bytes)`,
);
