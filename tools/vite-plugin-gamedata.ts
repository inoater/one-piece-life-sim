import { spawnSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

/**
 * The data gate.
 *
 *  - `vite build` fails if any file in /data is invalid, with every problem named by file and field.
 *  - `vite dev` validates at start and on every change to /data, showing problems in the browser
 *    overlay and the terminal instead of crashing the dev server.
 *
 * It runs tools/validate-data.ts as a subprocess, i.e. literally the same program as
 * `npm run validate`, so the gate, the pre-commit hook and CI can never disagree. (It also keeps
 * this file free of imports from src/, which Vite's config loader would otherwise have to bundle.)
 */

export function checkData(root: string): { ok: boolean; output: string } {
  const run = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(root, 'tools', 'validate-data.ts'), '--root', root],
    { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } },
  );
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
  if (run.error)
    return { ok: false, output: `Could not run data validation: ${run.error.message}` };
  return { ok: run.status === 0, output };
}

function failureMessage(output: string): string {
  return `Game data is invalid:\n\n${output}\n`;
}

export function gameDataPlugin(): Plugin {
  let root = process.cwd();
  let command: 'build' | 'serve' = 'serve';
  return {
    name: 'opsim-game-data',
    configResolved(config) {
      root = config.root;
      command = config.command;
    },
    buildStart() {
      if (command !== 'build') return;
      const { ok, output } = checkData(root);
      // An empty stack keeps the terminal output to the message: a data problem is not a crash.
      if (!ok) this.error({ message: failureMessage(output), stack: '' });
    },
    configureServer(server) {
      const report = (): boolean => {
        const { ok, output } = checkData(root);
        if (!ok) {
          const message = failureMessage(output);
          server.config.logger.error(message, { timestamp: true });
          server.ws.send({ type: 'error', err: { message, stack: '', plugin: 'opsim-game-data' } });
        }
        return ok;
      };
      report();
      server.watcher.add(join(root, 'data'));
      const onChange = (file: string) => {
        const rel = relative(root, file).split(sep).join('/');
        if (!rel.startsWith('data/') || !rel.endsWith('.json')) return;
        if (report()) server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
}
