import type { FromWorker, Op, Progress, Protocol, ToWorker } from '../worker/protocol';
import { SimError } from '../worker/sim-error';
import { createSimWorker } from '#worker-factory';
import type { SimCore } from '../worker/sim-core';

/**
 * The page's only connection to the simulation (rule 7). Two implementations of one interface:
 *
 *  - WorkerSimHost runs the engine in a Web Worker (the normal case), so a 468-month run never
 *    freezes the page and can be cancelled.
 *  - InlineSimHost runs the same engine on the main thread. It is the fallback when a worker
 *    cannot start (locked-down browsers, some embedded views) and the way tests drive the UI.
 *    It still yields between chunks of a long run, and it clones every result so the page
 *    sees exactly what a worker would have sent.
 */

export interface CallOptions {
  onProgress?: (progress: Progress) => void;
}

export interface SimHost {
  readonly mode: 'worker' | 'inline';
  call<K extends Op>(
    op: K,
    payload: Protocol[K]['req'],
    options?: CallOptions,
  ): Promise<Protocol[K]['res']>;
  /** Ask a running advance to stop at the next chunk boundary. */
  cancel(): void;
  dispose(): void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress: ((progress: Progress) => void) | undefined;
}

export class WorkerSimHost implements SimHost {
  readonly mode = 'worker' as const;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  private constructor(private readonly worker: Worker) {
    worker.onmessage = (event: MessageEvent<FromWorker>) => this.receive(event.data);
    worker.onerror = (event) =>
      this.failAll(new Error(event.message || 'The simulation worker crashed'));
  }

  /**
   * Starts the worker and waits for it to say it is ready. Rejects with a SimError if the data is
   * invalid (every problem named), or a plain Error if the worker itself could not start.
   */
  static start(worker: Worker, debug: boolean, timeoutMs = 8000): Promise<WorkerSimHost> {
    return new Promise((resolve, reject) => {
      const host = new WorkerSimHost(worker);
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new WorkerStartError('The simulation worker did not start in time'));
      }, timeoutMs);
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const message = event.data;
        if (message.type === 'ready') {
          clearTimeout(timer);
          worker.onmessage = (e: MessageEvent<FromWorker>) => host.receive(e.data);
          // Startup is over: from here a crash must fail the calls in flight, not a promise that is already settled.
          worker.onerror = (e) =>
            host.failAll(new Error(e.message || 'The simulation worker crashed'));
          resolve(host);
        } else if (message.type === 'fatal') {
          clearTimeout(timer);
          worker.terminate();
          reject(new SimError(message.error));
        }
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        worker.terminate();
        reject(new WorkerStartError(event.message || 'The simulation worker failed to load'));
      };
      const init: ToWorker = { type: 'init', debug };
      worker.postMessage(init);
    });
  }

  private receive(message: FromWorker): void {
    if (message.type === 'response') {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new SimError(message.error));
    } else if (message.type === 'progress') {
      this.pending
        .get(message.id)
        ?.onProgress?.({ ticksRun: message.ticksRun, target: message.target, tick: message.tick });
    }
  }

  private failAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  call<K extends Op>(
    op: K,
    payload: Protocol[K]['req'],
    options: CallOptions = {},
  ): Promise<Protocol[K]['res']> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress: options.onProgress,
      });
      const message: ToWorker = { type: 'request', id, op, payload };
      this.worker.postMessage(message);
    });
  }

  cancel(): void {
    const message: ToWorker = { type: 'cancel' };
    this.worker.postMessage(message);
  }

  dispose(): void {
    this.failAll(new Error('The simulation was shut down'));
    this.worker.terminate();
  }
}

export class InlineSimHost implements SimHost {
  readonly mode = 'inline' as const;

  constructor(private readonly core: SimCore) {}

  static async create(debug: boolean): Promise<InlineSimHost> {
    const { createBundledCore } = await import('../worker/bootstrap');
    return new InlineSimHost(await createBundledCore(debug));
  }

  async call<K extends Op>(
    op: K,
    payload: Protocol[K]['req'],
    options: CallOptions = {},
  ): Promise<Protocol[K]['res']> {
    const input = structuredClone(payload);
    try {
      const result = await this.core.handle(
        op,
        input,
        options.onProgress ? { onProgress: options.onProgress } : {},
      );
      return structuredClone(result);
    } catch (error) {
      // Errors cross the boundary as plain data in the worker; do the same here.
      const { serializeError } = await import('../worker/errors');
      throw new SimError(serializeError(error));
    }
  }

  cancel(): void {
    this.core.cancel();
  }

  dispose(): void {
    /* nothing to release */
  }
}

/** The worker could not start (as opposed to starting and reporting a problem with the data). */
export class WorkerStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerStartError';
  }
}

export interface CreateHostOptions {
  debug: boolean;
  /** Skip the worker (tests, or a user preference). */
  forceInline?: boolean;
}

export async function createSimHost(options: CreateHostOptions): Promise<SimHost> {
  if (!options.forceInline && typeof Worker !== 'undefined') {
    try {
      return await WorkerSimHost.start(createSimWorker(), options.debug);
    } catch (error) {
      // A data problem would fail identically inline, so report it. Only fall back when the
      // worker itself is the problem.
      if (error instanceof SimError) throw error;
      console.warn('Web Worker unavailable, running the simulation on the main thread:', error);
    }
  }
  return InlineSimHost.create(options.debug);
}
