import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseSync } from 'oxc-parser';

/**
 * Source rules that keep the plan's guarantees from eroding silently.
 *
 * 1. Determinism (rule 6). Code in the simulation zone (src/engine except saves, src/systems,
 *    src/core.ts) must not use anything whose result can differ between runs or between browsers:
 *      - Math.sin/cos/exp/log/pow/... and `**` (ECMAScript only requires them to be approximated,
 *        so engines can disagree in the last bit; use src/engine/dmath.ts),
 *      - Math.random, Date, performance, crypto (entropy and wall-clock),
 *      - browser/page globals and timers (rule 7: the engine never touches the page).
 * 2. Layering (rule 7). engine <- systems <- core <- worker <- ui. The UI may import only types
 *    plus a short allow-list of pure helpers, so it can only read state and send actions.
 *
 * The check parses real syntax (not regexes), so comments, strings and property names such as
 * `condition.location` never cause false alarms.
 */

export interface LintIssue {
  file: string;
  line: number;
  rule: string;
  message: string;
}

type Node = { type: string; start?: number; [key: string]: unknown };

function parse(file: string, code: string): Node {
  const result = parseSync(file, code, { lang: 'ts', sourceType: 'module' });
  if (result.errors.length > 0) {
    throw new Error(`Could not parse ${file}: ${result.errors[0]?.message ?? 'syntax error'}`);
  }
  return result.program as unknown as Node;
}

function lineStarts(code: string): number[] {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

type Visit = (node: Node, parent: Node | null, key: string) => void;

function walk(value: unknown, parent: Node | null, key: string, visit: Visit): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, parent, key, visit);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const node = value as Node;
  if (typeof node.type !== 'string') return;
  visit(node, parent, key);
  for (const childKey of Object.keys(node)) {
    if (childKey === 'start' || childKey === 'end' || childKey === 'type') continue;
    walk(node[childKey], node, childKey, visit);
  }
}

// ---- Determinism ----------------------------------------------------------------------------

export const BANNED_MATH = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'pow',
  'cbrt',
  'hypot',
  'random',
]);

const BANNED_GLOBALS = new Set([
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'indexedDB',
  'XMLHttpRequest',
  'fetch',
  'requestAnimationFrame',
  'setTimeout',
  'setInterval',
  'globalThis',
  'Date',
  'performance',
  'crypto',
]);

function nameOf(node: unknown): string | null {
  const n = node as Node | null;
  return n && n.type === 'Identifier' ? (n['name'] as string) : null;
}

/** Names the file declares itself (variables, parameters, imports). References to them are not globals. */
function declaredNames(root: Node): Set<string> {
  const names = new Set<string>();
  const addPattern = (pattern: unknown): void => {
    const p = pattern as Node | null;
    if (!p) return;
    if (p.type === 'Identifier') names.add(p['name'] as string);
    else if (p.type === 'ObjectPattern') {
      for (const prop of p['properties'] as Node[])
        addPattern(prop.type === 'RestElement' ? prop['argument'] : prop['value']);
    } else if (p.type === 'ArrayPattern')
      for (const el of p['elements'] as unknown[]) addPattern(el);
    else if (p.type === 'AssignmentPattern') addPattern(p['left']);
    else if (p.type === 'RestElement') addPattern(p['argument']);
  };
  walk(root, null, '', (node) => {
    if (node.type === 'VariableDeclarator') addPattern(node['id']);
    else if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      for (const param of (node['params'] as Node[]) ?? [])
        addPattern(param.type === 'TSParameterProperty' ? param['parameter'] : param);
      if (node.type !== 'ArrowFunctionExpression' && node['id']) addPattern(node['id']);
    } else if (node.type === 'ClassDeclaration' && node['id']) addPattern(node['id']);
    else if (
      node.type === 'ImportSpecifier' ||
      node.type === 'ImportDefaultSpecifier' ||
      node.type === 'ImportNamespaceSpecifier'
    ) {
      addPattern(node['local']);
    }
  });
  return names;
}

function isReference(node: Node, parent: Node | null, key: string): boolean {
  if (!parent) return true;
  if (parent.type.startsWith('TS')) return false; // type positions
  if (parent.type === 'MemberExpression' && key === 'property' && !parent['computed']) return false;
  if (
    (parent.type === 'Property' ||
      parent.type === 'PropertyDefinition' ||
      parent.type === 'MethodDefinition') &&
    key === 'key' &&
    !parent['computed']
  ) {
    return false;
  }
  if (parent.type.startsWith('Import') || parent.type.startsWith('Export')) return false;
  void node;
  return true;
}

export function lintSimSource(file: string, code: string): LintIssue[] {
  const program = parse(file, code);
  const starts = lineStarts(code);
  const issues: LintIssue[] = [];
  const declared = declaredNames(program);
  const add = (node: Node, rule: string, message: string) =>
    issues.push({ file, line: lineOf(starts, node.start ?? 0), rule, message });

  walk(program, null, '', (node, parent, key) => {
    if (node.type === 'MemberExpression' && nameOf(node['object']) === 'Math') {
      const prop = node['property'] as Node;
      const name = node['computed']
        ? prop.type === 'Literal'
          ? String(prop['value'])
          : '(computed)'
        : nameOf(prop);
      if (name === '(computed)') {
        add(
          node,
          'no-approximated-math',
          'Computed access on Math hides which function is used; call it by name',
        );
      } else if (name && BANNED_MATH.has(name)) {
        add(
          node,
          name === 'random' ? 'no-entropy' : 'no-approximated-math',
          name === 'random'
            ? 'Math.random is unseeded entropy; draw from the seeded Rng instead'
            : `Math.${name} may differ between JavaScript engines; use src/engine/dmath.ts`,
        );
      }
      return;
    }
    if (node.type === 'Identifier' && node['name'] === 'Math' && isReference(node, parent, key)) {
      const isObjectOfMember = parent?.type === 'MemberExpression' && key === 'object';
      if (!isObjectOfMember && !declared.has('Math')) {
        add(
          node,
          'no-approximated-math',
          'Math must only be used as Math.<function> so the checker can see which function is called',
        );
      }
      return;
    }
    if (node.type === 'BinaryExpression' && node['operator'] === '**') {
      add(
        node,
        'no-approximated-math',
        'The ** operator is implementation-approximated; use ipow or dpow from src/engine/dmath.ts',
      );
    } else if (node.type === 'AssignmentExpression' && node['operator'] === '**=') {
      add(
        node,
        'no-approximated-math',
        'The **= operator is implementation-approximated; use ipow or dpow from src/engine/dmath.ts',
      );
    } else if (
      node.type === 'Identifier' &&
      BANNED_GLOBALS.has(node['name'] as string) &&
      isReference(node, parent, key)
    ) {
      const name = node['name'] as string;
      if (declared.has(name)) return;
      const reason =
        name === 'Date' || name === 'performance'
          ? 'reads the wall clock; the engine takes time only from the tick'
          : name === 'crypto'
            ? 'is unseeded entropy; draw from the seeded Rng instead'
            : 'is a page, network or timer API; the engine never touches the page (rule 7)';
      add(
        node,
        name === 'Date' || name === 'performance' || name === 'crypto'
          ? 'no-entropy'
          : 'no-page-access',
        `"${name}" ${reason}`,
      );
    }
  });
  return issues;
}

// ---- Layering -------------------------------------------------------------------------------

export interface ImportRef {
  specifier: string;
  line: number;
  /** `import type ...` / `export type ... from`: erased at build time. */
  typeOnly: boolean;
  dynamic: boolean;
}

export function importsOf(file: string, code: string): ImportRef[] {
  const program = parse(file, code);
  const starts = lineStarts(code);
  const found: ImportRef[] = [];
  walk(program, null, '', (node) => {
    const source = node['source'] as Node | null | undefined;
    const specifier = source && source.type === 'Literal' ? String(source['value']) : null;
    if (specifier === null) return;
    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration'
    ) {
      const kind = (node['importKind'] ?? node['exportKind']) as string | undefined;
      found.push({
        specifier,
        line: lineOf(starts, node.start ?? 0),
        typeOnly: kind === 'type',
        dynamic: false,
      });
    } else if (node.type === 'ImportExpression') {
      found.push({
        specifier,
        line: lineOf(starts, node.start ?? 0),
        typeOnly: false,
        dynamic: true,
      });
    }
  });
  return found;
}

type Layer = 'engine' | 'systems' | 'core' | 'worker' | 'ui' | 'other';

export function layerOf(repoPath: string): Layer {
  if (repoPath.startsWith('src/engine/')) return 'engine';
  if (repoPath.startsWith('src/systems/')) return 'systems';
  if (repoPath === 'src/core.ts') return 'core';
  if (repoPath.startsWith('src/worker/')) return 'worker';
  if (repoPath.startsWith('src/ui/')) return 'ui';
  return 'other';
}

const ALLOWED_LAYERS: Record<Layer, readonly Layer[]> = {
  engine: ['engine'],
  systems: ['engine', 'systems'],
  core: ['engine', 'systems', 'core'],
  worker: ['engine', 'systems', 'core', 'worker'],
  ui: ['ui'],
  other: ['engine', 'systems', 'core', 'worker', 'ui', 'other'],
};

/** Pure helpers the UI may import as values (formatting only; no game logic, no state). */
export const UI_VALUE_IMPORTS: readonly string[] = [
  'src/worker/protocol.ts',
  'src/worker/sim-error.ts',
  'src/engine/hash.ts',
  'src/engine/stats.ts',
];

/**
 * The only UI files allowed to value-import from the worker layer beyond the allow-list above:
 *  - host.ts loads the simulation into the page when Web Workers are unavailable (inline fallback);
 *  - worker-factory.inline.ts embeds the worker entry point in the single-file preview build.
 */
export const UI_SPECIAL_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  'src/ui/host.ts': ['src/worker/bootstrap.ts', 'src/worker/sim-core.ts', 'src/worker/errors.ts'],
  'src/ui/worker-factory.inline.ts': ['src/worker/sim.worker.ts'],
};

const ALLOWED_PACKAGES: Record<Layer, readonly string[]> = {
  engine: ['zod'],
  systems: ['zod'],
  core: ['zod'],
  worker: ['zod'],
  ui: [],
  other: [],
};

function resolveRepoPath(fromRepoPath: string, specifier: string, root: string): string | null {
  const base = resolve(root, dirname(fromRepoPath), specifier.replace(/\?.*$/, ''));
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return relative(root, candidate).split(sep).join('/');
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

export function lintImports(repoPath: string, code: string, root: string): LintIssue[] {
  const layer = layerOf(repoPath);
  if (layer === 'other') return [];
  const issues: LintIssue[] = [];
  for (const imp of importsOf(repoPath, code)) {
    const report = (message: string) =>
      issues.push({ file: repoPath, line: imp.line, rule: 'layering', message });
    const { specifier } = imp;

    if (!specifier.startsWith('.')) {
      if (specifier.startsWith('#') || specifier === 'vite/client') continue; // build-time aliases and types
      const pkg = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : (specifier.split('/')[0] as string);
      if (!ALLOWED_PACKAGES[layer].includes(pkg) && !imp.typeOnly) {
        report(`${layer} code may not import the package "${pkg}"`);
      }
      continue;
    }

    const target = resolveRepoPath(repoPath, specifier, root);
    if (target === null) {
      report(`Cannot resolve "${specifier}"`);
      continue;
    }
    const targetLayer = layerOf(target);
    if (targetLayer === 'other') continue;
    if (ALLOWED_LAYERS[layer].includes(targetLayer)) continue;

    if (layer === 'ui') {
      if (imp.typeOnly) continue; // erased at build time: the UI may name engine types
      if (UI_VALUE_IMPORTS.includes(target)) continue;
      if (UI_SPECIAL_IMPORTS[repoPath]?.includes(target)) continue;
      report(
        `The UI may only read state and send actions (rule 7). Importing "${target}" as a value reaches into the engine. ` +
          `Use \`import type\` for types, ask the worker for data, or add a pure formatting helper to UI_VALUE_IMPORTS.`,
      );
      continue;
    }
    report(
      `${layer} may not import from ${targetLayer} ("${specifier}" -> ${target}); the dependency must point inward`,
    );
  }
  return issues;
}

// ---- Repository scan ------------------------------------------------------------------------

export function listSourceFiles(root: string, dir: string): string[] {
  const out: string[] = [];
  const walkDir = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walkDir(full);
      else if (name.endsWith('.ts') && !name.endsWith('.d.ts'))
        out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walkDir(join(root, dir));
  return out;
}

/** Files held to the determinism rules. */
export function inSimulationZone(repoPath: string): boolean {
  if (repoPath === 'src/core.ts') return true;
  if (repoPath.startsWith('src/systems/')) return true;
  if (!repoPath.startsWith('src/engine/')) return false;
  if (repoPath.startsWith('src/engine/saves/')) return false; // wall-clock metadata, IndexedDB, compression
  if (repoPath === 'src/engine/data/bundled.ts') return false; // Vite glob: build-time only
  return true;
}

export function lintRepository(root: string): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const file of listSourceFiles(root, 'src')) {
    const code = readFileSync(join(root, file), 'utf8');
    if (inSimulationZone(file)) issues.push(...lintSimSource(file, code));
    issues.push(...lintImports(file, code, root));
  }
  return issues;
}
