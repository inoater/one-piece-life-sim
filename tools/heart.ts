/**
 * npm run heart -- [--lives 30] [--years 10] [--sensible]
 *
 * Phase 7's sweep: ten-year adult lives lived by the autopilot (which talks to the people around
 * it), three of those years away from home, and what the people in them did: how many kinds of
 * initiative they started, which ones, how many milestones were reached, how many talks were had.
 * `--sensible` lets the autopilot say only sensible things; by default it tries everything.
 */
import { loadGameData } from '../src/engine/data/loader';
import { advance, applyAction, createLife, Rng } from '../src/core';
import { autopilot } from '../src/systems/life/autopilot';
import { readDataDir } from './lib/read-data';

const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const lives = arg('lives', 30);
const years = arg('years', 10);
const variety = !args.includes('--sensible');

const loaded = loadGameData(readDataDir(process.cwd()));
if (!loaded.data) {
  console.error('The data does not load: run npm run validate');
  process.exit(1);
}
const data = loaded.data;
const start = Date.now();
const kindsPer: number[] = [];
const seen = new Map<string, number>();
let milestones = 0;
let talks = 0;
for (let i = 0; i < lives; i++) {
  const seed = `heart-sweep-${i}`;
  const { state, playerId } = createLife(
    data,
    {
      seed,
      canonMode: 'canon',
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
  for (let m = 0; m < months && state.entities[playerId]?.character?.alive; m++) {
    if (m === Math.round(months * 0.25))
      applyAction(
        state,
        data,
        { type: 'debug/teleport', location: 'loc_loguetown' },
        { debug: true },
      );
    if (m === Math.round(months * 0.55))
      applyAction(
        state,
        data,
        { type: 'debug/teleport', location: 'loc_east_blue_village' },
        { debug: true },
      );
    autopilot(state, data, rng.fork('auto', state.tick), { variety });
    advance(state, data, rng, { kind: 'months', count: 1 }, 'auto-random');
  }
  const kinds = new Set<string>();
  for (const r of state.log) {
    for (const tag of r.tags) {
      if (tag.startsWith('ini:') && tag !== 'ini:ini_guilt') kinds.add(tag.slice(8));
      if (tag.startsWith('ms:')) milestones += 1;
      if (tag.startsWith('int:')) talks += 1;
    }
  }
  kindsPer.push(kinds.size);
  for (const k of kinds) seen.set(k, (seen.get(k) ?? 0) + 1);
}
const sorted = [...kindsPer].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
console.log(
  `## ${lives} lives of ${years} years from 22 (${variety ? 'trying everything' : 'sensible talk'}), ${Math.round((Date.now() - start) / 1000)} s\n`,
);
console.log(
  `Kinds of initiative people started, per life: min ${sorted[0]}, median ${median}, max ${sorted[sorted.length - 1]}; ${sorted.filter((n) => n >= 15).length} of ${lives} lives reach 15.`,
);
console.log(
  `Milestones reached: ${(milestones / lives).toFixed(1)} a life. Talks: ${(talks / lives).toFixed(0)} a life.\n`,
);
console.log('| Initiative | Lives it happened in |');
console.log('| --- | --- |');
for (const id of Object.keys(data.initiatives).sort()) {
  const k = id.slice(4);
  if (k === 'guilt') continue;
  console.log(`| ${data.initiatives[id]?.name ?? k} | ${seen.get(k) ?? 0}/${lives} |`);
}
