import type {
  Birthplace,
  DerivedDef,
  GameData,
  PLACE_FEATURES,
  Race,
  Requires,
  StageDef,
} from '../../engine/data/schemas';
import type {
  CharacterData,
  Entity,
  LifeData,
  RelationKind,
  Stat,
  WorldState,
} from '../../engine/state';
import { makeStat, statLabel, statValue } from '../../engine/stats';
import { formatBerries } from '../genesis/text';
import { ageAt, humanAgeFor, raceAgeFor, stageAt } from '../genesis/stages';

/**
 * The life loop's view of a body (Phase 2): how old someone is in their race's years and in human
 * terms, which stage of life that is, the derived values (Max Health, Vigor, Combat Power), and
 * whether they meet a requirement written in /data. Everything here reads state; nothing changes
 * it except `ensureLife`, which gives the player a life block the first month it is needed.
 */

export type Feature = (typeof PLACE_FEATURES)[number];

/** A person with the facts the life loop needs at hand. */
export interface Person {
  entity: Entity;
  c: CharacterData;
  race: Race;
  home: Birthplace;
}

export function personOf(data: GameData, entity: Entity | undefined): Person | null {
  const c = entity?.character;
  if (!entity || !c) return null;
  const race = data.races[c.race];
  const home = data.birthplaces[c.birthplace];
  if (!race || !home) return null;
  return { entity, c, race, home };
}

export function playerPerson(state: WorldState, data: GameData): Person | null {
  return state.playerId ? personOf(data, state.entities[state.playerId]) : null;
}

export function lifeOf(person: Person): LifeData {
  const life = person.c.life;
  if (!life) throw new Error(`${person.entity.id} has no life block`);
  return life;
}

// ---- Age and stage ------------------------------------------------------------------------------

/** Whole years in the character's own race. */
export function ageYears(c: CharacterData, tick: number): number {
  return Math.max(0, ageAt(c.birthTick, tick));
}

/** Age in human-equivalent years, with fractions ("a giant of 40 is a human of 12"). */
export function humanAgeOf(data: GameData, p: Person, tick: number): number {
  return humanAgeFor(data.character, p.race, Math.max(0, (tick - p.c.birthTick) / 12));
}

export function stageOf(data: GameData, p: Person, tick: number): StageDef {
  return stageAt(data.character, p.race, ageYears(p.c, tick)).stage;
}

/** The first real age (in this race's years) at which a human-equivalent age is reached. */
export function raceYearsFor(data: GameData, race: Race, humanAge: number): number {
  return Math.ceil(raceAgeFor(data.character, race, humanAge) - 1e-9);
}

// ---- Stats and derived values -------------------------------------------------------------------

export function statTotal(entity: Entity, id: string, tick: number): number {
  const stat = entity.stats[id];
  return stat ? statValue(stat, tick) : 0;
}

export function statTotals(entity: Entity, tick: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, stat] of Object.entries(entity.stats)) out[id] = statValue(stat, tick);
  return out;
}

export function derivedValue(def: DerivedDef, totals: Readonly<Record<string, number>>): number {
  let value = def.constant;
  for (const term of def.terms) {
    const stat = totals[term.stat] ?? 0;
    value += 'factor' in term ? stat * term.factor : stat / term.divide;
  }
  return def.round === 'floor'
    ? Math.floor(value)
    : def.round === 'round'
      ? Math.round(value)
      : value;
}

export function derived(data: GameData, entity: Entity, id: string, tick: number): number {
  const def = data.character.derived.find((d) => d.id === id);
  if (!def) throw new Error(`character.json defines no derived value "${id}"`);
  return derivedValue(def, statTotals(entity, tick));
}

export const maxHealthOf = (data: GameData, e: Entity, tick: number) =>
  Math.max(1, derived(data, e, 'maxHealth', tick));
export const vigorPoolOf = (data: GameData, e: Entity, tick: number) =>
  Math.max(0, derived(data, e, 'vigor', tick));
export const combatPowerOf = (data: GameData, e: Entity, tick: number) =>
  derived(data, e, 'combatPower', tick);

export function slotsOf(data: GameData, p: Person, tick: number): number {
  const base = data.life.slots[stageOf(data, p, tick).id] ?? 0;
  const extra = p.entity.flags[data.life.extraSlotFlag];
  return base + (base > 0 && typeof extra === 'number' ? extra : 0);
}

/** Fame and infamy are stats too (rule 3): a Legacy is a modifier, deeds add to the base. */
export function reputation(entity: Entity, id: 'fame' | 'infamy'): Stat {
  let stat = entity.stats[id];
  if (!stat) {
    stat = makeStat(0);
    entity.stats[id] = stat;
  }
  return stat;
}

/** Fame or infamy as a number, for views (reads only: never creates the stat). */
export function reputationValue(entity: Entity, id: 'fame' | 'infamy', tick: number): number {
  const stat = entity.stats[id];
  return stat ? Math.round(statValue(stat, tick) * 10) / 10 : 0;
}

// ---- The life block ------------------------------------------------------------------------------

export function freshLife(data: GameData, entity: Entity, tick: number, generation = 1): LifeData {
  const peak: Record<string, number> = {};
  for (const id of [...data.character.physical, ...data.character.mental]) {
    peak[id] = Math.round(statTotal(entity, id, tick) * 10) / 10;
  }
  return {
    health: maxHealthOf(data, entity, tick),
    exhausted: false,
    injuries: [],
    illnesses: [],
    routine: [],
    job: null,
    debt: 0,
    jailedUntil: null,
    collectorTick: null,
    gang: null,
    expecting: [],
    peak,
    deeds: [],
    generation,
    report: null,
  };
}

/**
 * The player's life block, created on first use (a new life, or a world saved before Phase 2).
 * Returns null when nobody is being played, or the person being played has died.
 */
export function ensureLife(state: WorldState, data: GameData): Person | null {
  const p = playerPerson(state, data);
  if (!p) return null;
  if (!p.c.life) p.c.life = freshLife(data, p.entity, state.tick);
  return p.c.alive ? p : null;
}

export function isBedRest(data: GameData, life: LifeData, tick: number): boolean {
  return life.injuries.some(
    (i) =>
      i.healTick > tick && data.life.injuries.severities.find((s) => s.id === i.severity)?.bedRest,
  );
}

export function isUnwell(life: LifeData, tick: number): boolean {
  return (
    life.injuries.some((i) => i.healTick > tick) || life.illnesses.some((i) => i.healTick > tick)
  );
}

export function isJailed(life: LifeData, tick: number): boolean {
  return life.jailedUntil !== null && life.jailedUntil > tick;
}

// ---- People --------------------------------------------------------------------------------------

/** Living people the character has a relationship of this kind with, oldest relationship first. */
export function livingRelations(state: WorldState, c: CharacterData, kind: RelationKind): Entity[] {
  const out: Entity[] = [];
  for (const rel of c.relationships) {
    if (rel.kind !== kind) continue;
    const other = state.entities[rel.id];
    if (other?.character?.alive) out.push(other);
  }
  return out;
}

export function isMarried(entity: Entity): boolean {
  return entity.flags['married'] === true;
}

/** The roles a requirement can name, mapped to relationship kinds. */
export function relationKind(role: string): RelationKind {
  return role as RelationKind;
}

// ---- Requirements --------------------------------------------------------------------------------

/** How a feature reads in "Needs ...". Presentation of an enum, not content. */
export const FEATURE_LABEL: Record<Feature, string> = {
  coast: 'a coast',
  docks: 'docks',
  farmland: 'farmland',
  forest: 'a forest',
  jungle: 'a jungle',
  mountains: 'mountains',
  cold: 'a cold climate',
  ruins: 'ruins',
  school: 'a school',
  library: 'a library',
  doctor: 'a doctor',
  dojo: 'a dojo',
  market: 'a market',
  smithy: 'a smithy',
  shipyard: 'a shipyard',
  marine_base: 'a Marine base',
  underworld: 'an underworld',
  clouds: 'a sea of clouds',
  deep_sea: 'the deep sea',
};

const ROLE_LABEL: Record<string, string> = {
  parent: 'a living parent',
  sibling: 'a brother or sister',
  guardian: 'a guardian',
  mentor: 'a mentor',
  friend: 'a friend',
  rival: 'a rival',
  sweetheart: 'a sweetheart',
  protege: 'a protégé',
  child: 'a child',
};

/** Who a flag lives on: the character first, then the world (legacy events set world flags). */
export function flagOf(state: WorldState, entity: Entity, flag: string) {
  return entity.flags[flag] ?? state.flags[flag];
}

function flagHolds(actual: unknown, wanted: unknown): boolean {
  if (typeof wanted === 'number') return typeof actual === 'number' && actual >= wanted;
  return actual === wanted;
}

type RequiresBase = Omit<Requires, 'anyOf'>;

function baseReason(
  state: WorldState,
  data: GameData,
  p: Person,
  req: RequiresBase,
  tick: number,
): string | null {
  const features = p.home.features;
  const missing = req.features.find((f) => !features.includes(f));
  if (missing) return `Needs ${FEATURE_LABEL[missing]} nearby`;
  if (req.anyFeatures.length > 0 && !req.anyFeatures.some((f) => features.includes(f))) {
    return `Needs ${req.anyFeatures.map((f) => FEATURE_LABEL[f]).join(' or ')} nearby`;
  }
  if (req.races.length > 0 && !req.races.includes(p.race.id)) return `Not for ${p.race.name}s`;
  if (req.notRaces.includes(p.race.id)) return `Not for ${p.race.name}s`;
  for (const [flag, wanted] of Object.entries(req.flags)) {
    if (!flagHolds(flagOf(state, p.entity, flag), wanted)) return 'Not unlocked yet';
  }
  if (req.notFlags.some((f) => flagOf(state, p.entity, f) !== undefined)) return 'Already done';
  if (req.anyTraits.length > 0 && !req.anyTraits.some((t) => p.c.traits.includes(t))) {
    return `Needs ${req.anyTraits.map((t) => data.traits[t]?.name ?? t).join(' or ')}`;
  }
  const notTrait = req.notTraits.find((t) => p.c.traits.includes(t));
  if (notTrait) return `Not with ${data.traits[notTrait]?.name ?? notTrait}`;
  for (const [stat, min] of Object.entries(req.stats)) {
    const have = statTotal(p.entity, stat, tick);
    if (have < (min ?? 0))
      return `Needs ${statLabel(stat)} ${min} (you have ${Math.floor(have * 10) / 10})`;
  }
  if (req.combatPower !== undefined) {
    const have = combatPowerOf(data, p.entity, tick);
    if (have < req.combatPower) return `Needs Combat Power ${req.combatPower} (you have ${have})`;
  }
  const life = p.c.life;
  if (req.employed === true && !life?.job) return 'Needs a job';
  if (req.employed === false && life?.job) return 'Not while you hold a job';
  if (req.relation && livingRelations(state, p.c, relationKind(req.relation)).length === 0) {
    return `Needs ${ROLE_LABEL[req.relation] ?? req.relation}`;
  }
  if (req.noRelation && livingRelations(state, p.c, relationKind(req.noRelation)).length > 0) {
    return `You already have ${ROLE_LABEL[req.noRelation] ?? req.noRelation}`;
  }
  if (req.married === true && !isMarried(p.entity)) return 'Needs a spouse';
  if (req.married === false && isMarried(p.entity)) return 'Already married';
  if (req.unwell === true && (!life || !isUnwell(life, tick))) return 'Only when hurt or ill';
  if (req.unwell === false && life && isUnwell(life, tick)) return 'Not while hurt or ill';
  if (req.berries !== undefined && p.c.berries < req.berries) {
    return `Needs ${formatBerries(req.berries)} Berries`;
  }
  return null;
}

/** Why this person does not meet a requirement, or null when they do. */
export function requirementReason(
  state: WorldState,
  data: GameData,
  p: Person,
  req: Requires,
  tick: number,
): string | null {
  const own = baseReason(state, data, p, req, tick);
  if (own) return own;
  if (req.anyOf.length === 0) return null;
  const reasons = req.anyOf.map((alt) => baseReason(state, data, p, alt, tick));
  if (reasons.some((r) => r === null)) return null;
  return reasons.join('; or ');
}
