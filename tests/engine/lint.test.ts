import { describe, expect, it } from 'vitest';
import {
  importsOf,
  inSimulationZone,
  layerOf,
  lintImports,
  lintRepository,
  lintSimSource,
} from '../../tools/lib/source-lint';
import { ROOT } from '../helpers/data';

const sim = (code: string) => lintSimSource('src/systems/x.ts', code);
const rules = (code: string) => sim(code).map((i) => i.rule);

describe('determinism lint: what it forbids', () => {
  it('approximated Math functions', () => {
    for (const fn of ['sin', 'cos', 'tan', 'exp', 'log', 'log2', 'pow', 'atan2', 'hypot', 'cbrt']) {
      expect(rules(`const x = Math.${fn}(1);`), fn).toEqual(['no-approximated-math']);
    }
  });

  it('Math.random, as entropy', () => {
    expect(rules('const x = Math.random();')).toEqual(['no-entropy']);
  });

  it('the ** operator and **=', () => {
    expect(rules('const x = 2 ** 8;')).toEqual(['no-approximated-math']);
    expect(rules('let x = 2; x **= 2;')).toEqual(['no-approximated-math']);
  });

  it('computed or aliased Math access, which would hide the function', () => {
    expect(rules("const x = Math['sin'](1);")).toEqual(['no-approximated-math']);
    expect(rules('const { exp } = Math;')).toEqual(['no-approximated-math']);
    expect(rules('const m = Math; m.sin(1);')).toEqual(['no-approximated-math']);
  });

  it('wall-clock and entropy sources', () => {
    expect(rules('const t = Date.now();')).toEqual(['no-entropy']);
    expect(rules('const t = new Date();')).toEqual(['no-entropy']);
    expect(rules('const t = performance.now();')).toEqual(['no-entropy']);
    expect(rules('crypto.getRandomValues(new Uint8Array(4));')).toEqual(['no-entropy']);
  });

  it('page, network and timer APIs (rule 7: the engine never touches the page)', () => {
    for (const name of [
      'window',
      'document',
      'localStorage',
      'sessionStorage',
      'navigator',
      'indexedDB',
      'fetch',
      'setTimeout',
      'setInterval',
      'requestAnimationFrame',
      'globalThis',
    ]) {
      expect(rules(`${name};`), name).toEqual(['no-page-access']);
    }
    expect(rules("document.getElementById('x');")).toEqual(['no-page-access']);
  });

  it('reports the line it found the problem on', () => {
    expect(sim('const a = 1;\nconst b = 2;\nconst c = Math.sin(a);\n')).toMatchObject([
      { line: 3 },
    ]);
  });
});

describe('determinism lint: what it must allow (no false alarms)', () => {
  it('exactly-specified Math functions', () => {
    const code =
      'const a = Math.floor(1.5) + Math.ceil(1.2) + Math.round(2.5) + Math.trunc(3.1) + Math.abs(-1) + Math.min(1, 2) + Math.max(1, 2) + Math.sqrt(4) + Math.sign(-2) + Math.imul(3, 4) + Math.fround(1.1) + Math.clz32(8);';
    expect(sim(code)).toEqual([]);
  });

  it('banned names appearing in comments, strings and templates', () => {
    expect(
      sim(
        '// Math.sin is banned, 2 ** 3 too, Date.now() as well\nconst s = "Math.random() ** window";\nconst t = `${1} Date.now()`;',
      ),
    ).toEqual([]);
    expect(sim('/** uses **bold** and Math.pow in docs */ export const x = 1;')).toEqual([]);
  });

  it('property and field names that merely look like globals', () => {
    expect(
      sim('const a = { window: 1, document: 2, fetch: 3, crypto: 4, Date: 5 }; a.window; a.fetch;'),
    ).toEqual([]);
    expect(sim('interface Cond { document: string; location: string; fetch(): void }')).toEqual([]);
    expect(sim('class C { performance = 1; Date = 2; }')).toEqual([]);
    expect(sim('const m = condition.location; const n = event.window;')).toEqual([]);
  });

  it('a local variable or parameter that shadows a global name', () => {
    expect(sim('function f(document: string) { return document.length; }')).toEqual([]);
    expect(sim('const performance = { score: 1 }; export const s = performance.score;')).toEqual(
      [],
    );
    expect(sim('import { Date } from "./mine"; export const d = Date;')).toEqual([]);
  });

  it('type positions', () => {
    expect(sim('export type When = Date; export interface X { at: Date }')).toEqual([]);
  });

  it('exact integer arithmetic and multiplication', () => {
    expect(sim('const x = 2 * 3 * 4; let y = 2; y *= 3;')).toEqual([]);
  });
});

describe('which files are held to the determinism rules', () => {
  it('covers the engine, the systems and core, but not saves, the data bundler or host code', () => {
    expect(inSimulationZone('src/engine/rng.ts')).toBe(true);
    expect(inSimulationZone('src/engine/data/loader.ts')).toBe(true);
    expect(inSimulationZone('src/systems/events.ts')).toBe(true);
    expect(inSimulationZone('src/core.ts')).toBe(true);
    expect(inSimulationZone('src/engine/saves/store.ts')).toBe(false);
    expect(inSimulationZone('src/engine/data/bundled.ts')).toBe(false);
    expect(inSimulationZone('src/worker/sim-core.ts')).toBe(false);
    expect(inSimulationZone('src/ui/main.ts')).toBe(false);
  });
});

describe('layering lint', () => {
  const imports = (code: string) => importsOf('src/ui/x.ts', code);

  it('finds static, type-only, re-export and dynamic imports', () => {
    expect(
      imports(
        "import a from './a'; import type { B } from '../engine/b'; export * from './c'; export { d } from './d'; const m = import('./e');",
      ),
    ).toMatchObject([
      { specifier: './a', typeOnly: false, dynamic: false },
      { specifier: '../engine/b', typeOnly: true },
      { specifier: './c' },
      { specifier: './d' },
      { specifier: './e', dynamic: true },
    ]);
  });

  it('classifies files into layers', () => {
    expect(layerOf('src/engine/rng.ts')).toBe('engine');
    expect(layerOf('src/systems/events.ts')).toBe('systems');
    expect(layerOf('src/core.ts')).toBe('core');
    expect(layerOf('src/worker/sim-core.ts')).toBe('worker');
    expect(layerOf('src/ui/main.ts')).toBe('ui');
    expect(layerOf('tools/x.ts')).toBe('other');
  });

  it("stops the engine reaching up into systems, and the UI reaching into the engine's logic", () => {
    const engineToSystems = lintImports(
      'src/engine/x.ts',
      "import { rollEvents } from '../systems/events';",
      ROOT,
    );
    expect(engineToSystems).toMatchObject([
      { rule: 'layering', message: expect.stringContaining('dependency must point inward') },
    ]);

    const uiToEngine = lintImports(
      'src/ui/x.ts',
      "import { createWorld } from '../engine/world';",
      ROOT,
    );
    expect(uiToEngine).toMatchObject([
      {
        rule: 'layering',
        message: expect.stringContaining('may only read state and send actions'),
      },
    ]);

    const uiToSystems = lintImports(
      'src/ui/x.ts',
      "import { applyAction } from '../systems/actions';",
      ROOT,
    );
    expect(uiToSystems).toHaveLength(1);
  });

  it('lets the UI name engine types, and use the short allow-list of pure helpers', () => {
    expect(
      lintImports('src/ui/x.ts', "import type { WorldState } from '../engine/state';", ROOT),
    ).toEqual([]);
    expect(lintImports('src/ui/x.ts', "import { shortHash } from '../engine/hash';", ROOT)).toEqual(
      [],
    );
    expect(
      lintImports('src/ui/x.ts', "import { SimError } from '../worker/sim-error';", ROOT),
    ).toEqual([]);
    // errors.ts is the worker side: it imports the systems layer, so the UI must not.
    expect(
      lintImports('src/ui/x.ts', "import { serializeError } from '../worker/errors';", ROOT),
    ).toHaveLength(1);
  });

  it('allows only the inline fallback host to load the simulation into the page', () => {
    expect(
      lintImports('src/ui/host.ts', "const core = await import('../worker/sim-core');", ROOT),
    ).toEqual([]);
    expect(
      lintImports('src/ui/other.ts', "const core = await import('../worker/sim-core');", ROOT),
    ).toHaveLength(1);
  });

  it('limits third-party packages in the simulation, and none in the UI', () => {
    expect(lintImports('src/engine/x.ts', "import { z } from 'zod';", ROOT)).toEqual([]);
    expect(lintImports('src/engine/x.ts', "import lodash from 'lodash';", ROOT)).toHaveLength(1);
    expect(lintImports('src/ui/x.ts', "import { z } from 'zod';", ROOT)).toHaveLength(1);
  });

  it('reports an import it cannot resolve', () => {
    expect(
      lintImports('src/engine/x.ts', "import { nope } from './does-not-exist';", ROOT)[0]?.message,
    ).toContain('Cannot resolve');
  });
});

describe('this repository', () => {
  it('follows its own determinism and layering rules', () => {
    const issues = lintRepository(ROOT);
    expect(issues.map((i) => `${i.file}:${i.line} [${i.rule}] ${i.message}`)).toEqual([]);
  });
});
