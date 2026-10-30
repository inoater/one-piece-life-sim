import type { GameData, Trait, TraitGate } from '../../engine/data/schemas';
import type { CharacterData, Entity } from '../../engine/state';
import { statTotal } from './body';
import { lifeLog, renderLife, reportLine, type LifeEnv } from './env';
import { giveTraitTo, removeTrait } from './traits';
import { deedHook } from '../heart/hooks';

/**
 * Personality drift and earned traits (Phase 4).
 *
 * Hidden counters (rule 4: never shown) run along axes such as courage, from cowardly to brave.
 * Each choice or outcome tagged "brave", "cruel", "honest" nudges one; crossing a trait's `gainAt`
 * grants the trait with a line in the chronicle, and falling back past its `loseAt` takes it away
 * ("You no longer flinch at a raised fist"). Counters fall back toward zero a little each year,
 * so who someone is follows what they have done lately.
 *
 * Behaviour counters count months of a behaviour (Hard training, a job, time at sea) and things
 * that happen (fights, severe injuries). An earned trait arrives once its counters are reached;
 * an evolving trait (Brawler, Street Fighter, Iron Fist) grows into the next one.
 */

export interface Personality {
  axes: Record<string, number>;
  counters: Record<string, number>;
}

/** The traits that drift, earn and evolve, in id order: worked out once per data set. */
const lists = new WeakMap<GameData, { drift: Trait[]; earn: Trait[] }>();
function traitLists(data: GameData): { drift: Trait[]; earn: Trait[] } {
  let found = lists.get(data);
  if (!found) {
    const all = Object.keys(data.traits)
      .sort()
      .map((id) => data.traits[id] as Trait);
    found = { drift: all.filter((t) => t.drift), earn: all.filter((t) => t.earn) };
    lists.set(data, found);
  }
  return found;
}

export function ensurePersonality(c: CharacterData): Personality {
  c.personality ??= { axes: {}, counters: {} };
  return c.personality;
}

/** A starting personality trait sets its counter where the trait sits, so it lasts until drift. */
export function seedPersonality(data: GameData, c: CharacterData): void {
  const p = ensurePersonality(c);
  for (const id of c.traits) {
    const drift = data.traits[id]?.drift;
    if (!drift) continue;
    const now = p.axes[drift.axis] ?? 0;
    // A little past the threshold, so who someone starts as lasts a few years without reinforcement.
    const start = drift.gainAt * 1.5;
    p.axes[drift.axis] = drift.gainAt > 0 ? Math.max(now, start) : Math.min(now, start);
  }
}

/** Who can be told: the player's month, or nobody. */
export interface DriftCtx {
  data: GameData;
  entity: Entity;
  c: CharacterData;
  tick: number;
  env?: LifeEnv;
}

export function driftCtxOf(env: LifeEnv): DriftCtx {
  return { data: env.data, entity: env.p.entity, c: env.p.c, tick: env.tick, env };
}

function say(ctx: DriftCtx, text: string, tone: 'good' | 'bad' | 'plain', tag: string): void {
  if (!ctx.env) return;
  lifeLog(ctx.env, text, { kind: 'event', tags: ['personal', 'trait', tag] });
  reportLine(ctx.env, text, tone);
}

function render(ctx: DriftCtx, template: string, title: string): string {
  return ctx.env ? renderLife(ctx.env, template, { title }) : template.replace('{title}', title);
}

/** Grant or remove personality traits whose counters have crossed their thresholds. */
export function checkDrift(ctx: DriftCtx): void {
  const { data, c } = ctx;
  const p = ensurePersonality(c);
  for (const trait of traitLists(data).drift) {
    const id = trait.id;
    const drift = trait.drift;
    if (!drift) continue;
    const value = p.axes[drift.axis] ?? 0;
    const held = c.traits.includes(id);
    const past = (at: number) => (drift.gainAt > 0 ? value >= at : value <= at);
    if (!held && past(drift.gainAt)) {
      if (giveTraitTo(data, ctx.entity, id, 'Who you have become', ctx.tick)) {
        say(
          ctx,
          render(ctx, trait.gainText ?? data.personality.lines.gained, trait.name),
          'plain',
          'drift-gained',
        );
      }
    } else if (held && !past(drift.loseAt)) {
      if (removeTrait(data, ctx.entity, id)) {
        say(
          ctx,
          render(ctx, trait.loseText ?? data.personality.lines.lost, trait.name),
          'plain',
          'drift-lost',
        );
      }
    }
  }
}

/** Choices and outcomes tagged "brave", "greedy"... nudge the hidden counters. */
export function drift(ctx: DriftCtx, tags: readonly string[]): void {
  const { data } = ctx;
  const p = ensurePersonality(ctx.c);
  let moved = false;
  for (const tag of tags) {
    const rule = data.personality.tags[tag];
    if (!rule) continue;
    const axis = data.personality.axes.find((a) => a.id === rule.axis);
    const max = axis?.max ?? 30;
    const next = Math.max(-max, Math.min(max, (p.axes[rule.axis] ?? 0) + rule.by));
    p.axes[rule.axis] = Math.round(next * 100) / 100;
    moved = true;
  }
  if (moved) checkDrift(ctx);
  // Phase 7: the same deed weighs on the conscience and is talked about where it happened.
  if (ctx.env && tags.length > 0) deedHook.fire?.(ctx.env, tags, ctx.env.causeSeq);
}

/** Add to a behaviour counter (fights, severe injuries, months of Hard training). */
export function countBehaviour(c: CharacterData, counter: string, by = 1): void {
  const p = ensurePersonality(c);
  p.counters[counter] = (p.counters[counter] ?? 0) + by;
}

function gateHolds(ctx: DriftCtx, gate: TraitGate, heldSince?: number): boolean {
  const p = ensurePersonality(ctx.c);
  for (const [counter, min] of Object.entries(gate.counters)) {
    if ((p.counters[counter] ?? 0) < min) return false;
  }
  for (const [stat, min] of Object.entries(gate.stats)) {
    if (statTotal(ctx.entity, stat, ctx.tick) < (min ?? 0)) return false;
  }
  if (gate.months > 0 && (heldSince === undefined || ctx.tick - heldSince < gate.months))
    return false;
  return true;
}

/** Earned traits whose behaviour has been repeated enough, and traits that grow into others. */
export function checkEarned(ctx: DriftCtx): void {
  const { data, c } = ctx;
  for (const trait of traitLists(data).earn) {
    const id = trait.id;
    if (trait.earn && !c.traits.includes(id) && gateHolds(ctx, trait.earn)) {
      if (giveTraitTo(data, ctx.entity, id, 'Earned by what you kept doing', ctx.tick)) {
        say(
          ctx,
          render(ctx, trait.gainText ?? data.personality.lines.gained, trait.name),
          'good',
          'earned',
        );
      }
    }
  }
  for (const id of [...c.traits]) {
    const trait = data.traits[id];
    const evolves = trait?.evolves;
    if (!trait || !evolves || !c.traits.includes(id)) continue;
    if (!gateHolds(ctx, evolves.when, c.traitInfo?.[id]?.tick)) continue;
    const next = data.traits[evolves.to];
    if (!next) continue;
    // Already grown past it (the next form, or one further along, earned another way): it falls away.
    if (heldLaterInChain(data, c.traits, evolves.to)) {
      removeTrait(data, ctx.entity, id);
      continue;
    }
    removeTrait(data, ctx.entity, id);
    if (giveTraitTo(data, ctx.entity, evolves.to, `Grew out of ${trait.name}`, ctx.tick)) {
      const text = ctx.env
        ? renderLife(ctx.env, next.gainText ?? data.personality.lines.evolved, {
            title: next.name,
            other: trait.name,
          })
        : data.personality.lines.evolved;
      say(ctx, text, 'good', 'evolved');
    } else {
      giveTraitTo(data, ctx.entity, id, 'Kept', ctx.tick);
    }
  }
}

/** Whether this trait, or anything it grows into, is held. */
function heldLaterInChain(data: GameData, held: readonly string[], from: string): boolean {
  const seen = new Set<string>();
  for (let id: string | undefined = from; id && !seen.has(id); id = data.traits[id]?.evolves?.to) {
    if (held.includes(id)) return true;
    seen.add(id);
  }
  return false;
}

/**
 * The month's behaviour (step 7): count what was done this month, let the counters fall back a
 * little toward zero, and check what that earns or changes.
 */
export function behaviourMonth(env: LifeEnv): void {
  const { data, p, life, tick } = env;
  const pers = ensurePersonality(p.c);
  const done = (life.report?.tick === tick ? life.report.done : []).map((d) => {
    const actId = d.id.split('#')[0] ?? '';
    const act = data.activities[actId];
    const job = data.jobs[actId];
    return {
      actId,
      effort: d.effort,
      tags: act?.tags ?? job?.tags ?? [],
      category: act?.category ?? (job ? 'work' : undefined),
    };
  });
  for (const counter of data.personality.counters) {
    if (counter.manual) continue;
    if (counter.atSea !== undefined && counter.atSea !== p.place.atSea) continue;
    const hit = done.some((d) => {
      if (counter.effort && d.effort !== counter.effort) return false;
      if (counter.activities.length > 0 && !counter.activities.includes(d.actId)) return false;
      if (
        counter.categories.length > 0 &&
        (!d.category || !counter.categories.includes(d.category))
      )
        return false;
      if (counter.tags.length > 0 && !counter.tags.some((t) => d.tags.includes(t))) return false;
      return true;
    });
    const always =
      counter.activities.length === 0 &&
      counter.categories.length === 0 &&
      counter.tags.length === 0 &&
      counter.effort === undefined;
    if (hit || (always && counter.atSea !== undefined))
      pers.counters[counter.id] = (pers.counters[counter.id] ?? 0) + 1;
  }
  for (const axis of data.personality.axes) {
    const now = pers.axes[axis.id];
    if (now === undefined || now === 0) continue;
    pers.axes[axis.id] = Math.round(now * (1 - axis.decayPerYear / 12) * 1000) / 1000;
  }
  const ctx = driftCtxOf(env);
  checkDrift(ctx);
  checkEarned(ctx);
}
