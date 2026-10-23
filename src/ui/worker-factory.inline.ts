import SimWorker from '../worker/sim.worker?worker&inline';

/** Preview build: the worker code is embedded in the page as a blob. */
export function createSimWorker(): Worker {
  return new SimWorker();
}
