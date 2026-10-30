import type { GameData, NamePool, Occupation } from '../../engine/data/schemas';
import { createEntity } from '../../engine/entities';
import type { Rng } from '../../engine/rng';
import {
  PUBLIC_KNOWLEDGE,
  type CharacterData,
  type Entity,
  type Pronouns,
  type RelationKind,
} from '../../engine/state';
import { makeStat } from '../../engine/stats';
import { characterOf, entityOf, wealthTier, type GenesisCtx } from './context';
import { sortedValues } from './options';
import { raceAgeFor } from './stages';

/**
 * The people around a new character: parents, brothers and sisters, a guardian for an orphan, and
 * the mentors, friends and rivals that backstory events bring in. All are ordinary generated
 * entities (origin "generated", tier 2) with a character block, linked to the player through
 * relationships on both sides.
 */

export function namePool(data: GameData, ctx: Pick<GenesisCtx, 'race' | 'birthplace'>): NamePool {
  const id = ctx.race.namePool ?? ctx.birthplace.namePool;
  const pool = data.names[id];
  if (!pool) throw new Error(`name pool ${id} is missing`);
  return pool;
}

export function givenNames(pool: NamePool, pronouns: Pronouns): string[] {
  const { he, she, any } = pool.given;
  if (pronouns === 'he') return [...he, ...any];
  if (pronouns === 'she') return [...she, ...any];
  return [...he, ...she, ...any];
}

export function fullName(pool: NamePool, given: string, family: string): string {
  if (family.trim() === '') return given;
  return pool.order === 'family-first' ? `${family} ${given}` : `${given} ${family}`;
}

export function rollPronouns(rng: Rng): Pronouns {
  return (
    rng.weightedPick<Pronouns>(['he', 'she', 'they'], (p) => (p === 'they' ? 4 : 48)) ?? 'they'
  );
}

/** An occupation that fits the place, race and wealth; never one reserved for legacies and events. */
export function rollOccupation(ctx: GenesisCtx, rng: Rng): Occupation | undefined {
  const tier = wealthTier(ctx).id;
  const all = sortedValues(ctx.data.occupations).filter((o) => !o.special);
  const fits = (o: Occupation, strict: boolean) =>
    (o.places.length === 0 || o.places.includes(ctx.birthplace.id)) &&
    (o.races.length === 0 || o.races.includes(ctx.race.id)) &&
    (!strict || o.wealth.length === 0 || o.wealth.includes(tier));
  const strict = all.filter((o) => fits(o, true));
  const loose = all.filter((o) => fits(o, false));
  const pool = strict.length > 0 ? strict : loose.length > 0 ? loose : all;
  return rng.weightedPick(pool, (o) => o.weight);
}

/** One or two everyday traits (nature and quirks) for a family member or acquaintance. */
export function npcTraits(data: GameData, rng: Rng): string[] {
  const pool = sortedValues(data.traits).filter(
    (t) => (t.category === 'innate' || t.category === 'quirk') && t.weight > 0,
  );
  const out: string[] = [];
  const count = rng.chance(0.5) ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const blocked = new Set(out);
    for (const id of out) for (const ex of data.traits[id]?.excludes ?? []) blocked.add(ex);
    const choice = rng.weightedPick(
      pool.filter((t) => !blocked.has(t.id) && !t.excludes.some((e) => out.includes(e))),
      (t) => t.weight,
    );
    if (choice) out.push(choice.id);
  }
  return out;
}

export interface NpcSpec {
  pronouns: Pronouns;
  givenName?: string;
  familyName: string;
  birthTick: number;
  occupation?: string;
  flags?: Record<string, boolean | number | string>;
}

export function createNpc(ctx: GenesisCtx, rng: Rng, spec: NpcSpec): Entity {
  const pool = namePool(ctx.data, ctx);
  // Nobody in one life shares a given name: two Currents in a family reads as a mistake.
  const taken = new Set<string>([ctx.pc.givenName]);
  for (const entity of Object.values(ctx.state.entities)) {
    if (entity.character) taken.add(entity.character.givenName);
  }
  const names = givenNames(pool, spec.pronouns).filter((n) => !taken.has(n));
  const given =
    spec.givenName ?? rng.pick(names.length > 0 ? names : givenNames(pool, spec.pronouns));
  const character: CharacterData = {
    givenName: given,
    familyName: spec.familyName,
    pronouns: spec.pronouns,
    race: ctx.race.id,
    birthTick: spec.birthTick,
    birthplace: ctx.birthplace.id,
    alive: true,
    traits: [...ctx.race.innateTraits, ...npcTraits(ctx.data, rng.fork('traits'))],
    appearance: {},
    scars: [],
    relationships: [],
    berries: 0,
  };
  if (spec.occupation !== undefined) character.occupation = spec.occupation;
  const entity = createEntity(ctx.state, {
    type: 'character',
    origin: 'generated',
    name: fullName(pool, given, spec.familyName),
    tier: 2,
    flags: { ...(spec.flags ?? {}) },
    knownBy: [PUBLIC_KNOWLEDGE],
  });
  entity.character = character;
  return entity;
}

export const RECIPROCAL: Record<RelationKind, RelationKind> = {
  parent: 'child',
  child: 'parent',
  sibling: 'sibling',
  guardian: 'ward',
  ward: 'guardian',
  mentor: 'protege',
  protege: 'mentor',
  friend: 'friend',
  rival: 'rival',
  sweetheart: 'sweetheart',
  benefactor: 'ward',
  crewmate: 'crewmate',
  superior: 'subordinate',
  subordinate: 'superior',
  former: 'former',
  companion: 'owner',
  owner: 'companion',
};

/** Link the player and another character both ways. `opinion` is the player's view of them. */
export function relate(
  ctx: GenesisCtx,
  rng: Rng,
  other: Entity,
  kind: RelationKind,
  opinion: number,
  sinceTick: number,
): void {
  const clamp = (n: number) => Math.max(-100, Math.min(100, Math.round(n)));
  ctx.pc.relationships.push({
    id: other.id,
    kind,
    opinion: makeStat(clamp(opinion)),
    sinceTick,
  });
  characterOf(other).relationships.push({
    id: ctx.player.id,
    kind: RECIPROCAL[kind],
    opinion: makeStat(clamp(opinion + rng.int(-20, 20))),
    sinceTick,
  });
}

/** "your mother", "your father", or "your parent" for a parent who uses they. */
export function parentTitle(entity: Entity): string {
  const p = characterOf(entity).pronouns;
  return p === 'he' ? 'your father' : p === 'she' ? 'your mother' : 'your parent';
}

/** "your older sister Ana". */
export function siblingTitle(ctx: GenesisCtx, entity: Entity): string {
  const c = characterOf(entity);
  const relative = c.birthTick < ctx.birthTick ? 'older' : 'younger';
  const noun = c.pronouns === 'he' ? 'brother' : c.pronouns === 'she' ? 'sister' : 'sibling';
  return `your ${relative} ${noun} ${c.givenName}`;
}

/** A human-equivalent age turned into a birth tick for someone of the player's race. */
function birthTickForAge(ctx: GenesisCtx, atTick: number, humanAge: number, rng: Rng): number {
  const years = raceAgeFor(ctx.data.character, ctx.race, humanAge);
  return atTick - Math.round(years * 12) - rng.int(0, 11);
}

/**
 * Parents, brothers and sisters (or, for an orphan, the guardian who raised them). Fixes the
 * birth order. Siblings due after the story starts are recorded as expected births for Phase 2.
 */
export function buildFamily(ctx: GenesisCtx, rng: Rng): void {
  const { data, legacy } = ctx;
  const familyName = ctx.pc.familyName;

  if (legacy.guardian) {
    const guardianRng = rng.fork('guardian');
    const guardian = createNpc(ctx, guardianRng, {
      pronouns: rollPronouns(guardianRng),
      familyName: guardianRng.pick(namePool(data, ctx).family),
      birthTick: birthTickForAge(ctx, ctx.birthTick, guardianRng.int(30, 50), guardianRng),
      occupation: legacy.guardian.occupation,
      flags: { 'family.title': legacy.guardian.title },
    });
    relate(ctx, guardianRng, guardian, 'guardian', 40 + guardianRng.int(-20, 30), ctx.birthTick);
    ctx.birthOrder = 'only';
    ctx.pc.family = {
      legacy: legacy.id,
      wealth: wealthTier(ctx).id,
      birthOrder: 'only',
      parentIds: [],
      siblingIds: [],
      expected: [],
    };
    return;
  }

  // Parents
  const carrier = legacy.parent;
  const carrierRole =
    carrier?.role === 'either'
      ? rng.fork('carrier').chance(0.5)
        ? 'mother'
        : 'father'
      : carrier?.role;
  for (const role of ['mother', 'father'] as const) {
    const parentRng = rng.fork('parent', role);
    const isCarrier = carrier !== undefined && carrierRole === role;
    const flags: Record<string, boolean | number | string> = {};
    if (isCarrier) {
      Object.assign(flags, carrier.flags);
      flags['family.title'] = carrier.title;
      if (carrier.status === 'absent') flags['absent'] = true;
      if (carrier.bounty) {
        flags['bounty'] =
          Math.round(parentRng.int(carrier.bounty.min, carrier.bounty.max) / 1000) * 1000;
      }
    }
    const occupation = isCarrier
      ? carrier.occupation
      : rollOccupation(ctx, parentRng.fork('job'))?.id;
    const parent = createNpc(ctx, parentRng, {
      pronouns: role === 'mother' ? 'she' : 'he',
      familyName,
      birthTick: birthTickForAge(
        ctx,
        ctx.birthTick,
        parentRng.int(data.creation.parentAge.min, data.creation.parentAge.max),
        parentRng,
      ),
      ...(occupation !== undefined ? { occupation } : {}),
      flags,
    });
    const absent = flags['absent'] === true;
    relate(
      ctx,
      parentRng,
      parent,
      'parent',
      (absent ? 15 : 50) + parentRng.int(-20, 30),
      ctx.birthTick,
    );
    ctx.parentIds.push(parent.id);
    if (isCarrier) ctx.legacyParentId = parent.id;
  }

  // Brothers and sisters
  const count =
    rng
      .fork('siblings')
      .weightedPick([0, 1, 2, 3, 4], (n) => data.creation.siblings.count[n] ?? 0) ?? 0;
  const position = count === 0 ? 0 : rng.fork('position').int(0, count);
  ctx.birthOrder =
    count === 0 ? 'only' : position === 0 ? 'eldest' : position === count ? 'youngest' : 'middle';

  const spacing = data.creation.siblings.spacingMonths;
  const ticks: number[] = [];
  let tick = ctx.birthTick;
  for (let i = position - 1; i >= 0; i--) {
    tick -= rng.fork('gap', i).int(spacing.min, spacing.max);
    ticks.unshift(tick);
  }
  tick = ctx.birthTick;
  for (let i = position + 1; i <= count; i++) {
    tick += rng.fork('gap', i).int(spacing.min, spacing.max);
    ticks.push(tick);
  }

  const expected: { birthTick: number; pronouns: Pronouns }[] = [];
  ticks.forEach((birthTick, i) => {
    const siblingRng = rng.fork('sibling', i);
    const pronouns = rollPronouns(siblingRng);
    if (birthTick > ctx.entryTick) {
      expected.push({ birthTick, pronouns });
      return;
    }
    const adultAtEntry =
      (ctx.entryTick - birthTick) / 12 >= raceAgeFor(data.character, ctx.race, 16);
    const occupation = adultAtEntry ? rollOccupation(ctx, siblingRng.fork('job'))?.id : undefined;
    const sibling = createNpc(ctx, siblingRng, {
      pronouns,
      familyName,
      birthTick,
      ...(occupation !== undefined ? { occupation } : {}),
    });
    relate(
      ctx,
      siblingRng,
      sibling,
      'sibling',
      40 + siblingRng.int(-30, 30),
      Math.max(birthTick, ctx.birthTick),
    );
    ctx.siblingIds.push(sibling.id);
  });
  for (const id of ctx.parentIds) {
    const parent = characterOf(entityOf(ctx, id));
    for (const siblingId of ctx.siblingIds) {
      parent.relationships.push({
        id: siblingId,
        kind: 'child',
        opinion: makeStat(50),
        sinceTick: characterOf(entityOf(ctx, siblingId)).birthTick,
      });
    }
  }
  ctx.pc.family = {
    legacy: legacy.id,
    wealth: wealthTier(ctx).id,
    birthOrder: ctx.birthOrder,
    parentIds: [...ctx.parentIds],
    siblingIds: [...ctx.siblingIds],
    expected,
  };
}

/** Someone a backstory event brings into the player's life (a mentor, a friend, a rival). */
export function meetSomeone(
  ctx: GenesisCtx,
  rng: Rng,
  role: Exclude<RelationKind, 'parent' | 'child' | 'sibling' | 'ward'>,
  opinion: number,
  ageOffset: { min: number; max: number },
  occupation: string | undefined,
  tick: number,
  playerHumanAge: number,
): Entity {
  const pool = namePool(ctx.data, ctx);
  const theirHumanAge = Math.max(0, playerHumanAge + rng.int(ageOffset.min, ageOffset.max));
  const birthTick = Math.min(tick, birthTickForAge(ctx, tick, theirHumanAge, rng));
  const job =
    occupation ?? (theirHumanAge >= 16 ? rollOccupation(ctx, rng.fork('job'))?.id : undefined);
  const other = createNpc(ctx, rng, {
    pronouns: rollPronouns(rng),
    familyName: rng.pick(pool.family),
    birthTick,
    ...(job !== undefined ? { occupation: job } : {}),
  });
  relate(ctx, rng, other, role, opinion, tick);
  return other;
}
