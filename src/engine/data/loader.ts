import type { ZodType } from 'zod';
import { hashValue } from '../canonical';
import { didYouMean, formatPath, type DataIssue } from './issues';
import { REF_EXTRACTORS, TARGET_LABEL } from './refs';
import {
  CalendarSchema,
  COLLECTIONS,
  RESERVED_DIRS,
  SettingsSchema,
  type CollectionKind,
  type GameData,
} from './schemas';

/**
 * Turns raw JSON files into validated game data.
 *
 * It is a pure function of its input, so the same code runs in the browser (files bundled by
 * Vite), in Node tools (files read from disk) and in the build gate (a Vite plugin). Every
 * problem is reported, not just the first, and each names the file and the field.
 */

export interface RawFile {
  /** Path relative to the project root with forward slashes, e.g. "data/traits/test_brawler.json". */
  path: string;
  /** Parsed JSON. Absent when the file could not be parsed. */
  content?: unknown;
  /** Set when the file is not valid JSON. */
  parseError?: string;
}

export interface LoadResult {
  ok: boolean;
  issues: DataIssue[];
  /** Present only when `ok` is true. */
  data: GameData | null;
  /** Fingerprint of every file's content. Part of the determinism contract (see docs/ARCHITECTURE.md). */
  dataHash: string;
  fileCount: number;
  counts: Record<string, number>;
}

const SINGLETONS = {
  'data/calendar.json': CalendarSchema,
  'data/settings.json': SettingsSchema,
} as const;

const IGNORED = /(^|\/)(\.gitkeep|\.DS_Store|README\.md)$/i;

function normalise(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

interface Item {
  file: string;
  /** Index inside an array file, or null for a single-object file. */
  index: number | null;
  value: unknown;
}

function fieldWithIndex(item: Item, field: string): string {
  const prefix = item.index === null ? '' : `[${item.index}]`;
  if (field === '(file)') return prefix === '' ? '(file)' : prefix;
  return `${prefix}${prefix !== '' && !field.startsWith('[') ? '.' : ''}${field}`;
}

export function loadGameData(input: readonly RawFile[]): LoadResult {
  const issues: DataIssue[] = [];
  const error = (file: string, field: string, message: string, hint?: string) => {
    const issue: DataIssue = { severity: 'error', file, field, message };
    if (hint) issue.hint = hint;
    issues.push(issue);
  };
  const warn = (file: string, field: string, message: string, hint?: string) => {
    const issue: DataIssue = { severity: 'warning', file, field, message };
    if (hint) issue.hint = hint;
    issues.push(issue);
  };

  const files = input
    .map((f) => ({ ...f, path: normalise(f.path) }))
    .filter((f) => !IGNORED.test(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const dataHash = hashValue(files.map((f) => [f.path, f.content ?? null]));

  const singletons: Partial<Record<keyof typeof SINGLETONS, unknown>> = {};
  const parsed: Record<
    CollectionKind,
    Map<string, { value: unknown; file: string; field: string }>
  > = {
    traits: new Map(),
    weapons: new Map(),
    locations: new Map(),
    events: new Map(),
  };
  const counts: Record<string, number> = { traits: 0, weapons: 0, locations: 0, events: 0 };
  /** Ids of items that exist but failed their own schema, so references to them are not reported twice. */
  const invalidIds: Record<CollectionKind, Set<string>> = {
    traits: new Set(),
    weapons: new Set(),
    locations: new Set(),
    events: new Set(),
  };

  const validate = <T>(schema: ZodType<T>, item: Item): T | undefined => {
    const result = schema.safeParse(item.value);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      let path = [...issue.path];
      let message = issue.message;
      if (issue.code === 'unrecognized_keys') {
        const keys = (issue as { keys: string[] }).keys;
        path = [...path, keys.join(', ')];
        message = `Unknown field${keys.length > 1 ? 's' : ''} (check the spelling, or add it to the schema first)`;
      }
      error(item.file, fieldWithIndex(item, formatPath(path)), message);
    }
    return undefined;
  };

  for (const file of files) {
    if (!file.path.startsWith('data/') || !file.path.endsWith('.json')) continue;

    if (file.parseError !== undefined) {
      error(file.path, '(file)', `Invalid JSON: ${file.parseError}`);
      continue;
    }

    if (file.path in SINGLETONS) {
      const key = file.path as keyof typeof SINGLETONS;
      const value = validate(SINGLETONS[key] as ZodType<unknown>, {
        file: file.path,
        index: null,
        value: file.content,
      });
      if (value !== undefined) singletons[key] = value;
      continue;
    }

    const match = /^data\/([^/]+)\/(.+)\.json$/.exec(file.path);
    const dir = match?.[1];
    if (!match || dir === undefined) {
      error(
        file.path,
        '(file)',
        'Unrecognised data file',
        'expected data/calendar.json, data/settings.json or data/<traits|weapons|locations|events>/<name>.json',
      );
      continue;
    }

    if ((RESERVED_DIRS as readonly string[]).includes(dir)) {
      error(
        file.path,
        '(file)',
        `data/${dir}/ has no schema registered yet`,
        'add the schema to src/engine/data/schemas.ts before adding content here',
      );
      continue;
    }

    if (!(dir in COLLECTIONS)) {
      const known = Object.keys(COLLECTIONS);
      const guess = didYouMean(dir, known);
      error(
        file.path,
        '(file)',
        `Unknown data folder "data/${dir}/"`,
        guess.length > 0
          ? `did you mean "${guess[0]}"?`
          : `known folders: ${[...known, ...RESERVED_DIRS].join(', ')}`,
      );
      continue;
    }

    const kind = dir as CollectionKind;
    const { schema, prefix } = COLLECTIONS[kind];
    const items: Item[] = Array.isArray(file.content)
      ? file.content.map((value, index) => ({ file: file.path, index, value }))
      : [{ file: file.path, index: null, value: file.content }];

    for (const item of items) {
      const value = validate(schema as ZodType<{ id: string }>, item);
      if (value === undefined) {
        const rawId = (item.value as { id?: unknown } | null)?.id;
        if (typeof rawId === 'string') invalidIds[kind].add(rawId);
        continue;
      }
      counts[kind] = (counts[kind] ?? 0) + 1;

      const existing = parsed[kind].get(value.id);
      if (existing) {
        error(
          item.file,
          fieldWithIndex(item, 'id'),
          `Duplicate ${TARGET_LABEL[kind]} id "${value.id}"`,
          `already defined in ${existing.file}`,
        );
        continue;
      }
      parsed[kind].set(value.id, { value, file: item.file, field: fieldWithIndex(item, '') });

      if (item.index === null) {
        const base = /([^/]+)\.json$/.exec(item.file)?.[1] ?? '';
        const expected = `${prefix}_${base}`;
        if (value.id !== expected) {
          warn(
            item.file,
            'id',
            `id "${value.id}" does not match the file name`,
            `by convention this file defines "${expected}"`,
          );
        }
      }
    }
  }

  for (const required of Object.keys(SINGLETONS)) {
    if (!(required in singletons) && !files.some((f) => f.path === required)) {
      error(required, '(file)', 'Required data file is missing');
    }
  }

  // Cross-references: only meaningful for items that passed their own schema.
  for (const kind of Object.keys(COLLECTIONS) as CollectionKind[]) {
    const extract = REF_EXTRACTORS[kind];
    if (!extract) continue;
    for (const [, entry] of parsed[kind]) {
      for (const ref of extract(entry.value as never)) {
        if (parsed[ref.target].has(ref.id) || invalidIds[ref.target].has(ref.id)) continue;
        const guess = didYouMean(ref.id, parsed[ref.target].keys());
        const index = /^\[(\d+)\]/.exec(entry.field)?.[0] ?? '';
        error(
          entry.file,
          `${index}${index !== '' ? '.' : ''}${ref.field}`,
          `Unknown ${TARGET_LABEL[ref.target]} "${ref.id}"`,
          guess.length > 0
            ? `did you mean ${guess.map((g) => `"${g}"`).join(' or ')}?`
            : `no ${TARGET_LABEL[ref.target]} with that id exists in data/${ref.target}/`,
        );
      }
    }
  }

  const ok = !issues.some((i) => i.severity === 'error');
  const toRecord = <T>(kind: CollectionKind): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [id, entry] of parsed[kind]) out[id] = entry.value as T;
    return out;
  };

  const data: GameData | null =
    ok &&
    singletons['data/calendar.json'] !== undefined &&
    singletons['data/settings.json'] !== undefined
      ? ({
          calendar: singletons['data/calendar.json'],
          settings: singletons['data/settings.json'],
          traits: toRecord('traits'),
          weapons: toRecord('weapons'),
          locations: toRecord('locations'),
          events: toRecord('events'),
        } as GameData)
      : null;

  return { ok, issues, data, dataHash, fileCount: files.length, counts };
}
