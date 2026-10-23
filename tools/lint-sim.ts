import { resolve } from 'node:path';
import { lintRepository } from './lib/source-lint';

/**
 * npm run lint:sim
 *
 * Checks the determinism rules (no approximated Math, no entropy or wall-clock, no page access in
 * the simulation) and the layering rules (the UI only reads state and sends actions).
 */
const args = process.argv.slice(2);
const i = args.indexOf('--root');
const root = resolve(i >= 0 && args[i + 1] ? (args[i + 1] as string) : process.cwd());
const issues = lintRepository(root);
if (issues.length === 0) {
  console.log('Source rules: determinism and layering are clean.');
  process.exit(0);
}
for (const issue of issues)
  console.log(`${issue.file}:${issue.line} [${issue.rule}] ${issue.message}`);
console.log(`\n${issues.length} source rule violation${issues.length === 1 ? '' : 's'}.`);
process.exit(1);
