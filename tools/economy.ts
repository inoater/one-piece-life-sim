import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { advanceOptions } from '../src/core';
import { loadGameData } from '../src/engine/data/loader';
import type { GameData } from '../src/engine/data/schemas';
import { runEarnerLife, type EarnerLife } from '../src/systems/hands/economy';
import { readDataDir } from './lib/read-data';
import { makeStyle, renderIssues, shouldColor } from './lib/report';

/**
 * npm run economy: the Phase 6 economy sweep. For each job, many hard-working lives from 16 in an
 * East Blue village (every shift Vigor allows, Hard and pushed past Hard, resting when spent,
 * buying nothing): how many months until they can afford a caravel at Loguetown, and how many
 * ever afford a galleon. The plan's target: a caravel in three to five years, a galleon a mark of
 * real success.
 *
 *   npm run economy -- --lives 100
 *
 *   --lives <n>     lives per job (default 100)
 *   --jobs <a,b>    jobs to sweep (default all)
 *   --years <n>     years followed (default 15)
 *   --seed <s>      base seed (default "economy")
 *   --workers <n>   worker threads (default: cores - 1)
 *   --json          machine-readable output
 *
 * Exit 1 if an honest East Blue job (one with no fighting or crime requirement) misses the
 * caravel target: a median between 2 and 5 years.
 */

interface Job {
  job: string;
  seeds: string[];
  years: number;
  root: string;
}

function load(root: string): GameData {
  const loaded = loadGameData(readDataDir(root));
  if (!loaded.ok || !loaded.data) {
    console.error(renderIssues(loaded.issues, makeStyle(shouldColor(process.stderr))));
    process.exit(1);
  }
  return loaded.data;
}

function runJob(job: Job): EarnerLife[] {
  const data = load(job.root);
  const options = advanceOptions('auto-random');
  return job.seeds.map((seed) =>
    runEarnerLife(data, { seed, job: job.job, years: job.years }, options),
  );
}

/** Jobs that need a fighter or a criminal: reported, but not held to the honest worker's target. */
const NOT_HONEST = new Set(['job_mercenary', 'job_bounty_hunter', 'job_street_thief']);

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
}

if (!isMainThread) {
  parentPort?.postMessage(runJob(workerData as Job));
} else {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const root = resolve(option('--root') ?? process.cwd());
  const data = load(root);
  const lives = Math.max(1, Number(option('--lives') ?? 100));
  const years = Math.max(1, Number(option('--years') ?? 15));
  const base = option('--seed') ?? 'economy';
  const jobIds = (option('--jobs')?.split(',') ?? Object.keys(data.jobs)).sort();
  const workers = Math.max(
    1,
    Number(option('--workers') ?? Math.max(1, availableParallelism() - 1)),
  );
  const jobs: Job[] = [];
  for (const job of jobIds) {
    const seeds = Array.from({ length: lives }, (_, i) => `${base}-${job}-${i + 1}`);
    const chunk = Math.max(1, Math.ceil((seeds.length * jobIds.length) / workers / jobIds.length));
    for (let i = 0; i < seeds.length; i += chunk)
      jobs.push({ job, seeds: seeds.slice(i, i + chunk), years, root });
  }
  const tsxApi = import.meta.resolve('tsx/esm/api');
  const started = performance.now();
  const results: EarnerLife[] = [];
  let next = 0;
  const runOne = (): Promise<void> => {
    const job = jobs[next++];
    if (!job) return Promise.resolve();
    return new Promise<void>((done, fail) => {
      const boot = `import(${JSON.stringify(tsxApi)}).then((m) => { m.register(); return import(${JSON.stringify(import.meta.url)}); })`;
      const worker = new Worker(boot, { eval: true, workerData: job });
      worker.once('message', (rows: EarnerLife[]) => {
        results.push(...rows);
        void worker.terminate();
        done();
      });
      worker.once('error', fail);
    }).then(runOne);
  };
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, runOne));
  const seconds = (performance.now() - started) / 1000;
  const report = jobIds.map((job) => {
    const rows = results.filter((r) => r.job === job);
    const working = rows.filter((r) => r.available);
    const caravel = working
      .filter((r) => r.caravel !== null)
      .map((r) => (r.caravel as number) / 12);
    const galleon = working.filter((r) => r.galleon !== null).length;
    const med = median(caravel);
    const honest = !NOT_HONEST.has(job);
    return {
      job,
      name: data.jobs[job]?.name ?? job,
      lives: rows.length,
      available: working.length,
      caravelShare: working.length > 0 ? caravel.length / working.length : 0,
      caravelYears: med,
      p25:
        caravel.length > 0
          ? ([...caravel].sort((a, b) => a - b)[Math.floor(caravel.length / 4)] ?? null)
          : null,
      galleonShare: working.length > 0 ? galleon / working.length : 0,
      at5: median(working.map((r) => r.at5)),
      honest,
      ok: !honest || working.length === 0 || (med !== null && med >= 2 && med <= 5),
    };
  });
  if (args.includes('--json')) {
    console.log(JSON.stringify({ lives, years, seconds, report }, null, 2));
  } else {
    console.log(
      `Economy sweep: ${lives} hard-working lives per job, ${years} years from 16 in the East Blue.\n`,
    );
    console.log(
      '| Job | Could work it | Afford a caravel | Median years | Galleon within the years | Berries at 5 years |',
    );
    console.log('| --- | --- | --- | --- | --- | --- |');
    for (const r of report) {
      console.log(
        `| ${r.name}${r.honest ? '' : ' (fighting or crime)'} | ${r.available}/${r.lives} | ${(r.caravelShare * 100).toFixed(0)}% | ${r.caravelYears === null ? '-' : r.caravelYears.toFixed(1)} | ${(r.galleonShare * 100).toFixed(0)}% | ${r.at5 === null ? '-' : Math.round(r.at5).toLocaleString('en')} |${r.ok ? '' : ' MISSES'}`,
      );
    }
    console.log(`\n${results.length} lives in ${seconds.toFixed(1)} s on ${workers} workers.`);
  }
  process.exit(report.every((r) => r.ok) ? 0 : 1);
}
