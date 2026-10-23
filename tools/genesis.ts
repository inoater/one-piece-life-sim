import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { characterSheet, createLife, genesisStats } from '../src/core';
import { loadGameData } from '../src/engine/data/loader';
import { readDataDir } from './lib/read-data';
import { makeStyle, renderIssues, shouldColor } from './lib/report';

/**
 * npm run genesis                       check every race against the cap table, time New Life
 * npm run genesis -- --sample [opts]    print one character sheet as text
 *
 * The Phase 1 checks without a browser:
 *   - 1,000 rolls per race match the cap table (potential means against race caps, talent tiers
 *     at their listed chances); exit 1 if any race is off;
 *   - New Life makes a full sheet in under 200 ms, timed on the slowest entries (age 80).
 *
 *   --rolls <n>        rolls per race (default 1000)
 *   --race <id>        only this race
 *   --json             machine-readable output
 *   --sample           print a character instead; with --seed, --race, --birthplace, --legacy,
 *                      --focus, --year, --age, --pronouns, --omniscient
 *   --root <dir>       project root (default: current directory)
 */

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const int = (name: string, fallback: number): number => {
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
  console.error('\nCannot run genesis: the data is invalid. Run `npm run validate`.');
  process.exit(1);
}
const data = loaded.data;
const style = makeStyle(shouldColor(process.stdout));

if (flag('--sample')) {
  const life = createLife(
    data,
    {
      seed: option('--seed') ?? 'sample',
      canonMode: data.creation.defaults.canonMode,
      difficulty: option('--difficulty') ?? data.creation.defaults.difficulty,
      rareRaces: true,
      race: option('--race') ?? 'random',
      birthplace: option('--birthplace') ?? 'random',
      legacy: option('--legacy') ?? 'random',
      focus: option('--focus') ?? 'random',
      entryYear: int('--year', data.creation.defaults.entryYear),
      entryAge: int('--age', data.creation.defaults.entryAge),
      pronouns: (option('--pronouns') ?? 'they') as 'he' | 'she' | 'they',
    },
    { allowBlocked: true },
  );
  const sheet = characterSheet(data, life.state, life.playerId, {
    omniscient: flag('--omniscient'),
  });
  if (!sheet) process.exit(1);
  if (flag('--json')) {
    console.log(JSON.stringify(sheet, null, 2));
    process.exit(0);
  }
  console.log(style.bold(sheet.name));
  console.log(
    `Age ${sheet.age} (${sheet.stage.name}), ${sheet.race.name}, born ${sheet.born.label}, ${sheet.birthplace.bornIn}.`,
  );
  console.log(`\n${sheet.appearance.sentence} Height ${sheet.appearance.height}.`);
  if (sheet.talentHint) console.log(`"${sheet.talentHint}"`);
  console.log('');
  for (const stat of sheet.stats) {
    console.log(
      `  ${stat.description}${stat.potential ? style.dim(`   [${stat.potential.description}]`) : ''}`,
    );
  }
  for (const d of sheet.derived) console.log(`  ${d.formula}`);
  console.log(`\nTraits: ${sheet.traits.map((t) => t.name).join(', ')}`);
  if (sheet.hidden) console.log(`Talent: ${sheet.hidden.talent.name}; Luck ${sheet.hidden.luck}`);
  if (sheet.family) {
    console.log(
      `Family: ${sheet.family.legacy.name}, ${sheet.family.wealth.name}, ${sheet.family.birthOrder}`,
    );
    for (const p of sheet.family.members) {
      console.log(
        `  ${p.relation}: ${p.name}${p.alive ? `, ${p.age}` : ''}${p.occupation ? `, ${p.occupation}` : ''}${p.notes.length ? `, ${p.notes.join(', ')}` : ''}${p.death ? ` (${p.death})` : ''}`,
      );
    }
  }
  for (const p of sheet.relationships) console.log(`  ${p.relation}: ${p.name}`);
  console.log(`Berries: ${sheet.berries}`);
  console.log(`\n${sheet.backstory}`);
  for (const w of life.warnings) console.log(style.dim(`\n[${w.level}] ${w.text}`));
  process.exit(0);
}

// ---- The cap table, for every race ---------------------------------------------------------

const rolls = Math.max(100, int('--rolls', 1000));
const only = option('--race');
const raceIds = Object.keys(data.races)
  .sort()
  .filter((id) => only === undefined || id === only);
if (raceIds.length === 0) {
  console.error(`There is no race "${only}". Races: ${Object.keys(data.races).sort().join(', ')}`);
  process.exit(2);
}
const reports = raceIds.map((id) => genesisStats(data, id, rolls));

// ---- New Life timing on the slowest entries ------------------------------------------------

createLife(data, {
  seed: 'warm-up',
  canonMode: 'canon',
  difficulty: 'normal',
  entryYear: 20,
  entryAge: 30,
  pronouns: 'they',
});
const timings = raceIds.map((race) => {
  const place = Object.values(data.birthplaces).find((b) => b.races.includes(race));
  const started = performance.now();
  const life = createLife(data, {
    seed: `timing-${race}`,
    canonMode: 'canon',
    difficulty: 'normal',
    rareRaces: true,
    race,
    ...(place ? { birthplace: place.id } : {}),
    entryYear: data.creation.entry.maxYear,
    entryAge: data.creation.entry.maxAge,
    pronouns: 'they',
  });
  characterSheet(data, life.state, life.playerId, { omniscient: false });
  return { race, ms: performance.now() - started };
});
const slowest = Math.max(...timings.map((t) => t.ms));
const ok = reports.every((r) => r.ok) && slowest < 200;

if (flag('--json')) {
  console.log(JSON.stringify({ ok, rolls, races: reports, timings }, null, 2));
  process.exit(ok ? 0 : 1);
}

console.log(style.bold(`Potential: ${rolls} rolls per race against the cap table`));
for (const r of reports) {
  const mark = r.ok ? style.green('ok ') : style.red('OFF');
  const worst = Math.max(...r.stats.map((s) => Math.abs(s.capDeviationPct)));
  console.log(`  ${mark} ${r.raceName.padEnd(18)} worst stat ${worst.toFixed(1)}% from its cap`);
  for (const problem of r.problems) console.log(`      ${problem}`);
}
console.log(style.bold(`\nNew Life at age ${data.creation.entry.maxAge} (the slowest entry)`));
for (const t of timings)
  console.log(`  ${data.races[t.race]?.name.padEnd(18)} ${t.ms.toFixed(1)} ms`);
console.log(
  ok
    ? style.green(
        `\nAll races match the cap table; the slowest New Life took ${slowest.toFixed(1)} ms (target under 200).`,
      )
    : style.red('\nGenesis checks failed.'),
);
process.exit(ok ? 0 : 1);
