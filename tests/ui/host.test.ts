// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataIssue } from '../../src/engine/data/issues';
import { MemorySaveStore } from '../../src/engine/saves/store';
import { createSimHost, InlineSimHost, WorkerSimHost, WorkerStartError } from '../../src/ui/host';
import type { FromWorker, SerializedError, ToWorker, ViewOptions } from '../../src/worker/protocol';
import { SimError } from '../../src/worker/sim-error';
import { serializeError } from '../../src/worker/errors';
import { SimCore, type SimCoreDeps } from '../../src/worker/sim-core';
import { data, dataHash } from '../helpers/data';

const VIEW: ViewOptions = { omniscient: false, hash: false };

interface Behaviour {
  fatal?: SerializedError;
  neverReady?: boolean;
  crashOnStart?: boolean;
  core?: Partial<SimCoreDeps>;
}

/** A stand-in for a Web Worker that speaks the real protocol, backed by a real SimCore. */
class FakeWorker {
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  readonly received: ToWorker[] = [];
  core: SimCore | null = null;

  constructor(private readonly behaviour: Behaviour = {}) {}

  private reply(message: FromWorker): void {
    this.onmessage?.({ data: message } as MessageEvent<FromWorker>);
  }

  postMessage(message: ToWorker): void {
    this.received.push(message);
    queueMicrotask(async () => {
      if (this.terminated) return;
      if (message.type === 'init') {
        if (this.behaviour.crashOnStart)
          return void this.onerror?.({ message: 'Failed to load worker script' } as ErrorEvent);
        if (this.behaviour.fatal) return this.reply({ type: 'fatal', error: this.behaviour.fatal });
        if (this.behaviour.neverReady) return;
        this.core = new SimCore({
          data,
          dataHash,
          store: new MemorySaveStore(),
          debug: message.debug,
          newSeed: () => 'fake-worker',
          yieldToHost: async () => {},
          ...this.behaviour.core,
        });
        this.reply({ type: 'ready' });
      } else if (message.type === 'cancel') {
        this.core?.cancel();
      } else if (message.type === 'request' && this.core) {
        try {
          const result = await this.core.handle(message.op, message.payload as never, {
            onProgress: (p) => this.reply({ type: 'progress', id: message.id, ...p }),
          });
          this.reply({ type: 'response', id: message.id, ok: true, result });
        } catch (error) {
          this.reply({ type: 'response', id: message.id, ok: false, error: serializeError(error) });
        }
      }
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

const asWorker = (w: FakeWorker) => w as unknown as Worker;

describe('WorkerSimHost', () => {
  it('becomes ready when the worker says so, and reports itself as a worker', async () => {
    const fake = new FakeWorker();
    const host = await WorkerSimHost.start(asWorker(fake), true);
    expect(host.mode).toBe('worker');
    expect(fake.received[0]).toEqual({ type: 'init', debug: true });
  });

  it('matches each response to its request, even when they overlap', async () => {
    const host = await WorkerSimHost.start(asWorker(new FakeWorker()), true);
    await host.call('newWorld', { seed: 'overlap', view: VIEW });
    const [a, b, c] = await Promise.all([
      host.call('snapshot', { view: VIEW }),
      host.call('advance', { plan: { kind: 'months', count: 5 }, view: VIEW }),
      host.call('hash', {}),
    ]);
    expect(a.snapshot.tick).toBe(0); // requests run in order: the snapshot saw the world before the advance
    expect(b.snapshot.tick).toBe(5);
    expect(c.stateHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('forwards progress for long runs to the caller that asked', async () => {
    let now = 0;
    const host = await WorkerSimHost.start(
      asWorker(new FakeWorker({ core: { batchTicks: 10, clock: () => (now += 20) } })),
      true,
    );
    await host.call('newWorld', { seed: 'progress', view: VIEW });
    const seen: number[] = [];
    await host.call(
      'advance',
      { plan: { kind: 'months', count: 50 }, view: VIEW },
      { onProgress: (p) => seen.push(p.ticksRun) },
    );
    expect(seen.length).toBeGreaterThan(2);
    expect(seen[0]).toBe(10);
  });

  it('turns an error in the worker into a SimError carrying its message and code', async () => {
    const host = await WorkerSimHost.start(asWorker(new FakeWorker()), true);
    await host.call('newWorld', { view: VIEW });
    const error = await host.call('saves/load', { slot: 'manual-4', view: VIEW }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SimError);
    expect(error).toMatchObject({
      name: 'SaveError',
      code: 'slot',
      message: 'Slot "manual-4" is empty',
    });
  });

  it('sends a cancel message that bypasses the request queue', async () => {
    const fake = new FakeWorker();
    const host = await WorkerSimHost.start(asWorker(fake), true);
    host.cancel();
    expect(fake.received.at(-1)).toEqual({ type: 'cancel' });
  });

  it('fails every waiting call and stops the worker when disposed', async () => {
    const fake = new FakeWorker({
      core: {
        yieldToHost: () => new Promise(() => {}),
        batchTicks: 1,
        clock: (() => {
          let n = 0;
          return () => (n += 20);
        })(),
      },
    });
    const host = await WorkerSimHost.start(asWorker(fake), true);
    await host.call('newWorld', { view: VIEW });
    const waiting = host.call('advance', { plan: { kind: 'months', count: 100 }, view: VIEW });
    await new Promise((r) => setTimeout(r, 0));
    host.dispose();
    await expect(waiting).rejects.toThrow('shut down');
    expect(fake.terminated).toBe(true);
  });

  it('fails waiting calls if the worker crashes after starting', async () => {
    const fake = new FakeWorker({
      core: {
        yieldToHost: () => new Promise(() => {}),
        batchTicks: 1,
        clock: (() => {
          let n = 0;
          return () => (n += 20);
        })(),
      },
    });
    const host = await WorkerSimHost.start(asWorker(fake), true);
    await host.call('newWorld', { view: VIEW });
    const waiting = host.call('advance', { plan: { kind: 'months', count: 100 }, view: VIEW });
    await new Promise((r) => setTimeout(r, 0));
    fake.onerror?.({ message: 'out of memory' } as ErrorEvent);
    await expect(waiting).rejects.toThrow('out of memory');
  });

  describe('failing to start', () => {
    it('reports invalid game data as a SimError that names every file and field', async () => {
      const issues: DataIssue[] = [
        {
          severity: 'error',
          file: 'data/traits/x.json',
          field: 'statMods[0].value',
          message: 'Expected number',
        },
      ];
      const fake = new FakeWorker({
        fatal: { name: 'DataValidationError', message: 'bad data', issues },
      });
      const error = await WorkerSimHost.start(asWorker(fake), true).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SimError);
      expect((error as SimError).issues).toEqual(issues);
      expect(fake.terminated).toBe(true);
    });

    it('reports a worker that cannot load as a start error', async () => {
      const fake = new FakeWorker({ crashOnStart: true });
      const error = await WorkerSimHost.start(asWorker(fake), true).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WorkerStartError);
      expect((error as Error).message).toContain('Failed to load worker script');
      expect(fake.terminated).toBe(true);
    });

    it('gives up on a worker that never answers', async () => {
      const fake = new FakeWorker({ neverReady: true });
      const error = await WorkerSimHost.start(asWorker(fake), true, 25).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WorkerStartError);
      expect((error as Error).message).toContain('did not start in time');
      expect(fake.terminated).toBe(true);
    });
  });
});

describe('InlineSimHost', () => {
  const make = () =>
    new InlineSimHost(
      new SimCore({
        data,
        dataHash,
        store: new MemorySaveStore(),
        debug: true,
        newSeed: () => 'inline',
        yieldToHost: async () => {},
      }),
    );

  it('answers like a worker would', async () => {
    const host = make();
    expect(host.mode).toBe('inline');
    const { snapshot } = await host.call('newWorld', { seed: 'abc', view: VIEW });
    expect(snapshot.seed).toBe('abc');
    expect(
      (await host.call('advance', { plan: { kind: 'months', count: 3 }, view: VIEW })).snapshot
        .tick,
    ).toBe(3);
  });

  it('hands back copies, so the page can never reach into the simulation', async () => {
    const host = make();
    const { snapshot } = await host.call('newWorld', { seed: 'copy', view: VIEW });
    snapshot.feed.length = 0;
    snapshot.seed = 'tampered';
    const again = (await host.call('snapshot', { view: VIEW })).snapshot;
    expect(again.seed).toBe('copy');
    expect(again.feed.length).toBeGreaterThan(0);
  });

  it('copies what it is sent too', async () => {
    const host = make();
    await host.call('newWorld', { view: VIEW });
    const payload = { plan: { kind: 'months', count: 2 } as const, view: { ...VIEW } };
    const pending = host.call('advance', payload);
    payload.plan = { kind: 'months', count: 50 } as never;
    expect((await pending).ticksRun).toBe(2);
  });

  it('turns errors into SimError, as the worker path does', async () => {
    const host = make();
    await host.call('newWorld', { view: VIEW });
    const error = await host
      .call('dispatch', { action: { type: 'nonsense' }, view: VIEW })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SimError);
    expect((error as SimError).message).toContain('Invalid action');
  });

  it('reports progress and supports cancel', async () => {
    let now = 0;
    const holder: { host?: InlineSimHost } = {};
    const host = new InlineSimHost(
      new SimCore({
        data,
        dataHash,
        store: new MemorySaveStore(),
        debug: true,
        batchTicks: 10,
        clock: () => (now += 20),
        yieldToHost: async () => holder.host?.cancel(),
      }),
    );
    holder.host = host;
    await host.call('newWorld', { view: VIEW });
    const seen: number[] = [];
    const report = await host.call(
      'advance',
      { plan: { kind: 'months', count: 200 }, view: VIEW },
      { onProgress: (p) => seen.push(p.ticksRun) },
    );
    expect(report.stop).toBe('cancelled');
    expect(seen).toEqual([10]);
  });
});

const factory = vi.hoisted(() => ({ make: (): unknown => ({}) }));
vi.mock('#worker-factory', () => ({ createSimWorker: () => factory.make() }));

describe('createSimHost', () => {
  const originalWorker = (globalThis as { Worker?: unknown }).Worker;
  afterEach(() => {
    (globalThis as { Worker?: unknown }).Worker = originalWorker;
    vi.restoreAllMocks();
  });
  const withWorkerSupport = () => ((globalThis as { Worker?: unknown }).Worker = class {});

  it('uses a Web Worker when one starts', async () => {
    withWorkerSupport();
    factory.make = () => new FakeWorker();
    const host = await createSimHost({ debug: true });
    expect(host.mode).toBe('worker');
  });

  it('falls back to running on the main thread when the worker cannot be created', async () => {
    withWorkerSupport();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    factory.make = () => {
      throw new Error('SecurityError: blocked by Content-Security-Policy');
    };
    const host = await createSimHost({ debug: true });
    expect(host.mode).toBe('inline');
    expect(warn).toHaveBeenCalled();
    const { snapshot } = await host.call('newWorld', { seed: 'fallback', view: VIEW });
    expect(snapshot.seed).toBe('fallback');
  });

  it('falls back when the worker starts but then crashes before it is ready', async () => {
    withWorkerSupport();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    factory.make = () => new FakeWorker({ crashOnStart: true });
    expect((await createSimHost({ debug: true })).mode).toBe('inline');
  });

  it('does NOT fall back on a data problem: it would fail the same way, so it reports it', async () => {
    withWorkerSupport();
    factory.make = () =>
      new FakeWorker({ fatal: { name: 'DataValidationError', message: 'bad', issues: [] } });
    await expect(createSimHost({ debug: true })).rejects.toBeInstanceOf(SimError);
  });

  it('can be told to skip the worker entirely', async () => {
    withWorkerSupport();
    const made = vi.fn(() => new FakeWorker());
    factory.make = made;
    expect((await createSimHost({ debug: true, forceInline: true })).mode).toBe('inline');
    expect(made).not.toHaveBeenCalled();
  });

  it('runs inline where there is no Worker at all', async () => {
    delete (globalThis as { Worker?: unknown }).Worker;
    expect((await createSimHost({ debug: false })).mode).toBe('inline');
  });
});
