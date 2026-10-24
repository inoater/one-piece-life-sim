import { resolve } from 'node:path';
import { lintCanon } from './lib/canon-lint';
import { readDataDir } from './lib/read-data';
import { makeStyle, shouldColor } from './lib/report';

/**
 * npm run canon-lint
 *
 * Lints the canon: the cast, the factions, the places and the beats (tools/lib/canon-lint.ts).
 * Exit code 1 on any problem.
 */

const args = process.argv.slice(2);
const i = args.indexOf('--root');
const root = resolve(i >= 0 && args[i + 1] ? (args[i + 1] as string) : process.cwd());
const style = makeStyle(shouldColor());

const { issues, checkedFiles, checkedItems } = lintCanon(readDataDir(root));
if (issues.length === 0) {
  console.log(
    style.green(
      checkedFiles === 0
        ? 'Canon lint: no canon files yet, nothing to check.'
        : `Canon lint: ${checkedItems} entries in ${checkedFiles} files are clean.`,
    ),
  );
  process.exit(0);
}
for (const issue of issues) console.log(`${issue.file} › ${issue.field}: ${issue.message}`);
console.log(
  style.red(`\nCanon lint failed with ${issues.length} problem${issues.length === 1 ? '' : 's'}.`),
);
process.exit(1);
