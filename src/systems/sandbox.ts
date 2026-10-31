import type { GameData } from '../engine/data/schemas';
import { appendLog } from '../engine/log';
import { Rng } from '../engine/rng';
import { makeStat, STAT_IDS, statLabel, statValue } from '../engine/stats';
import type { Entity, WorldState } from '../engine/state';
import { addMember } from './crew/members';
import { foundCrew } from './crew/creator';
import { crewLedBy, hereOf } from './crew/state';
import { makeCandidate } from './crew/world';
import { heartEnv } from './heart/talk';
import { reputation } from './life/body';
import { giveTraitTo } from './life/traits';
import { fruitName } from './powers/fruits';
import { HAKI_TRACKS } from './powers/state';

/**
 * The debug panel's sandbox: everything that can be handed out, by type (weapons by family,
 * items by kind, the world's Devil Fruits, traits, power tracks), and tools that set a stat, money,
 * fame, infamy and a bounty, give a trait, or bring a crewmate aboard. Debug builds only (the
 * action layer refuses `debug/*` otherwise); every change is logged as a debug record.
 */

export interface CatalogEntry {
  id: string;
  name: string;
  note: string;
}

export interface Catalog {
  weapons: { group: string; entries: CatalogEntry[] }[];
  items: { group: string; entries: CatalogEntry[] }[];
  fruits: { group: string; entries: CatalogEntry[] }[];
  traits: { group: string; entries: CatalogEntry[] }[];
  tracks: { group: string; entries: CatalogEntry[] }[];
  stats: { id: string; label: string; value: number; base: number }[];
  money: { berries: number; fame: number; infamy: number; bounty: number };
  crew: { name: string; size: number; members: { id: string; name: string }[] } | null;
}

function grouped<T>(list: readonly T[], groupOf: (x: T) => string, entry: (x: T) => CatalogEntry) {
  const map = new Map<string, CatalogEntry[]>();
  for (const x of list) {
    const g = groupOf(x);
    map.set(g, [...(map.get(g) ?? []), entry(x)]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([group, entries]) => ({
      group,
      entries: entries.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

export function sandboxCatalog(state: WorldState, data: GameData): Catalog {
  const player = state.playerId ? state.entities[state.playerId] : undefined;
  const tick = state.tick;
  const weapons = Object.values(data.weapons).filter((w) => !w.tags.includes('dev'));
  const fruits = Object.values(state.entities).filter((e) => e.fruit);
  const crewEnt = crewLedBy(state, player);
  return {
    weapons: grouped(
      weapons,
      (w) => `${cap(w.family)}${w.grade ? `, ${w.grade}` : ''}`,
      (w) => ({
        id: w.id,
        name: w.name,
        note: [
          w.template ? 'a blade of its grade' : null,
          w.canon ? 'canon' : null,
          w.price !== undefined ? `${w.price.toLocaleString('en-GB')} B` : null,
        ]
          .filter(Boolean)
          .join(', '),
      }),
    ),
    items: grouped(
      Object.values(data.items).filter((i) => !i.tags.includes('dev')),
      (i) => cap(i.kind),
      (i) => ({
        id: i.id,
        name: i.name,
        note: typeof i.price === 'number' ? `${i.price.toLocaleString('en-GB')} B` : '',
      }),
    ),
    fruits: grouped(
      fruits,
      (f) =>
        f.fruit?.container === 'eaten'
          ? 'Eaten'
          : f.fruit?.holderId
            ? 'Carried'
            : cap(f.fruit?.container ?? 'unknown'),
      (f) => ({
        id: f.id,
        name: fruitName(data, f),
        note: f.fruit?.userId
          ? `eaten by ${state.entities[f.fruit.userId]?.name ?? f.fruit.userName ?? 'someone'}`
          : f.fruit?.place
            ? (data.locations[f.fruit.place]?.name ?? f.fruit.place)
            : '',
      }),
    ),
    traits: grouped(
      Object.values(data.traits).filter((t) => !t.tags?.includes('dev')),
      (t) => cap(t.category ?? t.kind ?? 'other'),
      (t) => ({
        id: t.id,
        name: t.name,
        note: player?.character?.traits.includes(t.id) ? 'has it' : '',
      }),
    ),
    tracks: grouped(
      Object.values(data.tracks),
      (t) => cap(t.family),
      (t) => {
        const ts = player?.character?.powers?.tracks[t.id];
        return {
          id: t.id,
          name: t.name,
          note: ts
            ? `stage ${ts.stage + 1} of ${t.stages.length}`
            : (Object.values(HAKI_TRACKS) as string[]).includes(t.id)
              ? 'haki'
              : '',
        };
      },
    ),
    stats: STAT_IDS.map((id) => {
      const s = player?.stats[id];
      return {
        id,
        label: statLabel(id),
        value: s ? Math.round(statValue(s, tick) * 10) / 10 : 0,
        base: s?.base ?? 0,
      };
    }),
    money: {
      berries: player?.character?.berries ?? 0,
      fame: player ? Math.round(statValue(reputation(player, 'fame'), tick)) : 0,
      infamy: player ? Math.round(statValue(reputation(player, 'infamy'), tick)) : 0,
      bounty: typeof player?.flags['bounty'] === 'number' ? (player.flags['bounty'] as number) : 0,
    },
    crew: crewEnt?.crew
      ? {
          name: crewEnt.name,
          size: crewEnt.crew.members.length,
          members: crewEnt.crew.members.map((m) => ({
            id: m.id,
            name: state.entities[m.id]?.name ?? m.id,
          })),
        }
      : null,
  };
}

function log(state: WorldState, text: string, cause: string): void {
  appendLog(state, state.tick, {
    kind: 'system',
    summary: `Debug: ${text}`,
    tags: ['system', 'debug'],
    cause,
    knownBy: state.playerId ? [state.playerId] : [],
  });
}

/** Set a stat's total to a value (the base moves; modifiers stay). Anyone, by id. */
export function debugSetStat(
  state: WorldState,
  entityId: string,
  stat: string,
  value: number,
): void {
  const e = state.entities[entityId];
  if (!e) throw new Error(`There is no entity "${entityId}"`);
  e.stats[stat] ??= makeStat(0);
  const s = e.stats[stat] as NonNullable<Entity['stats'][string]>;
  const now = statValue(s, state.tick);
  s.base = Math.round((s.base + (value - now)) * 100) / 100;
  log(state, `${e.name}'s ${statLabel(stat)} set to ${value}.`, 'action:debug/setStat');
}

export type MoneyField = 'berries' | 'fame' | 'infamy' | 'bounty';

export function debugMoney(state: WorldState, field: MoneyField, value: number): void {
  const p = state.playerId ? state.entities[state.playerId] : undefined;
  if (!p?.character) throw new Error('Nobody is being played');
  if (field === 'berries') p.character.berries = Math.round(value);
  else if (field === 'bounty') {
    if (value > 0) p.flags['bounty'] = Math.round(value);
    else delete p.flags['bounty'];
  } else {
    const stat = reputation(p, field);
    stat.base += value - statValue(stat, state.tick);
  }
  log(state, `${field} set to ${Math.round(value).toLocaleString('en-GB')}.`, 'action:debug/money');
}

export function debugGiveTrait(
  state: WorldState,
  data: GameData,
  traitId: string,
  remove: boolean,
): void {
  const p = state.playerId ? state.entities[state.playerId] : undefined;
  if (!p?.character) throw new Error('Nobody is being played');
  if (!data.traits[traitId]) throw new Error(`There is no trait "${traitId}"`);
  if (remove) p.character.traits = p.character.traits.filter((t) => t !== traitId);
  else giveTraitTo(data, p, traitId, 'A debug command', state.tick);
  log(
    state,
    `${remove ? 'removed' : 'gave'} ${data.traits[traitId]?.name ?? traitId}.`,
    'action:debug/trait',
  );
}

/** Someone looking for a ship, here, brought straight aboard (a crew founded if there is none). */
export function debugAddCrewmate(state: WorldState, data: GameData, strength: number): string {
  const env = heartEnv(state, data, 'action:debug/addCrewmate');
  if (!env) throw new Error('Nobody alive is being played');
  const crewEnt = crewLedBy(state, env.p.entity) ?? foundCrew(env, { kind: 'pirate' });
  const here = hereOf(data, env.p.entity) ?? env.p.c.birthplace;
  const place = data.locations[here] ? here : (Object.keys(data.locations).sort()[0] as string);
  const other = makeCandidate(
    env,
    place,
    'debug',
    Rng.root(state.seed).fork('debug-crewmate', state.counters.genId),
    Math.max(0.2, strength),
  );
  if (!other) throw new Error('Nobody could be made here');
  addMember(env, crewEnt, other, { how: 'debug' });
  log(state, `${other.name} joined the crew.`, 'action:debug/addCrewmate');
  return other.id;
}
