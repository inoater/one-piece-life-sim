import { resolve } from 'node:path';
import { advance, createWorld, Rng } from '../src/core';
import type { BattleState, Fighter } from '../src/engine/battle-state';
import { loadGameData } from '../src/engine/data/loader';
import { DEFAULT_WORLD_CONFIG } from '../src/engine/state';
import { ctxOf, newBattle, runDuel, sidePower, winChance } from '../src/systems/battle/battle';
import { foeFighter } from '../src/systems/battle/fighters';
import { castPowerAt, tierOf } from '../src/systems/battle/ladder';
import { partnerMult } from '../src/systems/battle/spar';
import { combatPowerOf } from '../src/systems/life/body';
import { ensureWorldLayer } from '../src/systems/places/history';
import { readDataDir } from './lib/read-data';
import { renderIssues } from './lib/report';

/**
 * npm run battle
 *
 * The evidence for Phase 5 that is too slow (or too wordy) for the unit tests:
 *
 *   (always)        1,000 seeded pairings: the tactical engine against the abstract resolver, by
 *                   band of odds, and the gamma that fits the engine best (data/battle.json).
 *   --spars N       N spars between random fighters: deaths (none), and the training multiplier.
 *   --world         a 39-year world with every Tier 2 person: NPC fights by kind, with examples.
 *   --ladder        the canon cast's Combat Power by era against their rung.
 *
 *   npm run battle -- --spars 1000 --world --ladder
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
const pool = data.battle.foes.filter((f) => f.id !== 'foe_sea_king' && f.id !== 'foe_pacifista');

function duel(
  a: Fighter,
  b: Fighter,
  id: number,
  seed: string,
  extra: Partial<BattleState> = {},
): BattleState {
  const battle = newBattle(data, {
    id,
    scale: 'duel',
    mode: 'narrated',
    tick: 0,
    place: null,
    fighters: [a, b],
    sides: [a.name, b.name],
    source: { kind: 'debug', id: 'tool' },
  });
  Object.assign(battle, extra);
  runDuel(ctxOf({ seed }, data, battle));
  return battle;
}

// ---- Tactical against abstract
const t0 = performance.now();
const rows: { r: number; p: number; won: number; ex: number }[] = [];
for (let i = 0; i < 1000; i++) {
  const rng = Rng.root('pairing').fork(i);
  const a = foeFighter(data, rng.fork('a').pick(pool), rng.fork('A'), {
    id: 'a',
    side: 0,
    intent: 'spare',
  });
  const b = foeFighter(data, rng.fork('b').pick(pool), rng.fork('B'), {
    id: 'b',
    side: 1,
    intent: 'spare',
  });
  const p = winChance(data, sidePower(data, [a], [b]), sidePower(data, [b], [a]));
  const ratio = Math.log(a.cp / b.cp);
  const battle = duel(a, b, i + 1, 'pairings');
  const w = battle.result?.winner;
  rows.push({
    r: ratio,
    p,
    won: w === 0 ? 1 : w === 1 ? 0 : 0.5,
    ex: battle.result?.exchanges ?? 0,
  });
}
const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / Math.max(1, xs.length);
console.log(
  `1,000 pairings in ${((performance.now() - t0) / 1000).toFixed(1)} s (gamma ${data.battle.abstract.gamma}):`,
);
console.log('| Odds (abstract) | Pairings | Abstract | Tactical | Gap | Exchanges |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const [lo, hi] of [
  [0, 0.1],
  [0.1, 0.25],
  [0.25, 0.5],
  [0.5, 0.75],
  [0.75, 0.9],
  [0.9, 1.01],
] as const) {
  const band = rows.filter((r) => r.p >= lo && r.p < hi);
  if (band.length === 0) continue;
  const pa = mean(band.map((r) => r.p));
  const pt = mean(band.map((r) => r.won));
  console.log(
    `| ${Math.round(lo * 100)} to ${Math.min(100, Math.round(hi * 100))}% | ${band.length} | ${(pa * 100).toFixed(1)}% | ${(pt * 100).toFixed(1)}% | ${(Math.abs(pa - pt) * 100).toFixed(1)} | ${mean(band.map((r) => r.ex)).toFixed(1)} |`,
  );
}
console.log(
  `Overall: abstract ${(mean(rows.map((r) => r.p)) * 100).toFixed(1)}%, tactical ${(mean(rows.map((r) => r.won)) * 100).toFixed(1)}% for the first side.`,
);
let best = { g: 0, ll: -Infinity };
for (let g = 1; g <= 10; g += 0.1) {
  let ll = 0;
  for (const x of rows) {
    const q = Math.min(1 - 1e-9, Math.max(1e-9, 1 / (1 + Math.exp(-g * x.r))));
    ll += x.won * Math.log(q) + (1 - x.won) * Math.log(1 - q);
  }
  if (ll > best.ll) best = { g, ll };
}
console.log(`The gamma that fits the tactical engine best: ${best.g.toFixed(1)}.`);

// ---- Spars
const spars = num('spars', 0);
if (spars > 0) {
  let deaths = 0;
  let injuriesWorth = 0;
  for (let i = 0; i < spars; i++) {
    const rng = Rng.root('spars').fork(i);
    const a = foeFighter(data, rng.fork('a').pick(data.battle.foes), rng.fork('A'), {
      id: 'a',
      side: 0,
      intent: 'spare',
    });
    const b = foeFighter(data, rng.fork('b').pick(data.battle.foes), rng.fork('B'), {
      id: 'b',
      side: 1,
      intent: 'spare',
    });
    const stop = (['first_hit', 'first_knockdown', 'time_limit', 'yield'] as const)[i % 4];
    const battle = duel(a, b, i + 1, 'spars', {
      spar: true,
      stop,
      water: i % 5 === 0,
    } as Partial<BattleState>);
    deaths += battle.fighters.filter((f) => f.down === 'dead').length;
    injuriesWorth += battle.fighters.reduce((n, f) => n + f.totals.wounds.length, 0);
  }
  const mults = [0.5, 0.8, 1, 1.1, 1.2, 1.5].map(
    (r) => `${r}x partner: x${partnerMult(data, 100, 100 * r).toFixed(2)}`,
  );
  console.log(
    `${spars} spars: ${deaths} deaths; ${injuriesWorth} blows big enough to roll for an injury (a spar rolls a tenth as often). Training by partner: ${mults.join(', ')}.`,
  );
}

// ---- NPC fights in a world
if (flag('world')) {
  const t = performance.now();
  const state = createWorld({
    seed: 'battle-world',
    config: { ...DEFAULT_WORLD_CONFIG, canonMode: 'canon', population: 'full' },
    intro: false,
  });
  ensureWorldLayer(state, data);
  advance(state, data, Rng.root('battle-world'), { kind: 'months', count: 39 * 12 }, 'auto-first');
  const fights = state.log.filter((r) => r.tags.includes('fight') && r.tags.includes('npc'));
  const by = (tag: string) => fights.filter((f) => f.tags.includes(tag)).length;
  const deaths = fights.filter((f) => f.summary.includes('did not survive')).length;
  console.log(
    `A 39-year world (${((performance.now() - t) / 1000).toFixed(1)} s): ${fights.length} NPC fights (${by('hunt')} hunts, ${by('quarrel')} quarrels, ${by('raid')} raids, ${by('sea')} at sea); ${deaths} ended in a death.`,
  );
  const seen = new Set<string>();
  for (const f of fights) {
    const kind = ['hunt', 'quarrel', 'raid', 'sea'].find((k) => f.tags.includes(k)) ?? 'other';
    if (seen.has(kind)) continue;
    seen.add(kind);
    console.log(`  ${kind}: ${f.summary}`);
  }
}

// ---- The ladder
if (flag('ladder')) {
  const state = createWorld({
    seed: 'ladder',
    config: { ...DEFAULT_WORLD_CONFIG, canonMode: 'canon', population: 'none' },
    intro: false,
  });
  ensureWorldLayer(state, data);
  for (const year of [0, 12, 24, 36, 38]) {
    const target = year * 12 + 6;
    advance(
      state,
      data,
      Rng.root('ladder'),
      { kind: 'months', count: target - state.tick },
      'auto-first',
    );
    const rows = Object.values(data.cast)
      .filter((c) => !c.dev && state.entities[c.id]?.character?.alive)
      .map((c) => {
        const e = state.entities[c.id]!;
        const cp = combatPowerOf(data, e, state.tick - 1);
        const key = castPowerAt(c, state.tick - 1);
        return {
          name: c.name,
          cp,
          tier: tierOf(data, cp).name,
          ok: key?.tier === tierOf(data, cp).id,
        };
      })
      .sort((a, b) => b.cp - a.cp);
    const bad = rows.filter((r) => !r.ok).length;
    console.log(
      `${1486 + year} SC (${rows.length} cast, ${bad} off their rung): ${rows
        .slice(0, 8)
        .map((r) => `${r.name} ${r.cp} (${r.tier})`)
        .join(', ')} ...`,
    );
  }
}
