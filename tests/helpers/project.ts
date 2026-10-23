import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { ROOT } from './data';

const created: string[] = [];

/** Remove every throwaway project made by this test file (a symlink is removed, never followed). */
export function cleanupProjects(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const SKIP = new Set(['node_modules', 'dist', 'dist-preview', '.git', '.tmp', 'coverage']);

/** A throwaway copy of the project (sharing node_modules) that a test can safely break. */
export function copyProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opsim-'));
  created.push(dir);
  cpSync(ROOT, dir, {
    recursive: true,
    filter: (source) => !SKIP.has(relative(ROOT, source).split(sep)[0] ?? ''),
  });
  // A directory symlink needs administrator rights on Windows; a junction does the same job without them.
  symlinkSync(
    join(ROOT, 'node_modules'),
    join(dir, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  return dir;
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

export interface Ran {
  status: number | null;
  output: string;
}

/** Run a TypeScript tool exactly as `npm run` would, returning combined output. */
export function runTool(script: string, args: string[], cwd = ROOT): Ran {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(ROOT, 'tools', script), ...args],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** The environment a developer's terminal would have: nothing inherited from the test runner. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', CI: '1' };
  // vite.config.ts switches the data gate off under Vitest, so a child process must not look like one.
  for (const key of Object.keys(env))
    if (key.startsWith('VITEST') || key === 'NODE_ENV') delete env[key];
  return env;
}

export function runVite(args: string[], cwd: string): Ran {
  const result = spawnSync(
    process.execPath,
    [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), ...args],
    {
      cwd,
      encoding: 'utf8',
      env: cleanEnv(),
    },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}
