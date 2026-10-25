import { dateOf, formatDate } from '../../engine/calendar';
import type { GameData } from '../../engine/data/schemas';
import { mintGeneratedId } from '../../engine/entities';
import { appendLog } from '../../engine/log';
import type { Entity, RelationKind, Stat, WorldState } from '../../engine/state';
import { addMod, statLabel, statValue } from '../../engine/stats';
import { createLife } from '../genesis/generate';
import {
  ageYears,
  freshLife,
  livingRelations,
  personOf,
  reputation,
  reputationValue,
  type Person,
} from './body';
import { formatBerries } from '../genesis/text';
import { passItems } from '../hands/swords';
import { relationTitle } from './people';
import { reapplyTraits } from './traits';
import { entityIds } from '../../engine/entities';
import { passCarriedFruits } from '../powers/fruits';

/**
 * When the person being played dies (Phase 2): the life recap, and carrying on as someone else.
 *
 *   heir      your eldest living child
 *   protégé   someone you taught
 *   crewmate  someone who ran with you (your gang until crews exist in Phase 3)
 *   sibling   a living brother or sister
 *   newborn   a stranger's child born at home that month
 *   new       a new game (the page handles this one)
 *
 * Inheritance: Berries pass to an heir, protégé, crewmate or sibling; debts die with the debtor;
 * the bounty does not pass; half the fame (life.json) becomes the heir's Legacy; command of the
 * crew passes to a crewmate. Ships pass on too (Phase 3); an eaten Devil Fruit returns to the world
 * when its user dies, and an uneaten one is carried and passes like Berries (Phase 4).
 */

export const CONTINUE_MODES = ['heir', 'protege', 'crewmate', 'sibling', 'newborn', 'new'] as const;
export type ContinueMode = (typeof CONTINUE_MODES)[number];

export class ContinueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContinueError';
  }
}

export interface Candidate {
  id: string;
  name: string;
  relation: string;
  age: number;
}

export interface ContinueOption {
  id: ContinueMode;
  label: string;
  description: string;
  candidates: Candidate[];
  available: boolean;
  /** Why not, when unavailable. */
  reason: string | null;
  /** Whether Berries and Legacy pass on. */
  inherits: boolean;
}

const INHERITS: ReadonlySet<ContinueMode> = new Set(['heir', 'protege', 'crewmate', 'sibling']);

function candidatesFor(state: WorldState, dead: Person, mode: ContinueMode): Entity[] {
  const { c } = dead;
  const byAge = (list: Entity[]) =>
    [...list].sort((a, b) => (a.character?.birthTick ?? 0) - (b.character?.birthTick ?? 0));
  switch (mode) {
    case 'heir':
      return byAge(livingRelations(state, c, 'child'));
    case 'protege':
      return byAge(livingRelations(state, c, 'protege'));
    case 'sibling':
      return byAge(livingRelations(state, c, 'sibling'));
    case 'crewmate': {
      // Gang members (Phase 2), and the shipmates made at sea (Phase 3).
      const gang = c.life?.gang;
      return byAge(
        livingRelations(state, c, 'friend').filter(
          (e) =>
            (gang !== null && gang !== undefined && e.flags['gang.name'] === gang) ||
            e.flags['shipmate'] === true,
        ),
      );
    }
    default:
      return [];
  }
}

const NONE_REASON: Record<ContinueMode, string> = {
  heir: 'No living children',
  protege: 'You never took on an apprentice',
  crewmate: 'No crew: no gang, and no shipmate who became a friend',
  sibling: 'No living brothers or sisters',
  newborn: '',
  new: '',
};

export function continueOptions(state: WorldState, data: GameData): ContinueOption[] {
  const dead = state.playerId ? personOf(data, state.entities[state.playerId]) : null;
  if (!dead || dead.c.alive) return [];
  return data.life.continuation.map((def) => {
    const people = candidatesFor(state, dead, def.id);
    const always = def.id === 'newborn' || def.id === 'new';
    return {
      id: def.id,
      label: def.label,
      description: def.description,
      candidates: people.map((e) => ({
        id: e.id,
        name: e.name,
        relation: relationTitle(dead.c, e, kindOf(dead, e.id)),
        age: ageYears(e.character as NonNullable<Entity['character']>, state.tick),
      })),
      available: always || people.length > 0,
      reason: always || people.length > 0 ? null : NONE_REASON[def.id],
      inherits: INHERITS.has(def.id),
    };
  });
}

function kindOf(p: Person, id: string): RelationKind {
  return p.c.relationships.find((r) => r.id === id)?.kind ?? 'friend';
}

// ---- Taking over a body -------------------------------------------------------------------------

function clampTo(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Make sure `target` is linked to each parent, and to each parent's other children. */
function connectFamily(state: WorldState, target: Entity, parentIds: readonly string[]): string[] {
  const tc = target.character;
  if (!tc) return [];
  const siblings = new Set<string>();
  const has = (e: Entity, id: string) => e.character?.relationships.some((r) => r.id === id);
  for (const parentId of parentIds) {
    const parent = state.entities[parentId];
    const pc = parent?.character;
    if (!parent || !pc) continue;
    if (!has(target, parentId)) {
      tc.relationships.push({
        id: parentId,
        kind: 'parent',
        opinion: { base: 50, mods: [] },
        sinceTick: tc.birthTick,
      });
    }
    for (const rel of pc.relationships) {
      if (rel.kind === 'child' && rel.id !== target.id) siblings.add(rel.id);
    }
  }
  for (const id of siblings) {
    const sibling = state.entities[id];
    if (!sibling?.character || has(target, id)) continue;
    const since = Math.max(tc.birthTick, sibling.character.birthTick);
    tc.relationships.push({
      id,
      kind: 'sibling',
      opinion: { base: 40, mods: [] },
      sinceTick: since,
    });
    if (!has(sibling, target.id)) {
      sibling.character.relationships.push({
        id: target.id,
        kind: 'sibling',
        opinion: { base: 40, mods: [] },
        sinceTick: since,
      });
    }
  }
  return [...siblings].sort();
}

/**
 * Give an existing character a player's body: hidden potential and talent, full stats, appearance
 * and the traits of a birthplace and family, made by character genesis for their age and home (so
 * they are exactly as strong as a new character of that age would be). What they already were is
 * kept: name, relationships, the traits they had, their place in the family.
 */
function promote(state: WorldState, data: GameData, target: Entity, dead: Person): void {
  const tc = target.character;
  if (!tc) throw new ContinueError(`${target.name} is not a person`);
  const { entry } = data.creation;
  const year = Math.floor(state.tick / 12);
  const life = createLife(
    data,
    {
      seed: `${state.seed}#${target.id}`,
      canonMode: state.config.canonMode,
      difficulty: state.config.difficulty,
      rareRaces: true,
      race: tc.race,
      birthplace: tc.birthplace,
      entryYear: clampTo(year, entry.minYear, entry.maxYear),
      entryAge: clampTo(ageYears(tc, state.tick), entry.minAge, entry.maxAge),
      pronouns: tc.pronouns,
      givenName: tc.givenName,
      ...(tc.familyName ? { familyName: tc.familyName } : {}),
    },
    { allowBlocked: true },
  );
  const made = life.state.entities[life.playerId];
  const mc = made?.character;
  if (!made || !mc) throw new ContinueError('Could not build a body for them');
  target.stats = structuredClone(made.stats);
  if (mc.hidden) tc.hidden = structuredClone(mc.hidden);
  tc.appearance = { ...mc.appearance };
  if (mc.adultHeightCm !== undefined) tc.adultHeightCm = mc.adultHeightCm;
  if (mc.focus) tc.focus = mc.focus;
  const kept = new Set(tc.traits);
  for (const id of mc.traits) {
    const category = data.traits[id]?.category;
    if (
      (category === 'birth' || category === 'family' || category === 'backstory') &&
      !kept.has(id)
    ) {
      tc.traits.push(id);
    }
  }
  reapplyTraits(data, target);
  // Exclusions may have dropped a trait during the rebuild; that is the rule working.

  const parentIds = tc.relationships.filter((r) => r.kind === 'parent').map((r) => r.id);
  const sameFamily = dead.c.family && parentIds.some((id) => dead.c.family?.parentIds.includes(id));
  const ownParents = sameFamily ? (dead.c.family?.parentIds ?? []) : parentIds;
  const siblingIds = connectFamily(state, target, ownParents);
  const older = siblingIds.filter(
    (id) => (state.entities[id]?.character?.birthTick ?? 0) < tc.birthTick,
  );
  tc.family = {
    legacy: dead.c.family?.legacy ?? mc.family?.legacy ?? life.resolved.legacy.id,
    wealth: dead.c.family?.wealth ?? mc.family?.wealth ?? 'modest',
    birthOrder:
      siblingIds.length === 0
        ? 'only'
        : older.length === 0
          ? 'eldest'
          : older.length === siblingIds.length
            ? 'youngest'
            : 'middle',
    parentIds: [...ownParents],
    siblingIds,
    expected: [],
  };
}

// ---- A newborn stranger -------------------------------------------------------------------------

function shiftStat(stat: Stat, shift: number): void {
  for (const mod of stat.mods) if (mod.expiresTick !== undefined) mod.expiresTick += shift;
}

/**
 * Character genesis makes a newborn (and their family) in a world of their own; they are moved
 * into this one with fresh ids and every date shifted to this month.
 */
function newborn(state: WorldState, data: GameData, dead: Person): Entity {
  const { entry } = data.creation;
  const year = Math.floor(state.tick / 12);
  const life = createLife(
    data,
    {
      seed: `${state.seed}#newborn#${state.tick}`,
      canonMode: state.config.canonMode,
      difficulty: state.config.difficulty,
      rareRaces: false,
      race: dead.race.rare ? 'random' : dead.race.id,
      birthplace: dead.race.rare ? 'random' : dead.home.id,
      entryYear: clampTo(year, entry.minYear, entry.maxYear),
      entryAge: 0,
      pronouns: dead.c.pronouns,
    },
    { allowBlocked: true },
  );
  const from = life.state;
  const shift = state.tick - from.tick;
  const ids = new Map<string, string>();
  for (const id of Object.keys(from.entities).sort()) ids.set(id, mintGeneratedId(state));
  const remap = (id: string) => ids.get(id) ?? id;
  for (const [oldId, entity] of Object.entries(from.entities).sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const moved: Entity = structuredClone(entity);
    moved.id = remap(oldId);
    moved.createdTick = state.tick;
    for (const stat of Object.values(moved.stats)) shiftStat(stat, shift);
    const c = moved.character;
    if (c) {
      c.birthTick += shift;
      if (c.death) c.death.tick += shift;
      for (const rel of c.relationships) {
        rel.id = remap(rel.id);
        rel.sinceTick += shift;
      }
      for (const scar of c.scars) scar.tick += shift;
      for (const potential of Object.values(c.hidden?.potential ?? {})) shiftStat(potential, shift);
      if (c.family) {
        c.family.parentIds = c.family.parentIds.map(remap);
        c.family.siblingIds = c.family.siblingIds.map(remap);
        for (const e of c.family.expected) e.birthTick += shift;
      }
      delete c.life;
    }
    state.entities[moved.id] = moved;
  }
  for (const record of from.log) {
    appendLog(state, record.tick + shift, {
      kind: record.kind,
      summary: record.summary,
      tags: record.tags,
      actorIds: record.actorIds.map(remap),
      targetIds: record.targetIds.map(remap),
      place: record.place,
      ...(record.cause !== undefined ? { cause: record.cause } : {}),
      knownBy: record.knownBy.map((k) => (k === '*' ? k : remap(k))),
    });
  }
  for (const s of from.scheduled) {
    state.scheduled.push({ eventId: s.eventId, tick: s.tick + shift, source: s.source });
  }
  const baby = state.entities[remap(life.playerId)];
  if (!baby) throw new ContinueError('The newborn went missing');
  return baby;
}

// ---- Carrying on --------------------------------------------------------------------------------

export function continueAs(
  state: WorldState,
  data: GameData,
  mode: ContinueMode,
  targetId?: string,
): Entity {
  const dead = state.playerId ? personOf(data, state.entities[state.playerId]) : null;
  if (!dead) throw new ContinueError('Nobody is being played');
  if (dead.c.alive) throw new ContinueError(`${dead.entity.name} is still alive`);
  if (mode === 'new') throw new ContinueError('A new game starts from the New Life screens');

  // What belonged to the life that ended goes with it: its debt collectors, its family's chains.
  state.scheduled = state.scheduled.filter(
    (s) =>
      !s.source.startsWith('legacy:') &&
      !s.source.startsWith('sys:') &&
      !s.source.startsWith('life:'),
  );
  state.pending = [];

  let target: Entity;
  if (mode === 'newborn') {
    target = newborn(state, data, dead);
  } else {
    const people = candidatesFor(state, dead, mode);
    const found = targetId ? people.find((e) => e.id === targetId) : people[0];
    if (!found) throw new ContinueError(NONE_REASON[mode] || 'Nobody to continue as');
    target = found;
    promote(state, data, target, dead);
  }
  const tc = target.character;
  if (!tc) throw new ContinueError(`${target.name} is not a person`);

  const deadLife = dead.c.life;
  const notes: string[] = [];
  if (INHERITS.has(mode)) {
    if (dead.c.berries > 0) {
      tc.berries += dead.c.berries;
      notes.push(`${formatBerries(dead.c.berries)} Berries`);
      dead.c.berries = 0;
    }
    // Phase 3: ships, and the command of their crews, pass on too.
    for (const id of entityIds(state)) {
      const ship = state.entities[id]?.ship;
      if (!ship || ship.ownerId !== dead.entity.id || ship.sunk) continue;
      ship.ownerId = target.id;
      notes.push(
        `the ship ${state.entities[id]?.name ?? id}${ship.crew > 0 ? ` and her ${ship.crew} hands` : ''}`,
      );
    }
    // Phase 4: an uneaten Devil Fruit (and the encyclopedia) are things, and pass like Berries;
    // an eaten fruit returned to the world the moment its user died.
    const carried = passCarriedFruits(state, dead.entity, target, state.tick);
    if (carried > 0)
      notes.push(carried === 1 ? 'something they carried' : `${carried} things they carried`);
    // Phase 6: weapons, gear and cargo pass too.
    const things = passItems(state, data, dead.entity, target, state.tick);
    if (things > 0) notes.push(things === 1 ? 'their gear' : `${things} pieces of their gear`);
    const fame = statValue(reputation(dead.entity, 'fame'), state.tick);
    const legacy = Math.round(fame * data.life.fame.legacyPct) / 100;
    if (legacy > 0) {
      addMod(reputation(target, 'fame'), {
        source: `Legacy of ${dead.entity.name}`,
        value: legacy,
        kind: 'flat',
      });
      notes.push(`a Legacy of ${legacy} fame`);
    }
  }
  state.playerId = target.id;
  target.origin = 'player';
  target.tier = 1;
  // The story so far stays the player's to read: whoever carries on knows what the last life knew
  // (rule 4 still holds for everything nobody knew).
  for (const record of state.log) {
    if (record.knownBy.includes(dead.entity.id) && !record.knownBy.includes(target.id)) {
      record.knownBy.push(target.id);
    }
  }
  // A life that ended at sea ends its voyage: whoever carries on is wherever they are.
  if (dead.c.travel?.voyage) {
    const voyage = dead.c.travel.voyage;
    const ship = voyage.shipId ? state.entities[voyage.shipId]?.ship : undefined;
    if (ship && !ship.sunk) ship.place = voyage.done < voyage.miles / 2 ? voyage.from : voyage.to;
    dead.c.travel.voyage = null;
  }
  const life = freshLife(data, target, state.tick, (deadLife?.generation ?? 1) + 1);
  life.predecessorId = dead.entity.id;
  if (mode === 'crewmate' && deadLife?.gang) {
    life.gang = deadLife.gang;
    target.flags['gang.member'] = true;
    notes.push(`command of ${deadLife.gang}`);
  }
  tc.life = life;

  const relation =
    mode === 'newborn'
      ? `a newborn ${data.birthplaces[tc.birthplace]?.bornIn ?? ''}`.trim()
      : `${dead.c.givenName}'s ${relationTitle(dead.c, target, kindOf(dead, target.id))}`;
  appendLog(state, state.tick, {
    kind: 'life',
    summary: `The story carries on with ${target.name}, ${relation}${notes.length > 0 ? `, who inherits ${notes.join(', ')}` : ''}.`,
    tags: ['personal', 'genesis'],
    actorIds: [target.id],
    targetIds: [dead.entity.id],
    place: tc.place ?? data.birthplaces[tc.birthplace]?.location ?? null,
    cause: `sys:continue:${mode}`,
    knownBy: ['*'],
  });
  return target;
}

// ---- The recap ----------------------------------------------------------------------------------

export interface LifeRecap {
  id: string;
  name: string;
  age: number;
  born: string;
  died: string | null;
  cause: string | null;
  generation: number;
  peak: { id: string; label: string; value: number }[];
  fame: number;
  infamy: number;
  bounty: number | null;
  deeds: { date: string; text: string }[];
  /** Headlines that mention them by name. */
  newsMentions: number;
  children: number;
  job: string | null;
  berries: number;
  debt: number;
}

export function lifeRecap(state: WorldState, data: GameData, entityId: string): LifeRecap | null {
  const p = personOf(data, state.entities[entityId]);
  if (!p) return null;
  const { c, entity } = p;
  const end = c.death?.tick ?? state.tick;
  const label = (tick: number) => formatDate(dateOf(data.calendar, tick));
  const bounty = entity.flags['bounty'];
  const job = c.life?.job ? (data.jobs[c.life.job.id]?.name ?? null) : null;
  return {
    id: entity.id,
    name: entity.name,
    age: ageYears(c, end),
    born: label(c.birthTick),
    died: c.death ? label(c.death.tick) : null,
    cause: c.death?.cause ?? null,
    generation: c.life?.generation ?? 1,
    peak: [...data.character.physical, ...data.character.mental].map((id) => ({
      id,
      label: statLabel(id),
      value:
        c.life?.peak[id] ??
        Math.round(statValue(entity.stats[id] ?? { base: 0, mods: [] }, end) * 10) / 10,
    })),
    fame: reputationValue(entity, 'fame', end),
    infamy: reputationValue(entity, 'infamy', end),
    bounty: typeof bounty === 'number' ? bounty : null,
    deeds: (c.life?.deeds ?? []).map((d) => ({ date: label(d.tick), text: d.text })),
    newsMentions: state.news.filter((n) => n.text.includes(entity.name)).length,
    children: c.relationships.filter((r) => r.kind === 'child').length,
    job,
    berries: c.berries,
    debt: c.life?.debt ?? 0,
  };
}
