import { resolve } from 'node:path';
import { loadGameData } from '../src/engine/data/loader';
import { readDataDir } from './lib/read-data';
import { makeStyle, renderIssues, renderSummary, shouldColor } from './lib/report';

/**
 * npm run validate
 *
 * Checks every file in /data against its schema and checks that files agree with each other
 * (an event may only name a trait, island or event that exists). Every problem names the file
 * and the field. Exit code 1 if anything is wrong, so it can gate commits, CI and builds.
 *
 *   --root <dir>   project root (default: current directory)
 *   --strict       treat warnings as errors
 *   --json         machine-readable output
 */

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const root = resolve(option('--root') ?? process.cwd());
const result = loadGameData(readDataDir(root));

if (flag('--json')) {
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        fileCount: result.fileCount,
        counts: result.counts,
        dataHash: result.dataHash,
        issues: result.issues,
      },
      null,
      2,
    ),
  );
} else {
  const style = makeStyle(shouldColor());
  if (result.issues.length > 0) console.log(renderIssues(result.issues, style) + '\n');
  console.log(renderSummary(result, style));
}

const strictFailure = flag('--strict') && result.issues.length > 0;
process.exit(result.ok && !strictFailure ? 0 : 1);
