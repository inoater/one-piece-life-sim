import { dpow } from '../../engine/dmath';
import type { GameData } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { Entity, RelationKind, WorldState } from '../../engine/state';
import { statValue } from '../../engine/stats';
import { AGE_SOURCE, namedMod } from '../genesis/context';
import { numberWords } from '../genesis/text';
import {
  ageYears,
  humanAgeOf,
  isJailed,
  maxHealthOf,
  personOf,
  stageOf,
  statTotal,
  type Person,
} from './body';
import { lifeLog, renderLife, reportLine, withCause, type LifeEnv } from './env';
import { catchIllnesses, die, healMonth, mortalityCause, mortalityChance } from './health';
import { monthOfMoney } from './money';
import { makePerson, relate, relationWords } from './people';

/**
 * The passing of a month for the person being played and the people around them (step 7):
 * natural growth and later decline, birthdays and new stages of life, healing, illness, the
 * yearly mortality roll, money, children and younger siblings born, and relatives who die.
 */

function wealthGrowth(data: GameData, p: Person): number {
  const tier = data.creation.wealthTiers.find((t) => t.id === p.c.family?.wealth);
  return p.home.growthIntensity * (tier?.growthIntensity ?? 1);
}

/** Natural growth toward the natural ceiling, and the decline of later life, for one month. */
export function growMonth(data: GameData, p: Person, tick: number): void {
  const rules = data.character;
  const stage = stageOf(data, p, tick);
  const dh = humanAgeOf(data, p, tick + 1) - humanAgeOf(data, p, tick);
  if (dh <= 0) return;
  const growth =
    stage.growth > 0
      ? 1 - dpow(Math.max(0, 1 - Math.min(0.99, stage.growth * wealthGrowth(data, p))), dh)
      : 0;
  for (const id of [...rules.physical, ...rules.mental]) {
    const stat = p.entity.stats[id];
    const potential = p.c.hidden?.potential[id];
    if (!stat) continue;
    if (growth > 0 && potential) {
      const target = rules.naturalCeiling * statValue(potential, tick);
      if (target > stat.base)
        stat.base = Math.round((stat.base + growth * (target - stat.base)) * 1e4) / 1e4;
    }
    const decline = rules.physical.includes(id) ? stage.physicalDecline : stage.mentalDecline;
    if (decline > 0) {
      const mod = namedMod(stat, AGE_SOURCE);
      mod.value =
        Math.round((mod.value - decline * dh * statTotal(p.entity, id, tick)) * 1e4) / 1e4;
    }
  }
}

function birthday(env: LifeEnv): void {
  const { data, tick, p } = env;
  if (tick <= p.c.birthTick || (tick - p.c.birthTick) % 12 !== 0) return;
  const age = ageYears(p.c, tick);
  const text = renderLife(env, data.life.lines.birthday, { ageWords: numberWords(age) });
  lifeLog(env, text, { tags: ['personal', 'birthday'] });
  const before = stageOf(data, p, tick - 1);
  const now = stageOf(data, p, tick);
  if (before.id !== now.id) {
    const line = renderLife(env, data.life.lines.stage, { stage: now.name.toLowerCase() });
    lifeLog(env, line, { kind: 'event', tags: ['personal', 'stage'] });
    reportLine(env, line, 'good');
  }
  const max = maxHealthOf(data, p.entity, tick);
  const input = { data, state: env.state, p, tick, healthRatio: env.life.health / max };
  const rng = env.rng.fork('mortality', age);
  if (rng.chance(mortalityChance(input)))
    die(withCause(env, 'sys:mortality'), mortalityCause(input, rng.fork('cause')));
}

// ---- Family -------------------------------------------------------------------------------------

function siblingsDue(env: LifeEnv, rng: Rng): void {
  const { state, data, tick, p } = env;
  const family = p.c.family;
  if (!family) return;
  const due = family.expected.filter((e) => e.birthTick <= tick);
  if (due.length === 0) return;
  family.expected = family.expected.filter((e) => e.birthTick > tick);
  const parents = family.parentIds
    .map((id) => state.entities[id])
    .filter((e): e is Entity => e?.character?.alive === true);
  if (parents.length === 0) return;
  due.forEach((expected, i) => {
    const siblingRng = rng.fork('sibling', expected.birthTick, i);
    const sibling = makePerson(state, data, p, siblingRng, {
      pronouns: expected.pronouns,
      familyName: p.c.familyName,
      birthTick: tick,
    });
    relate(
      p.entity,
      sibling,
      'sibling',
      40 + siblingRng.int(-20, 30),
      tick,
      siblingRng.fork('relate'),
    );
    for (const parent of parents)
      relate(parent, sibling, 'child', 60, tick, siblingRng.fork('parent', parent.id));
    family.siblingIds.push(sibling.id);
    const text = renderLife(env, data.life.lines.siblingBorn, {
      sibling: relationWords(p.c, sibling, 'sibling'),
    });
    lifeLog(env, text, { kind: 'event', tags: ['family', 'birth'], others: [sibling.id] });
    reportLine(env, text, 'good');
  });
}

function childrenDue(env: LifeEnv, rng: Rng): void {
  const { state, data, tick, p, life } = env;
  const due = life.expecting.filter((t) => t <= tick);
  if (due.length === 0) return;
  life.expecting = life.expecting.filter((t) => t > tick);
  const spouse = p.c.relationships
    .filter((r) => r.kind === 'sweetheart')
    .map((r) => state.entities[r.id])
    .find((e) => e?.character?.alive && e.flags['married'] === true);
  due.forEach((_, i) => {
    const childRng = rng.fork('child', tick, i);
    const child = makePerson(state, data, p, childRng, {
      familyName: p.c.familyName,
      birthTick: tick,
    });
    relate(p.entity, child, 'child', 70, tick, childRng.fork('relate'));
    if (spouse) relate(spouse, child, 'child', 70, tick, childRng.fork('spouse'));
    const text = renderLife(env, data.life.lines.childBorn, { child: child.name });
    lifeLog(env, text, {
      kind: 'event',
      tags: ['family', 'birth', 'relationship'],
      others: [child.id],
    });
    reportLine(env, text, 'good');
  });
}

const FAMILY_KINDS = new Set<RelationKind>(['parent', 'sibling', 'child', 'guardian']);

/** Everyone the player knows ages; on their birthday, the same yearly roll as the player's. */
function relativesAge(env: LifeEnv, rng: Rng): void {
  const { state, data, tick, p } = env;
  for (const rel of p.c.relationships) {
    const other = state.entities[rel.id];
    const oc = other?.character;
    if (!other || !oc?.alive) continue;
    if (tick <= oc.birthTick || (tick - oc.birthTick) % 12 !== 0) continue;
    const person = personOf(data, other);
    if (!person) continue;
    const input = { data, state, p: person, tick, healthRatio: 1 };
    const roll = rng.fork('relative', other.id);
    if (!roll.chance(mortalityChance(input))) continue;
    const cause = mortalityCause(input, roll.fork('cause'));
    oc.alive = false;
    oc.death = { tick, cause };
    if (rel.kind === 'sweetheart') {
      delete other.flags['married'];
      delete p.entity.flags['married'];
    }
    const text = renderLife(env, data.life.lines.relativeDied, {
      other: relationWords(p.c, other, rel.kind),
      cause,
      age: String(ageYears(oc, tick)),
    });
    lifeLog(env, text, {
      kind: 'event',
      tags: [FAMILY_KINDS.has(rel.kind) ? 'family' : 'relationship', 'death'],
      others: [other.id],
    });
    reportLine(env, text, 'bad');
  }
}

function release(env: LifeEnv): void {
  const { life, tick, data } = env;
  if (life.jailedUntil !== null && life.jailedUntil === tick + 1) {
    const text = renderLife(env, data.life.lines.released);
    lifeLog(env, text, { tags: ['personal', 'crime'] });
    reportLine(env, text, 'good');
  }
  if (life.jailedUntil !== null && !isJailed(life, tick + 1)) life.jailedUntil = null;
}

function recordPeaks(env: LifeEnv): void {
  const { data, p, life, tick } = env;
  for (const id of [...data.character.physical, ...data.character.mental]) {
    const value = Math.round(statTotal(p.entity, id, tick) * 10) / 10;
    if (value > (life.peak[id] ?? 0)) life.peak[id] = value;
  }
}

/** One month of life for the player, after the events of the month (step 7). */
export function liveMonth(env: LifeEnv): void {
  const { data, p, tick } = env;
  const rng = env.rng;
  birthday(env);
  if (!p.c.alive) return;
  growMonth(data, p, tick);
  catchIllnesses(withCause(env, 'sys:illness', undefined, rng.fork('illness')));
  healMonth(withCause(env, 'sys:healing', undefined, rng.fork('heal')));
  if (!p.c.alive) return;
  monthOfMoney(withCause(env, 'sys:money', undefined, rng.fork('money')));
  if (!p.c.alive) return;
  release(env);
  siblingsDue(withCause(env, 'sys:birth'), rng.fork('siblings'));
  childrenDue(withCause(env, 'sys:birth'), rng.fork('children'));
  relativesAge(withCause(env, 'sys:mortality'), rng.fork('relatives'));
  recordPeaks(env);
  const max = maxHealthOf(data, p.entity, tick + 1);
  if (env.life.health > max) env.life.health = max;
}

/** Whether the world's player has died (time stops until they choose who to continue as). */
export function playerHasDied(state: WorldState): boolean {
  if (!state.playerId) return false;
  return state.entities[state.playerId]?.character?.alive === false;
}
