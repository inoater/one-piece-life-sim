import type { GameData, Occupation } from '../../engine/data/schemas';
import { createEntity } from '../../engine/entities';
import type { Rng } from '../../engine/rng';
import {
  PUBLIC_KNOWLEDGE,
  type CharacterData,
  type Entity,
  type FlagValue,
  type Pronouns,
  type RelationKind,
  type WorldState,
} from '../../engine/state';
import { addMod, makeStat, statValue } from '../../engine/stats';
import {
  fullName,
  givenNames,
  namePool,
  npcTraits,
  RECIPROCAL,
  rollPronouns,
} from '../genesis/family';
import { sortedValues } from '../genesis/options';
import { raceAgeFor } from '../genesis/stages';
import { type Person } from './body';

/**
 * The people a life gathers after it starts: friends, rivals, mentors, sweethearts, children,
 * protégés and gang members. Like Phase 1's family they are ordinary generated entities (tier 2)
 * with a character block, linked both ways by relationships whose opinions are stats (rule 3).
 */

export interface NewPerson {
  pronouns?: Pronouns;
  familyName?: string;
  birthTick: number;
  occupation?: string;
  flags?: Record<string, FlagValue>;
}

/** An occupation that exists where the player lives, for someone they meet. */
function rollOccupation(data: GameData, p: Person, rng: Rng): Occupation | undefined {
  const pool = sortedValues(data.occupations).filter(
    (o) =>
      !o.special &&
      (o.places.length === 0 || o.places.includes(p.home.id)) &&
      (o.races.length === 0 || o.races.includes(p.race.id)),
  );
  return rng.weightedPick(pool, (o) => o.weight);
}

/** Someone new, of the player's race and from the player's home, with a name nobody else has. */
export function makePerson(
  state: WorldState,
  data: GameData,
  p: Person,
  rng: Rng,
  spec: NewPerson,
): Entity {
  const pool = namePool(data, { race: p.race, birthplace: p.home });
  const pronouns = spec.pronouns ?? rollPronouns(rng.fork('pronouns'));
  const taken = new Set<string>();
  for (const entity of Object.values(state.entities)) {
    if (entity.character) taken.add(entity.character.givenName);
  }
  const names = givenNames(pool, pronouns);
  const free = names.filter((n) => !taken.has(n));
  const given = rng.fork('name').pick(free.length > 0 ? free : names);
  const familyName = spec.familyName ?? rng.fork('surname').pick(pool.family);
  const character: CharacterData = {
    givenName: given,
    familyName,
    pronouns,
    race: p.race.id,
    birthTick: spec.birthTick,
    birthplace: p.home.id,
    alive: true,
    traits: [...p.race.innateTraits, ...npcTraits(data, rng.fork('traits'))],
    appearance: {},
    scars: [],
    relationships: [],
    berries: 0,
  };
  if (spec.occupation !== undefined) character.occupation = spec.occupation;
  const entity = createEntity(state, {
    type: 'character',
    origin: 'generated',
    name: fullName(pool, given, familyName),
    tier: 2,
    flags: { ...(spec.flags ?? {}) },
    knownBy: [PUBLIC_KNOWLEDGE],
  });
  entity.character = character;
  return entity;
}

/** Someone the player meets, `ageOffset` human years older (or younger) than they are. */
export function meetPerson(
  state: WorldState,
  data: GameData,
  p: Person,
  rng: Rng,
  tick: number,
  playerHumanAge: number,
  spec: {
    ageOffset: { min: number; max: number };
    occupation?: string;
    flags?: Record<string, FlagValue>;
  },
): Entity {
  const humanAge = Math.max(
    0,
    playerHumanAge + rng.fork('age').int(spec.ageOffset.min, spec.ageOffset.max),
  );
  const years = raceAgeFor(data.character, p.race, humanAge);
  const birthTick = Math.min(tick, tick - Math.round(years * 12) - rng.fork('month').int(0, 11));
  const occupation =
    spec.occupation ?? (humanAge >= 16 ? rollOccupation(data, p, rng.fork('job'))?.id : undefined);
  return makePerson(state, data, p, rng, {
    birthTick,
    ...(occupation !== undefined ? { occupation } : {}),
    ...(spec.flags ? { flags: spec.flags } : {}),
  });
}

const clampOpinion = (n: number) => Math.max(-100, Math.min(100, Math.round(n)));

/** Link two characters both ways. `opinion` is how `a` feels about `b`. */
export function relate(
  a: Entity,
  b: Entity,
  kind: RelationKind,
  opinion: number,
  tick: number,
  rng: Rng,
): void {
  const ac = a.character;
  const bc = b.character;
  if (!ac || !bc) throw new Error('only characters can be related');
  ac.relationships.push({
    id: b.id,
    kind,
    opinion: makeStat(clampOpinion(opinion)),
    sinceTick: tick,
  });
  bc.relationships.push({
    id: a.id,
    kind: RECIPROCAL[kind],
    opinion: makeStat(clampOpinion(opinion + rng.int(-20, 20))),
    sinceTick: tick,
  });
}

/**
 * Change how `a` feels about `b`, as a named modifier ("Time together", "Quarrels") so the opinion
 * still explains itself. Kept within -100 to 100.
 */
export function shiftOpinion(a: Entity, otherId: string, by: number, tick: number): void {
  const rel = a.character?.relationships.find((r) => r.id === otherId);
  if (!rel || by === 0) return;
  const now = statValue(rel.opinion, tick);
  const target = clampOpinion(now + by);
  const delta = target - now;
  if (delta === 0) return;
  const source = delta > 0 ? 'Time together' : 'Quarrels';
  const mod = rel.opinion.mods.find((m) => m.source === source && m.kind === 'flat');
  if (mod) mod.value = Math.round((mod.value + delta) * 10) / 10;
  else addMod(rel.opinion, { source, value: delta, kind: 'flat' });
}

/** "your mother", "your father", "your parent". */
export function parentWords(entity: Entity): string {
  const p = entity.character?.pronouns;
  return p === 'he' ? 'your father' : p === 'she' ? 'your mother' : 'your parent';
}

/** "your younger sister Ana" relative to `viewer`. */
export function siblingWords(viewer: CharacterData, entity: Entity): string {
  const c = entity.character;
  if (!c) return entity.name;
  const relative = c.birthTick < viewer.birthTick ? 'older' : 'younger';
  const noun = c.pronouns === 'he' ? 'brother' : c.pronouns === 'she' ? 'sister' : 'sibling';
  return `your ${relative} ${noun} ${c.givenName}`;
}

/** "your daughter Mira", "your son Tal", "your child Ren". */
export function childWords(entity: Entity): string {
  const c = entity.character;
  const noun = c?.pronouns === 'he' ? 'son' : c?.pronouns === 'she' ? 'daughter' : 'child';
  return `your ${noun} ${c?.givenName ?? entity.name}`;
}

/** What someone is to `viewer`, without their name: "older sister", "son", "protégé". */
export function relationTitle(viewer: CharacterData, entity: Entity, kind: RelationKind): string {
  const c = entity.character;
  const p = c?.pronouns;
  const pick = (he: string, she: string, they: string) =>
    p === 'he' ? he : p === 'she' ? she : they;
  switch (kind) {
    case 'parent':
      return pick('father', 'mother', 'parent');
    case 'sibling':
      return `${(c?.birthTick ?? 0) < viewer.birthTick ? 'older' : 'younger'} ${pick('brother', 'sister', 'sibling')}`;
    case 'child':
      return pick('son', 'daughter', 'child');
    case 'sweetheart':
      return entity.flags['married'] === true ? pick('husband', 'wife', 'spouse') : 'sweetheart';
    case 'protege':
      return 'protégé';
    case 'friend':
      return typeof entity.flags['gang.name'] === 'string'
        ? `of ${entity.flags['gang.name']}`
        : 'friend';
    default:
      return kind;
  }
}

/** How the player names someone when they die or are born: "Your father, Garo Hale". */
export function relationWords(viewer: CharacterData, entity: Entity, kind: RelationKind): string {
  switch (kind) {
    case 'parent':
      return `${parentWords(entity)}, ${entity.name}`;
    case 'sibling':
      return siblingWords(viewer, entity);
    case 'child':
      return childWords(entity);
    case 'sweetheart':
      return `${entity.flags['married'] === true ? 'your spouse' : 'your sweetheart'}, ${entity.name}`;
    case 'mentor':
      return `your old teacher, ${entity.name}`;
    case 'guardian':
      return `${entity.name}, who raised you`;
    case 'protege':
      return `your protégé, ${entity.name}`;
    case 'friend':
      return `your friend ${entity.name}`;
    case 'rival':
      return `your rival ${entity.name}`;
    default:
      return entity.name;
  }
}
