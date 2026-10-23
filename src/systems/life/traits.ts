import type { GameData } from '../../engine/data/schemas';
import type { Entity } from '../../engine/state';
import { addMod, removeModsBySource } from '../../engine/stats';
import { blockedTraits } from '../genesis/context';

/**
 * Traits gained during a life: a scar, Sea Legs from a month on the boats. The same rules as at
 * birth (stat and potential modifiers, flags, exclusions both ways); in this phase traits change
 * stats and open activities, and full trait mechanics arrive in Phase 4.
 */

export function traitSource(name: string): string {
  return `${name} (trait)`;
}

/** Give a trait to a character. False (and nothing changes) if it is held or excluded. */
export function giveTraitTo(data: GameData, entity: Entity, traitId: string): boolean {
  const c = entity.character;
  const trait = data.traits[traitId];
  if (!c || !trait) return false;
  if (blockedTraits(data, c.traits).has(traitId)) return false;
  c.traits.push(traitId);
  const source = traitSource(trait.name);
  for (const mod of trait.statMods) {
    const stat = entity.stats[mod.stat];
    if (stat) addMod(stat, { source, value: mod.value, kind: mod.kind });
  }
  for (const mod of trait.potentialMods) {
    const potential = c.hidden?.potential[mod.stat];
    if (potential) addMod(potential, { source, value: mod.pct, kind: 'pct' });
  }
  Object.assign(entity.flags, trait.flags);
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
  const isTraitMod = (source: string) => source.endsWith(' (trait)');
  for (const stat of Object.values(entity.stats)) {
    for (const source of new Set(stat.mods.map((m) => m.source)))
      if (isTraitMod(source)) removeModsBySource(stat, source);
  }
  for (const potential of Object.values(c.hidden?.potential ?? {})) {
    for (const source of new Set(potential.mods.map((m) => m.source)))
      if (isTraitMod(source)) removeModsBySource(potential, source);
  }
  const held = [...c.traits];
  c.traits = [];
  for (const id of held) giveTraitTo(data, entity, id);
}
