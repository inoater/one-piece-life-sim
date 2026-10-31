import type { CrewEffectKey, CrewPost, GameData } from '../../engine/data/schemas';
import type { CrewSituation, CrewState, Entity, WorldState } from '../../engine/state';
import { CREW_SITUATIONS } from '../../engine/crew-state';
import { roleOf, roleScore, fitWords } from './roles';
import { hereOf, crewLedBy, memberRecord, onHand, playerCrew } from './state';
import { entityIds } from '../../engine/entities';

/**
 * Positions aboard (Phase 8). A role says what someone is good at; a post says where they stand
 * and when. Each situation (at sea, in battle, in port, in a storm) has its own line-up; the
 * auto-fill puts people at posts by role (locked posts stay as the player set them), and switches
 * line-ups by itself as the situation changes. Every post feeds one or more systems through an
 * effect key (data/crew.json): `crewEffect(state, data, key)` is what those systems read. A crew
 * of one still has posts, and the empty ones show (and cost) what nobody is doing; someone with no
 * crew at all sails by the Phase 3 numbers, untouched.
 */

/** Which line-up each effect key reads. */
export function situationOfKey(key: CrewEffectKey): CrewSituation {
  if (key.startsWith('storm.')) return 'storm';
  if (key.startsWith('naval.') || key.startsWith('battle.')) return 'battle';
  if (key.startsWith('port.')) return 'port';
  return 'sea';
}

/** How each key's number reads: a share of a multiplier, points, a chance, or months. */
export const KEY_UNIT: Record<CrewEffectKey, 'pct' | 'pts' | 'chance' | 'months' | 'events'> = {
  'voyage.pace': 'pct',
  'sea.danger': 'events',
  'sea.morale': 'pts',
  'sea.scurvy': 'pct',
  'sea.supplies': 'pct',
  'sea.heal': 'months',
  'sea.repair': 'pts',
  'sea.discipline': 'pct',
  'check.perception': 'pts',
  'check.navigation': 'pts',
  'storm.hull': 'pct',
  'storm.supplies': 'pct',
  'storm.delay': 'pct',
  'naval.cannons': 'pct',
  'naval.reload': 'pct',
  'naval.accuracy': 'pct',
  'naval.boarding': 'pct',
  'naval.guard': 'pct',
  'naval.speed': 'pct',
  'naval.fire': 'pct',
  'battle.medic': 'pct',
  'battle.morale': 'pts',
  'port.rumours': 'chance',
  'port.theft': 'chance',
  'port.prices': 'pct',
  'port.board': 'pct',
  'port.raid': 'pct',
};

export const KEY_LABEL: Record<CrewEffectKey, string> = {
  'voyage.pace': 'voyage speed',
  'sea.danger': 'trouble at sea',
  'sea.morale': 'morale a month',
  'sea.scurvy': 'scurvy',
  'sea.supplies': 'stores eaten',
  'sea.heal': 'healing at sea',
  'sea.repair': 'hull mended a month',
  'sea.discipline': 'grumbling and worse',
  'check.perception': 'Perception checks',
  'check.navigation': 'navigation checks',
  'storm.hull': 'hull lost to storms',
  'storm.supplies': 'stores lost to storms',
  'storm.delay': 'time lost to storms',
  'naval.cannons': 'guns firing',
  'naval.reload': 'cannon damage',
  'naval.accuracy': 'gunnery aim',
  'naval.boarding': 'boarding strength',
  'naval.guard': 'boarders’ strength',
  'naval.speed': 'speed in a sea fight',
  'naval.fire': 'fire damage',
  'battle.medic': 'injuries from big blows',
  'battle.morale': 'morale as a fight opens',
  'port.rumours': 'rumours a month',
  'port.theft': 'theft a month',
  'port.prices': 'market prices',
  'port.board': 'people looking for a ship',
  'port.raid': 'raids without warning',
};

/** "+6% voyage speed", "−10 hull lost to storms" in words a post's tooltip can show. */
export function effectWords(key: CrewEffectKey, value: number): string {
  const unit = KEY_UNIT[key];
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  const abs = Math.abs(value);
  const n =
    unit === 'pct' || unit === 'chance'
      ? `${Math.round(abs * 100)}%`
      : unit === 'months'
        ? `${Math.round(abs * 10) / 10} months`
        : unit === 'events'
          ? `${Math.round(abs * 100) / 100}`
          : `${Math.round(abs * 10) / 10}`;
  return `${sign}${n} ${KEY_LABEL[key]}`;
}

export interface PostFill {
  post: CrewPost;
  /** Who stands there (an entity id), or null. */
  who: string | null;
  /** Deck hands stand there (nobody named). */
  hands: boolean;
  /** Their fit, 0 to about 120 (a deck hand's is fixed). */
  score: number;
  /** How well the post is done: 0 to 1.25 (a perfect fit, doubled duty, laid up...). */
  share: number;
  double: boolean;
  empty: boolean;
  words: string;
  /** Why a person set here cannot stand it (away, hurt, rank). */
  problem: string | null;
}

/** The deck hands (hired, unnamed) aboard the player's ship, at sea or moored where they are. */
export function handsAboard(state: WorldState, data: GameData, player: Entity): number {
  const voyage = player.character?.travel?.voyage;
  if (voyage?.vessel) return voyage.vessel.crew;
  const ship = voyage?.shipId ? state.entities[voyage.shipId]?.ship : undefined;
  if (ship) return ship.crew;
  if (voyage) return 0;
  const place = hereOf(data, player);
  // Her home ship first (the usual case), then any ship of theirs moored here.
  const home = crewLedBy(state, player)?.crew?.home;
  const homeShip = home?.kind === 'ship' && home.id ? state.entities[home.id]?.ship : undefined;
  if (homeShip && homeShip.ownerId === player.id && !homeShip.sunk && homeShip.place === place)
    return homeShip.crew;
  for (const id of entityIds(state)) {
    const s = state.entities[id]?.ship;
    if (s && s.ownerId === player.id && !s.sunk && s.place === place) return s.crew;
  }
  return 0;
}

interface Candidate {
  id: string;
  entity: Entity;
  mastery: Readonly<Record<string, number>>;
  rank: number;
  player: boolean;
}

function candidates(state: WorldState, crew: CrewState, leader: Entity, tick: number): Candidate[] {
  const out: Candidate[] = [{ id: leader.id, entity: leader, mastery: {}, rank: 99, player: true }];
  for (const { member, entity } of onHand(state, crew, tick))
    out.push({ id: member.id, entity, mastery: member.mastery, rank: member.rank, player: false });
  return out;
}

const HANDS_PER_POST = 2;

function scoreAt(data: GameData, c: Candidate, post: CrewPost, tick: number): number {
  const role = roleOf(data, post.role);
  if (!role) return 0;
  return roleScore(data, c.entity, role, tick, c.mastery[post.role] ?? 0);
}

/** Can they stand this post (a ranked crew's chart)? Null when they can. */
function rankProblem(data: GameData, crew: CrewState, c: Candidate, post: CrewPost): string | null {
  if (post.minRank <= 0 || c.player) return null;
  const kind = data.crew.kinds.find((k) => k.id === crew.kind);
  if (!kind || kind.ranks.length === 0) return null;
  if (c.rank >= post.minRank) return null;
  return `Needs at least ${kind.ranks[post.minRank] ?? 'a higher rank'}`;
}

/** The posts of a situation, specialists first (deck hands' posts fill last). */
export function postsOf(data: GameData, situation: CrewSituation): CrewPost[] {
  const posts = data.crew.posts.filter((p) => p.situation === situation);
  return [...posts.filter((p) => !p.hands), ...posts.filter((p) => p.hands)];
}

/** The line-up of one situation as it stands: who is at each post and how well it is done. */
export function lineupOf(
  state: WorldState,
  data: GameData,
  crew: CrewState,
  leader: Entity,
  situation: CrewSituation,
  tick = state.tick,
): PostFill[] {
  const set = crew.lineups[situation] ?? {};
  const people = new Map(candidates(state, crew, leader, tick).map((c) => [c.id, c]));
  const held = new Map<string, number>();
  for (const id of Object.values(set)) held.set(id, (held.get(id) ?? 0) + 1);
  let hands = handsAboard(state, data, leader);
  const rules = data.crew.fit;
  return postsOf(data, situation).map((post) => {
    const id = set[post.id] ?? null;
    const c = id ? people.get(id) : undefined;
    let problem: string | null = null;
    if (id && !c) {
      const m = memberRecord(crew, id);
      problem = !m
        ? 'No longer aboard'
        : m.away
          ? 'Away on a mission'
          : m.hurtUntil !== null && m.hurtUntil > tick
            ? 'Laid up'
            : 'Not here';
    } else if (c) problem = rankProblem(data, crew, c, post);
    if (c && problem === null) {
      const score = scoreAt(data, c, post, tick);
      const double = (held.get(c.id) ?? 0) > 1;
      const share = Math.max(0, Math.min(1.25, score / 80)) * (double ? rules.double : 1);
      return {
        post,
        who: c.id,
        hands: false,
        score,
        share,
        double,
        empty: false,
        words: fitWords(data, score * (double ? rules.double : 1)),
        problem: null,
      };
    }
    if (post.hands && hands >= HANDS_PER_POST) {
      hands -= HANDS_PER_POST;
      return {
        post,
        who: null,
        hands: true,
        score: Math.round(rules.hand * 80),
        share: rules.hand,
        double: false,
        empty: false,
        words: 'deck hands',
        problem,
      };
    }
    return {
      post,
      who: null,
      hands: false,
      score: 0,
      share: 0,
      double: false,
      empty: true,
      words: 'nobody',
      problem,
    };
  });
}

/**
 * The auto-fill (presets by role): every unlocked post gets whoever does it best among those on
 * hand, specialists first; a post nobody free can stand goes to someone already standing one
 * (double duty) when they would do it at least capably. In battle the captain stands on the
 * captain's deck and nowhere else.
 */
export function autoFill(state: WorldState, data: GameData, crewEnt: Entity, tick: number): void {
  const crew = crewEnt.crew;
  const leader = crew ? state.entities[crew.leaderId] : undefined;
  if (!crew || !leader) return;
  const people = candidates(state, crew, leader, tick);
  for (const situation of CREW_SITUATIONS) {
    const lineup = { ...(crew.lineups[situation] ?? {}) };
    const used = new Set<string>();
    for (const post of postsOf(data, situation))
      if (crew.locks[`${situation}:${post.id}`] && lineup[post.id])
        used.add(lineup[post.id] as string);
    for (const post of postsOf(data, situation)) {
      if (crew.locks[`${situation}:${post.id}`]) continue;
      const fits = people
        .filter((c) => rankProblem(data, crew, c, post) === null)
        .filter((c) => !(situation === 'battle' && c.player && post.role !== 'captain'))
        .map((c) => ({ c, score: scoreAt(data, c, post, tick) }))
        .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));
      const free = fits.find((f) => !used.has(f.c.id));
      // A named person on a deck hands' post only if they do it better than the hands would.
      const handsFit = data.crew.fit.hand * 80;
      if (free && (!post.hands || free.score > handsFit)) {
        lineup[post.id] = free.c.id;
        used.add(free.c.id);
        continue;
      }
      // Double duty: nobody holds more than two posts at once.
      const twice = !post.hands
        ? fits.find(
            (f) =>
              f.score >= 45 &&
              !(f.c.player && situation === 'battle') &&
              Object.values(lineup).filter((x) => x === f.c.id).length < 2,
          )
        : undefined;
      if (twice) lineup[post.id] = twice.c.id;
      else delete lineup[post.id];
    }
    crew.lineups[situation] = lineup;
  }
}

// ---- What the posts are worth -------------------------------------------------------------------

const cache = new WeakMap<CrewState, { stamp: string; values: Map<CrewEffectKey, number> }>();

function stampOf(state: WorldState, data: GameData, crew: CrewState, leader: Entity): string {
  const members = crew.members
    .map((m) => `${m.id}:${m.away ? 1 : 0}:${m.hurtUntil ?? 0}:${m.rank}`)
    .join(',');
  const lineups = CREW_SITUATIONS.map((s) =>
    Object.entries(crew.lineups[s] ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('|'),
  ).join(';');
  return `${state.tick}#${members}#${lineups}#${handsAboard(state, data, leader)}`;
}

/** A role-mastery perk the person at a post has earned. */
function perk(
  data: GameData,
  crew: CrewState,
  who: string | null,
  role: string,
  id: string,
): boolean {
  if (!who) return false;
  const m = memberRecord(crew, who);
  const at = roleOf(data, role)?.perks.find((p) => p.id === id)?.at;
  return at !== undefined && (m?.mastery[role] ?? 0) >= at;
}

/** Everything the posts of a situation are worth, key by key. */
export function postEffects(
  state: WorldState,
  data: GameData,
  crew: CrewState,
  leader: Entity,
  situation: CrewSituation,
): Map<CrewEffectKey, number> {
  const out = new Map<CrewEffectKey, number>();
  for (const fill of lineupOf(state, data, crew, leader, situation)) {
    for (const e of fill.post.effects) {
      let v = fill.empty ? e.empty : e.full * fill.share;
      // Perks of role mastery (data/crew.json roles).
      if (
        !fill.empty &&
        e.key === 'naval.fire' &&
        perk(data, crew, fill.who, 'shipwright', 'mid_battle')
      )
        v *= 2;
      if (
        !fill.empty &&
        e.key === 'sea.heal' &&
        perk(data, crew, fill.who, 'doctor', 'any_sickness')
      )
        v *= 2;
      if (
        !fill.empty &&
        e.key === 'sea.discipline' &&
        perk(data, crew, fill.who, 'first_mate', 'iron_order')
      )
        v *= 1.33;
      out.set(e.key, (out.get(e.key) ?? 0) + v);
    }
  }
  // A navigator who reads the Grand Line's weather spares the hull in storms.
  if (situation === 'storm') {
    const nav = crew.lineups['sea']?.['navigation'] ?? null;
    if (perk(data, crew, nav, 'navigator', 'grand_line_weather'))
      out.set('storm.hull', (out.get('storm.hull') ?? 0) - 0.33);
  }
  return out;
}

/**
 * What the player's crew adds to one system's number (0 with no crew: the Phase 3 numbers). Cached
 * for the month and the line-up, since a voyage's planner asks many times over.
 */
export function crewEffect(state: WorldState, data: GameData, key: CrewEffectKey): number {
  const crewEnt = playerCrew(state);
  const crew = crewEnt?.crew;
  const leader = crew ? state.entities[crew.leaderId] : undefined;
  if (!crew || !leader?.character?.alive) return 0;
  const stamp = stampOf(state, data, crew, leader);
  let cached = cache.get(crew);
  if (!cached || cached.stamp !== stamp) {
    const values = new Map<CrewEffectKey, number>();
    for (const situation of CREW_SITUATIONS)
      for (const [k, v] of postEffects(state, data, crew, leader, situation)) values.set(k, v);
    cached = { stamp, values };
    cache.set(crew, cached);
  }
  return cached.values.get(key) ?? 0;
}

/** The same for anyone who leads a crew (a fleet captain's, in tests). */
export function crewEffectOf(
  state: WorldState,
  data: GameData,
  leader: Entity,
  key: CrewEffectKey,
): number {
  const crew = crewLedBy(state, leader)?.crew;
  if (!crew) return 0;
  return postEffects(state, data, crew, leader, situationOfKey(key)).get(key) ?? 0;
}

/**
 * A month of service: everyone at a post of the situation they are in grows the matching role
 * skill, and long service at a post earns a title ("Master Gunner"). Returns the titles earned.
 */
export function serviceMonth(
  state: WorldState,
  data: GameData,
  crew: CrewState,
  leader: Entity,
  situation: CrewSituation,
  tick: number,
): { id: string; title: string }[] {
  const earned: { id: string; title: string }[] = [];
  const learn = data.crew.fit.learn;
  for (const fill of lineupOf(state, data, crew, leader, situation, tick)) {
    if (!fill.who || fill.who === leader.id) continue;
    const m = memberRecord(crew, fill.who);
    if (!m) continue;
    const key = `${situation}:${fill.post.id}`;
    m.served[key] = (m.served[key] ?? 0) + 1;
    const role = fill.post.role;
    const now = m.mastery[role] ?? 0;
    m.mastery[role] =
      Math.round(Math.min(100, now + learn * Math.max(0.3, fill.share) * (1 - now / 110)) * 100) /
      100;
    for (const t of data.crew.titles) {
      if (t.post !== fill.post.id || m.titles.includes(t.title)) continue;
      if ((m.served[key] ?? 0) >= t.months && (m.mastery[role] ?? 0) >= t.mastery) {
        m.titles.push(t.title);
        earned.push({ id: m.id, title: t.title });
      }
    }
  }
  return earned;
}

/** Where the player is now, for the line-up that applies: at sea or in port. */
export function situationNow(leader: Entity): CrewSituation {
  return leader.character?.travel?.voyage ? 'sea' : 'port';
}
