import type { GameData, Weapon } from '../../engine/data/schemas';
import type { WeaponFamily } from '../../engine/data/defs';
import type { Entity, WorldState } from '../../engine/state';
import { carried, itemOf, weaponDefOf } from './items';

/**
 * Weapons in a fight (Phase 6): what a weapon item adds, from its family, grade, how well it was
 * made, its edge, whether it has turned black, its curse, and the wielder's skill with its family.
 * The battle engine reads one summary per fighter (`weaponOfEntity`); people without weapon items
 * (Tier 2 fighters, the canon cast before their blades) fall back to their gear kind.
 */

export interface WeaponSummary {
  name: string;
  /** What fighting styles and techniques call it: "swords", "gun", "bow", or the family. */
  kind: string;
  family: WeaponFamily;
  attack: number;
  combat: number;
  /** Accuracy added (skill). */
  accuracy: number;
  seastone: boolean;
  /** Haki stamina an untamed hungry blade drinks each exchange it is used. */
  drain: number;
  /** The items in hand, main weapon first (empty for a fighter without weapon items). */
  items: string[];
}

export function kindOf(data: GameData, weapon: Weapon): string {
  return weapon.gear ?? data.hands.families[weapon.family]?.gear ?? weapon.family;
}

export function qualityMult(data: GameData, quality: number): number {
  const q = data.hands.quality;
  return q.at0 + ((q.at100 - q.at0) * Math.max(0, Math.min(100, quality))) / 100;
}

export function skillOf(entity: Entity, family: string): number {
  return entity.character?.hands?.skills[family] ?? 0;
}

/** What one weapon item adds to a blow, before the wielder's skill. */
export function itemAttack(data: GameData, item: Entity): number {
  const def = weaponDefOf(data, item);
  const b = item.item;
  if (!def || !b) return 0;
  const family = data.hands.families[def.family];
  const grade = data.hands.grades[b.grade ?? def.grade];
  let attack = ((family?.attack ?? 0) + def.attack) * (grade?.attackMult ?? 1);
  attack *= qualityMult(data, b.quality);
  if (b.black) attack *= 1 + data.hands.black.attack;
  else if (b.sharpness !== undefined && b.sharpness < data.hands.edge.dull)
    attack *= data.hands.edge.dullMult;
  if (b.curse) {
    const rule = data.hands.curses[b.curse.id];
    attack *= 1 + (b.curse.tamed ? (rule?.tamedAttack ?? 0) : (rule?.attack ?? 0));
  }
  return attack;
}

/** What one weapon item adds to Combat Power. */
export function itemCombat(data: GameData, item: Entity): number {
  const def = weaponDefOf(data, item);
  const b = item.item;
  if (!def || !b) return 0;
  const grade = data.hands.grades[b.grade ?? def.grade];
  return (
    def.combat * qualityMult(data, b.quality) +
    (grade?.combat ?? 0) +
    (b.black ? def.combat * 0.25 : 0)
  );
}

/** The weapons a person has in hand: what they wield, or else the best they carry. */
export function inHand(state: WorldState, data: GameData, entity: Entity): Entity[] {
  const hands = entity.character?.hands;
  if (!hands) return [];
  const wielded = hands.wield
    .map((id) => itemOf(state, id))
    .filter(
      (x): x is Entity =>
        !!x && x.item?.holderId === entity.id && weaponDefOf(data, x) !== undefined,
    );
  if (wielded.length > 0) return wielded.sort((a, b) => itemAttack(data, b) - itemAttack(data, a));
  const best = carried(state, entity)
    .filter((x) => weaponDefOf(data, x) !== undefined)
    .sort((a, b) => itemAttack(data, b) - itemAttack(data, a))[0];
  return best ? [best] : [];
}

/** A plain weapon for someone without weapon items: by their occupation, else by gear kind. */
function plainWeapon(data: GameData, entity: Entity): Weapon | null {
  const gear = entity.character?.powers?.gear ?? {};
  // Weapons bought before Phase 6 made weapons items: the best one named in the gear.
  let named: Weapon | null = null;
  for (const [id, n] of Object.entries(gear)) {
    const w = data.weapons[id];
    if (w && n > 0 && (!named || w.combat > named.combat)) named = w;
  }
  if (named) return named;
  const occ = entity.character?.occupation;
  const byOcc = occ ? data.weapons[data.hands.npcWeapons[occ] ?? ''] : undefined;
  if (byOcc && (gear[kindOf(data, byOcc)] ?? 0) > 0) return byOcc;
  const fallback: Record<string, string> = {
    swords: 'weapon_sword',
    gun: 'weapon_flintlock',
    bow: 'weapon_bow',
  };
  for (const kind of ['swords', 'gun', 'bow']) {
    if ((gear[kind] ?? 0) > 0) return data.weapons[fallback[kind] ?? ''] ?? null;
  }
  return null;
}

/** The weapon a person fights with, summed up for the battle engine. */
export function weaponOfEntity(
  state: WorldState,
  data: GameData,
  entity: Entity,
): WeaponSummary | null {
  const items = inHand(state, data, entity);
  const main = items[0];
  const mainDef = weaponDefOf(data, main);
  if (main && mainDef) {
    const skill = skillOf(entity, mainDef.family);
    // A second and third blade (two- and three-sword styles) add a share of their own edge.
    let attack = itemAttack(data, main);
    let combat = itemCombat(data, main);
    for (const extra of items.slice(1)) {
      attack += itemAttack(data, extra) * 0.2;
      combat += itemCombat(data, extra) * 0.2;
    }
    const s = data.hands.skill;
    const carriesBullets = carried(state, entity).some(
      (x) => x.item?.defId === 'item_seastone_bullets',
    );
    const carriesEdge = carried(state, entity).some((x) => x.item?.defId === 'item_seastone_edge');
    const curse = main.item?.curse;
    const drain = curse && !curse.tamed ? (data.hands.curses[curse.id]?.drain ?? 0) : 0;
    return {
      name: main.name,
      kind: kindOf(data, mainDef),
      family: mainDef.family,
      attack: Math.round((attack + skill * s.attack) * 10) / 10,
      combat: Math.round(combat + skill * 2),
      accuracy: Math.round(skill * s.accuracy * 10) / 10,
      seastone:
        main.item?.seastone === true ||
        (mainDef.family === 'firearm' && carriesBullets) ||
        (mainDef.family === 'blade' && carriesEdge),
      drain,
      items: items.map((x) => x.id),
    };
  }
  const plain = plainWeapon(data, entity);
  if (!plain) return null;
  const family = data.hands.families[plain.family];
  return {
    name: plain.name,
    kind: kindOf(data, plain),
    family: plain.family,
    attack: (family?.attack ?? 0) + plain.attack,
    combat: plain.combat,
    accuracy: 0,
    seastone: plain.seastone,
    drain: 0,
    items: [],
  };
}

/** The armour worn: defence added in a fight (none in the water for a swimmer: see the engine). */
export function armourOf(state: WorldState, data: GameData, entity: Entity): number {
  const id = entity.character?.hands?.armour;
  const item = itemOf(state, id);
  if (!item || item.item?.holderId !== entity.id) return 0;
  return data.items[item.item.defId]?.armour ?? 0;
}
