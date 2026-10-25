import { POWER_LEVELS } from '../../engine/data/defs';
import { dateOf, formatDate } from '../../engine/calendar';
import type { GameData, Track } from '../../engine/data/schemas';
import { TECH_FORMS } from '../../engine/data/schemas';
import { PUBLIC_KNOWLEDGE, type Entity, type WorldState } from '../../engine/state';
import { statBreakdown } from '../../engine/stats';
import { formatBerries } from '../genesis/text';
import { stockHere } from '../hands/market';
import { combatPowerOf, playerPerson, type Person } from '../life/body';
import { fruitDefOf } from './catalogue';
import { cursedNow, eatenFruit, fruitEntities, fruitMastery, marketHere } from './fruits';
import { staminaPool } from './haki';
import { HAKI_COLOURS, hakiAwake, levelName, nextStageOf, stageOf, trackStateOf } from './state';
import {
  battleActions,
  comboPartners,
  inventChance,
  moveDef,
  moveLock,
  moveName,
  pricedTechnique,
  sourceTags,
} from './techniques';
import {
  ceilingOf,
  learnLock,
  powerCtxFor,
  progressToNext,
  stageLock,
  teacherAt,
  whereTaught,
} from './tracks';
import { Rng } from '../../engine/rng';

/**
 * What the Powers page and the Devil Fruit page show (Phase 4): every track with its stages, the
 * progress to the next and what stands in the way, where a teacher can be found; the moveset with
 * each technique's numbers; inventions in progress; the fruit; and the fruits the player knows of.
 * Rule 4 throughout: hidden stages show as "???", hidden tracks only once open, and fruits only
 * as far as the player knows them (omniscient views show the truth).
 */

export interface StageView {
  id: string;
  name: string;
  level: string;
  reached: boolean;
  current: boolean;
  description: string;
  techniques: string[];
  combat: number;
}

export interface TrackView {
  id: string;
  name: string;
  family: string;
  description: string;
  open: boolean;
  focus: boolean;
  /** The stage reached, or null when not begun. `levelIndex`: 0 (Novice) to 5 (Grandmaster). */
  stage: { name: string; level: string; levelIndex: number } | null;
  next: null | { name: string; level: string; progress: number; locks: string[] };
  mode: 'points' | 'mastery';
  progress: number;
  stages: StageView[];
  where: string[];
  /** Why they cannot begin it here and now (null: they can). */
  learnLock: string | null;
  teacherHere: string | null;
  rusting: boolean;
  ceiling: string | null;
}

export interface MoveView {
  id: string;
  name: string;
  /** The technique's own name, when the player renamed it. */
  original: string | null;
  source: string;
  form: string;
  tags: string[];
  power: number;
  accuracy: number;
  cost: number;
  range: string;
  mastery: number;
  uses: number;
  signature: boolean;
  finisher: boolean;
  faded: boolean;
  lock: string | null;
  custom: boolean;
  description: string | null;
}

export interface FruitSelfView {
  name: string;
  type: string | null;
  model: string | null;
  identified: boolean;
  dud: boolean;
  description: string | null;
  mastery: number;
  awakened: boolean;
  secret: string | null;
  cursed: boolean;
  weaknesses: string[];
}

/**
 * The powers at a glance: everything they have and how far along it is (the stage, and its level
 * out of the six from Novice to Grandmaster), the haki still asleep in them, and a fruit carried
 * uneaten.
 */
export interface PowerSummary {
  rows: {
    id: string;
    group: string;
    name: string;
    stage: string;
    level: string;
    levelIndex: number;
    detail: string | null;
  }[];
  asleep: string[];
  carriedFruit: boolean;
}

export interface PowersView {
  summary: PowerSummary;
  /** Null until a colour of haki wakes. */
  stamina: { current: number; pool: number } | null;
  combat: { total: number; bonus: { source: string; value: number }[] };
  doriki: number | null;
  tracks: TrackView[];
  moves: MoveView[];
  actions: { name: string; kind: string; power: number; signature: boolean }[];
  drafts: {
    id: string;
    name: string;
    source: string;
    attempts: number;
    chance: number;
    power: number;
  }[];
  fruit: FruitSelfView | null;
  gear: Record<string, number>;
  shop: { id: string; name: string; gear: string; price: number; lock: string | null }[];
  encyclopedia: { owned: boolean; price: number; lock: string | null };
  invent: { sources: { id: string; label: string; tags: string[] }[]; forms: string[] };
  partners: { id: string; name: string; moves: { id: string; name: string }[] }[];
  sixPowersMastered: number;
}

function sourceLabel(data: GameData, source: string): string {
  if (source === 'fruit') return 'Devil Fruit';
  if (source === 'custom') return 'Your invention';
  if (source === 'combo') return 'Combination';
  if (source === 'canon') return 'Signature';
  if (source.startsWith('track:')) return data.tracks[source.slice(6)]?.name ?? source;
  return source;
}

function trackView(state: WorldState, data: GameData, p: Person, track: Track): TrackView {
  const ts = trackStateOf(p.c, track.id);
  const ctx = powerCtxFor(state, data, p.entity, state.tick, Rng.root('view'));
  const next = ts ? nextStageOf(track, ts) : null;
  const locks: string[] = [];
  if (ts && next && ctx) {
    const why = stageLock({ ...ctx, placeId: p.place.atSea ? null : p.place.id }, track, ts, next);
    if (why) locks.push(next.requires.hidden ? 'Something you have not found yet' : why);
    if (ts.progress < next.at)
      locks.unshift(
        `${Math.round((next.at - ts.progress) * 10) / 10} more ${track.mode === 'mastery' ? 'mastery' : 'practice'}`,
      );
  }
  const ceiling = ceilingOf(data, p.c, track);
  const teacher =
    track.learn.how === 'teacher' ? teacherAt(state, data, p, track, state.tick) : null;
  const rust = track.rust ?? data.powers.rust;
  return {
    id: track.id,
    name: track.name,
    family: track.family,
    description: track.description,
    open: ts !== undefined,
    focus: p.c.powers?.focus === track.id,
    stage: ts
      ? {
          name: stageOf(track, ts).name,
          level: levelName(data, stageOf(track, ts).level),
          levelIndex: POWER_LEVELS.indexOf(stageOf(track, ts).level),
        }
      : null,
    next:
      ts && next
        ? {
            name:
              next.requires.hidden && ts.stage + 1 > ceiling.index
                ? '???'
                : next.requires.hidden
                  ? '???'
                  : next.name,
            level: levelName(data, next.level),
            progress: progressToNext(track, ts),
            locks,
          }
        : null,
    mode: track.mode,
    progress: ts?.progress ?? 0,
    stages: track.stages.map((s, i) => {
      const reached = ts !== undefined && ts.stage >= i;
      const hide = s.requires.hidden && !reached;
      return {
        id: s.id,
        name: hide ? '???' : s.name,
        level: levelName(data, s.level),
        reached,
        current: ts !== undefined && ts.stage === i,
        description: hide ? 'Nobody has told you what lies here.' : s.description,
        techniques: hide ? [] : s.techniques.map((id) => data.techniques[id]?.name ?? id),
        combat: s.combat,
      };
    }),
    where: whereTaught(data, track),
    learnLock: ts ? null : learnLock(state, data, p, track, state.tick),
    teacherHere: teacher?.name ?? null,
    // Only progress inside a stage can rust: a track never practised has nothing to lose.
    rusting:
      ts !== undefined &&
      ts.progress > stageOf(track, ts).at &&
      state.tick - ts.lastUsed > rust.afterMonths,
    ceiling:
      ts && ceiling.index < track.stages.length - 1 && ts.stage >= ceiling.index
        ? ceiling.reason
        : null,
  };
}

export function powersView(state: WorldState, data: GameData): PowersView | null {
  const p = playerPerson(state, data);
  if (!p) return null;
  const c = p.c;
  const powers = c.powers;
  const tick = state.tick;
  const combatStat = p.entity.stats[data.powers.combatBonusStat];
  const bonus = combatStat
    ? statBreakdown(combatStat, tick).lines.map((l) => ({
        source: l.source.replace(/ \((power|trait)\)$/, ''),
        value: Math.round(l.contribution * 10) / 10,
      }))
    : [];
  const tracks = Object.values(data.tracks)
    .filter((t) => (powers?.tracks[t.id] ? true : !t.hidden))
    .filter((t) => t.family !== 'fruit' || powers?.tracks[t.id])
    // The Six Powers are learned together, through Soru: one row until they are open.
    .filter((t) => t.group !== 'six_powers' || t.id === 'track_soru' || powers?.tracks[t.id])
    .sort((a, b) => {
      const oa = powers?.tracks[a.id] ? 0 : 1;
      const ob = powers?.tracks[b.id] ? 0 : 1;
      return oa - ob || (a.name < b.name ? -1 : 1);
    })
    .map((t) => {
      const view = trackView(state, data, p, t);
      if (t.id === 'track_soru' && !powers?.tracks[t.id]) {
        view.name = 'Rokushiki: the Six Powers';
        view.description =
          'Soru, Geppo, Tekkai, Shigan, Rankyaku and Kami-e, taught together to Cipher Pol agents and Marine elites who have Strength, Speed and Durability 50. Master four for the elite ranks; all six, with Willpower 70, for the seventh.';
      }
      return view;
    });
  const actions = battleActions(data, p.entity, tick);
  const moves: MoveView[] = (powers?.moves ?? []).map((m) => {
    const def = moveDef(data, m);
    const priced = def ? pricedTechnique(data, def) : undefined;
    const action = actions.find((a) => a.id === m.id);
    return {
      id: m.id,
      name: moveName(data, m),
      original: m.name && def ? def.name : null,
      source: sourceLabel(data, m.source),
      form: def?.form ?? 'strike',
      tags: def?.tags ? [...def.tags] : [],
      power: action?.power ?? priced?.power ?? 0,
      accuracy: priced?.accuracy ?? 0,
      cost: priced?.cost ?? 0,
      range: priced?.range ?? 'melee',
      mastery: Math.round(m.mastery),
      uses: m.uses,
      signature: action?.signature ?? false,
      finisher: action?.finisher ?? false,
      faded: m.faded,
      lock: moveLock(data, p.entity, m, tick),
      custom: m.source === 'custom' || m.source === 'combo',
      description: def?.description ?? null,
    };
  });
  const fruitEntity = eatenFruit(state, p.entity);
  const record = powers?.fruit ?? null;
  const fdef = fruitEntity ? fruitDefOf(data, fruitEntity) : undefined;
  const fruit: FruitSelfView | null =
    record && fdef
      ? {
          name: record.identified ? fdef.name : 'an unknown Devil Fruit',
          type: record.identified ? fdef.type : null,
          model: record.identified ? (fdef.model ?? null) : null,
          identified: record.identified,
          dud: record.dud,
          description: record.identified ? fdef.description : null,
          mastery: Math.round(fruitMastery(data, c) * 10) / 10,
          awakened: record.awakened,
          secret: record.secret ? (fdef.secret?.name ?? null) : null,
          cursed: cursedNow(p.entity, tick),
          weaknesses: record.identified ? fdef.weaknesses.map((w) => w.text) : [],
        }
      : null;
  // Phase 6: weapons are items, sold where a place has the right trade (the Gear page's market).
  const forSale = new Map(stockHere(state, data, p).map((l) => [l.key, l]));
  const shop = Object.values(data.weapons)
    .filter((w) => w.gear && w.price !== undefined && !w.template && !w.canon)
    .filter(
      (w) =>
        forSale.has(w.id) ||
        w.id === 'weapon_sword' ||
        w.id === 'weapon_flintlock' ||
        w.id === 'weapon_bow',
    )
    .map((w) => {
      const line = forSale.get(w.id);
      return {
        id: w.id,
        name: w.name,
        gear: w.gear as string,
        price: line?.price ?? (w.price as number),
        lock: !line
          ? 'Not sold here'
          : c.berries < line.price
            ? `Costs ${formatBerries(line.price)} Berries`
            : null,
      };
    });
  const encyclopediaRules = data.powers.fruit.encyclopedia;
  const owned = (powers?.items ?? []).some(
    (id) => state.entities[id]?.flags['item.kind'] === 'encyclopedia',
  );
  const library = !p.place.atSea && p.place.features.includes('library');
  const sources: { id: string; label: string; tags: string[] }[] = [];
  if (record && !record.dud && record.identified) {
    sources.push({
      id: 'fruit',
      label: fdef?.name ?? 'Your fruit',
      tags: [...sourceTags(state, data, p.entity, 'fruit')],
    });
  }
  for (const id of Object.keys(powers?.tracks ?? {}).sort()) {
    const track = data.tracks[id];
    if (!track || track.family === 'fruit') continue;
    const tags = [...sourceTags(state, data, p.entity, id)];
    if (tags.length > 0) sources.push({ id, label: track.name, tags });
  }
  const sixMastered =
    typeof p.entity.flags['six_powers.mastered'] === 'number'
      ? (p.entity.flags['six_powers.mastered'] as number)
      : 0;
  const rokushiki = Object.keys(powers?.tracks ?? {}).some(
    (id) => data.tracks[id]?.group === 'six_powers',
  );
  const GROUP: Record<string, string> = {
    haki: 'Haki',
    fruit: 'Devil Fruit',
    style: 'Style',
    sword: 'Sword',
    six_powers: 'Six Powers',
    weapon: 'Weapon',
  };
  const order = ['haki', 'fruit', 'six_powers', 'sword', 'style', 'weapon'];
  const summary: PowerSummary = {
    rows: tracks
      .filter((t) => t.open && t.stage)
      .sort(
        (a, b) =>
          order.indexOf(a.family) - order.indexOf(b.family) ||
          (b.stage?.levelIndex ?? 0) - (a.stage?.levelIndex ?? 0) ||
          (a.name < b.name ? -1 : 1),
      )
      .map((t) => ({
        id: t.id,
        group: GROUP[t.family] ?? t.family,
        name:
          t.family === 'fruit' && fruit
            ? fruit.name.charAt(0).toUpperCase() + fruit.name.slice(1)
            : t.name,
        stage: t.stage?.name ?? '',
        level: t.stage?.level ?? '',
        levelIndex: Math.max(0, t.stage?.levelIndex ?? 0),
        detail:
          t.family === 'fruit' && fruit
            ? `mastery ${Math.round(fruit.mastery)} of 100`
            : t.next
              ? `next: ${t.next.name}`
              : 'the last stage',
      })),
    asleep: tracks.filter((t) => t.family === 'haki' && !t.open).map((t) => t.name),
    carriedFruit: (powers?.items ?? []).some((id) => state.entities[id]?.fruit !== undefined),
  };
  return {
    summary,
    stamina: HAKI_COLOURS.some((h) => hakiAwake(c, h))
      ? {
          current: Math.round(powers?.stamina ?? 0),
          pool: Math.round(staminaPool(data, p.entity, tick)),
        }
      : null,
    combat: { total: combatPowerOf(data, p.entity, tick), bonus },
    doriki: rokushiki ? combatPowerOf(data, p.entity, tick) * 10 : null,
    tracks,
    moves,
    actions: actions.map((a) => ({
      name: a.name,
      kind: a.kind,
      power: a.power,
      signature: a.signature,
    })),
    drafts: (powers?.drafts ?? []).map((d) => ({
      id: d.def.id,
      name: d.def.name,
      source: d.source === 'fruit' ? 'Devil Fruit' : (data.tracks[d.source]?.name ?? d.source),
      attempts: d.attempts,
      chance: Math.round(inventChance(data, p.entity, d.source, d.attempts, tick) * 100),
      power: d.def.power ?? 0,
    })),
    fruit,
    gear: { ...(powers?.gear ?? {}) },
    shop,
    encyclopedia: {
      owned,
      price: encyclopediaRules.price,
      lock: owned
        ? 'You have one'
        : !library
          ? 'Only a library sells it'
          : c.berries < encyclopediaRules.price
            ? `Costs ${formatBerries(encyclopediaRules.price)} Berries`
            : null,
    },
    invent: { sources, forms: [...TECH_FORMS] },
    partners: comboPartners(state, data, p.entity, tick).map((e) => ({
      id: e.id,
      name: e.name,
      moves: (e.character?.powers?.moves ?? [])
        .filter((m) => !m.faded)
        .map((m) => ({ id: m.id, name: moveName(data, m) })),
    })),
    sixPowersMastered: sixMastered,
  };
}

// ---- The Devil Fruit page -----------------------------------------------------------------

export interface FruitEntryView {
  id: string;
  name: string;
  japanese: string | null;
  type: string | null;
  rarity: string | null;
  /** Who has it, as far as the player knows. */
  user: string | null;
  status: string;
  place: string | null;
  description: string | null;
  techniques: string[];
  canon: boolean;
  /** Shown only because omniscient mode is on. */
  hidden: boolean;
  /** The player knows it lies wild where they stand: they can look for it. */
  searchHere: boolean;
}

export interface FruitsView {
  known: FruitEntryView[];
  rumours: { index: number; name: string; place: string; date: string; here: boolean }[];
  /** Nothing carried and no fruit eaten: how a fruit can be had at all. */
  howTo: string[] | null;
  carried: {
    id: string;
    look: string;
    name: string | null;
    canEat: boolean;
    warning: string | null;
    canIdentify: { encyclopedia: boolean; scholar: string | null };
  }[];
  market: { id: string; look: string; price: number; lock: string | null }[];
  counts: { canon: number; generated: number; inWorld: number };
}

function statusOf(
  state: WorldState,
  data: GameData,
  fruit: Entity,
  viewer: Entity,
  truth: boolean,
): { status: string; user: string | null; place: string | null } {
  const f = fruit.fruit;
  if (!f) return { status: 'unknown', user: null, place: null };
  const placeName = (id: string | null) => (id ? (data.locations[id]?.name ?? id) : null);
  if (f.container === 'eaten') {
    const user = f.userId ? (state.entities[f.userId]?.name ?? null) : f.userName;
    return { status: f.userId === viewer.id ? 'eaten by you' : 'eaten', user, place: null };
  }
  if (f.container === 'held') {
    return {
      status: f.holderId === viewer.id ? 'carried by you' : 'carried',
      user: f.holderId ? (state.entities[f.holderId]?.name ?? null) : null,
      place: null,
    };
  }
  if (f.container === 'market')
    return { status: 'for sale', user: null, place: placeName(f.place) };
  return {
    status: truth ? f.container : 'whereabouts unknown',
    user: null,
    place: truth ? placeName(f.place) : null,
  };
}

export function fruitsView(
  state: WorldState,
  data: GameData,
  omniscient: boolean,
): FruitsView | null {
  const p = playerPerson(state, data);
  if (!p) return null;
  const powers = p.c.powers;
  const all = fruitEntities(state);
  const known: FruitEntryView[] = [];
  for (const fruit of all) {
    const def = fruitDefOf(data, fruit);
    if (!def) continue;
    const mine = powers?.known[fruit.id];
    const isPublic =
      fruit.knownBy.includes(PUBLIC_KNOWLEDGE) || fruit.knownBy.includes(p.entity.id);
    if (!mine && !isPublic && !omniscient) continue;
    const identified = omniscient || isPublic || mine?.identified === true;
    const s = statusOf(state, data, fruit, p.entity, omniscient);
    known.push({
      id: fruit.id,
      name: identified ? def.name : 'An unknown Devil Fruit',
      japanese: identified ? (def.japanese ?? null) : null,
      type: identified ? def.type : null,
      rarity: identified ? def.rarity : null,
      user: s.user,
      status: s.status,
      place: s.place,
      description: identified ? def.description : (fruit.fruit?.look ?? null),
      techniques: identified ? def.techniques.map((t) => t.name) : [],
      canon: def.origin === 'canon',
      hidden: !mine && !isPublic,
      searchHere:
        !p.place.atSea &&
        mine !== undefined &&
        mine.place === p.place.id &&
        fruit.fruit?.container !== 'eaten' &&
        fruit.fruit?.container !== 'held',
    });
  }
  const carried = (powers?.items ?? [])
    .map((id) => state.entities[id])
    .filter((e): e is Entity => e?.fruit !== undefined)
    .map((fruit) => {
      const def = fruitDefOf(data, fruit);
      const identified = powers?.known[fruit.id]?.identified === true;
      const library = !p.place.atSea && p.place.features.includes('library');
      const book = (powers?.items ?? []).some(
        (id) => state.entities[id]?.flags['item.kind'] === 'encyclopedia',
      );
      return {
        id: fruit.id,
        look: fruit.fruit?.look ?? 'a swirled fruit',
        name: identified ? (def?.name ?? null) : null,
        canEat: p.c.alive,
        warning: powers?.fruit
          ? 'You already have a fruit: a second one would kill you.'
          : 'The sea will never hold you again.',
        canIdentify: {
          encyclopedia: book && !identified,
          scholar: identified ? 'Already known' : library ? null : 'It takes a library',
        },
      };
    });
  const market = p.place.atSea
    ? []
    : marketHere(state, p.place.id).map((fruit) => ({
        id: fruit.id,
        look: fruit.fruit?.look ?? 'a swirled fruit',
        price: fruit.fruit?.price ?? 0,
        lock:
          p.c.berries < (fruit.fruit?.price ?? 0)
            ? `Costs ${formatBerries(fruit.fruit?.price ?? 0)} Berries`
            : null,
      }));
  return {
    known: known.sort((a, b) => Number(a.hidden) - Number(b.hidden) || (a.name < b.name ? -1 : 1)),
    rumours: (powers?.rumours ?? []).map((r, index) => ({
      index,
      name: r.name,
      place: data.locations[r.place]?.name ?? r.place,
      date: formatDate(dateOf(data.calendar, r.tick)),
      here: !p.place.atSea && r.place === p.place.id,
    })),
    howTo:
      carried.length === 0 && !powers?.fruit
        ? [
            'Chase Devil Fruit rumours (an activity, from 16): some point to a real fruit lying wild.',
            'Sail to where a rumour points and search there: a true one, still there, is yours.',
            'Black markets sell fruits nobody will name, for a hundred million Berries and up.',
            'Ruins, chests adrift and the odd auction turn one up now and then.',
          ]
        : null,
    carried,
    market,
    counts: {
      canon: all.filter((e) => e.origin === 'canon').length,
      generated: all.filter((e) => e.origin === 'generated').length,
      inWorld: all.length,
    },
  };
}
