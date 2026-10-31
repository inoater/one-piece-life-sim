import type { EventDef } from '../../engine/data/schemas';
import { crewEffect } from '../crew/fx';
import type { Rng } from '../../engine/rng';
import { laneZone } from '../places/graph';
import { allHold } from './conditions';
import type { StoryCtx } from './context';
import { canCast } from './roles';

/**
 * Choosing the month's events (Phase 3, the plan's event engine): collect the events of a trigger,
 * drop those whose conditions fail (or that are cooling down, or have happened once already),
 * multiply each weight by its modifiers (its own `weightMods`, the place's event tags, the
 * player's traits and, at sea, the lane's danger), then pick a number of them without repeats.
 */

const SEA_PERIL = new Set(['hazard', 'encounter', 'weather']);

export function eventWeight(ctx: StoryCtx, def: EventDef): number {
  const { data, p, place, lane } = ctx;
  let weight = def.weight;
  for (const mod of def.weightMods) if (allHold(ctx, mod.when)) weight *= mod.mult;
  const placeTags = place?.location?.eventTags ?? {};
  for (const tag of def.tags) {
    weight *= placeTags[tag] ?? 1;
    if (p) for (const trait of p.c.traits) weight *= data.traits[trait]?.eventWeights[tag] ?? 1;
  }
  if (lane && def.tags.some((t) => SEA_PERIL.has(t))) {
    weight *= 1 + data.travel.dangerWeight * lane.danger;
  }
  return weight;
}

/** Events of this trigger that could happen now, in id order. */
export function candidates(
  ctx: StoryCtx,
  trigger: EventDef['trigger'],
  filter: (def: EventDef) => boolean = () => true,
): EventDef[] {
  const { data, state, tick } = ctx;
  const out: EventDef[] = [];
  for (const id of Object.keys(data.events).sort()) {
    const def = data.events[id] as EventDef;
    if (def.trigger !== trigger || !filter(def)) continue;
    const seen = state.eventState[id];
    if (seen && def.once) continue;
    if (seen && def.cooldown > 0 && tick - seen.last < def.cooldown) continue;
    if (!allHold(ctx, def.conditions)) continue;
    if (!canCast(ctx, def)) continue;
    out.push(def);
  }
  return out;
}

/** How many events this month, from weights for 0, 1, 2, 3. */
export function rollCount(rng: Rng, weights: readonly number[]): number {
  const counts = weights.map((w, n) => ({ n, w }));
  return rng.weightedPick(counts, (c) => c.w)?.n ?? 0;
}

/** Voyage-event rolls this month: the base, plus the sea's danger modifier (fractions are chances). */
export function voyageRolls(ctx: StoryCtx, rng: Rng): number {
  const { data, lane } = ctx;
  const zone = lane ? laneZone(data, lane) : (ctx.place?.region ?? 'east_blue');
  // Phase 8: a lookout in the crow's nest (with a crew of one's own) steers clear of trouble.
  const lookout = ctx.voyage?.mode === 'own' ? crewEffect(ctx.state, data, 'sea.danger') : 0;
  const extra = Math.max(
    0,
    (data.travel.regionDanger[zone as keyof typeof data.travel.regionDanger] ?? 0) + lookout,
  );
  const whole = Math.floor(extra);
  return data.travel.baseEvents + whole + (rng.chance(extra - whole) ? 1 : 0);
}

/**
 * Pick up to `count` distinct events by weight. Each pick may come up "nothing" with the given
 * weight against them (a quiet month at sea).
 */
export function pickEvents(
  ctx: StoryCtx,
  rng: Rng,
  pool: readonly EventDef[],
  count: number,
  quietWeight = 0,
): EventDef[] {
  const left = [...pool];
  const out: EventDef[] = [];
  for (let i = 0; i < count && left.length > 0; i++) {
    const options: (EventDef | null)[] = [null, ...left];
    const pick = rng
      .fork('pick', i)
      .weightedPick(options, (def) => (def === null ? quietWeight : eventWeight(ctx, def)));
    if (!pick) continue;
    out.push(pick);
    left.splice(left.indexOf(pick), 1);
  }
  return out;
}
