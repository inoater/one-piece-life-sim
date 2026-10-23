import { z } from 'zod';
import { hashValue } from '../canonical';
import { WorldStateSchema, type WorldState } from '../state';
import { ENGINE_VERSION, HASH_ALGO, SAVE_VERSION } from '../version';

/**
 * What goes inside the gzip: a small header of facts about the save, then the state.
 *
 * `seed` and `saveVersion` are required by the plan. The rest earns its place:
 *  - integrity.stateHash proves the state was not damaged or hand-edited;
 *  - dataHash records which content the world was made with. "Same seed, same world" only holds
 *    for the same seed AND the same data AND the same engine, so a mismatch is surfaced to the
 *    player as a warning rather than silently loading a subtly different world;
 *  - createdAt is wall-clock metadata and is never part of the state hash.
 */

export const EnvelopeSchema = z.strictObject({
  format: z.literal('opsim'),
  saveVersion: z.number().int().min(1),
  engineVersion: z.string(),
  dataHash: z.string(),
  createdAt: z.number().int(),
  label: z.string(),
  seed: z.string().min(1),
  tick: z.number().int(),
  integrity: z.strictObject({ algo: z.string(), stateHash: z.string() }),
  state: WorldStateSchema,
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

export interface EnvelopeMeta {
  dataHash: string;
  label: string;
  /** Wall-clock time in ms, supplied by the host (the engine does not read the clock). */
  now: number;
}

export function buildEnvelope(state: WorldState, meta: EnvelopeMeta): Envelope {
  return {
    format: 'opsim',
    saveVersion: SAVE_VERSION,
    engineVersion: ENGINE_VERSION,
    dataHash: meta.dataHash,
    createdAt: meta.now,
    label: meta.label,
    seed: state.seed,
    tick: state.tick,
    integrity: { algo: HASH_ALGO, stateHash: hashValue(state) },
    state,
  };
}
