import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { advanceOptions } from '../src/core';
import { loadGameData } from '../src/engine/data/loader';
import type { GameData } from '../src/engine/data/schemas';
import { runHeadlessLife, type HeadlessLife } from '../src/systems/life/headless';
import { readDataDir } from './lib/read-data';
import { makeStyle, renderIssues, shouldColor } from './lib/report';

/**
 * npm run lives -- --lives 1000 --race all
 *
 * Phase 2's balancing tool: whole lives with nobody at the controls (the autopilot plans each month,
 * decisions are answered at random), from birth in Year 0 to death. Reports per race how long they
 * lived against the race's lifespan range, what killed them, and how many distinct monthly outcomes
 * one life met. Runs on every core (worker threads); every life is reproducible from its seed.
 *
 *   --lives <n>        lives per race (default 1000)
 *   --race <id|all>    one race, or every race (default all)
 *   --seed <s>         base seed (default "lives"); life i of race r uses "<s>-<r>-<i>"
 *   --difficulty <id>  world difficulty (default normal)
 *   --workers <n>      worker threads (default: cores - 1)
 *   --variety          the autopilot tries everything available (more outcomes, riskier lives)
 *   --json             machine-readable output
 *
 * The plan's check: "1,000 headless lives give an average lifespan within 10% of each race's
 * range". Read here as: the mean age at death lies within 10% of the middle of the race's lifespan
 * range (a human's 70 to 90 gives 72 to 88). Exit 1 if a race misses it.
 */

interface Job {
  race: string;
  seeds: string[];
  difficulty: string;
  variety: boolean;
  root: string;
}

type Slim = Omit<HeadlessLife, 'outcomes' | 'traits' | 'state'> & {
  outcomeCount: number;
  ms: number;
};

function load(root: string): GameData {
  const loaded = loadGameData(readDataDir(root));
  if (!loaded.ok || !loaded.data) {
    console.error(renderIssues(loaded.issues, makeStyle(shouldColor(process.stderr))));
    console.error('\nCannot simulate: the data is invalid. Run `npm run validate`.');
    process.exit(1);
  }
  return loaded.data;
}

function runJob(job: Job): Slim[] {
  const data = load(job.root);
  const options = advanceOptions('auto-random');
  return job.seeds.map((seed) => {
    const started = performance.now();
    const life = runHeadlessLife(
      data,
      { seed, race: job.race, difficulty: job.difficulty, variety: job.variety },
      options,
    );
    const { outcomes, traits, state, ...rest } = life;
    void traits;
    void state;
    return { ...rest, outcomeCount: outcomes.length, ms: performance.now() - started };
  });
}

if (!isMainThread) {
  parentPort?.postMessage(runJob(workerData as Job));
} else {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const flag = (name: string) => args.includes(name);
  const root = resolve(option('--root') ?? process.cwd());
  const data = load(root);
  const lives = Math.max(1, Number(option('--lives') ?? 1000));
  const raceArg = option('--race') ?? 'all';
  const races = raceArg === 'all' ? Object.keys(data.races).sort() : [raceArg];
  for (const race of races) {
    if (!data.races[race]) {
      console.error(`There is no race "${race}" (races: ${Object.keys(data.races).join(', ')})`);
      process.exit(2);
    }
  }
  const base = option('--seed') ?? 'lives';
  const difficulty = option('--difficulty') ?? 'normal';
  const workers = Math.max(
    1,
    Number(option('--workers') ?? Math.max(1, availableParallelism() - 1)),
  );
  const variety = flag('--variety');

  const jobs: Job[] = [];
  for (const race of races) {
    const seeds = Array.from({ length: lives }, (_, i) => `${base}-${race}-${i + 1}`);
    const chunk = Math.max(1, Math.ceil(seeds.length / workers));
    for (let i = 0; i < seeds.length; i += chunk) {
      jobs.push({ race, seeds: seeds.slice(i, i + chunk), difficulty, variety, root });
    }
  }

  const tsxApi = import.meta.resolve('tsx/esm/api');
  const started = performance.now();
  const results: Slim[] = [];
  let next = 0;
  const runOne = (): Promise<void> => {
    const job = jobs[next++];
    if (!job) return Promise.resolve();
    return new Promise<void>((done, fail) => {
      // Worker threads do not inherit tsx's TypeScript loader, so each one registers it first.
      const boot = `import(${JSON.stringify(tsxApi)}).then((m) => { m.register(); return import(${JSON.stringify(import.meta.url)}); })`;
      const worker = new Worker(boot, { eval: true, workerData: job });
      worker.once('message', (slims: Slim[]) => {
        results.push(...slims);
        void worker.terminate();
        done();
      });
      worker.once('error', fail);
    }).then(runOne);
  };
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, runOne));
  const seconds = (performance.now() - started) / 1000;

  const report = races.map((race) => {
    const def = data.races[race] as GameData['races'][string];
    const rows = results.filter((r) => r.race === race);
    const ages = rows.map((r) => r.age).sort((a, b) => a - b);
    const at = (q: number) => ages[Math.min(ages.length - 1, Math.floor(q * ages.length))] ?? 0;
    const mean = ages.reduce((a, b) => a + b, 0) / Math.max(1, ages.length);
    const mid = (def.lifespan.min + def.lifespan.max) / 2;
    const causes: Record<string, number> = {};
    for (const r of rows) causes[r.cause ?? 'alive'] = (causes[r.cause ?? 'alive'] ?? 0) + 1;
    const outcomes = rows.map((r) => r.outcomeCount);
    return {
      race,
      name: def.name,
      lives: rows.length,
      lifespan: def.lifespan,
      target: { min: Math.round(mid * 0.9 * 10) / 10, max: Math.round(mid * 1.1 * 10) / 10 },
      mean: Math.round(mean * 10) / 10,
      median: at(0.5),
      p10: at(0.1),
      p90: at(0.9),
      ok: mean >= mid * 0.9 && mean <= mid * 1.1,
      insideRange: mean >= def.lifespan.min && mean <= def.lifespan.max,
      causes,
      outcomesPerLife: {
        mean: Math.round(outcomes.reduce((a, b) => a + b, 0) / Math.max(1, outcomes.length)),
        min: Math.min(...outcomes),
      },
      msPerLife: Math.round(rows.reduce((a, r) => a + r.ms, 0) / Math.max(1, rows.length)),
    };
  });

  if (flag('--json')) {
    console.log(JSON.stringify({ seconds: Math.round(seconds), lives, races: report }, null, 2));
  } else {
    for (const r of report) {
      const top = Object.entries(r.causes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([c, n]) => `${c} ${Math.round((n / r.lives) * 100)}%`)
        .join(', ');
      console.log(
        `${r.ok ? 'ok  ' : 'MISS'} ${r.name.padEnd(17)} mean ${String(r.mean).padStart(5)} (target ${r.target.min}-${r.target.max}, range ${r.lifespan.min}-${r.lifespan.max}), median ${r.median}, p10-p90 ${r.p10}-${r.p90}, ${r.outcomesPerLife.mean} outcomes/life`,
      );
      console.log(`     ${r.lives} lives, ${r.msPerLife} ms each. Causes: ${top}`);
    }
    console.log(
      `${results.length} lives in ${seconds.toFixed(1)} s on ${workers} worker${workers === 1 ? '' : 's'}.`,
    );
  }
  process.exit(report.every((r) => r.ok) ? 0 : 1);
}
