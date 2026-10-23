import { bundledRawFiles } from '../engine/data/bundled';
import { DataValidationError } from '../engine/data/issues';
import { loadGameData } from '../engine/data/loader';
import { openBestStore } from '../engine/saves/store';
import { SimCore } from './sim-core';

/**
 * Builds a SimCore from the data bundled into this build and the best available save store.
 * Shared by the Web Worker and the inline fallback. Throws DataValidationError (naming every
 * broken file and field) if the bundled data does not validate.
 */
export async function createBundledCore(debug: boolean): Promise<SimCore> {
  const loaded = loadGameData(bundledRawFiles());
  if (!loaded.ok || !loaded.data) throw new DataValidationError(loaded.issues);
  const store = await openBestStore();
  return new SimCore({
    data: loaded.data,
    dataHash: loaded.dataHash,
    dataWarnings: loaded.issues.filter((i) => i.severity === 'warning').length,
    store,
    debug,
  });
}
