/**
 * npm run crew -- [--lives 20] [--years 10]
 *
 * Phase 8's sweep: ten-year adult lives of a captain (the autopilot founds a pirate crew at once,
 * recruits from the boards, answers doubts, works quests, sends errands), moving port to port
 * every year and a half. For each life: who joined and how, what crewmates trained, which styles
 * they taught each other (and the techniques that came with them), the personal arcs finished,
 * the bounties earned, missions run, quests done, spies caught and betrayals.
 */
import { loadGameData } from '../src/engine/data/loader';
import { advance, applyAction, createLife, Rng } from '../src/core';
import { autopilot } from '../src/systems/life/autopilot';
import { crewLedBy, crewLimit } from '../src/systems/crew/state';
import { TRAINING_SOURCE } from '../src/systems/genesis/context';
import { readDataDir } from './lib/read-data';

const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const lives = arg('lives', 20);
const years = arg('years', 10);

const loaded = loadGameData(readDataDir(process.cwd()));
if (!loaded.data) {
  console.error('The data does not load: run npm run validate');
  process.exit(1);
}
const data = loaded.data;
const ports = Object.values(data.locations)
  .filter(
    (l) =>
      l.features.includes('docks') &&
      !l.tags.includes('dev') &&
      (l.region === 'east_blue' || l.region === 'paradise'),
  )
  .map((l) => l.id)
  .sort();

const start = Date.now();
const rows: Record<string, number>[] = [];
const joinedBy = new Map<string, number>();
const questsDone = new Map<string, number>();
for (let i = 0; i < lives; i++) {
  const seed = `crew-sweep-${i}`;
  const { state, playerId } = createLife(
    data,
    {
      seed,
      canonMode: 'probable',
      difficulty: 'normal',
      rareRaces: false,
      race: 'race_human',
      birthplace: 'bp_east_blue_village',
      entryYear: 20,
      entryAge: 22,
      pronouns: 'they',
    },
    { allowBlocked: true, population: 'none' },
  );
  const rng = Rng.root(seed);
  const months = years * 12;
  const statAtJoin = new Map<string, number>();
  for (let m = 0; m < months && state.entities[playerId]?.character?.alive; m++) {
    if (m % 18 === 0) {
      const to = ports[Math.floor(m / 18 + i) % ports.length] as string;
      try {
        applyAction(state, data, { type: 'debug/teleport', location: to }, { debug: true });
      } catch {
        // At sea, or there already.
      }
    }
    autopilot(state, data, rng.fork('auto', state.tick), { captain: true });
    advance(state, data, rng, { kind: 'months', count: 1 }, 'auto-random');
    const crew = crewLedBy(state, state.entities[playerId])?.crew;
    for (const mem of crew?.members ?? []) {
      if (statAtJoin.has(mem.id)) continue;
      const e = state.entities[mem.id];
      const sum = Object.entries(e?.stats ?? {}).reduce(
        (n, [k, s]) =>
          n +
          (k === 'luck'
            ? 0
            : s.mods.reduce((a, x) => a + (x.source === TRAINING_SOURCE ? x.value : 0), 0)),
        0,
      );
      statAtJoin.set(mem.id, sum);
    }
  }
  const crew = crewLedBy(state, state.entities[playerId])?.crew;
  let trained = 0;
  for (const [id, before] of statAtJoin) {
    const e = state.entities[id];
    const now = Object.entries(e?.stats ?? {}).reduce(
      (n, [k, s]) =>
        n +
        (k === 'luck'
          ? 0
          : s.mods.reduce((a, x) => a + (x.source === TRAINING_SOURCE ? x.value : 0), 0)),
      0,
    );
    if (now - before >= 1) trained += 1;
  }
  const count = (tag: string) => state.log.filter((r) => r.tags.includes(tag)).length;
  for (const r of state.log) {
    for (const t of r.tags) {
      if (t.startsWith('join:')) joinedBy.set(t.slice(5), (joinedBy.get(t.slice(5)) ?? 0) + 1);
      if (t.startsWith('questDone:'))
        questsDone.set(t.slice(10), (questsDone.get(t.slice(10)) ?? 0) + 1);
    }
  }
  const bountied = [...statAtJoin.keys()].filter(
    (id) => typeof state.entities[id]?.flags['bounty'] === 'number',
  ).length;
  rows.push({
    aboard: crew?.members.length ?? 0,
    limit: crew ? crewLimit(state, data, state.entities[playerId] as never, crew).limit : 0,
    joined: count('join'),
    trained,
    taught: count('crew:taught'),
    techniques: count('crew:technique'),
    'technique from a crewmate': count('technique:taught'),
    arcs: count('arcDone'),
    bountied,
    missions: count('crew:missionBack'),
    quests: count('crew:questDone'),
    spies: count('crew:spyCaught'),
    betrayals: count('crew:betrayal'),
    haki: count('crew:hakiWoke'),
  });
}
const keys = Object.keys(rows[0] ?? {});
const all = (k: string) => rows.filter((r) => (r[k] ?? 0) > 0).length;
const median = (k: string) => {
  const v = rows.map((r) => r[k] ?? 0).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)] ?? 0;
};
console.log(
  `${lives} captains, ${years} years each, from 22 (${((Date.now() - start) / 1000).toFixed(1)} s)\n`,
);
console.log('| Measure | Lives where it happened | Median a life | Most |');
console.log('| --- | --- | --- | --- |');
for (const k of keys)
  console.log(
    `| ${k} | ${all(k)}/${lives} | ${median(k)} | ${Math.max(...rows.map((r) => r[k] ?? 0))} |`,
  );
const every = rows.filter(
  (r) =>
    (r['trained'] ?? 0) > 0 &&
    (r['technique from a crewmate'] ?? 0) > 0 &&
    (r['arcs'] ?? 0) > 0 &&
    (r['bountied'] ?? 0) > 0,
).length;
console.log(
  `\nLives where crewmates trained, learned a technique from each other, finished an arc AND earned bounties: ${every}/${lives}`,
);
console.log(
  '\nJoined by:',
  [...joinedBy.entries()]
    .sort()
    .map(([k, n]) => `${k} ${n}`)
    .join(', '),
);
console.log(
  'Quests done by kind:',
  [...questsDone.entries()]
    .sort()
    .map(([k, n]) => `${k} ${n}`)
    .join(', '),
);
