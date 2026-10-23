import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { hashValue } from '../../src/engine/canonical';
import {
  decodeContainer,
  encodeContainer,
  HEADER_LENGTH,
  SaveError,
} from '../../src/engine/saves/codec';
import { buildEnvelope } from '../../src/engine/saves/envelope';
import { deserializeSave, SaveManager, serializeSave } from '../../src/engine/saves/manager';
import { MIGRATIONS, migrateEnvelope } from '../../src/engine/saves/migrations';
import {
  assertSlot,
  IndexedDbSaveStore,
  MemorySaveStore,
  openBestStore,
  parseSlot,
  pickAutosaveSlot,
  slotIds,
  type SaveStore,
  type SlotSummary,
} from '../../src/engine/saves/store';
import { CONTAINER_VERSION, ENGINE_VERSION, SAVE_VERSION } from '../../src/engine/version';
import { data, dataHash } from '../helpers/data';
import { act, makeWorld, run } from '../helpers/world';

const LIMITS = { maxCompressedBytes: 64 << 20, maxDecompressedBytes: 256 << 20 };
const MAGIC = [0x4f, 0x50, 0x53, 0x49, 0x4d];

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Build a container around arbitrary payload bytes, to craft hostile or damaged files. */
async function containerAround(
  payload: string | Uint8Array,
  version = CONTAINER_VERSION,
): Promise<Uint8Array> {
  const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  const gz = await gzip(bytes);
  return Uint8Array.from([...MAGIC, version, ...gz]);
}

function worldWithHistory() {
  const w = makeWorld('save-tests', { probe: true, fixtures: true });
  act(w, { type: 'debug/forceEvent', eventId: 'evt_test_notice' });
  run(w, 40);
  return w;
}

const failure = async (promise: Promise<unknown>): Promise<SaveError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SaveError);
    return error as SaveError;
  }
  throw new Error('expected a SaveError but the promise resolved');
};

describe('the .opsim container', () => {
  it('starts with the magic bytes and a version, followed by gzip', async () => {
    const bytes = await encodeContainer('{"hello":"world"}', LIMITS);
    expect([...bytes.subarray(0, 5)]).toEqual(MAGIC);
    expect(bytes[5]).toBe(CONTAINER_VERSION);
    expect([bytes[HEADER_LENGTH], bytes[HEADER_LENGTH + 1]]).toEqual([0x1f, 0x8b]);
  });

  it('round-trips text, including non-ASCII', async () => {
    const text = JSON.stringify({ name: 'Ünïcode ☠ 海賊', n: [1, 2, 3] });
    expect(await decodeContainer(await encodeContainer(text, LIMITS), LIMITS)).toBe(text);
  });

  it('compresses repetitive state well', async () => {
    const text = JSON.stringify(
      Array.from({ length: 2000 }, (_, i) => ({ seq: i, kind: 'event', tags: ['a', 'b'] })),
    );
    const bytes = await encodeContainer(text, LIMITS);
    expect(bytes.byteLength).toBeLessThan(text.length / 5);
  });

  it('rejects files that are not .opsim saves', async () => {
    expect(
      (await failure(decodeContainer(new TextEncoder().encode('hello world, not a save'), LIMITS)))
        .code,
    ).toBe('not-opsim');
    expect((await failure(decodeContainer(new Uint8Array(0), LIMITS))).code).toBe('not-opsim');
    expect((await failure(decodeContainer(Uint8Array.from(MAGIC), LIMITS))).code).toBe('not-opsim');
  });

  it('rejects a container version it does not understand, saying so', async () => {
    const error = await failure(decodeContainer(await containerAround('{}', 9), LIMITS));
    expect(error.code).toBe('unsupported-container');
    expect(error.message).toContain('format 9');
  });

  it('reports truncated and bit-flipped files as damaged', async () => {
    const good = await encodeContainer(JSON.stringify({ filler: 'x'.repeat(5000) }), LIMITS);
    expect((await failure(decodeContainer(good.slice(0, 30), LIMITS))).code).toBe('corrupt');
    const flipped = good.slice();
    const middle = Math.floor(flipped.length / 2);
    flipped[middle] = (flipped[middle] ?? 0) ^ 0xff;
    expect((await failure(decodeContainer(flipped, LIMITS))).code).toBe('corrupt');
  });

  it('reports gzip contents that are not valid text as damaged', async () => {
    const error = await failure(
      decodeContainer(
        await containerAround(Uint8Array.from([0xff, 0xfe, 0xfd, 0xc3, 0x28])),
        LIMITS,
      ),
    );
    expect(error.code).toBe('corrupt');
  });

  it('refuses a file over the size limit before touching it', async () => {
    const bytes = await encodeContainer('{}', LIMITS);
    expect((await failure(decodeContainer(bytes, { ...LIMITS, maxCompressedBytes: 4 }))).code).toBe(
      'too-large',
    );
  });

  it('refuses a zip bomb: a tiny file that expands past the limit is rejected mid-stream', async () => {
    const huge = new Uint8Array(8 * 1024 * 1024); // 8 MB of zeros gzips to a few KB
    const bomb = await containerAround(huge);
    expect(bomb.byteLength).toBeLessThan(20_000);
    const error = await failure(
      decodeContainer(bomb, { ...LIMITS, maxDecompressedBytes: 1024 * 1024 }),
    );
    expect(error.code).toBe('too-large');
    expect(error.message).toContain('expands past');
  });

  it('refuses to write a save over the size limit', async () => {
    expect(
      (await failure(encodeContainer('x'.repeat(2000), { ...LIMITS, maxDecompressedBytes: 1000 })))
        .code,
    ).toBe('too-large');
  });
});

describe('saving and loading a world', () => {
  it('records the seed, version and hash alongside the state', async () => {
    const w = worldWithHistory();
    const { bytes, info } = await serializeSave(
      w.state,
      { dataHash, label: 'checkpoint', now: 1234 },
      LIMITS,
    );
    const envelope = JSON.parse(await decodeContainer(bytes, LIMITS));
    expect(envelope).toMatchObject({
      format: 'opsim',
      saveVersion: SAVE_VERSION,
      engineVersion: ENGINE_VERSION,
      dataHash,
      createdAt: 1234,
      label: 'checkpoint',
      seed: 'save-tests',
      tick: 40,
      integrity: { algo: 'cyrb128-canonical-v1', stateHash: hashValue(w.state) },
    });
    expect(info).toMatchObject({
      seed: 'save-tests',
      tick: 40,
      stateHash: hashValue(w.state),
      size: bytes.byteLength,
    });
  });

  it('loads back to exactly the same state and says so', async () => {
    const w = worldWithHistory();
    const { bytes } = await serializeSave(w.state, { dataHash, label: 'x', now: 1 }, LIMITS);
    const { state, report } = await deserializeSave(bytes, { dataHash, limits: LIMITS });
    expect(state).toEqual(w.state);
    expect(hashValue(state)).toBe(hashValue(w.state));
    expect(report).toMatchObject({
      hashMatches: true,
      migratedFrom: null,
      dataHashMatches: true,
      seed: 'save-tests',
      tick: 40,
      saveVersion: SAVE_VERSION,
    });
  });

  it('warns (without failing) when the game content changed since the save was made', async () => {
    const w = worldWithHistory();
    const { bytes } = await serializeSave(
      w.state,
      { dataHash: 'the-old-data-hash', label: 'x', now: 1 },
      LIMITS,
    );
    const { report } = await deserializeSave(bytes, { dataHash, limits: LIMITS });
    expect(report.dataHashMatches).toBe(false);
    expect(report.savedDataHash).toBe('the-old-data-hash');
    expect(report.hashMatches).toBe(true);
  });

  describe('damage and tampering', () => {
    const forge = async (edit: (envelope: any) => void, rehash = false): Promise<Uint8Array> => {
      const w = worldWithHistory();
      const envelope = JSON.parse(
        JSON.stringify(buildEnvelope(w.state, { dataHash, label: 'x', now: 1 })),
      );
      edit(envelope);
      if (rehash) envelope.integrity.stateHash = hashValue(envelope.state);
      return containerAround(JSON.stringify(envelope));
    };
    const load = (bytes: Uint8Array) => deserializeSave(bytes, { dataHash, limits: LIMITS });

    it('detects a state that was edited after saving (checksum)', async () => {
      const error = await failure(load(await forge((e) => (e.state.tick = 400))));
      expect(error.code).toBe('checksum');
      expect(error.message).toContain('damaged or was edited');
    });

    it('detects a swapped checksum', async () => {
      expect(
        (await failure(load(await forge((e) => (e.integrity.stateHash = '0'.repeat(32)))))).code,
      ).toBe('checksum');
    });

    it('rejects a save with no checksum at all', async () => {
      expect((await failure(load(await forge((e) => delete e.integrity)))).code).toBe('invalid');
    });

    it('rejects JSON that is not an object or not an opsim envelope', async () => {
      expect((await failure(load(await containerAround('[1,2,3]')))).code).toBe('not-opsim');
      expect((await failure(load(await containerAround('{"format":"other"}')))).code).toBe(
        'not-opsim',
      );
      expect((await failure(load(await containerAround('this is not json')))).code).toBe('corrupt');
    });

    it('rejects a structurally invalid state even when its checksum was recomputed, naming the field', async () => {
      const error = await failure(load(await forge((e) => (e.state.tick = 'soon'), true)));
      expect(error.code).toBe('invalid');
      expect(error.message).toMatch(/state\.tick/);
    });

    it('rejects an entity stored under the wrong id and a player that does not exist', async () => {
      const wrongKey = await failure(
        load(
          await forge((e) => {
            const [id] = Object.keys(e.state.entities);
            e.state.entities['gen_000777'] = e.state.entities[id!];
          }, true),
        ),
      );
      expect(wrongKey.message).toContain('is stored under "gen_000777"');
      const ghost = await failure(
        load(await forge((e) => (e.state.playerId = 'gen_000999'), true)),
      );
      expect(ghost.message).toContain('playerId');
    });

    it('rejects unknown fields rather than silently dropping them', async () => {
      const error = await failure(load(await forge((e) => (e.state.surprise = true), true)));
      expect(error.code).toBe('invalid');
    });

    it('rejects a save from a newer version with a clear instruction', async () => {
      const error = await failure(load(await forge((e) => (e.saveVersion = SAVE_VERSION + 4))));
      expect(error.code).toBe('version');
      expect(error.message).toContain('newer version');
    });
  });
});

describe('migrations', () => {
  it('every version below the current one has a migration (bumping SAVE_VERSION without one fails here)', () => {
    const have = Object.keys(MIGRATIONS)
      .map(Number)
      .sort((a, b) => a - b);
    const need = Array.from({ length: SAVE_VERSION - 1 }, (_, i) => i + 1);
    expect(have).toEqual(need);
  });

  const env = (version: unknown): Record<string, unknown> => ({
    saveVersion: version,
    state: { n: 1 },
  });

  it('applies migrations in order up to the target', () => {
    const order: number[] = [];
    const table = {
      1: (e: Record<string, unknown>) => (order.push(1), { ...e, saveVersion: 2, renamed: true }),
      2: (e: Record<string, unknown>) => (order.push(2), { ...e, saveVersion: 3 }),
    };
    const result = migrateEnvelope(env(1), table, 3);
    expect(order).toEqual([1, 2]);
    expect(result).toMatchObject({
      from: 1,
      migrated: true,
      envelope: { saveVersion: 3, renamed: true },
    });
  });

  it("starts from the save's own version and does nothing when already current", () => {
    const order: number[] = [];
    const table = {
      1: (e: Record<string, unknown>) => (order.push(1), { ...e, saveVersion: 2 }),
      2: (e: Record<string, unknown>) => (order.push(2), { ...e, saveVersion: 3 }),
    };
    expect(migrateEnvelope(env(2), table, 3).from).toBe(2);
    expect(order).toEqual([2]);
    expect(migrateEnvelope(env(3), table, 3)).toMatchObject({ migrated: false, from: 3 });
  });

  it('refuses a newer save, a missing step, a lying migration and a nonsense version', () => {
    expect(() => migrateEnvelope(env(5), {}, 3)).toThrow(/newer version/);
    expect(() => migrateEnvelope(env(1), { 2: (e) => e }, 3)).toThrow(
      /No migration exists from save format 1 to 2/,
    );
    expect(() => migrateEnvelope(env(1), { 1: (e) => e }, 2)).toThrow(/did not produce format 2/);
    for (const bad of [0, 1.5, 'x', undefined, -1])
      expect(() => migrateEnvelope(env(bad), {}, 3)).toThrow(SaveError);
  });

  it('an old save loads through its migration end to end (checksum verified before, hash reported after)', async () => {
    const w = worldWithHistory();
    const { bytes } = await serializeSave(w.state, { dataHash, label: 'old', now: 1 }, LIMITS);
    const migrations = {
      1: (e: Record<string, unknown>) => ({
        ...e,
        saveVersion: 2,
        label: `${String(e['label'])} (migrated)`,
        state: {
          ...(e['state'] as object),
          flags: { ...(e['state'] as { flags: object }).flags, 'migrated.from.v1': true },
        },
      }),
    };
    const { state, report } = await deserializeSave(bytes, {
      dataHash,
      limits: LIMITS,
      migrations,
      targetVersion: 2,
    });
    expect(report).toMatchObject({
      saveVersion: 2,
      migratedFrom: 1,
      label: 'old (migrated)',
      hashMatches: false,
    });
    expect(report.storedHash).toBe(hashValue(w.state));
    expect(report.actualHash).toBe(hashValue(state));
    expect(state.flags['migrated.from.v1']).toBe(true);
  });

  it('does not run a migration on a save that fails its checksum', async () => {
    const w = worldWithHistory();
    const envelope = JSON.parse(
      JSON.stringify(buildEnvelope(w.state, { dataHash, label: 'x', now: 1 })),
    );
    envelope.state.tick += 1;
    let ran = false;
    const error = await failure(
      deserializeSave(await containerAround(JSON.stringify(envelope)), {
        dataHash,
        limits: LIMITS,
        migrations: { 1: (e) => ((ran = true), { ...e, saveVersion: 2 }) },
        targetVersion: 2,
      }),
    );
    expect(error.code).toBe('checksum');
    expect(ran).toBe(false);
  });
});

describe('slots', () => {
  const counts = { autosaveSlots: 3, manualSlots: 10 };

  it('names and parses slots', () => {
    expect(slotIds('auto', 3)).toEqual(['auto-1', 'auto-2', 'auto-3']);
    expect(slotIds('manual', 2)).toEqual(['manual-1', 'manual-2']);
    expect(parseSlot('manual-7')).toEqual({ kind: 'manual', index: 7 });
    expect(parseSlot('nonsense')).toBeNull();
    expect(parseSlot('auto-x')).toBeNull();
  });

  it('accepts only the configured slots', () => {
    expect(assertSlot('auto-3', counts)).toBe('auto');
    expect(assertSlot('manual-10', counts)).toBe('manual');
    for (const bad of ['auto-4', 'auto-0', 'manual-0', 'manual-11', 'slot-1', '', '../manual-1']) {
      expect(() => assertSlot(bad, counts), bad).toThrow(SaveError);
    }
  });

  const summary = (slot: string, savedAt: number): SlotSummary => ({
    slot,
    kind: 'auto',
    label: '',
    savedAt,
    seed: 's',
    tick: 0,
    stateHash: 'h',
    saveVersion: 1,
    engineVersion: 'v',
    dataHash: 'd',
    size: 1,
  });

  it('rotates autosaves: fills empty slots first, then overwrites the oldest', () => {
    expect(pickAutosaveSlot([], 3)).toBe('auto-1');
    expect(pickAutosaveSlot([summary('auto-1', 10)], 3)).toBe('auto-2');
    expect(pickAutosaveSlot([summary('auto-1', 10), summary('auto-3', 12)], 3)).toBe('auto-2');
    expect(
      pickAutosaveSlot([summary('auto-1', 30), summary('auto-2', 10), summary('auto-3', 20)], 3),
    ).toBe('auto-2');
    expect(
      pickAutosaveSlot([summary('auto-1', 5), summary('auto-2', 5), summary('auto-3', 5)], 3),
    ).toBe('auto-1'); // tie: lowest
  });
});

function managerOver(store: SaveStore) {
  let clock = 1_000;
  return new SaveManager(store, {
    counts: { autosaveSlots: 3, manualSlots: 10 },
    limits: LIMITS,
    dataHash,
    now: () => (clock += 10),
  });
}

describe('the save manager', () => {
  it('saves to and loads from a manual slot', async () => {
    const w = worldWithHistory();
    const m = managerOver(new MemorySaveStore());
    const saved = await m.saveManual(w.state, 'manual-4', 'Before the storm');
    expect(saved).toMatchObject({
      slot: 'manual-4',
      kind: 'manual',
      label: 'Before the storm',
      seed: 'save-tests',
      tick: 40,
    });
    const { state, report } = await m.load('manual-4');
    expect(hashValue(state)).toBe(hashValue(w.state));
    expect(report.label).toBe('Before the storm');
  });

  it('overwrites a manual slot and keeps slots independent', async () => {
    const m = managerOver(new MemorySaveStore());
    const w = worldWithHistory();
    await m.saveManual(w.state, 'manual-1', 'first');
    run(w, 10);
    await m.saveManual(w.state, 'manual-1', 'second');
    await m.saveManual(w.state, 'manual-2', 'other');
    expect((await m.list()).map((s) => [s.slot, s.label])).toEqual([
      ['manual-1', 'second'],
      ['manual-2', 'other'],
    ]);
    expect((await m.load('manual-1')).state.tick).toBe(50);
  });

  it('never lets a player write an autosave slot by hand, nor use a slot that does not exist', async () => {
    const m = managerOver(new MemorySaveStore());
    const w = worldWithHistory();
    expect((await failure(m.saveManual(w.state, 'auto-1', 'x'))).code).toBe('slot');
    expect((await failure(m.saveManual(w.state, 'manual-99', 'x'))).code).toBe('slot');
    expect((await failure(m.load('manual-3'))).code).toBe('slot'); // empty
  });

  it('rotates three autosave slots', async () => {
    const m = managerOver(new MemorySaveStore());
    const w = makeWorld('rotation');
    const used: string[] = [];
    for (let i = 0; i < 7; i++) {
      run(w, 1);
      used.push((await m.autosave(w.state, `auto ${i}`)).slot);
    }
    expect(used).toEqual(['auto-1', 'auto-2', 'auto-3', 'auto-1', 'auto-2', 'auto-3', 'auto-1']);
    const slots = await m.list();
    expect(slots.map((s) => [s.slot, s.tick])).toEqual([
      ['auto-1', 7],
      ['auto-2', 5],
      ['auto-3', 6],
    ]);
    expect((await m.newest())?.slot).toBe('auto-1');
  });

  it('lists autosaves before manual saves, in slot order, ignoring unknown slots', async () => {
    const store = new MemorySaveStore();
    const m = managerOver(store);
    const w = worldWithHistory();
    await m.saveManual(w.state, 'manual-2', 'b');
    await m.autosave(w.state, 'a');
    await m.saveManual(w.state, 'manual-1', 'a');
    await store.put({ ...summary2('legacy-thing') }, new Uint8Array([1]));
    expect((await m.list()).map((s) => s.slot)).toEqual(['auto-1', 'manual-1', 'manual-2']);
  });

  it('deletes a slot', async () => {
    const m = managerOver(new MemorySaveStore());
    await m.saveManual(worldWithHistory().state, 'manual-1', 'x');
    await m.delete('manual-1');
    expect(await m.list()).toEqual([]);
  });

  it('exports exactly the bytes a slot stores, under a safe file name', async () => {
    const store = new MemorySaveStore();
    const m = managerOver(store);
    const w = makeWorld('Coral Lantern 42!!');
    run(w, 7);
    const exported = await m.exportBytes(w.state, 'label');
    expect(exported.filename).toBe('opsim-coral-lantern-42-tick7.opsim');
    const { state } = await m.decode(exported.bytes);
    expect(hashValue(state)).toBe(hashValue(w.state));
  });

  it('imports an exported file as a fresh world', async () => {
    const w = worldWithHistory();
    const exported = await managerOver(new MemorySaveStore()).exportBytes(w.state, 'x');
    const { state, report } = await managerOver(new MemorySaveStore()).decode(exported.bytes);
    expect(report.hashMatches).toBe(true);
    expect(state).toEqual(w.state);
  });
});

function summary2(slot: string): SlotSummary {
  return {
    slot,
    kind: 'manual',
    label: '',
    savedAt: 1,
    seed: 's',
    tick: 0,
    stateHash: 'h',
    saveVersion: 1,
    engineVersion: 'v',
    dataHash: 'd',
    size: 1,
  };
}

describe('IndexedDB store (real IndexedDB semantics via fake-indexeddb)', () => {
  it('stores, lists, reads and deletes saves', async () => {
    const store = await IndexedDbSaveStore.open('t1', new IDBFactory());
    const bytes = Uint8Array.from([1, 2, 3, 250, 255]);
    await store.put(summary2('manual-1'), bytes);
    expect(await store.list()).toEqual([summary2('manual-1')]);
    expect(await store.get('manual-1')).toEqual(bytes);
    expect(await store.get('manual-9')).toBeNull();
    await store.delete('manual-1');
    expect(await store.list()).toEqual([]);
    expect(await store.get('manual-1')).toBeNull();
    store.close();
  });

  it('lists summaries without the save bytes', async () => {
    const store = await IndexedDbSaveStore.open('t2', new IDBFactory());
    await store.put(summary2('manual-1'), new Uint8Array(1000));
    const [listed] = await store.list();
    expect(listed).not.toHaveProperty('bytes');
    expect(Object.keys(listed!).sort()).toEqual(Object.keys(summary2('manual-1')).sort());
    store.close();
  });

  it('keeps saves across a close and reopen (what a page reload does)', async () => {
    const factory = new IDBFactory();
    const first = await IndexedDbSaveStore.open('t3', factory);
    await first.put(summary2('manual-2'), Uint8Array.from([9, 9, 9]));
    first.close();
    const second = await IndexedDbSaveStore.open('t3', factory);
    expect((await second.list()).map((s) => s.slot)).toEqual(['manual-2']);
    expect(await second.get('manual-2')).toEqual(Uint8Array.from([9, 9, 9]));
    second.close();
  });

  it('overwrites a slot in place', async () => {
    const store = await IndexedDbSaveStore.open('t4', new IDBFactory());
    await store.put({ ...summary2('manual-1'), label: 'one' }, Uint8Array.from([1]));
    await store.put({ ...summary2('manual-1'), label: 'two' }, Uint8Array.from([2]));
    expect(await store.list()).toMatchObject([{ label: 'two' }]);
    expect(await store.get('manual-1')).toEqual(Uint8Array.from([2]));
    store.close();
  });

  it('works under the full save manager, across a reload', async () => {
    const factory = new IDBFactory();
    const w = worldWithHistory();
    const first = managerOver(await IndexedDbSaveStore.open('t5', factory));
    await first.autosave(w.state, 'auto');
    (first.store as IndexedDbSaveStore).close();

    const second = managerOver(await IndexedDbSaveStore.open('t5', factory));
    const newest = await second.newest();
    expect(newest?.slot).toBe('auto-1');
    const { state, report } = await second.load('auto-1');
    expect(hashValue(state)).toBe(hashValue(w.state));
    expect(report.hashMatches).toBe(true);
  });

  it('falls back to memory (and says saves will not persist) where IndexedDB is unavailable', async () => {
    const store = await openBestStore(); // plain Node has no indexedDB
    expect(store.persistent).toBe(false);
    await store.put(summary2('manual-1'), Uint8Array.from([1]));
    expect(await store.get('manual-1')).toEqual(Uint8Array.from([1]));
  });
});

describe('data', () => {
  it('uses the real game data', () => {
    expect(data.settings.saves).toMatchObject({ autosaveSlots: 3, manualSlots: 10 });
  });
});
