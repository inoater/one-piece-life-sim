import type { GameData } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { CharacterData, Entity, WorldState } from '../../engine/state';
import { makeStat } from '../../engine/stats';
import { giveTraitTo } from '../life/traits';
import { humanAgeOf, isMarried } from '../life/body';
import { lifeLog, reportLine, type LifeEnv } from '../life/env';
import { meetPerson, relate } from '../life/people';
import { firstMeeting } from './meet';
import { circle, markMet, moveAxis, relOf } from './bonds';
import { renderHeart } from './speech';
import { clampMorale, ensureHeart, setMood } from './profile';
import { remember } from './memory';

/**
 * Family, love and lineage (Phase 7). Children take after their parents: heritable traits, hidden
 * potential leaning toward theirs (Phase 1's tiers), appearance ids for Phase 14, and personality
 * leanings; the full rules of heredity and bloodlines are Phase 10's. Adoption, a will naming an
 * heir, grief and widowhood, and a family name that carries its reputation down the generations.
 */

export class FamilyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FamilyError';
  }
}

/**
 * A family feud: the kin of someone the player killed hold it against them (a heavy grudge, and
 * colder feelings where they already know the player).
 */
export function feudFor(
  state: WorldState,
  data: GameData,
  deadId: string,
  killer: Entity,
  seq: number,
  place: string | null,
): void {
  const dead = state.entities[deadId];
  for (const rel of dead?.character?.relationships ?? []) {
    if (!['parent', 'child', 'sibling', 'sweetheart', 'guardian', 'ward'].includes(rel.kind))
      continue;
    const kin = state.entities[rel.id];
    if (!kin?.character?.alive || kin.id === killer.id) continue;
    remember(state, data, kin, { about: killer.id, kind: 'grudge', weight: -60, place, seq });
    const theirs = relOf(kin, killer.id);
    if (theirs)
      moveAxis(
        data,
        theirs,
        'affection',
        -50,
        `You killed ${dead?.character?.givenName ?? 'them'}`,
        seq,
        state.tick,
      );
  }
}

/** A child takes after `parents`: traits, potential, appearance and personality. */
export function inheritFrom(
  state: WorldState,
  data: GameData,
  child: Entity,
  parents: readonly Entity[],
  rng: Rng,
): void {
  const c = child.character;
  if (!c || parents.length === 0) return;
  const rules = data.heart.heredity;
  const tick = state.tick;
  // Traits that run in families: each a parent has may pass.
  const held = new Set<string>();
  for (const parent of parents) for (const t of parent.character?.traits ?? []) held.add(t);
  for (const id of rules.traits) {
    if (!held.has(id) || c.traits.includes(id)) continue;
    if (!rng.fork('trait', id).chance(rules.traitChance)) continue;
    const from = parents.find((p) => p.character?.traits.includes(id));
    giveTraitTo(data, child, id, `Inherited from ${from?.name ?? 'a parent'}`, tick);
  }
  // Hidden potential leaning toward the parents' (and their talent tier, now and then).
  const withHidden = parents.filter((p) => p.character?.hidden);
  if (withHidden.length > 0) {
    const tierRng = rng.fork('talent');
    const parentTier = tierRng.pick(withHidden).character?.hidden?.talent;
    const rolled = tierRng
      .fork('roll')
      .weightedPick(data.character.talentTiers, (t) => t.chance)?.id;
    const talent =
      parentTier && tierRng.fork('lean').chance(rules.potentialPull)
        ? parentTier
        : (rolled ?? parentTier ?? 'average');
    const potential: Record<string, ReturnType<typeof makeStat>> = {};
    const stats = new Set<string>();
    for (const p of withHidden)
      for (const s of Object.keys(p.character?.hidden?.potential ?? {})) stats.add(s);
    for (const stat of [...stats].sort()) {
      const values = withHidden
        .map((p) => p.character?.hidden?.potential[stat]?.base)
        .filter((v): v is number => v !== undefined);
      const mean = values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
      potential[stat] = makeStat(
        Math.round(mean * rng.fork('pot', stat).float(0.9, 1.1) * 10) / 10,
      );
    }
    c.hidden = { talent, potential };
  }
  // Appearance ids: each field from one parent or the other, now and then something new.
  const fields = data.appearance.fields;
  for (const field of fields) {
    const r = rng.fork('look', field.id);
    const from = parents
      .map((p) => p.character?.appearance[field.id])
      .filter((v): v is string => typeof v === 'string');
    if (from.length > 0 && !r.chance(rules.appearanceMutation))
      c.appearance[field.id] = r.pick(from);
    else if (field.options.length > 0)
      c.appearance[field.id] = r.fork('new').pick(field.options).id;
  }
  const heights = parents
    .map((p) => p.character?.adultHeightCm)
    .filter((v): v is number => v !== undefined);
  if (heights.length > 0)
    c.adultHeightCm = Math.round(
      (heights.reduce((s, v) => s + v, 0) / heights.length) * rng.fork('height').float(0.95, 1.05),
    );
  // Personality: their parents' leanings, with a will of their own.
  for (const parent of parents) ensureHeart(state, data, parent);
  ensureHeart(state, data, child, parents);
}

/**
 * A character carried on in (Phase 2's continuation) gets a body from character genesis; what
 * they inherited from their parents is kept: appearance, and potential pulled toward the
 * inherited leaning.
 */
export function keepInheritance(
  data: GameData,
  made: CharacterData,
  target: CharacterData,
  inherited: CharacterData['hidden'],
  inheritedLook: Record<string, string>,
): void {
  target.appearance = { ...made.appearance, ...inheritedLook };
  if (!made.hidden) return;
  const hidden = structuredClone(made.hidden);
  if (inherited) {
    hidden.talent = inherited.talent;
    const pull = data.heart.heredity.potentialPull;
    for (const [stat, p] of Object.entries(hidden.potential)) {
      const from = inherited.potential[stat];
      if (from) p.base = Math.round((p.base * (1 - pull) + from.base * pull) * 10) / 10;
    }
  }
  target.hidden = hidden;
}

/** The family name's reputation passes to whoever carries the story on under it. */
export function passFamilyName(dead: Entity, target: Entity): void {
  const from = dead.character?.heart?.rep;
  const tc = target.character;
  if (!from || !tc?.heart) return;
  tc.heart.rep ??= {};
  for (const [scope, dims] of Object.entries(from)) {
    if (!scope.startsWith('family:')) continue;
    tc.heart.rep[scope] = { ...dims, ...(tc.heart.rep[scope] ?? {}) };
  }
}

/** Take in a child of the place who has nobody. */
export function adopt(env: LifeEnv): Entity {
  const { state, data, tick, p } = env;
  if (humanAgeOf(data, p, tick) < 18) throw new FamilyError('You are too young to raise a child');
  if (p.place.atSea || !p.place.location) throw new FamilyError('Not at sea');
  const here = state.entities[p.place.location.id]?.place;
  if (!here || here.residents.children < 1)
    throw new FamilyError('There is no child here who needs a home');
  const rng = env.rng.fork('adopt', tick);
  const child = meetPerson(state, data, p, rng, tick, humanAgeOf(data, p, tick), {
    ageOffset: { min: -60, max: -60 },
  });
  const cc = child.character as CharacterData;
  const age = rng.fork('age').int(2, 10);
  cc.birthTick = tick - age * 12 - rng.fork('month').int(0, 11);
  cc.familyName = p.c.familyName;
  child.name = p.c.familyName ? `${cc.givenName} ${p.c.familyName}` : cc.givenName;
  delete cc.occupation;
  child.flags['adopted'] = true;
  relate(p.entity, child, 'child', 60, tick, rng.fork('relate'));
  const text = renderHeart(state, data, child, data.heart.lines.adopted, rng.fork('line'));
  const record = lifeLog(env, text, {
    kind: 'event',
    tags: ['family', 'birth', 'relationship'],
    others: [child.id],
  });
  reportLine(env, text, 'good');
  markMet(p.entity, child, record.seq);
  firstMeeting(env, child, record.seq);
  return child;
}

/** Name an heir: they come first when the story carries on. */
export function makeWill(env: LifeEnv, heirId: string): void {
  const { state, data, p } = env;
  const heir = state.entities[heirId];
  const rel = relOf(p.entity, heirId);
  if (!heir?.character?.alive || !rel)
    throw new FamilyError('You can only name someone you know who lives');
  if (!['child', 'protege', 'sibling', 'crewmate', 'friend'].includes(rel.kind))
    throw new FamilyError('An heir is a child, a student, a sibling or a crewmate');
  const heart = ensureHeart(state, data, p.entity);
  heart.heir = heirId;
  const text = renderHeart(state, data, heir, data.heart.lines.willMade, env.rng.fork('will'));
  lifeLog(env, text, { kind: 'event', tags: ['personal', 'family'], others: [heirId] });
  reportLine(env, text, 'plain');
}

/**
 * The month's grief: anyone close who died since last month. Grief for a while, morale lost by how
 * much they were loved; a spouse lost leaves the player widowed. Those who loved the dead too
 * remember the loss (and the player's part, if any).
 */
export function griefMonth(env: LifeEnv): void {
  const { state, data, tick, p } = env;
  const myHeart = ensureHeart(state, data, p.entity);
  for (const rel of p.c.relationships) {
    const other = state.entities[rel.id];
    const oc = other?.character;
    if (!other || !oc || oc.alive || !oc.death) continue;
    if (oc.death.tick < tick - 1) continue;
    const heart = ensureHeart(state, data, other);
    heart.reached ??= {};
    if (heart.reached['mourned'] !== undefined) continue;
    heart.reached['mourned'] = tick;
    const love = Math.max(
      0,
      rel.opinion.base +
        rel.opinion.mods.reduce((s, m) => s + (m.kind === 'flat' ? m.value : 0), 0),
    );
    if (love < 15 && rel.kind !== 'parent' && rel.kind !== 'child') continue;
    setMood(data, myHeart, 'grieving', tick);
    myHeart.morale = clampMorale(myHeart.morale - Math.min(30, 5 + love / 4));
    const married = rel.kind === 'sweetheart' && (rel.romance === 'married' || isMarried(other));
    const text = renderHeart(
      state,
      data,
      other,
      married ? data.heart.lines.widowed : data.heart.lines.grief,
      env.rng.fork('grief', other.id),
    );
    const record = lifeLog(env, text, {
      kind: 'event',
      tags: ['personal', 'family', 'grief'],
      others: [other.id],
    });
    reportLine(env, text, 'bad');
    if (married) p.entity.flags['married'] = false;
    // Their other loved ones grieve with the player: a shared loss remembered.
    for (const { other: mourner } of circle(state, p.entity)) {
      if (!relOf(mourner, other.id)) continue;
      remember(state, data, mourner, {
        about: p.entity.id,
        kind: 'loss',
        weight: 8,
        place: p.place.location?.id ?? null,
        seq: record.seq,
      });
    }
  }
}
