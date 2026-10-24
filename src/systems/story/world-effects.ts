import type { GameData } from '../../engine/data/schemas';
import type { FlagValue, WorldState } from '../../engine/state';
import { addMod, makeStat } from '../../engine/stats';

/**
 * What events and canon beats do to the world rather than to a life (Phase 3): a faction grows or
 * weakens or changes its mind about another, a place changes hands, does better or worse, gains
 * or loses people. Every change to a number is a named modifier (rule 3), so the World tab can say
 * why the Marines are as strong as they are.
 */

export function factionChange(
  state: WorldState,
  org: string,
  change: {
    strength?: number | undefined;
    opinion?: { toward: string; value: number } | undefined;
  },
  source: string,
  tick: number,
  months?: number,
): boolean {
  const entity = state.entities[org];
  if (!entity?.org) return false;
  const expires = months !== undefined ? { expiresTick: tick + months } : {};
  if (change.strength !== undefined && change.strength !== 0) {
    const stat = (entity.stats['strength'] ??= makeStat(0));
    addMod(stat, { source, value: change.strength, kind: 'flat', ...expires });
  }
  if (change.opinion) {
    const stat = (entity.org.opinions[change.opinion.toward] ??= makeStat(0));
    addMod(stat, { source, value: change.opinion.value, kind: 'flat', ...expires });
  }
  return true;
}

export function setControl(state: WorldState, place: string, org: string | null): boolean {
  const entity = state.entities[place];
  if (!entity?.place) return false;
  entity.place.controller = org;
  return true;
}

export function prosperityChange(
  state: WorldState,
  place: string,
  value: number,
  source: string,
  tick: number,
  months?: number,
): boolean {
  const entity = state.entities[place];
  if (!entity?.place) return false;
  addMod(entity.place.prosperity, {
    source,
    value,
    kind: 'flat',
    ...(months !== undefined ? { expiresTick: tick + months } : {}),
  });
  return true;
}

/** A place's people (Tier 3) grow or shrink by a percentage, every age group and trade alike. */
export function populationChange(state: WorldState, place: string, pct: number): boolean {
  const entity = state.entities[place];
  if (!entity?.place) return false;
  const f = 1 + pct / 100;
  const r = entity.place.residents;
  r.children = Math.max(0, Math.round(r.children * f));
  r.adults = Math.max(0, Math.round(r.adults * f));
  r.elders = Math.max(0, Math.round(r.elders * f));
  for (const job of Object.keys(entity.place.jobs)) {
    entity.place.jobs[job] = Math.max(0, Math.round((entity.place.jobs[job] ?? 0) * f));
  }
  return true;
}

/** A flag on a place, optionally for a while (`<flag>.until` holds the month it ends). */
export function setLocalFlag(
  state: WorldState,
  place: string,
  flag: string,
  value: FlagValue,
  tick: number,
  months?: number,
): boolean {
  const entity = state.entities[place];
  if (!entity) return false;
  entity.flags[flag] = value;
  if (months !== undefined) entity.flags[`${flag}.until`] = tick + months;
  return true;
}

/** Whether a place's timed flag is still in force. */
export function localFlagActive(
  state: WorldState,
  place: string,
  flag: string,
  tick: number,
): boolean {
  const entity = state.entities[place];
  if (!entity || entity.flags[flag] === undefined) return false;
  const until = entity.flags[`${flag}.until`];
  return typeof until !== 'number' || until > tick;
}

export function factionName(data: GameData, state: WorldState, org: string | null): string {
  if (!org) return 'nobody in particular';
  return state.entities[org]?.name ?? data.factions[org]?.name ?? org;
}
