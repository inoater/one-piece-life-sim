import { resolve } from 'node:path';
import { advance, createWorld, Rng } from '../src/core';
import { loadGameData } from '../src/engine/data/loader';
import { DEFAULT_WORLD_CONFIG, type WorldState } from '../src/engine/state';
import { beatState, orderedBeats } from '../src/systems/canon/beats';
import { ensureWorldLayer } from '../src/systems/places/history';
import { worldTimeline } from '../src/systems/places/timeline';
import { canonView, factionViews, worldSummary } from '../src/systems/places/view';
import { readDataDir } from './lib/read-data';
import { renderIssues } from './lib/report';

/**
 * npm run world
 *
 * Plays the world from Year 0 to the present with nobody in it (Phase 3) and prints its timeline:
 * every famous event that happened or did not, early deaths, and (with --news) every headline.
 * Then the powers as they stand and how the story went.
 *
 *   npm run world -- --seed s --mode probable --population full --news
 *   npm run world -- --rates 100           how often each beat fires, per canon mode
 */

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--')
    ? (args[i + 1] as string)
    : fallback;
};
const flag = (name: string) => args.includes(`--${name}`);

const loaded = loadGameData(readDataDir(resolve(process.cwd())));
if (!loaded.ok || !loaded.data) {
  console.error(renderIssues(loaded.issues));
  process.exit(1);
}
const data = loaded.data;
const PRESENT = data.calendar.presentTick;

function playWorld(
  seed: string,
  mode: string,
  population: 'full' | 'none',
  fixtures = false,
): WorldState {
  const state = createWorld({
    seed,
    config: { ...DEFAULT_WORLD_CONFIG, canonMode: mode, population },
    intro: false,
  });
  if (fixtures) state.flags['dev.fixtures'] = true;
  ensureWorldLayer(state, data);
  advance(
    state,
    data,
    Rng.root(seed),
    { kind: 'months', count: PRESENT - state.tick },
    'auto-first',
  );
  return state;
}

const rates = Number(arg('rates', '0'));
if (rates > 0) {
  const modes = ['canon', 'probable', 'random'];
  const fired: Record<string, Record<string, number>> = {};
  const started = Date.now();
  for (const mode of modes) {
    for (let i = 0; i < rates; i++) {
      const state = playWorld(`rates-${mode}-${i}`, mode, 'none', true);
      for (const beat of orderedBeats(state, data)) {
        fired[beat.id] ??= {};
        if (beatState(state, beat.id).status === 'fired')
          fired[beat.id]![mode] = (fired[beat.id]![mode] ?? 0) + 1;
      }
    }
  }
  console.log(
    `How often each beat fired across ${rates} seeded worlds per mode (${((Date.now() - started) / 1000).toFixed(1)} s):\n`,
  );
  console.log(`| Beat | Anchor | Canon | Probable | Random |`);
  console.log(`| --- | --- | --- | --- | --- |`);
  for (const beat of Object.values(data.canon)) {
    const f = fired[beat.id] ?? {};
    const pct = (m: string) => `${Math.round(((f[m] ?? 0) / rates) * 100)}%`;
    console.log(
      `| ${beat.name} | ${beat.anchor} | ${pct('canon')} | ${pct('probable')} | ${pct('random')} |`,
    );
  }
  process.exit(0);
}

const seed = arg('seed', 'world');
const mode = arg('mode', 'canon');
const population = arg('population', 'none') === 'full' ? 'full' : 'none';
const started = Date.now();
const state = playWorld(seed, mode, population);
const ms = Date.now() - started;

for (const line of worldTimeline(state, data, { news: flag('news') })) {
  const mark = line.kind === 'canon' ? '*' : line.kind === 'divergence' ? '!' : ' ';
  console.log(`${line.date.padEnd(20)} ${mark} ${line.text}`);
}
const summary = worldSummary(state, data);
const canon = canonView(state, data);
console.log(`\nThe powers at the present:`);
for (const f of factionViews(state, data)
  .filter((x) => x.active)
  .slice(0, 12)) {
  console.log(
    `  ${f.shortName.padEnd(22)} ${String(Math.round(f.strength)).padStart(4)}  ${f.places > 0 ? `holds ${f.places}` : ''}`,
  );
}
console.log(
  `\n${canon.mode} mode, seed "${seed}": ${canon.counts.fired} famous events happened, ${canon.counts.diverged} never did, ${state.canon.divergences.length} divergences logged.`,
);
console.log(
  `${summary.population.places} places, ${summary.population.named} named people, ${summary.population.crews} crews at sea, ${state.news.length} headlines. ${PRESENT} months in ${(ms / 1000).toFixed(1)} s.`,
);
