import { isKnownBy } from './knowledge';
import type { EventRecord, WorldState } from './state';
import { PUBLIC_KNOWLEDGE } from './state';

/**
 * The event log (rule 6). Every change that matters is a record with a tick, a kind, who was
 * involved and why. "Why did this character die?" is answered by reading the log, not by guessing.
 *
 * What gets logged: anything a player could reasonably ask "why?" about. Housekeeping that has no
 * story (a temporary modifier expiring) is not logged.
 */

export interface LogInput {
  kind: string;
  summary: string;
  tags?: string[];
  actorIds?: string[];
  targetIds?: string[];
  place?: string | null;
  cause?: string;
  causeSeq?: number;
  knownBy?: string[];
}

export function appendLog(state: WorldState, tick: number, input: LogInput): EventRecord {
  const record: EventRecord = {
    seq: state.counters.logSeq,
    tick,
    kind: input.kind,
    actorIds: input.actorIds ?? [],
    targetIds: input.targetIds ?? [],
    place: input.place ?? null,
    summary: input.summary,
    tags: input.tags ?? [],
    knownBy: input.knownBy ?? [PUBLIC_KNOWLEDGE],
  };
  if (input.cause !== undefined) record.cause = input.cause;
  if (input.causeSeq !== undefined) record.causeSeq = input.causeSeq;
  state.counters.logSeq += 1;
  state.log.push(record);
  return record;
}

export interface LogFilter {
  fromTick?: number;
  toTick?: number;
  /** Matches records where this entity is an actor or a target. */
  entityId?: string;
  tag?: string;
  kind?: string;
  /** Case-insensitive text search in the summary. */
  text?: string;
}

export function matchesFilter(record: EventRecord, filter: LogFilter): boolean {
  if (filter.fromTick !== undefined && record.tick < filter.fromTick) return false;
  if (filter.toTick !== undefined && record.tick > filter.toTick) return false;
  if (filter.kind && record.kind !== filter.kind) return false;
  if (filter.tag && !record.tags.includes(filter.tag)) return false;
  if (
    filter.entityId &&
    !record.actorIds.includes(filter.entityId) &&
    !record.targetIds.includes(filter.entityId)
  ) {
    return false;
  }
  if (filter.text && !record.summary.toLowerCase().includes(filter.text.toLowerCase()))
    return false;
  return true;
}

export interface Viewer {
  playerId: string | null;
  omniscient: boolean;
}

/** Records matching the filter that this viewer is allowed to see. */
export function queryLog(state: WorldState, filter: LogFilter, viewer: Viewer): EventRecord[] {
  return state.log.filter(
    (record) =>
      matchesFilter(record, filter) &&
      isKnownBy(record.knownBy, viewer.playerId, viewer.omniscient),
  );
}

/** Walk `causeSeq` links back from a record: [the record, its cause, the cause's cause, ...]. */
export function explainChain(state: WorldState, seq: number): EventRecord[] {
  const bySeq = new Map<number, EventRecord>();
  for (const record of state.log) bySeq.set(record.seq, record);
  const chain: EventRecord[] = [];
  let current = bySeq.get(seq);
  const seen = new Set<number>();
  while (current && !seen.has(current.seq)) {
    chain.push(current);
    seen.add(current.seq);
    current = current.causeSeq === undefined ? undefined : bySeq.get(current.causeSeq);
  }
  return chain;
}
