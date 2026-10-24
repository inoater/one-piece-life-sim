import type { DerivedBonus, GameData, Trait } from '../../engine/data/schemas';
import { traitKind } from '../../engine/data/schemas';
import type { CharacterData, Entity, Relationship } from '../../engine/state';
import { addMod, makeStat, removeModsBySource, statLabel } from '../../engine/stats';
import { blockedTraits } from '../genesis/context';

/**
 * Traits (Phase 4: full mechanics). A trait is a data file with any mix of: stat and potential
 * modifiers, training multipliers (all stats, or one), changes to derived values (Max Health,
 * Vigor, haki stamina, Combat Power), event weight changes, check bonuses, immunities, unlocks
 * (flags) and locks, opinion modifiers others feel, practice speed for powers, conflicts, and
 * evolutions. Personality traits come and go with the hidden counters (personality.ts); earned
 * traits arrive once a behaviour has been repeated enough.
 *
 * Every number a trait changes is a modifier whose source is "Name (trait)" (rule 3), so the sheet
 * can explain it and `removeTrait` can take it back exactly.
 */

export function traitSource(name: string): string {
  return `${name} (trait)`;
}

const isTraitMod = (source: string) => source.endsWith(' (trait)');

/** The entity stat a derived value's bonuses live on (character.json `bonusStat`). */
export function derivedBonusStat(data: GameData, id: DerivedBonus): string | undefined {
  return data.character.derived.find((d) => d.id === id)?.bonusStat;
}

function bonusStatOf(entity: Entity, id: string) {
  let stat = entity.stats[id];
  if (!stat) {
    stat = makeStat(0);
    entity.stats[id] = stat;
  }
  return stat;
}

function applyTraitMods(data: GameData, entity: Entity, c: CharacterData, trait: Trait): void {
  const source = traitSource(trait.name);
  for (const mod of trait.statMods) {
    const stat = entity.stats[mod.stat];
    if (stat) addMod(stat, { source, value: mod.value, kind: mod.kind });
  }
  for (const mod of trait.potentialMods) {
    const potential = c.hidden?.potential[mod.stat];
    if (potential) addMod(potential, { source, value: mod.pct, kind: 'pct' });
  }
  for (const [id, value] of Object.entries(trait.derivedMods)) {
    const statId = derivedBonusStat(data, id as DerivedBonus);
    if (statId && value) addMod(bonusStatOf(entity, statId), { source, value, kind: 'flat' });
  }
  Object.assign(entity.flags, trait.flags);
}

/**
 * Give a trait to a character. False (and nothing changes) if it is held or excluded. `source` is
 * where it came from, for the sheet ("Born with it", "A brawl in 1497 SC").
 */
export function giveTraitTo(
  data: GameData,
  entity: Entity,
  traitId: string,
  source = 'Gained along the way',
  tick?: number,
): boolean {
  const c = entity.character;
  const trait = data.traits[traitId];
  if (!c || !trait) return false;
  if (blockedTraits(data, c.traits).has(traitId)) return false;
  c.traits.push(traitId);
  applyTraitMods(data, entity, c, trait);
  c.traitInfo ??= {};
  c.traitInfo[traitId] = { tick: tick ?? entity.createdTick, source };
  return true;
}

/** Take a trait away (drift, an evolution, a pardon): its modifiers and the flags it set. */
export function removeTrait(data: GameData, entity: Entity, traitId: string): boolean {
  const c = entity.character;
  const trait = data.traits[traitId];
  if (!c || !trait || !c.traits.includes(traitId)) return false;
  c.traits = c.traits.filter((t) => t !== traitId);
  const source = traitSource(trait.name);
  for (const stat of Object.values(entity.stats)) removeModsBySource(stat, source);
  for (const potential of Object.values(c.hidden?.potential ?? {}))
    removeModsBySource(potential, source);
  for (const [flag, value] of Object.entries(trait.flags)) {
    const stillGiven = c.traits.some((t) => data.traits[t]?.flags[flag] === value);
    if (entity.flags[flag] === value && !stillGiven) delete entity.flags[flag];
  }
  if (c.traitInfo) delete c.traitInfo[traitId];
  return true;
}

/**
 * Rebuild every trait modifier from the trait list (used when someone else's body is taken over:
 * their traits are kept, their stats are rolled fresh). Removes modifiers whose source ends in
 * " (trait)" and adds them again for each trait held.
 */
export function reapplyTraits(data: GameData, entity: Entity): void {
  const c = entity.character;
  if (!c) return;
  for (const stat of Object.values(entity.stats)) {
    for (const source of new Set(stat.mods.map((m) => m.source)))
      if (isTraitMod(source)) removeModsBySource(stat, source);
  }
  for (const potential of Object.values(c.hidden?.potential ?? {})) {
    for (const source of new Set(potential.mods.map((m) => m.source)))
      if (isTraitMod(source)) removeModsBySource(potential, source);
  }
  for (const id of c.traits) {
    const trait = data.traits[id];
    if (trait) applyTraitMods(data, entity, c, trait);
  }
}

// ---- Reading the mechanics --------------------------------------------------------------------

/** What traits add to a check of this stat ("Silver-Tongued: +10 on Charisma checks"). */
export function checkBonus(data: GameData, c: CharacterData | undefined, stat: string): number {
  if (!c) return 0;
  let bonus = 0;
  for (const id of c.traits) bonus += data.traits[id]?.checkBonuses[stat as never] ?? 0;
  return bonus;
}

/** Whether a trait keeps this from happening to them ("seasickness", an illness id). */
export function immuneTo(data: GameData, c: CharacterData | undefined, what: string): boolean {
  return c?.traits.some((id) => data.traits[id]?.immunities.includes(what)) ?? false;
}

/** Percent a trait adds to one stat's training. */
export function trainingModPct(data: GameData, c: CharacterData, stat: string): number {
  let pct = 0;
  for (const id of c.traits) pct += data.traits[id]?.trainingMods[stat as never] ?? 0;
  return pct;
}

/** The product of traits' weights on these tags (events, and the outcomes of a month). */
export function tagWeight(
  data: GameData,
  c: CharacterData | undefined,
  tags: readonly string[],
): number {
  if (!c) return 1;
  let weight = 1;
  for (const tag of tags)
    for (const id of c.traits) weight *= data.traits[id]?.eventWeights[tag] ?? 1;
  return weight;
}

/** Why a trait closes this activity to them, or null ("Not with Landlubber (4 more months)"). */
export function traitLock(
  data: GameData,
  c: CharacterData,
  activityId: string,
  tick: number,
): string | null {
  for (const id of c.traits) {
    const trait = data.traits[id];
    const lock = trait?.locks.find((l) => l.activity === activityId);
    if (!trait || !lock) continue;
    if (lock.months === undefined) return `Not with ${trait.name}`;
    const since = c.traitInfo?.[id]?.tick ?? -Infinity;
    const left = since + lock.months - tick;
    if (left > 0)
      return `Not with ${trait.name} (${left === 1 ? '1 more month' : `${left} more months`})`;
  }
  return null;
}

// ---- What others feel -------------------------------------------------------------------------

/** The groups someone belongs to, for trait opinion modifiers ("nobles", "pirates"). */
export function groupsOf(data: GameData, entity: Entity): Set<string> {
  const out = new Set<string>(['everyone']);
  const c = entity.character;
  for (const [name, group] of Object.entries(data.personality.groups)) {
    if (c?.occupation && group.occupations.includes(c.occupation)) out.add(name);
    else if (c && group.races.includes(c.race)) out.add(name);
    else if (group.flags.some((f) => entity.flags[f] !== undefined)) out.add(name);
  }
  return out;
}

/** The modifiers `target`'s traits put on what `viewer` thinks of them. */
export function opinionMods(
  data: GameData,
  viewer: Entity,
  target: Entity,
  firstMeeting: boolean,
): { source: string; value: number }[] {
  const groups = groupsOf(data, viewer);
  const out: { source: string; value: number }[] = [];
  for (const id of target.character?.traits ?? []) {
    const trait = data.traits[id];
    if (!trait) continue;
    let value = 0;
    for (const o of trait.opinion) {
      if (o.firstImpression && !firstMeeting) continue;
      if (groups.has(o.group)) value += o.value;
    }
    if (value !== 0) out.push({ source: traitSource(trait.name), value });
  }
  return out;
}

function addOpinionMods(
  rel: Relationship | undefined,
  mods: { source: string; value: number }[],
): void {
  if (!rel) return;
  for (const mod of mods) {
    if (rel.opinion.mods.some((m) => m.source === mod.source)) continue;
    addMod(rel.opinion, { source: mod.source, value: mod.value, kind: 'flat' });
  }
}

/**
 * Two people have just met: each one's traits colour what the other thinks of them (Charming +10
 * on first meeting; Scarred -5 with nobles, +5 with pirates).
 */
export function firstImpressions(data: GameData, a: Entity, b: Entity): void {
  const relA = a.character?.relationships.find((r) => r.id === b.id);
  const relB = b.character?.relationships.find((r) => r.id === a.id);
  addOpinionMods(relB, opinionMods(data, b, a, true));
  addOpinionMods(relA, opinionMods(data, a, b, true));
}

// ---- Describing a trait -----------------------------------------------------------------------

const DERIVED_LABEL: Record<DerivedBonus, string> = {
  maxHealth: 'Max Health',
  vigor: 'Vigor a month',
  hakiStamina: 'haki stamina',
  combatPower: 'Combat Power',
};

function signed(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n * 10) / 10)}`;
}

function checkLabel(id: string): string {
  if (id === 'combatPower') return 'Combat Power';
  if (id === 'navigation') return 'seamanship';
  return statLabel(id);
}

/**
 * Everything a trait does, as short lines for the sheet: "+3 Willpower", "+10% training",
 * "+10 on Charisma checks", "misfortune events x2", "locks Rigging for 12 months",
 * "nobles −5 opinion, pirates +5". A hidden trait shows nothing (rule 4).
 */
export function describeTrait(data: GameData, trait: Trait): string[] {
  if (trait.hidden) return [];
  const out: string[] = [];
  for (const m of trait.statMods)
    out.push(`${signed(m.value)}${m.kind === 'pct' ? '%' : ''} ${statLabel(m.stat)}`);
  for (const m of trait.potentialMods) out.push(`${signed(m.pct)}% ${statLabel(m.stat)} potential`);
  if (trait.trainingGainPct) out.push(`${signed(trait.trainingGainPct)}% to all training`);
  for (const [stat, pct] of Object.entries(trait.trainingMods))
    out.push(`${signed(pct ?? 0)}% ${statLabel(stat)} training`);
  for (const [id, v] of Object.entries(trait.derivedMods))
    out.push(`${signed(v ?? 0)} ${DERIVED_LABEL[id as DerivedBonus]}`);
  for (const [stat, v] of Object.entries(trait.checkBonuses))
    out.push(`${signed(v ?? 0)} on ${checkLabel(stat)} checks`);
  for (const [tag, mult] of Object.entries(trait.eventWeights)) {
    out.push(
      `${tag.replace(/_/g, ' ')} ${mult >= 1 ? 'more' : 'less'} likely (x${Math.round(mult * 100) / 100})`,
    );
  }
  for (const what of trait.immunities) {
    out.push(
      `never ${what === 'seasickness' ? 'seasick' : `catches ${data.life.illnesses.find((i) => i.id === what)?.name.toLowerCase() ?? what}`}`,
    );
  }
  for (const lock of trait.locks) {
    const act = data.activities[lock.activity]?.name ?? lock.activity;
    out.push(
      lock.months
        ? `cannot ${act.toLowerCase()} for ${lock.months} months`
        : `cannot ${act.toLowerCase()}`,
    );
  }
  const opinions = trait.opinion.map(
    (o) =>
      `${o.group === 'everyone' ? 'everyone' : o.group} ${signed(o.value)} opinion${o.firstImpression ? ' on first meeting' : ''}`,
  );
  if (opinions.length > 0) out.push(opinions.join(', '));
  for (const [key, pct] of Object.entries(trait.powerMods)) {
    const name = key.startsWith('family:')
      ? `${key.slice(7).replace(/_/g, ' ')} powers`
      : (data.tracks[key]?.name ?? key);
    out.push(`${signed(pct)}% practice of ${name}`);
  }
  for (const [flag, value] of Object.entries(trait.flags)) {
    if (flag.startsWith('unlock.')) out.push(`opens ${flag.slice(7).replace(/_/g, ' ')}`);
    else if (flag.startsWith('haki.') && typeof value === 'number')
      out.push(`${flag.slice(5)} haki from the start`);
  }
  if (trait.excludes.length > 0) {
    out.push(`never with ${trait.excludes.map((id) => data.traits[id]?.name ?? id).join(' or ')}`);
  }
  if (trait.evolves)
    out.push(`can grow into ${data.traits[trait.evolves.to]?.name ?? trait.evolves.to}`);
  return out;
}

/** The trait's kind, for grouping on the sheet. */
export function kindOf(trait: Trait): string {
  return traitKind(trait);
}
