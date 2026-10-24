import { dateOf } from '../../engine/calendar';
import type { Condition } from '../../engine/data/schemas';
import { statValue } from '../../engine/stats';
import {
  combatPowerOf,
  flagOf,
  humanAgeOf,
  livingRelations,
  relationKind,
  statTotal,
} from '../life/body';
import { shipsOf } from '../voyage/plan';
import { mouthsAboard, vesselNow } from '../voyage/progress';
import type { StoryCtx } from './context';

/**
 * Whether an event's condition holds (Phase 3: the plan's "drops those failing conditions").
 * Conditions about the player fail when there is no player, so a world event can only use the
 * ones about the world and its place.
 */

function inRange(value: number, min?: number, max?: number): boolean {
  return (min === undefined || value >= min) && (max === undefined || value <= max);
}

function flagValue(ctx: StoryCtx, flag: string) {
  return ctx.p ? flagOf(ctx.state, ctx.p.entity, flag) : ctx.state.flags[flag];
}

/** Canon characters alive at the player's place (not hidden away), in id order. */
export function canonHere(ctx: StoryCtx): string[] {
  const here = ctx.place?.location?.id;
  if (!here) return [];
  const out: string[] = [];
  for (const id of Object.keys(ctx.data.cast).sort()) {
    const e = ctx.state.entities[id];
    const c = e?.character;
    if (!e || !c?.alive || c.place !== here || id === ctx.state.playerId) continue;
    const status = e.flags['status'];
    if (status === 'imprisoned' || status === 'hidden') continue;
    out.push(id);
  }
  return out;
}

export function conditionHolds(ctx: StoryCtx, cond: Condition): boolean {
  const { state, data, tick, p, place, voyage } = ctx;
  switch (cond.kind) {
    case 'hasTrait':
      return p?.c.traits.includes(cond.trait) ?? false;
    case 'notTrait':
      return p ? !p.c.traits.includes(cond.trait) : true;
    case 'atLocation':
      return place?.location?.id === cond.location;
    case 'flag':
      return flagValue(ctx, cond.flag) === cond.equals;
    case 'notFlag':
      return flagValue(ctx, cond.flag) === undefined;
    case 'flagAtLeast': {
      const v = flagValue(ctx, cond.flag);
      return typeof v === 'number' && v >= cond.value;
    }
    case 'lane':
      return voyage !== null && cond.lanes.includes(voyage.lane);
    case 'region':
      return place !== null && (cond.regions as readonly string[]).includes(place.region);
    case 'atSea':
      return (voyage !== null) === cond.value;
    case 'travelMode':
      return voyage !== null && cond.modes.includes(voyage.mode);
    case 'ownShip':
      return p ? shipsOf(state, p.entity.id).length > 0 === cond.value : false;
    case 'age':
      return p ? inRange(humanAgeOf(data, p, tick), cond.min, cond.max) : false;
    case 'stat': {
      if (!p) return false;
      const value =
        cond.stat === 'combatPower'
          ? combatPowerOf(data, p.entity, tick)
          : statTotal(p.entity, cond.stat, tick);
      return inRange(value, cond.min, cond.max);
    }
    case 'canonMode':
      return cond.modes.includes(state.config.canonMode);
    case 'year':
      return inRange(dateOf(data.calendar, tick).year, cond.min, cond.max);
    case 'feature':
      return place !== null && cond.features.some((f) => place.features.includes(f));
    case 'danger':
      return place !== null && inRange(place.danger, cond.min, cond.max);
    case 'berries':
      return p ? p.c.berries >= cond.min : false;
    case 'relation':
      return p ? livingRelations(state, p.c, relationKind(cond.relation)).length > 0 : false;
    case 'noRelation':
      return p ? livingRelations(state, p.c, relationKind(cond.relation)).length === 0 : false;
    case 'morale': {
      const vessel = voyage ? vesselNow(state, voyage) : null;
      return vessel !== null && inRange(vessel.morale, cond.min, cond.max);
    }
    case 'supplies': {
      const vessel = voyage?.mode === 'own' ? vesselNow(state, voyage) : null;
      return vessel !== null && vessel.supplies / mouthsAboard(vessel) <= cond.max;
    }
    case 'climate':
      return place !== null && (cond.climates as readonly string[]).includes(place.climate);
    case 'season':
      return cond.seasons.includes(dateOf(data.calendar, tick).seasonId);
    case 'job':
      return p?.c.life?.job ? cond.jobs.includes(p.c.life.job.id) : false;
    case 'beat':
      return (state.canon.beats[cond.beat]?.status ?? 'pending') === cond.status;
    case 'canonHere':
      return canonHere(ctx).length > 0;
  }
}

export function allHold(ctx: StoryCtx, conditions: readonly Condition[]): boolean {
  return conditions.every((c) => conditionHolds(ctx, c));
}

/** A stat for checks and views: a stat's total (Luck included), or a derived value. */
export function statForCheck(ctx: StoryCtx, stat: string): number {
  const p = ctx.p;
  if (!p) return 0;
  if (stat === 'combatPower') return combatPowerOf(ctx.data, p.entity, ctx.tick);
  if (stat === 'navigation') {
    const nav =
      0.6 * statTotal(p.entity, 'intellect', ctx.tick) +
      0.4 * statTotal(p.entity, 'perception', ctx.tick);
    const sailor = p.c.traits.includes('trait_sea_legs') ? 5 : 0;
    const job = p.c.life?.job?.id === 'job_ships_hand' ? 5 : 0;
    return nav + sailor + job;
  }
  const s = p.entity.stats[stat];
  return s ? statValue(s, ctx.tick) : 0;
}
