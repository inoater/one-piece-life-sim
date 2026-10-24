import { resolve } from 'node:path';
import { advance, advanceOptions, createWorld, Rng } from '../src/core';
import { loadGameData } from '../src/engine/data/loader';
import { DEFAULT_WORLD_CONFIG } from '../src/engine/state';
import { createLife } from '../src/systems/genesis/generate';
import { runHeadlessLife } from '../src/systems/life/headless';
import { giveTraitTo } from '../src/systems/life/traits';
import { ensureWorldLayer } from '../src/systems/places/history';
import { canonIndex, fruitDefOf, generateFruit } from '../src/systems/powers/catalogue';
import { fruitEntities } from '../src/systems/powers/fruits';
import { hasKingsQualities, tryWake } from '../src/systems/powers/haki';
import { hakiAwake } from '../src/systems/powers/state';
import { powerCtxFor } from '../src/systems/powers/tracks';
import { readDataDir } from './lib/read-data';
import { renderIssues } from './lib/report';

/**
 * npm run powers
 *
 * The evidence for Phase 4 that is too slow for the unit tests:
 *
 *   --kings N    N real lives from character genesis, every waking trigger tried many times on
 *                each: Conqueror's Haki wakes only in those born with King's Qualities.
 *   --drift N    N headless lives of 39 years: personality traits gained and lost.
 *   --world      a 39-year world with every Tier 2 person: one copy of each fruit, every year.
 *
 *   npm run powers -- --kings 10000 --drift 20 --world
 */

const args = process.argv.slice(2);
const num = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const flag = (name: string) => args.includes(`--${name}`);

const loaded = loadGameData(readDataDir(resolve(process.cwd())));
if (!loaded.ok || !loaded.data) {
  console.error(renderIssues(loaded.issues));
  process.exit(1);
}
const data = loaded.data;

// ---- The catalogue
const fruits = Object.values(data.fruits);
const byType = (t: string) => fruits.filter((f) => f.type === t).length;
console.log(
  `Canon fruits: ${fruits.length} (Paramecia ${byType('paramecia')}, Zoan ${byType('zoan')}, Logia ${byType('logia')}); tracks ${Object.keys(data.tracks).length}; techniques ${Object.keys(data.techniques).length} plus ${fruits.reduce((n, f) => n + f.techniques.length, 0)} in fruits; canon movesets ${Object.keys(data.movesets).length}; traits ${Object.keys(data.traits).length}.`,
);
const canon = canonIndex(data);
let clash = 0;
const taken = new Set<string>();
const t0 = performance.now();
for (let i = 0; i < 1000; i++) {
  if (i % 30 === 0) taken.clear();
  const def = generateFruit(data, Rng.root('tool').fork(i), {
    id: `fruit_gen_${String(i).padStart(6, '0')}`,
    taken,
  });
  if (canon.powers.has(def.power) || canon.names.has(def.name.toLowerCase())) clash += 1;
}
console.log(
  `1,000 generated fruits in ${(performance.now() - t0).toFixed(0)} ms: ${clash} take a canon power or name.`,
);

// ---- King's Qualities
const kings = num('kings', 0);
if (kings > 0) {
  const t = performance.now();
  let born = 0;
  let given = 0;
  let wokeWith = 0;
  let wokeWithout = 0;
  for (let i = 0; i < kings; i++) {
    const seed = `kings-${i}`;
    const { state, playerId } = createLife(
      data,
      {
        seed,
        canonMode: 'canon',
        difficulty: 'normal',
        rareRaces: true,
        race: 'random',
        birthplace: 'random',
        entryYear: 20,
        entryAge: 18,
        pronouns: 'they',
      } as never,
      { allowBlocked: true, population: 'none' },
    );
    const entity = state.entities[playerId]!;
    if (hasKingsQualities(data, entity.character!)) born += 1;
    // Born kings are one in millions: every hundredth life is given the trait, to show it wakes.
    else if (i % 100 === 0) giveTraitTo(data, entity, data.powers.haki.kingsQualitiesTrait);
    const king = hasKingsQualities(data, entity.character!);
    if (king) given += 1;
    const ctx = powerCtxFor(state, data, entity, state.tick, Rng.root(seed));
    if (!ctx) continue;
    for (let n = 0; n < 5; n++) {
      for (const trigger of ['seed', 'near_death', 'crisis', 'teacher', 'clash'] as const) {
        tryWake({ ...ctx, rng: Rng.root(seed).fork(trigger, n) }, 'conqueror', trigger);
      }
    }
    if (hakiAwake(entity.character!, 'conqueror')) {
      if (king) wokeWith += 1;
      else wokeWithout += 1;
    }
  }
  console.log(
    `${kings} lives (${((performance.now() - t) / 1000).toFixed(1)} s): ${born} born with King's Qualities and ${given - born} given it; Conqueror's woke in ${wokeWith} of those ${given} and in ${wokeWithout} of the ${kings - given} without.`,
  );
}

// ---- Personality drift
const drift = num('drift', 0);
if (drift > 0) {
  const t = performance.now();
  let lives = 0;
  let gained = 0;
  let lost = 0;
  let both = 0;
  for (let i = 0; i < drift; i++) {
    const life = runHeadlessLife(
      data,
      { seed: `drift-${i + 1}`, race: 'race_human', maxYears: 39, keepState: true },
      advanceOptions('auto-random'),
    );
    const log = life.state!.log;
    const g = log.filter((r) => r.tags.includes('drift-gained')).length;
    const l = log.filter((r) => r.tags.includes('drift-lost')).length;
    lives += 1;
    gained += g;
    lost += l;
    if (g > 0 && l > 0) both += 1;
  }
  console.log(
    `${lives} lives of 39 years (${((performance.now() - t) / 1000).toFixed(1)} s): ${gained} personality traits gained, ${lost} lost; ${both} lives both gained and lost one.`,
  );
}

// ---- One fruit, one world
if (flag('world')) {
  const t = performance.now();
  const state = createWorld({
    seed: 'powers-world',
    config: { ...DEFAULT_WORLD_CONFIG, canonMode: 'canon', population: 'full' },
    intro: false,
  });
  ensureWorldLayer(state, data);
  let worst = 0;
  for (let year = 0; year < 39; year++) {
    advance(state, data, Rng.root(state.seed), { kind: 'months', count: 12 }, 'auto-first');
    const seen = new Map<string, number>();
    for (const f of fruitEntities(state)) {
      const p = fruitDefOf(data, f)?.power ?? f.id;
      seen.set(p, (seen.get(p) ?? 0) + 1);
    }
    worst = Math.max(worst, ...seen.values());
  }
  const all = fruitEntities(state);
  const count = (c: string) => all.filter((f) => f.fruit?.container === c).length;
  const reborn = state.log.filter(
    (r) => r.tags.includes('fruit') && r.summary.includes('returned to the world'),
  ).length;
  console.log(
    `A 39-year world (${((performance.now() - t) / 1000).toFixed(1)} s): ${all.length} fruits, at most ${worst} cop${worst === 1 ? 'y' : 'ies'} of any one; ${count('eaten')} eaten, ${count('tree')} growing wild, ${count('market')} on black markets, ${count('unknown') + count('chest') + count('vault')} unfound; ${reborn} returned to the world on a death.`,
  );
}
