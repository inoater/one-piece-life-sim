/** Normal builds: the worker is its own file, cached separately and visible in dev tools. */
export function createSimWorker(): Worker {
  return new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
}
