import type { GameData } from '../../engine/data/schemas';
import type { CurseId } from '../../engine/data/defs';
import type { Rng } from '../../engine/rng';
import type { Entity, WorldState } from '../../engine/state';
import { formatBerries } from '../genesis/text';
import { statTotal } from '../life/body';
import { lifeLog, pay, renderLife, reportLine, withCause, type LifeEnv } from '../life/env';
import { injure } from '../life/health';
import { drift, driftCtxOf } from '../life/personality';
import { HAKI_TRACKS, hakiAwake, trackStateOf } from '../powers/state';
import { carried, ensureHands, HandsError, itemOf, itemStory } from './items';

/**
 * Cursed blades (Phase 6). A curse is a data block (data/hands.json `curses`): what it does to
 * whoever carries the blade untamed (a flag the curse's events read, a monthly mischance, a pull in
 * a fight), and how it is tamed: a test of fate (misfortune), a will strong enough to hold it
 * (haki hunger), its pull refused fight after fight (bloodthirst), or a priest's rite (haunting).
 * Tamed, the blade keeps its power and stops fighting its wielder.
 */

/** The untamed cursed blades a person carries. */
export function cursedBlades(state: WorldState, entity: Entity): Entity[] {
  return carried(state, entity).filter((i) => i.item?.curse && !i.item.curse.tamed);
}

export function cursesOn(state: WorldState, entity: Entity): Set<CurseId> {
  return new Set(cursedBlades(state, entity).map((i) => i.item?.curse?.id as CurseId));
}

/** The flags the curses' events read: set while an untamed blade of the curse is carried. */
export function syncCurseFlags(state: WorldState, data: GameData, entity: Entity): void {
  const on = cursesOn(state, entity);
  for (const [id, rule] of Object.entries(data.hands.curses)) {
    if (on.has(id as CurseId)) entity.flags[rule.flag] = true;
    else delete entity.flags[rule.flag];
  }
}

export function tameBlade(env: LifeEnv, item: Entity): void {
  const curse = item.item?.curse;
  if (!curse || curse.tamed) return;
  curse.tamed = true;
  itemStory(item, env.tick, `Tamed by ${env.p.entity.name}.`);
  const text = renderLife(env, env.data.hands.lines['tamed'] ?? '', { item: item.name });
  lifeLog(env, text, { kind: 'event', tags: ['personal', 'curse', 'deed'] });
  reportLine(env, text, 'good');
  env.p.c.life?.deeds.push({ tick: env.tick, text });
  syncCurseFlags(env.state, env.data, env.p.entity);
}

function armamentLevel(entity: Entity): number {
  const c = entity.character;
  if (!c || !hakiAwake(c, 'armament')) return 0;
  return (trackStateOf(c, HAKI_TRACKS.armament)?.stage ?? 0) + 1;
}

/**
 * The curses' month: each untamed curse may make mischief; a will grown strong enough masters a
 * hungry blade; enough refusals tame a bloodthirsty one.
 */
export function curseMonth(env: LifeEnv): void {
  const { state, data, p, tick, rng } = env;
  syncCurseFlags(state, data, p.entity);
  for (const item of cursedBlades(state, p.entity)) {
    const curse = item.item?.curse;
    if (!curse) continue;
    const rule = data.hands.curses[curse.id];
    if (!rule) continue;
    const roll = rng.fork('curse', item.id);
    if (rule.tame.kind === 'will') {
      if (
        statTotal(p.entity, 'willpower', tick) >= rule.tame.willpower &&
        armamentLevel(p.entity) >= rule.tame.armament
      ) {
        tameBlade(env, item);
        continue;
      }
    }
    if (rule.tame.kind === 'checks') {
      const passed = p.entity.flags[`${rule.flag}.checks`];
      const total = (typeof passed === 'number' ? passed : 0) + curse.checks;
      if (total >= rule.tame.checks) {
        delete p.entity.flags[`${rule.flag}.checks`];
        tameBlade(env, item);
        continue;
      }
    }
    if (!roll.fork('mischief').chance(rule.monthly)) continue;
    mischief(env, curse.id, item, roll);
  }
}

function mischief(env: LifeEnv, id: CurseId, item: Entity, rng: Rng): void {
  const { p } = env;
  switch (id) {
    case 'misfortune':
      injure(withCause(env, `curse:${item.id}`, undefined, rng.fork('accident')), {
        severity: 'minor',
        area: 'roll',
        cause: 'accident',
      });
      reportLine(env, `Bad luck dogs whoever carries ${item.name}.`, 'bad');
      break;
    case 'haki_hunger':
      env.life.health = Math.max(1, env.life.health * 0.92);
      reportLine(env, `${item.name} drank from you this month; you feel it in your arm.`, 'bad');
      break;
    case 'bloodthirst':
      drift(driftCtxOf(env), ['cruel']);
      reportLine(env, `${item.name} pulls at you. You are a little harder than you were.`, 'bad');
      break;
    case 'haunting':
      env.life.health = Math.max(1, env.life.health * 0.95);
      p.entity.flags['curse.sleepless'] = env.tick;
      reportLine(env, `Another month of dreams that are not yours, from ${item.name}.`, 'bad');
      break;
  }
}

/**
 * Misfortune's test: toss the blade and hold out your arm. Luck decides; most lose, and the blade
 * takes the arm's measure on the way down. Once a month at most.
 */
export function testFate(env: LifeEnv, itemId: string): boolean {
  const { state, data, p, tick } = env;
  const item = itemOf(state, itemId);
  const curse = item?.item?.curse;
  if (!item || item.item?.holderId !== p.entity.id) throw new HandsError('You do not carry that');
  if (!curse || curse.tamed) throw new HandsError('That blade has nothing to test you with');
  const rule = data.hands.curses[curse.id];
  if (rule?.tame.kind !== 'fate')
    throw new HandsError(`${rule?.name ?? 'Its curse'} is not tamed that way`);
  const hands = ensureHands(p.entity);
  if (hands.last[`fate:${item.id}`] === tick)
    throw new HandsError('Fate will not be asked twice in a month');
  hands.last[`fate:${item.id}`] = tick;
  const luck = statTotal(p.entity, 'luck', tick);
  const roll = env.rng.fork('fate', item.id).int(1, 100) + Math.round((luck - 50) / 2);
  if (roll >= rule.tame.luck) {
    tameBlade(env, item);
    return true;
  }
  injure(withCause(env, `curse:${item.id}`, undefined, env.rng.fork('fateCut')), {
    severity: 'serious',
    area: 'arms',
    cause: 'accident',
  });
  const text = renderLife(env, data.hands.lines['fateFailed'] ?? '', { item: item.name });
  lifeLog(env, text, { tags: ['personal', 'curse'] });
  reportLine(env, text, 'bad');
  return false;
}

/** Haunting's rite: a priest at one of the old shrines quiets what lives in the steel. */
export function cleanse(env: LifeEnv, itemId: string): void {
  const { state, data, p } = env;
  const item = itemOf(state, itemId);
  const curse = item?.item?.curse;
  if (!item || item.item?.holderId !== p.entity.id) throw new HandsError('You do not carry that');
  if (!curse || curse.tamed) throw new HandsError('There is nothing in it to quiet');
  const rule = data.hands.curses[curse.id];
  if (rule?.tame.kind !== 'ritual')
    throw new HandsError(`${rule?.name ?? 'Its curse'} is not lifted that way`);
  const here = p.place.location?.id;
  if (!here || !rule.tame.places.includes(here))
    throw new HandsError(
      `Only the priests at ${rule.tame.places.map((id) => data.locations[id]?.name ?? id).join(', ')} know the rite`,
    );
  if (p.c.berries < rule.tame.cost)
    throw new HandsError(`The rite costs ${formatBerries(rule.tame.cost)} Berries`);
  pay(env, -rule.tame.cost);
  tameBlade(env, item);
}

/**
 * A fight begins with a bloodthirsty blade in hand: unless the wielder already means to kill, a
 * Willpower check against its pull. Failing, they fight to kill; passing counts toward taming it.
 * Returns the intent to fight with.
 */
export function bloodthirstIntent<T extends string>(
  state: WorldState,
  data: GameData,
  entity: Entity,
  intent: T,
  rng: Rng,
  tick: number,
): T | 'kill' {
  if (intent === 'kill') return intent;
  const blade = cursedBlades(state, entity).find((i) => i.item?.curse?.id === 'bloodthirst');
  const rule = data.hands.curses.bloodthirst;
  if (!blade?.item?.curse || !rule) return intent;
  const will = statTotal(entity, 'willpower', tick);
  const chance = Math.max(0.05, Math.min(0.95, 0.5 + (will - rule.tame.difficulty) / 40));
  if (rng.fork('bloodthirst', blade.id, tick).chance(chance)) {
    blade.item.curse.checks += 1;
    return intent;
  }
  return 'kill';
}
