import { CanonicalError, hashValue } from '../canonical';
import { formatPath } from '../data/issues';
import type { WorldState } from '../state';
import { HASH_ALGO, SAVE_VERSION } from '../version';
import { decodeContainer, encodeContainer, SaveError, type ContainerLimits } from './codec';
import { buildEnvelope, EnvelopeSchema } from './envelope';
import { migrateEnvelope, type Migration, type RawEnvelope } from './migrations';
import {
  assertSlot,
  pickAutosaveSlot,
  slotIds,
  type SaveStore,
  type SlotKind,
  type SlotSummary,
} from './store';

/**
 * Saving and loading, as pure-ish functions over bytes plus a slot manager over a SaveStore.
 *
 * Load pipeline (each step fails with a SaveError the UI can explain):
 *   decode container -> parse JSON -> check checksum -> migrate to the current version ->
 *   validate against the schema -> report.
 *
 * The checksum is verified BEFORE migrating, against the state exactly as it was written. After a
 * migration the state legitimately has a different hash, which the report states.
 */

export interface SaveInfo {
  label: string;
  savedAt: number;
  seed: string;
  tick: number;
  stateHash: string;
  saveVersion: number;
  engineVersion: string;
  dataHash: string;
  size: number;
}

export interface LoadReport {
  label: string;
  seed: string;
  tick: number;
  savedAt: number;
  saveVersion: number;
  /** The version the file was written in, when a migration ran. */
  migratedFrom: number | null;
  engineVersion: string;
  storedHash: string;
  /** Hash of the state as loaded (after any migration). */
  actualHash: string;
  /** True when the loaded state hashes to exactly what was stored: the save round-tripped intact. */
  hashMatches: boolean;
  savedDataHash: string;
  /** False when the game content changed since the save: the same seed may now give a different world. */
  dataHashMatches: boolean;
}

export async function serializeSave(
  state: WorldState,
  meta: { dataHash: string; label: string; now: number },
  limits: ContainerLimits,
): Promise<{ bytes: Uint8Array; info: SaveInfo }> {
  const envelope = buildEnvelope(state, meta);
  const bytes = await encodeContainer(JSON.stringify(envelope), limits);
  return {
    bytes,
    info: {
      label: meta.label,
      savedAt: meta.now,
      seed: state.seed,
      tick: state.tick,
      stateHash: envelope.integrity.stateHash,
      saveVersion: envelope.saveVersion,
      engineVersion: envelope.engineVersion,
      dataHash: meta.dataHash,
      size: bytes.byteLength,
    },
  };
}

export interface DeserializeOptions {
  dataHash: string;
  limits: ContainerLimits;
  /** Overrides for tests of the migration chain. */
  migrations?: Readonly<Record<number, Migration>>;
  targetVersion?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function deserializeSave(
  bytes: Uint8Array,
  options: DeserializeOptions,
): Promise<{ state: WorldState; report: LoadReport }> {
  const text = await decodeContainer(bytes, options.limits);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError('corrupt', 'The save file is damaged (its contents are not valid JSON)');
  }
  if (!isRecord(raw) || raw['format'] !== 'opsim') {
    throw new SaveError('not-opsim', 'This is not an .opsim save file');
  }

  // Integrity, against the state as written (before any migration).
  const integrity = raw['integrity'];
  const storedHash =
    isRecord(integrity) && typeof integrity['stateHash'] === 'string' ? integrity['stateHash'] : '';
  const algo = isRecord(integrity) ? integrity['algo'] : undefined;
  if (storedHash === '') throw new SaveError('invalid', 'The save has no integrity checksum');
  if (algo === HASH_ALGO) {
    let writtenHash: string;
    try {
      writtenHash = hashValue(raw['state']);
    } catch (error) {
      if (error instanceof CanonicalError)
        throw new SaveError('invalid', `The save state is not plain data: ${error.message}`);
      throw error;
    }
    if (writtenHash !== storedHash) {
      throw new SaveError(
        'checksum',
        'The save does not match its checksum: the file is damaged or was edited after it was written',
      );
    }
  }

  const migrated = migrateEnvelope(
    raw as RawEnvelope,
    options.migrations,
    options.targetVersion ?? SAVE_VERSION,
  );

  const parsed = EnvelopeSchema.safeParse(migrated.envelope);
  if (!parsed.success) {
    const shown = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${formatPath(i.path)}: ${i.message}`)
      .join('; ');
    const more =
      parsed.error.issues.length > 3 ? ` (and ${parsed.error.issues.length - 3} more)` : '';
    throw new SaveError('invalid', `The save is not valid: ${shown}${more}`);
  }
  const envelope = parsed.data;
  const actualHash = hashValue(envelope.state);

  return {
    state: envelope.state,
    report: {
      label: envelope.label,
      seed: envelope.seed,
      tick: envelope.tick,
      savedAt: envelope.createdAt,
      saveVersion: envelope.saveVersion,
      migratedFrom: migrated.migrated ? migrated.from : null,
      engineVersion: envelope.engineVersion,
      storedHash,
      actualHash,
      hashMatches: actualHash === storedHash,
      savedDataHash: envelope.dataHash,
      dataHashMatches: envelope.dataHash === options.dataHash,
    },
  };
}

export interface SaveManagerDeps {
  counts: { autosaveSlots: number; manualSlots: number };
  limits: ContainerLimits;
  dataHash: string;
  now: () => number;
}

/** Slot-level operations over a SaveStore. */
export class SaveManager {
  constructor(
    readonly store: SaveStore,
    private readonly deps: SaveManagerDeps,
  ) {}

  /** Autosave slots first, then manual slots, each in numeric order. */
  async list(): Promise<SlotSummary[]> {
    const all = await this.store.list();
    const order = [
      ...slotIds('auto', this.deps.counts.autosaveSlots),
      ...slotIds('manual', this.deps.counts.manualSlots),
    ];
    return all
      .filter((s) => order.includes(s.slot))
      .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
  }

  async newest(): Promise<SlotSummary | null> {
    const all = await this.list();
    let best: SlotSummary | null = null;
    for (const s of all) {
      if (best === null || s.savedAt > best.savedAt) best = s;
    }
    return best;
  }

  private async write(
    slot: string,
    kind: SlotKind,
    state: WorldState,
    label: string,
  ): Promise<SlotSummary> {
    const { bytes, info } = await serializeSave(
      state,
      { dataHash: this.deps.dataHash, label, now: this.deps.now() },
      this.deps.limits,
    );
    const summary: SlotSummary = { slot, kind, ...info };
    await this.store.put(summary, bytes);
    return summary;
  }

  async saveManual(state: WorldState, slot: string, label: string): Promise<SlotSummary> {
    const kind = assertSlot(slot, this.deps.counts);
    if (kind !== 'manual')
      throw new SaveError('slot', 'Autosave slots are written automatically; choose a manual slot');
    return this.write(slot, kind, state, label);
  }

  async autosave(state: WorldState, label: string): Promise<SlotSummary> {
    const slot = pickAutosaveSlot(await this.store.list(), this.deps.counts.autosaveSlots);
    return this.write(slot, 'auto', state, label);
  }

  async load(slot: string): Promise<{ state: WorldState; report: LoadReport }> {
    assertSlot(slot, this.deps.counts);
    const bytes = await this.store.get(slot);
    if (!bytes) throw new SaveError('slot', `Slot "${slot}" is empty`);
    return this.decode(bytes);
  }

  async delete(slot: string): Promise<void> {
    assertSlot(slot, this.deps.counts);
    await this.store.delete(slot);
  }

  /** The save as file bytes: identical to what a slot stores. */
  async exportBytes(
    state: WorldState,
    label: string,
  ): Promise<{ filename: string; bytes: Uint8Array }> {
    const { bytes } = await serializeSave(
      state,
      { dataHash: this.deps.dataHash, label, now: this.deps.now() },
      this.deps.limits,
    );
    const seed =
      state.seed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'world';
    return { filename: `opsim-${seed}-tick${state.tick}.opsim`, bytes };
  }

  decode(bytes: Uint8Array): Promise<{ state: WorldState; report: LoadReport }> {
    return deserializeSave(bytes, { dataHash: this.deps.dataHash, limits: this.deps.limits });
  }
}
