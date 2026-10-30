import type { GameData } from '../../engine/data/schemas';
import { createEntity } from '../../engine/entities';
import { appendLog } from '../../engine/log';
import type { CharacterData, Entity } from '../../engine/state';
import { makeStat, STAT_IDS } from '../../engine/stats';
import { formatBerries } from '../genesis/text';
import { rollPronouns } from '../genesis/family';
import { ageYears, type Person } from '../life/body';
import { lifeLog, pay, reportLine, type LifeEnv } from '../life/env';
import { relate } from '../life/people';
import { priceMult } from '../places/place';
import { markMet } from './bonds';
import { ensureHeart } from './profile';
import { renderHeart } from './speech';

/**
 * Animal companions (Phase 7): pets, mounts and fighting partners, each a small person of its own
 * (an entity with a character block flagged as an animal), with a personality, a relationship
 * record and a bond that grows with time together. Fighting partners stand beside the player in a
 * fight; some can eat a Devil Fruit. They live as long as their kind does.
 */

export class CompanionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompanionError';
  }
}

export type Species = GameData['heart']['companions'][number];

/** The kinds of animal to be had where the player stands. */
export function speciesHere(data: GameData, p: Person): Species[] {
  if (p.place.atSea) return [];
  const here = p.place.location?.id;
  return data.heart.companions.filter(
    (s) =>
      (here !== undefined && s.places.includes(here)) ||
      s.features.some((f) => (p.place.features as readonly string[]).includes(f)),
  );
}

export function speciesOf(data: GameData, entity: Entity): Species | undefined {
  const id = entity.flags['animal'];
  return typeof id === 'string' ? data.heart.companions.find((s) => s.id === id) : undefined;
}

export function companionPrice(env: Pick<LifeEnv, 'state' | 'data' | 'p'>, s: Species): number {
  return Math.round(s.price * priceMult(env.state, env.data, env.p.place.location?.id ?? ''));
}

/** Take an animal on: bought, or (a dugong that lost to you) simply following you home. */
export function takeCompanion(env: LifeEnv, speciesId: string, name?: string): Entity {
  const { state, data, tick, p } = env;
  const s = speciesHere(data, p).find((x) => x.id === speciesId);
  if (!s) throw new CompanionError('There is no such animal to be had here');
  const owned = p.c.relationships.filter(
    (r) => r.kind === 'companion' && state.entities[r.id]?.character?.alive,
  );
  if (owned.length >= 3)
    throw new CompanionError('Three animals are as many as anyone can look after');
  const price = companionPrice(env, s);
  if (p.c.berries < price) throw new CompanionError(`It costs ${formatBerries(price)} Berries`);
  pay(env, -price);
  const rng = env.rng.fork('companion', s.id, tick);
  const given =
    (name ?? '').trim().slice(0, 30) || rng.fork('name').pick(data.heart.companionNames);
  const stats: Record<string, ReturnType<typeof makeStat>> = {};
  for (const id of STAT_IDS) stats[id] = makeStat(s.stats[id] ?? 10);
  const entity = createEntity(state, {
    type: 'character',
    origin: 'generated',
    name: `${given} the ${s.name}`,
    tier: 2,
    stats,
    flags: { animal: s.id },
    knownBy: [p.entity.id],
  });
  const age = rng.fork('age').int(1, Math.max(1, Math.floor(s.lifespan / 4)));
  const character: CharacterData = {
    givenName: given,
    familyName: '',
    pronouns: rollPronouns(rng.fork('pronouns')),
    race: p.c.race,
    birthTick: tick - age * 12,
    birthplace: p.c.birthplace,
    alive: true,
    traits: [],
    appearance: {},
    scars: [],
    relationships: [],
    berries: 0,
  };
  if (p.place.location) character.place = p.place.location.id;
  entity.character = character;
  const heart = ensureHeart(state, data, entity);
  heart.species = s.id;
  heart.profile.romance = false;
  relate(p.entity, entity, 'companion', 50, tick, rng.fork('relate'));
  const text = renderHeart(state, data, entity, data.heart.lines.companion, rng.fork('line'));
  const record = lifeLog(env, text, {
    kind: 'event',
    tags: ['personal', 'relationship', 'companion'],
    others: [entity.id],
  });
  reportLine(env, text, 'good');
  markMet(p.entity, entity, record.seq);
  return entity;
}

/** A companion that can eats a Devil Fruit the player carries: no ordinary animal any more. */
export function feedFruit(env: LifeEnv, companionId: string, fruitId: string): void {
  const { state, data, tick, p } = env;
  const pet = state.entities[companionId];
  const s = pet ? speciesOf(data, pet) : undefined;
  if (!pet?.character?.alive || !s || !p.c.relationships.some((r) => r.id === companionId))
    throw new CompanionError('That is not your companion');
  if (!s.canEatFruit) throw new CompanionError(`A ${s.name} will not eat it`);
  if (pet.flags['fruit.user'] !== undefined) throw new CompanionError('It has eaten one already');
  const fruit = state.entities[fruitId];
  const powers = p.c.powers;
  if (!fruit?.fruit || !powers?.items.includes(fruitId) || fruit.fruit.holderId !== p.entity.id)
    throw new CompanionError('You do not carry that fruit');
  powers.items = powers.items.filter((id) => id !== fruitId);
  fruit.fruit.container = 'eaten';
  fruit.fruit.holderId = null;
  fruit.fruit.userId = pet.id;
  fruit.fruit.history.push({ tick, text: `Eaten by ${pet.name}.` });
  pet.flags['fruit.user'] = fruit.id;
  for (const stat of ['strength', 'durability', 'speed']) {
    const st = pet.stats[stat];
    if (st) st.base = Math.round((st.base + 15) * 10) / 10;
  }
  const text = renderHeart(
    state,
    data,
    pet,
    data.heart.lines.companionFruit,
    env.rng.fork('fruit'),
  );
  lifeLog(env, text, { kind: 'event', tags: ['personal', 'companion', 'fruit'], others: [pet.id] });
  reportLine(env, text, 'good');
}

/** Companions grow old by their own kind's years. */
export function companionsAge(env: LifeEnv): void {
  const { state, data, tick, p } = env;
  for (const rel of p.c.relationships) {
    if (rel.kind !== 'companion') continue;
    const pet = state.entities[rel.id];
    const s = pet ? speciesOf(data, pet) : undefined;
    const c = pet?.character;
    if (!pet || !c?.alive || !s) continue;
    if (ageYears(c, tick) < s.lifespan) continue;
    c.alive = false;
    c.death = { tick, cause: 'old age' };
    appendLog(state, tick, {
      kind: 'life',
      summary: `${pet.name} died: old age.`,
      tags: ['personal', 'companion', 'death'],
      actorIds: [pet.id],
      targetIds: [p.entity.id],
      place: c.place ?? null,
      cause: 'sys:heart',
      knownBy: [p.entity.id],
    });
  }
}
