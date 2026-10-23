import { SaveError } from './codec';

/**
 * Where saves live. Three rotating autosave slots, ten manual slots (counts come from
 * settings.json), plus export/import as files.
 *
 * Two implementations behind one interface: IndexedDB for the browser (localStorage caps near
 * 5 MB and a 39-year world can exceed that) and memory for tests, headless tools and browsers
 * where IndexedDB is unavailable.
 */

export type SlotKind = 'auto' | 'manual';

/** Everything the slot list needs, without the (large) save bytes. */
export interface SlotSummary {
  slot: string;
  kind: SlotKind;
  label: string;
  /** Wall-clock ms when it was saved. */
  savedAt: number;
  seed: string;
  tick: number;
  stateHash: string;
  saveVersion: number;
  engineVersion: string;
  dataHash: string;
  /** Size of the stored (compressed) bytes. */
  size: number;
}

export interface SaveStore {
  /** False when saves will not survive a reload (memory fallback). */
  readonly persistent: boolean;
  list(): Promise<SlotSummary[]>;
  get(slot: string): Promise<Uint8Array | null>;
  put(summary: SlotSummary, bytes: Uint8Array): Promise<void>;
  delete(slot: string): Promise<void>;
}

const SLOT_PATTERN = /^(auto|manual)-(\d+)$/;

export function slotId(kind: SlotKind, index: number): string {
  return `${kind}-${index}`;
}

export function parseSlot(slot: string): { kind: SlotKind; index: number } | null {
  const match = SLOT_PATTERN.exec(slot);
  if (!match) return null;
  return { kind: match[1] as SlotKind, index: Number(match[2]) };
}

export function slotIds(kind: SlotKind, count: number): string[] {
  return Array.from({ length: count }, (_, i) => slotId(kind, i + 1));
}

export function assertSlot(
  slot: string,
  counts: { autosaveSlots: number; manualSlots: number },
): SlotKind {
  const parsed = parseSlot(slot);
  const max = parsed?.kind === 'auto' ? counts.autosaveSlots : counts.manualSlots;
  if (!parsed || parsed.index < 1 || parsed.index > max) {
    throw new SaveError('slot', `"${slot}" is not a save slot`);
  }
  return parsed.kind;
}

/**
 * Rotation: use an empty autosave slot if there is one, otherwise overwrite the oldest.
 * Wall-clock `savedAt` decides "oldest"; ties go to the lower slot number.
 */
export function pickAutosaveSlot(existing: readonly SlotSummary[], autosaveSlots: number): string {
  const byId = new Map(existing.map((s) => [s.slot, s]));
  let oldest: { slot: string; savedAt: number } | null = null;
  for (const slot of slotIds('auto', autosaveSlots)) {
    const found = byId.get(slot);
    if (!found) return slot;
    if (oldest === null || found.savedAt < oldest.savedAt)
      oldest = { slot, savedAt: found.savedAt };
  }
  return (oldest as { slot: string }).slot;
}

export class MemorySaveStore implements SaveStore {
  readonly persistent = false;
  private readonly summaries = new Map<string, SlotSummary>();
  private readonly blobs = new Map<string, Uint8Array>();

  async list(): Promise<SlotSummary[]> {
    return [...this.summaries.values()].map((s) => ({ ...s }));
  }
  async get(slot: string): Promise<Uint8Array | null> {
    const bytes = this.blobs.get(slot);
    return bytes ? bytes.slice() : null;
  }
  async put(summary: SlotSummary, bytes: Uint8Array): Promise<void> {
    this.summaries.set(summary.slot, { ...summary });
    this.blobs.set(summary.slot, bytes.slice());
  }
  async delete(slot: string): Promise<void> {
    this.summaries.delete(slot);
    this.blobs.delete(slot);
  }
}

const DB_VERSION = 1;
const SUMMARIES = 'slots';
const BLOBS = 'blobs';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Summaries and bytes are kept in separate object stores so listing the slots never reads the
 * megabytes of save data.
 */
export class IndexedDbSaveStore implements SaveStore {
  readonly persistent = true;

  private constructor(private readonly db: IDBDatabase) {}

  static async open(name = 'opsim', factory: IDBFactory = indexedDB): Promise<IndexedDbSaveStore> {
    const opening = factory.open(name, DB_VERSION);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains(SUMMARIES))
        db.createObjectStore(SUMMARIES, { keyPath: 'slot' });
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
    };
    return new IndexedDbSaveStore(await request(opening));
  }

  async list(): Promise<SlotSummary[]> {
    const tx = this.db.transaction(SUMMARIES, 'readonly');
    return (await request(tx.objectStore(SUMMARIES).getAll())) as SlotSummary[];
  }

  async get(slot: string): Promise<Uint8Array | null> {
    const tx = this.db.transaction(BLOBS, 'readonly');
    const value = (await request(tx.objectStore(BLOBS).get(slot))) as Uint8Array | undefined;
    return value ?? null;
  }

  async put(summary: SlotSummary, bytes: Uint8Array): Promise<void> {
    const tx = this.db.transaction([SUMMARIES, BLOBS], 'readwrite');
    tx.objectStore(SUMMARIES).put(summary);
    tx.objectStore(BLOBS).put(bytes, summary.slot);
    await done(tx);
  }

  async delete(slot: string): Promise<void> {
    const tx = this.db.transaction([SUMMARIES, BLOBS], 'readwrite');
    tx.objectStore(SUMMARIES).delete(slot);
    tx.objectStore(BLOBS).delete(slot);
    await done(tx);
  }

  close(): void {
    this.db.close();
  }
}

/** IndexedDB if it works, otherwise memory (private browsing modes can refuse it). */
export async function openBestStore(): Promise<SaveStore> {
  try {
    if (typeof indexedDB === 'undefined') return new MemorySaveStore();
    return await IndexedDbSaveStore.open();
  } catch {
    return new MemorySaveStore();
  }
}
