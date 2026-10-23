import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { advance, createWorld, Rng, applyAction } from '../src/core';
import type { DecisionPolicy } from '../src/engine/advance';
import { hashValue } from '../src/engine/canonical';
import { loadGameData } from '../src/engine/data/loader';
import { readDataDir } from './lib/read-data';
import { makeStyle, renderIssues, shouldColor } from './lib/report';

/**
 * npm run sim -- --seed abc --ticks 468 --worlds 1000 --verify
 *
 * Runs the simulation with no page, no worker and no player: the tool for balancing the game by
 * simulating many worlds, and for checking determinism and speed.
 *
 *   --seed <s>         base seed (default "headless"); with --worlds N the seeds are <s>-1 .. <s>-N
 *   --ticks <n>        months to simulate (default 468: the whole canon span)
 *   --worlds <n>       how many worlds (default 1)
 *   --probe            enable the entropy probe so the world consumes randomness
 *   --fixtures         spawn the dev test entity first
 *   --decisions <p>    auto-random (default) | auto-first | stop
 *   --verify           run every world twice and fail if the hashes differ
 *   --json             machine-readable output
 *   --root <dir>       project root (default: current directory)
 */

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const number = (name: string, fallback: number): number => {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`${name} needs a non-negative integer, got "${raw}"`);
    process.exit(2);
  }
  return n;
};

const root = resolve(option('--root') ?? process.cwd());
const loaded = loadGameData(readDataDir(root));
if (!loaded.ok || !loaded.data) {
  console.error(renderIssues(loaded.issues, makeStyle(shouldColor(process.stderr))));
  console.error('\nCannot simulate: the data is invalid. Run `npm run validate`.');
  process.exit(1);
}
const data = loaded.data;

const baseSeed = option('--seed') ?? 'headless';
const ticks = number('--ticks', 468);
const worlds = Math.max(1, number('--worlds', 1));
const decisions = (option('--decisions') ?? 'auto-random') as DecisionPolicy;
if (!['auto-random', 'auto-first', 'stop'].includes(decisions)) {
  console.error(`--decisions must be auto-random, auto-first or stop, got "${decisions}"`);
  process.exit(2);
}

interface Run {
  seed: string;
  ticksRun: number;
  finalTick: number;
  stop: string;
  ms: number;
  hash: string;
  log: number;
  entities: number;
}

function runOnce(seed: string): Run {
  const state = createWorld({ seed, ...(flag('--probe') ? { probe: true } : {}) });
  if (flag('--fixtures'))
    applyAction(state, data, { type: 'debug/spawnTestEntity' }, { debug: true });
  const started = performance.now();
  const result = advance(state, data, Rng.root(seed), { kind: 'months', count: ticks }, decisions);
  const ms = performance.now() - started;
  return {
    seed,
    ticksRun: result.ticksRun,
    finalTick: state.tick,
    stop: result.stop,
    ms,
    hash: hashValue(state),
    log: state.log.length,
    entities: Object.keys(state.entities).length,
  };
}

const runs: Run[] = [];
const mismatches: string[] = [];
for (let i = 0; i < worlds; i++) {
  const seed = worlds === 1 ? baseSeed : `${baseSeed}-${i + 1}`;
  const run = runOnce(seed);
  runs.push(run);
  if (flag('--verify') && runOnce(seed).hash !== run.hash) mismatches.push(seed);
}

const times = runs.map((r) => r.ms);
const total = times.reduce((a, b) => a + b, 0);
const summary = {
  worlds,
  ticksRequested: ticks,
  totalMs: Math.round(total * 10) / 10,
  perWorldMs: {
    mean: Math.round((total / worlds) * 100) / 100,
    min: Math.round(Math.min(...times) * 100) / 100,
    max: Math.round(Math.max(...times) * 100) / 100,
  },
  distinctHashes: new Set(runs.map((r) => r.hash)).size,
  verified: flag('--verify') ? mismatches.length === 0 : null,
  mismatches,
};

if (flag('--json')) {
  console.log(JSON.stringify({ summary, runs: worlds <= 20 ? runs : undefined }, null, 2));
} else {
  if (worlds <= 5) {
    for (const r of runs) {
      console.log(
        `seed ${r.seed}: ${r.ticksRun} ticks in ${r.ms.toFixed(1)} ms, stopped (${r.stop}) at tick ${r.finalTick}, ${r.entities} entities, ${r.log} log records`,
      );
      console.log(`  state hash ${r.hash}`);
    }
  }
  console.log(
    `${worlds} world${worlds === 1 ? '' : 's'}, ${ticks} ticks each: ${summary.totalMs} ms total (mean ${summary.perWorldMs.mean} ms, max ${summary.perWorldMs.max} ms), ${summary.distinctHashes} distinct hash${summary.distinctHashes === 1 ? '' : 'es'}.`,
  );
  if (flag('--verify')) {
    console.log(
      mismatches.length === 0
        ? 'Determinism verified: every world reproduced its hash on a second run.'
        : `DETERMINISM FAILURE for seeds: ${mismatches.join(', ')}`,
    );
  }
}
process.exit(mismatches.length === 0 ? 0 : 1);
