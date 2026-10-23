import { createBundledCore } from './bootstrap';
import { serializeError } from './errors';
import type { FromWorker, ToWorker } from './protocol';
import type { SimCore } from './sim-core';

/**
 * The simulation, off the main thread. The page sends requests; this answers them. The engine
 * runs here so a 468-month advance never freezes the page.
 *
 * Lifecycle: the page sends `init`; this loads and validates the data, opens the save store, and
 * replies `ready` (or `fatal` with every data problem, naming file and field).
 */

interface WorkerScope {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;

let booting: Promise<SimCore> | null = null;
let core: SimCore | null = null;

scope.onmessage = (event) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      booting = createBundledCore(message.debug).then(
        (created) => {
          core = created;
          scope.postMessage({ type: 'ready' });
          return created;
        },
        (error: unknown) => {
          scope.postMessage({ type: 'fatal', error: serializeError(error) });
          throw error;
        },
      );
      booting.catch(() => undefined);
      break;
    case 'cancel':
      core?.cancel();
      break;
    case 'request':
      void answer(message);
      break;
  }
};

async function answer(message: Extract<ToWorker, { type: 'request' }>): Promise<void> {
  try {
    const target = booting ? await booting : null;
    if (!target) throw new Error('The simulation has not been initialised');
    const result = await target.handle(message.op, message.payload as never, {
      onProgress: (progress) =>
        scope.postMessage({ type: 'progress', id: message.id, ...progress }),
    });
    const transfer: Transferable[] = [];
    if (message.op === 'saves/export') {
      transfer.push((result as { bytes: Uint8Array }).bytes.buffer as ArrayBuffer);
    }
    scope.postMessage({ type: 'response', id: message.id, ok: true, result }, transfer);
  } catch (error) {
    scope.postMessage({
      type: 'response',
      id: message.id,
      ok: false,
      error: serializeError(error),
    });
  }
}
