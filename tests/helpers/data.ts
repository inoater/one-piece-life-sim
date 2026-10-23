import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameData } from '../../src/engine/data/loader';
import { readDataDir } from '../../tools/lib/read-data';

// A plain string, not `new URL(..., import.meta.url)`: happy-dom swaps in its own URL class.
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const loaded = loadGameData(readDataDir(ROOT));
if (!loaded.ok || !loaded.data) {
  throw new Error(
    `The project's own /data must be valid for tests to run:\n${JSON.stringify(loaded.issues, null, 2)}`,
  );
}

/** The real game data, loaded once from disk. */
export const data = loaded.data;
export const dataHash = loaded.dataHash;
export const rawFiles = readDataDir(ROOT);
