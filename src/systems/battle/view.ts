import type { BattleLine, BattleState, Fighter } from '../../engine/battle-state';
import type { GameData } from '../../engine/data/schemas';
import { Rng } from '../../engine/rng';
import type { WorldState } from '../../engine/state';
import { combatPowerOf, playerPerson } from '../life/body';
import { PLAYER_FIGHTER } from './aftermath';
import { canTouch, enemiesOf, hitChance, type BattleCtx } from './engine';
import { tierOf } from './ladder';
import { duelOdds, oddsWords } from './scales';

/**
 * What the battle screen shows (Phase 5): both sides with Health, stamina and haki as bars, the
 * actions the player has with their chances in words ("likely", "a long shot") and as numbers
 * for hovering, the running log, the board, the fronts, the ships, and the post-fight card.
 */

export interface FighterView {
  id: string;
  name: string;
  side: 0 | 1;
  player: boolean;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  haki: number;
  maxHaki: number;
  cp: number;
  tier: string;
  role: string;
  zone: string;
  /** "Coated in Armament", "Pinned", "Gear Second"... */
  status: string[];
  fruit: string | null;
  down: string | null;
  /** At the fronts (crew battles, wars) or waiting to tag in. */
  away: string | null;
}

export interface ActionView {
  key: string;
  verb: string;
  label: string;
  move?: string;
  haki?: 'read' | 'coat' | 'burst';
  talk?: 'taunt' | 'surrender' | 'persuade' | 'stall';
  item?: string;
  /** Against the chosen target: the chance it lands, and in words. */
  chance: number | null;
  words: string;
  detail: string;
  lock: string | null;
  needsTarget: boolean;
}

export interface BattleView {
  id: number;
  title: string;
  scale: string;
  mode: string;
  spar: boolean;
  contest: string | null;
  exchange: number;
  maxExchanges: number;
  round: number;
  sides: {
    name: string;
    morale: number;
    ranks: number;
    broken: boolean;
    order: string;
    target: string | null;
  }[];
  fighters: FighterView[];
  /** The player can choose this exchange (tactical, standing, not at the fronts). */
  canAct: boolean;
  actions: ActionView[];
  targets: { id: string; name: string; chance: number; words: string; touchable: boolean }[];
  stance: string;
  stances: { id: string; name: string; description: string }[];
  orders: { id: string; name: string; text: string }[];
  board: { a: string; b: string; aName: string; bName: string; chance: number; words: string }[];
  fronts: {
    name: string;
    strength: [number, number];
    morale: [number, number];
    broken: [boolean, boolean];
    here: boolean;
  }[];
  ships: {
    name: string;
    hull: number;
    maxHull: number;
    cannons: number;
    fire: boolean;
    sunk: boolean;
    struck: boolean;
  }[];
  range: string | null;
  naval: boolean;
  log: BattleLine[];
  result: null | { how: string; decisive: boolean };
  card: BattleLine[];
}

const STATUS_WORDS: [keyof Fighter['status'], string][] = [
  ['coated', 'Coated in Armament'],
  ['read', 'Reading the fight'],
  ['guarding', 'Guarding'],
  ['evading', 'Evading'],
  ['pinned', 'Pinned'],
  ['stunned', 'Stunned'],
  ['burning', 'Burning'],
  ['bleeding', 'Bleeding'],
  ['poisoned', 'Poisoned'],
  ['blinded', 'Blinded'],
  ['taunted', 'Riled'],
  ['shrunk', 'Shrunken'],
  ['countering', 'Ready to counter'],
];

function fighterView(data: GameData, f: Fighter): FighterView {
  const status: string[] = [];
  for (const [key, word] of STATUS_WORDS) {
    const v = f.status[key];
    if (v === true || (typeof v === 'number' && v > 0)) status.push(word);
  }
  if (f.status.overdrive) status.push(f.status.overdrive.name);
  if (f.cursed) status.push('Weakened by the sea');
  if (f.stamina <= 0) status.push('Out of breath');
  return {
    id: f.id,
    name: f.name,
    side: f.side,
    player: f.player,
    hp: Math.max(0, Math.round(f.hp)),
    maxHp: f.maxHp,
    stamina: Math.round(f.stamina),
    maxStamina: f.maxStamina,
    haki: Math.round(f.haki),
    maxHaki: Math.round(f.maxHaki),
    cp: f.cp,
    tier: tierOf(data, f.cp).name,
    role: data.battle.roles.find((r) => r.id === f.role)?.name ?? f.role,
    zone: data.battle.zones.find((z) => z.id === f.zone)?.name ?? f.zone,
    status,
    fruit: f.fruit?.name ?? null,
    down: f.down,
    away: f.reserve ? 'Waiting to tag in' : f.front ? 'At the fronts' : null,
  };
}

/** A hit chance in words. */
export function chanceWords(chance: number): string {
  if (chance >= 0.85) return 'almost sure';
  if (chance >= 0.65) return 'likely';
  if (chance >= 0.45) return 'even';
  if (chance >= 0.25) return 'unlikely';
  return 'a long shot';
}

function actionsFor(ctx: BattleCtx, me: Fighter, target: Fighter | undefined): ActionView[] {
  const { data } = ctx;
  const rules = data.battle;
  const out: ActionView[] = [];
  const chance = (move: Parameters<typeof hitChance>[3]) =>
    target ? hitChance(ctx, me, target, move) : null;
  const words = (c: number | null) => (c === null ? '' : chanceWords(c));
  const stamina = (cost: number) => (me.stamina < cost ? 'Out of breath' : null);
  const c0 = chance(null);
  out.push({
    key: 'strike',
    verb: 'strike',
    label: 'Strike',
    chance: c0,
    words: words(c0),
    detail: me.weapon ? `with your ${me.weapon.name.toLowerCase()}` : 'a plain blow',
    lock: target ? null : 'Nobody in reach',
    needsTarget: true,
  });
  for (const m of me.moves) {
    const c = m.power > 0 ? chance(m) : null;
    const cost = Math.round(m.cost * rules.stamina.techniqueCostMult * 10) / 10;
    const touch = target ? canTouch(ctx, me, target, m) : true;
    out.push({
      key: `technique:${m.id}`,
      verb: 'technique',
      move: m.id,
      label: m.name,
      chance: c,
      words: m.power > 0 ? (touch ? words(c) : 'passes through them') : (m.form ?? ''),
      detail: `${m.form ?? 'technique'}, power ${m.power}, stamina ${cost}${m.signature ? ', your signature' : ''}${m.finisher ? ', a finisher' : ''}`,
      lock: stamina(cost),
      needsTarget: m.power > 0,
    });
  }
  out.push({
    key: 'guard',
    verb: 'guard',
    label: 'Guard',
    chance: null,
    words: 'halves the next blow',
    detail: me.armament > 0 ? 'Armament hardens it further' : 'take less this exchange',
    lock: null,
    needsTarget: false,
  });
  out.push({
    key: 'evade',
    verb: 'evade',
    label: 'Evade',
    chance: null,
    words: 'harder to hit',
    detail: me.observation > 0 ? 'Observation helps you read it' : 'stay moving',
    lock: null,
    needsTarget: false,
  });
  out.push({
    key: 'feint',
    verb: 'feint',
    label: 'Feint',
    chance: null,
    words: 'opens their guard',
    detail: 'Dexterity or Intellect against their Perception',
    lock: target ? null : 'Nobody in reach',
    needsTarget: true,
  });
  const cg = chance({
    id: 'grapple',
    name: 'Grapple',
    form: 'grapple',
    tags: ['grip'],
    effects: [],
    power: 10,
    accuracy: 60,
    cost: 0,
    range: 'melee',
    source: 'basic',
    signature: false,
    finisher: false,
  });
  out.push({
    key: 'grapple',
    verb: 'grapple',
    label: 'Grapple',
    chance: cg,
    words: words(cg),
    detail: me.intent === 'capture' ? 'pin, then bind them' : 'pin or throw them',
    lock: target ? stamina(rules.stamina.costs.grapple ?? 0) : 'Nobody in reach',
    needsTarget: true,
  });
  if (me.observation > 0)
    out.push({
      key: 'haki:read',
      verb: 'haki',
      haki: 'read',
      label: 'Observation Haki: read them',
      chance: null,
      words: 'see it coming',
      detail: `haki ${rules.haki.read.cost}`,
      lock: me.haki < rules.haki.read.cost ? 'Not enough haki' : null,
      needsTarget: false,
    });
  if (me.armament > 0)
    out.push({
      key: 'haki:coat',
      verb: 'haki',
      haki: 'coat',
      label: 'Armament Haki: coat and strike',
      chance: c0,
      words: 'touches even a Logia',
      detail: `haki ${rules.haki.coat.cost}, lasts ${rules.haki.coat.exchanges} exchanges`,
      lock:
        me.haki < rules.haki.coat.cost
          ? 'Not enough haki'
          : me.status.coated > 0
            ? 'Already coated'
            : null,
      needsTarget: true,
    });
  if (me.conqueror > 0)
    out.push({
      key: 'haki:burst',
      verb: 'haki',
      haki: 'burst',
      label: "Conqueror's Haki: let it loose",
      chance: null,
      words: 'drops the weak-willed',
      detail: `haki ${rules.haki.burst.cost}`,
      lock: me.haki < rules.haki.burst.cost ? 'Not enough haki' : null,
      needsTarget: false,
    });
  for (const item of rules.items) {
    const n = me.kit[item.id] ?? 0;
    if (n > 0)
      out.push({
        key: `item:${item.id}`,
        verb: 'item',
        item: item.id,
        label: `${item.name} (${n})`,
        chance: null,
        words:
          item.effect === 'heal'
            ? 'patch up'
            : item.effect === 'smoke'
              ? 'cover to run'
              : 'call for help',
        detail: item.description,
        lock: null,
        needsTarget: false,
      });
  }
  if (!ctx.battle.spar) {
    out.push({
      key: 'talk:taunt',
      verb: 'talk',
      talk: 'taunt',
      label: 'Taunt',
      chance: null,
      words: 'rattle them',
      detail: 'they aim worse while angry',
      lock: null,
      needsTarget: true,
    });
    out.push({
      key: 'talk:surrender',
      verb: 'talk',
      talk: 'surrender',
      label: 'Demand surrender',
      chance: null,
      words:
        target && target.hp / target.maxHp < rules.talk.surrenderBelow ? 'they might' : 'not yet',
      detail: 'Charisma against their Willpower, once they are hurt',
      lock: null,
      needsTarget: true,
    });
    if (ctx.battle.fighters.every((f) => f.down !== null || f.intent === 'spare'))
      out.push({
        key: 'talk:persuade',
        verb: 'talk',
        talk: 'persuade',
        label: 'Talk them down',
        chance: null,
        words: 'end it here',
        detail: 'nobody here means to kill',
        lock: null,
        needsTarget: true,
      });
    out.push({
      key: 'talk:stall',
      verb: 'talk',
      talk: 'stall',
      label: 'Play for time',
      chance: null,
      words: 'catch your breath',
      detail: 'guard and recover stamina',
      lock: null,
      needsTarget: false,
    });
    out.push({
      key: 'flee',
      verb: 'flee',
      label: 'Flee',
      chance: null,
      words: 'Speed against the fastest of them',
      detail: 'smoke helps',
      lock: null,
      needsTarget: false,
    });
  }
  return out;
}

function titleOf(battle: BattleState): string {
  if (battle.spar) return 'A spar';
  if (battle.contest) return 'A contest';
  if (battle.scale === 'naval') return 'A sea fight';
  if (battle.scale === 'war') return 'War';
  if (battle.scale === 'crew') return 'A crew battle';
  return 'A fight';
}

export function battleView(state: WorldState, data: GameData, target?: string): BattleView | null {
  const battle = state.battle;
  if (!battle) return null;
  const ctx: BattleCtx = { battle, data, rng: Rng.root(state.seed).fork('view') };
  const me = battle.fighters.find((f) => f.id === PLAYER_FIGHTER);
  const enemies = me ? enemiesOf(battle, me) : [];
  const chosen = enemies.find((e) => e.id === target) ?? enemies[0];
  const canAct =
    battle.mode === 'tactical' &&
    !battle.result &&
    me !== undefined &&
    me.down === null &&
    !me.front &&
    !(battle.scale === 'naval' && !battle.boarded);
  return {
    id: battle.id,
    title: titleOf(battle),
    scale: battle.scale,
    mode: battle.mode,
    spar: battle.spar,
    contest: battle.contest
      ? (data.battle.contests.find((c) => c.id === battle.contest)?.name ?? battle.contest)
      : null,
    exchange: battle.exchange,
    maxExchanges: battle.maxExchanges,
    round: battle.round,
    sides: battle.sides.map((s) => ({
      name: s.name,
      morale: Math.max(0, Math.round(s.morale)),
      ranks: Math.round(s.ranks),
      broken: s.broken,
      order: s.order,
      target: s.target,
    })),
    fighters: battle.fighters.map((f) => fighterView(data, f)),
    canAct,
    actions: canAct && me ? actionsFor(ctx, me, chosen) : [],
    targets:
      canAct && me
        ? enemies.map((e) => {
            const c = hitChance(ctx, me, e, null);
            return {
              id: e.id,
              name: e.name,
              chance: c,
              words: chanceWords(c),
              touchable: canTouch(ctx, me, e, null),
            };
          })
        : [],
    stance: battle.stance,
    stances: data.battle.stances.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
    })),
    orders: data.battle.orders.map((o) => ({ id: o.id, name: o.name, text: o.text })),
    board: battle.board.map(([a, b]) => {
      const fa = battle.fighters.find((f) => f.id === a) as Fighter;
      const fb = battle.fighters.find((f) => f.id === b) as Fighter;
      const chance = duelOdds(data, fa, fb);
      return { a, b, aName: fa.name, bName: fb.name, chance, words: oddsWords(chance) };
    }),
    fronts: battle.fronts.map((fr, i) => ({
      name: fr.name,
      strength: fr.strength,
      morale: [Math.round(fr.morale[0]), Math.round(fr.morale[1])] as [number, number],
      broken: fr.broken,
      here: i === battle.playerFront,
    })),
    ships: battle.ships.map((s) => ({
      name: s.name,
      hull: Math.round(s.hull),
      maxHull: s.maxHull,
      cannons: s.cannons,
      fire: s.fire > 0,
      sunk: s.sunk,
      struck: s.struck,
    })),
    range: battle.range,
    naval: battle.scale === 'naval' && !battle.boarded && !battle.result,
    log: battle.log.slice(-60),
    result: battle.result ? { how: battle.result.how, decisive: battle.result.decisive } : null,
    card: battle.card,
  };
}

/** The player's place on the ladder and their record, for the Powers page and the sheet. */
export interface FightSelfView {
  cp: number;
  tier: string;
  record: { won: number; lost: number; drawn: number; spars: number };
  mode: string;
  stance: string;
  stances: { id: string; name: string; description: string }[];
  kit: {
    id: string;
    name: string;
    description: string;
    price: number;
    have: number;
    lock: string | null;
  }[];
  ladder: { name: string; min: number; who: string; here: boolean }[];
}

export function fightSelfView(state: WorldState, data: GameData): FightSelfView | null {
  const p = playerPerson(state, data);
  if (!p || !p.c.alive) return null;
  const cp = combatPowerOf(data, p.entity, state.tick);
  const rung = tierOf(data, cp);
  const r = p.c.fights;
  const market = !p.place.atSea && p.place.features.some((f) => f === 'market' || f === 'doctor');
  return {
    cp,
    tier: rung.name,
    record: { won: r?.won ?? 0, lost: r?.lost ?? 0, drawn: r?.drawn ?? 0, spars: r?.spars ?? 0 },
    mode:
      typeof p.entity.flags['battle.mode'] === 'string'
        ? (p.entity.flags['battle.mode'] as string)
        : 'tactical',
    stance:
      typeof p.entity.flags['battle.stance'] === 'string'
        ? (p.entity.flags['battle.stance'] as string)
        : (data.battle.stances[0]?.id ?? ''),
    stances: data.battle.stances.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
    })),
    kit: data.battle.items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: item.price,
      have: p.c.powers?.gear[item.id] ?? 0,
      lock: !market ? 'No market here' : p.c.berries < item.price ? 'Not enough Berries' : null,
    })),
    ladder: data.battle.ladder.map((l) => ({
      name: l.name,
      min: l.min,
      who: l.who,
      here: l.id === rung.id,
    })),
  };
}
