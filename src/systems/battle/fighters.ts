import type { Fighter, FighterMove } from '../../engine/battle-state';
import type { BattleRole, BattleZone, FoeDef, GameData, Intent } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { Entity, WorldState } from '../../engine/state';
import { STAT_IDS } from '../../engine/stats';
import { combatPowerOf, maxHealthOf, reputationValue, statTotal, statTotals } from '../life/body';
import { fruitDefOf, generateFruit } from '../powers/catalogue';
import { cursedNow, eatenFruit, fruitTrackOf } from '../powers/fruits';
import { staminaPool } from '../powers/haki';
import { temperamentOf } from '../powers/movesets';
import { HAKI_TRACKS, hakiAwake, stageOf, trackStateOf } from '../powers/state';
import { battleActions, moveDef, pricedTechnique, techniqueIndex } from '../powers/techniques';
import { tierSpan } from './ladder';

/**
 * Fighters (Phase 5): a person as they stand when a fight begins, or a nameless foe made from a
 * template in data/battle.json.
 *
 * Every number in a fight is the fighter's own stat times their power `k`: Combat Power over what
 * their stats alone would give. A thug's k is about 1; an Emperor's, whose haki, fruit and
 * mastery dwarf their body, about 10. The plan's formulas are written on these scaled numbers, so
 * a blow means the same at every rung of the ladder.
 */

export interface FighterOptions {
  id: string;
  side: 0 | 1;
  intent: Intent;
  role?: BattleRole;
  zone?: BattleZone;
  player?: boolean;
  leader?: boolean;
  /** Contest rules. */
  noFruits?: boolean;
  noWeapons?: boolean;
  reserve?: boolean;
}

const SWIMMERS = new Set(['race_fishman', 'race_merfolk']);
const CRIMINAL_JOBS = new Set(['occ_pirate', 'occ_bandit', 'occ_smuggler']);

/** What a fighter's stats alone give Combat Power (its formula without the bonus stack). */
export function statPower(data: GameData, stats: Readonly<Record<string, number>>): number {
  const def = data.character.derived.find((d) => d.id === 'combatPower');
  if (!def) return 1;
  let value = def.constant;
  for (const term of def.terms) {
    const s = stats[term.stat] ?? 0;
    value += 'factor' in term ? s * term.factor : s / term.divide;
  }
  return Math.max(10, value);
}

function freshStatus(): Fighter['status'] {
  return {
    coated: 0,
    read: 0,
    guarding: false,
    evading: false,
    opened: null,
    pinnedBy: null,
    pinned: 0,
    stunned: 0,
    burning: 0,
    bleeding: 0,
    poisoned: 0,
    blinded: 0,
    taunted: 0,
    shrunk: 0,
    overdrive: null,
    secondWind: false,
    protects: null,
    countering: false,
    callAt: null,
  };
}

function freshTotals(): Fighter['totals'] {
  return { dealt: 0, taken: 0, hits: 0, wounds: [], used: [], kos: 0 };
}

function staminaOf(data: GameData, endurance: number): number {
  const s = data.battle.stamina;
  return Math.round(s.constant + endurance * s.endurance);
}

function hakiStage(entity: Entity, colour: keyof typeof HAKI_TRACKS): number {
  const c = entity.character;
  if (!c || !hakiAwake(c, colour)) return 0;
  return (trackStateOf(c, HAKI_TRACKS[colour])?.stage ?? 0) + 1;
}

/** The weapon a person fights with: the best they carry (bought ones are named in their gear). */
function weaponOf(
  data: GameData,
  entity: Entity,
): { name: string; kind: string; attack: number; combat: number } | null {
  const gear = entity.character?.powers?.gear ?? {};
  let best: { name: string; kind: string; attack: number; combat: number } | null = null;
  for (const weapon of Object.values(data.weapons)) {
    if (!weapon.gear || (gear[weapon.gear] ?? 0) <= 0) continue;
    // A named purchase counts as itself; otherwise the plainest weapon of the kind.
    const owned = (gear[weapon.id] ?? 0) > 0;
    const plain = !Object.values(data.weapons).some(
      (w) => w.gear === weapon.gear && (w.price ?? 0) < (weapon.price ?? 0),
    );
    if (!owned && !plain) continue;
    const attack = (data.battle.damage.weaponAttack[weapon.gear] ?? 0) + weapon.attack;
    if (!best || weapon.combat > best.combat)
      best = { name: weapon.name, kind: weapon.gear, attack, combat: weapon.combat };
  }
  return best;
}

/** The best weapon's Combat Power (Phase 5 fills in the formula's weapon term). */
export function weaponCombat(
  data: GameData,
  entity: Entity,
): { name: string; value: number } | null {
  const w = weaponOf(data, entity);
  return w && w.combat > 0 ? { name: w.name, value: w.combat } : null;
}

function toMove(action: ReturnType<typeof battleActions>[number], effects: string[]): FighterMove {
  return {
    id: action.id,
    name: action.name,
    form: action.form,
    tags: [...action.tags],
    effects,
    power: action.power,
    accuracy: action.accuracy,
    cost: action.cost,
    range: action.range,
    source: action.source,
    signature: action.signature,
    finisher: action.finisher,
  };
}

/** A person as they stand at the start of a fight. */
export function fighterOf(
  state: WorldState,
  data: GameData,
  entity: Entity,
  tick: number,
  opts: FighterOptions,
): Fighter {
  const c = entity.character;
  const raw = statTotals(entity, tick);
  const stats: Record<string, number> = {};
  for (const id of STAT_IDS) stats[id] = Math.max(1, raw[id] ?? 0);
  let cp = combatPowerOf(data, entity, tick);

  // The fruit, unless the rules of a contest take it away.
  const fruitEntity = c ? eatenFruit(state, entity) : undefined;
  const def = fruitEntity ? fruitDefOf(data, fruitEntity) : undefined;
  let fruit: Fighter['fruit'] = null;
  if (def && c?.powers?.fruit && !c.powers.fruit.dud) {
    if (opts.noFruits) {
      const track = fruitTrackOf(data, def);
      const ts = track ? trackStateOf(c, track) : undefined;
      const t = track ? data.tracks[track] : undefined;
      if (t && ts) cp -= stageOf(t, ts).combat;
    } else {
      const index = techniqueIndex(data);
      const tags = new Set<string>(def.primitives);
      for (const t of def.techniques) for (const tag of t.tags) tags.add(tag);
      void index;
      fruit = {
        name: def.name,
        power: def.power,
        type: def.type,
        logia: def.intangible,
        tags: [...tags].sort(),
        weaknesses: def.weaknesses.map((w) => w.against),
      };
    }
  }
  let weapon = weaponOf(data, entity);
  if (weapon && opts.noWeapons) {
    cp -= weapon.combat;
    weapon = null;
  }
  cp = Math.max(1, cp);
  const k = Math.max(0.2, cp / statPower(data, stats));

  const moves: FighterMove[] = [];
  for (const action of battleActions(data, entity, tick)) {
    if (action.kind !== 'technique') continue;
    if (opts.noFruits && action.source === 'fruit') continue;
    if (opts.noWeapons && action.tags.some((t) => t === 'sword' || t === 'gun' || t === 'bow'))
      continue;
    const move = c?.powers?.moves.find((m) => m.id === action.id);
    const effects = move ? [...(moveDef(data, move)?.effects ?? [])] : [];
    moves.push(toMove(action, effects));
  }

  const maxHealth = maxHealthOf(data, entity, tick);
  const life = c?.life;
  const share = life ? Math.max(0, Math.min(1, life.health / maxHealth)) : 1;
  const maxHp = Math.max(1, Math.round(maxHealth * k));
  const maxHaki = staminaPool(data, entity, tick);
  const haki = c?.powers ? Math.min(maxHaki, c.powers.stamina) : maxHaki;
  const affiliation = entity.flags['affiliation'];
  const bounty = typeof entity.flags['bounty'] === 'number' ? entity.flags['bounty'] : 0;
  const fame = reputationValue(entity, 'fame', tick);
  const infamy = reputationValue(entity, 'infamy', tick);
  const marine = affiliation === 'org_marines' || c?.occupation === 'occ_marine';
  const conqueror =
    c &&
    data.powers.haki.kingsQualitiesTrait &&
    c.traits.includes(data.powers.haki.kingsQualitiesTrait)
      ? hakiStage(entity, 'conqueror')
      : 0;
  const maxStamina = staminaOf(data, stats['endurance'] ?? 0);

  return {
    id: opts.id,
    entityId: entity.id,
    name: entity.name,
    pronouns: c?.pronouns ?? 'they',
    side: opts.side,
    player: opts.player ?? false,
    intent: opts.intent,
    role: opts.role ?? 'striker',
    zone: opts.zone ?? 'front',
    cp: Math.round(cp),
    k: Math.round(k * 1000) / 1000,
    stats,
    hp: Math.max(1, Math.round(maxHp * share)),
    maxHp,
    stamina: maxStamina,
    maxStamina,
    haki,
    maxHaki,
    armament: hakiStage(entity, 'armament'),
    observation: hakiStage(entity, 'observation'),
    conqueror,
    fruit,
    cursed: fruit !== null && cursedNow(entity, tick),
    swimmer: SWIMMERS.has(c?.race ?? ''),
    weapon: weapon ? { name: weapon.name, kind: weapon.kind, attack: weapon.attack } : null,
    seastone: marine,
    temperament: temperamentOf(data, entity),
    moves,
    status: freshStatus(),
    down: null,
    downBy: null,
    totals: freshTotals(),
    bonds: {},
    combos: {},
    traits: [...(c?.traits ?? [])],
    criminal: bounty > 0 || CRIMINAL_JOBS.has(c?.occupation ?? '') || (infamy > fame && infamy > 5),
    marine,
    bounty,
    fame,
    leader: opts.leader ?? false,
    kit: Object.fromEntries(
      Object.entries(c?.powers?.gear ?? {}).filter(([id, n]) => id.startsWith('kit_') && n > 0),
    ),
    reserve: opts.reserve ?? false,
    front: false,
  };
}

/** A foe's Combat Power: their template's place inside its rung. */
export function foePower(data: GameData, foe: FoeDef, rng: Rng): number {
  const { min, max } = tierSpan(data, foe.tier);
  const within = rng.float(foe.within.min, foe.within.max);
  if (max === null) return Math.round(min * (1 + within * 0.4));
  return Math.round(min + (max - min) * within);
}

/**
 * A nameless foe from data/battle.json: a body that gives most of a weak foe's power and a share
 * of a strong one's, stats spread around it, the template's weapon and techniques, and (a few) a
 * Devil Fruit of the generator's making.
 */
export function foeFighter(
  data: GameData,
  foe: FoeDef,
  rng: Rng,
  opts: FighterOptions & { cp?: number; name?: string },
): Fighter {
  const cp = opts.cp ?? foePower(data, foe, rng.fork('cp'));
  const body = cp <= 500 ? cp * 0.9 : 450 + (cp - 500) * 0.12;
  const level = Math.max(3, Math.min(160, body / 4.1));
  const stats: Record<string, number> = {};
  for (const id of STAT_IDS) {
    stats[id] = Math.max(1, Math.round(level * rng.fork('stat', id).float(0.8, 1.2) * 10) / 10);
  }
  const k = Math.max(0.2, cp / statPower(data, stats));
  const maxHealth = 50 + 1.2 * (stats['durability'] ?? 0) + 0.8 * (stats['endurance'] ?? 0);
  const maxHp = Math.max(1, Math.round(maxHealth * k));
  const moves: FighterMove[] = [];
  const index = techniqueIndex(data);
  for (const id of foe.techniques) {
    const entry = index.get(id);
    if (!entry) continue;
    const priced = pricedTechnique(data, entry.def);
    moves.push({
      id,
      name: entry.def.name,
      form: entry.def.form,
      tags: [...entry.def.tags],
      effects: [...entry.def.effects],
      power: Math.round((priced.power ?? 0) * 0.8),
      accuracy: priced.accuracy ?? 70,
      cost: priced.cost ?? 0,
      range: priced.range ?? 'melee',
      source: entry.source,
      signature: false,
      finisher: entry.def.finisher,
    });
  }
  let fruit: Fighter['fruit'] = null;
  if (!opts.noFruits && foe.fruitChance > 0 && rng.fork('fruit?').chance(foe.fruitChance)) {
    const def = generateFruit(data, rng.fork('fruit'), {
      id: `fruit_gen_${opts.id.replace(/\W/g, '')}`,
      taken: new Set(),
    });
    const tags = new Set<string>(def.primitives);
    for (const t of def.techniques) for (const tag of t.tags) tags.add(tag);
    fruit = {
      name: def.name,
      power: def.power,
      type: def.type,
      logia: def.intangible,
      tags: [...tags].sort(),
      weaknesses: def.weaknesses.map((w) => w.against),
    };
    for (const t of def.techniques.filter((x) => x.mastery <= 40).slice(0, 3)) {
      const priced = pricedTechnique(data, t);
      moves.push({
        id: t.id,
        name: t.name,
        form: t.form,
        tags: [...t.tags],
        effects: [...t.effects],
        power: Math.round((priced.power ?? 0) * 0.8),
        accuracy: priced.accuracy ?? 70,
        cost: priced.cost ?? 0,
        range: priced.range ?? 'melee',
        source: 'fruit',
        signature: false,
        finisher: t.finisher,
      });
    }
  }
  const weapon =
    foe.weapon && !opts.noWeapons
      ? {
          name: foe.weapon,
          kind: foe.weapon,
          attack: data.battle.damage.weaponAttack[foe.weapon] ?? 0,
        }
      : null;
  const maxStamina = staminaOf(data, stats['endurance'] ?? 0);
  const name = opts.name ?? foe.name.replace(/^an? /, '').replace(/^./, (ch) => ch.toUpperCase());
  return {
    id: opts.id,
    entityId: null,
    name,
    pronouns: 'they',
    side: opts.side,
    player: false,
    intent: opts.intent,
    role: opts.role ?? (foe.weapon === 'gun' || foe.weapon === 'bow' ? 'ranged' : 'striker'),
    zone: opts.zone ?? (foe.weapon === 'gun' || foe.weapon === 'bow' ? 'rear' : 'front'),
    cp,
    k: Math.round(k * 1000) / 1000,
    stats,
    hp: maxHp,
    maxHp,
    stamina: maxStamina,
    maxStamina,
    haki: foe.armament + foe.observation > 0 ? 20 : 0,
    maxHaki: foe.armament + foe.observation > 0 ? 20 : 0,
    armament: foe.armament,
    observation: foe.observation,
    conqueror: 0,
    fruit,
    cursed: false,
    swimmer: foe.id === 'foe_sea_king',
    weapon,
    seastone: !foe.criminal && foe.intent === 'capture',
    temperament:
      foe.intent === 'kill' ? 'aggressive' : foe.intent === 'spare' ? 'cautious' : 'balanced',
    moves,
    status: freshStatus(),
    down: null,
    downBy: null,
    totals: freshTotals(),
    bonds: {},
    combos: {},
    traits: [],
    foe: foe.id,
    criminal: foe.criminal,
    marine: foe.id.startsWith('foe_marine'),
    bounty: 0,
    fame: 0,
    leader: opts.leader ?? false,
    kit: opts.role === 'support' ? { kit_medicine: 1 } : {},
    reserve: opts.reserve ?? false,
    front: false,
  };
}

/** Raw stat, for checks that read the person and not their power (Willpower against a blow). */
export function rawStat(f: Fighter, stat: string): number {
  return f.stats[stat] ?? 0;
}

export { statTotal };
