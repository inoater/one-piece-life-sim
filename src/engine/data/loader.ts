import type { ZodType } from 'zod';
import { hashValue } from '../canonical';
import { didYouMean, formatPath, type DataIssue } from './issues';
import {
  appearanceRefs,
  creationRefs,
  lifeRefs,
  REF_EXTRACTORS,
  singletonTargets,
  TARGET_HOME,
  TARGET_LABEL,
  type Ref,
  type RefTarget,
} from './refs';
import {
  COLLECTION_KINDS,
  COLLECTIONS,
  RESERVED_DIRS,
  SINGLETONS,
  type Appearance,
  type CharacterRules,
  type CollectionKind,
  type Creation,
  type GameData,
  type LifeRules,
  type SingletonPath,
  type Calendar,
} from './schemas';

/**
 * Turns raw JSON files into validated game data.
 *
 * It is a pure function of its input, so the same code runs in the browser (files bundled by
 * Vite), in Node tools (files read from disk) and in the build gate (a Vite plugin). Every
 * problem is reported, not just the first, and each names the file and the field.
 *
 * Three passes:
 *  1. each file against its schema;
 *  2. references between files (an id named in one file must exist in another);
 *  3. coherence: facts that only hold for the data as a whole (every race can be born somewhere).
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

interface Entry {
  value: unknown;
  file: string;
  /** "[3]" for the fourth item of an array file, "" for a single-object file. */
  field: string;
}

function fieldWithIndex(item: Item, field: string): string {
  const prefix = item.index === null ? '' : `[${item.index}]`;
  if (field === '(file)') return prefix === '' ? '(file)' : prefix;
  return `${prefix}${prefix !== '' && !field.startsWith('[') ? '.' : ''}${field}`;
}

const byKind = <T>(make: () => T): Record<CollectionKind, T> =>
  Object.fromEntries(COLLECTION_KINDS.map((kind) => [kind, make()])) as Record<CollectionKind, T>;

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

  const singletons: Partial<Record<SingletonPath, unknown>> = {};
  const parsed = byKind(() => new Map<string, Entry>());
  const counts = Object.fromEntries(COLLECTION_KINDS.map((kind) => [kind, 0])) as Record<
    string,
    number
  >;
  /** Ids of items that exist but failed their own schema, so references to them are not reported twice. */
  const invalidIds = byKind(() => new Set<string>());

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

  const knownDirs = (): string => [...COLLECTION_KINDS, ...RESERVED_DIRS].join(', ');

  for (const file of files) {
    if (!file.path.startsWith('data/') || !file.path.endsWith('.json')) continue;

    if (file.parseError !== undefined) {
      error(file.path, '(file)', `Invalid JSON: ${file.parseError}`);
      continue;
    }

    if (file.path in SINGLETONS) {
      const key = file.path as SingletonPath;
      const value = validate(SINGLETONS[key].schema as ZodType<unknown>, {
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
        `expected ${Object.keys(SINGLETONS).join(', ')} or data/<folder>/<name>.json (folders: ${COLLECTION_KINDS.join(', ')})`,
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
      const guess = didYouMean(dir, COLLECTION_KINDS);
      error(
        file.path,
        '(file)',
        `Unknown data folder "data/${dir}/"`,
        guess.length > 0 ? `did you mean "${guess[0]}"?` : `known folders: ${knownDirs()}`,
      );
      continue;
    }

    const kind = dir as CollectionKind;
    const { schema, prefix, label } = COLLECTIONS[kind];
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
          `Duplicate ${label} id "${value.id}"`,
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

  const calendar = singletons['data/calendar.json'] as Calendar | undefined;
  const character = singletons['data/character.json'] as CharacterRules | undefined;
  const creation = singletons['data/creation.json'] as Creation | undefined;
  const appearance = singletons['data/appearance.json'] as Appearance | undefined;
  const life = singletons['data/life.json'] as LifeRules | undefined;

  // ---- Pass 2: references --------------------------------------------------------------------

  const fromSingletons = singletonTargets({
    ...(creation ? { creation } : {}),
    ...(appearance ? { appearance } : {}),
    ...(character ? { stageIds: character.stages.map((s) => s.id) } : {}),
    ...(life ? { life } : {}),
    ...(calendar ? { seasonIds: calendar.seasons.map((s) => s.id) } : {}),
  });
  /** Is the target's id list available? If its file is broken, its references are not checked. */
  const has = (target: RefTarget, id: string): boolean | null => {
    if (target in COLLECTIONS) {
      const kind = target as CollectionKind;
      return parsed[kind].has(id) || invalidIds[kind].has(id);
    }
    const known = fromSingletons[target];
    return known ? known.has(id) : null;
  };
  const candidates = (target: RefTarget): Iterable<string> =>
    target in COLLECTIONS
      ? parsed[target as CollectionKind].keys()
      : (fromSingletons[target] ?? new Set<string>());

  const checkRefs = (file: string, prefix: string, refs: readonly Ref[]) => {
    for (const ref of refs) {
      if (has(ref.target, ref.id) !== false) continue;
      const guess = didYouMean(ref.id, candidates(ref.target));
      error(
        file,
        `${prefix}${prefix !== '' ? '.' : ''}${ref.field}`,
        `Unknown ${TARGET_LABEL[ref.target]} "${ref.id}"`,
        guess.length > 0
          ? `did you mean ${guess.map((g) => `"${g}"`).join(' or ')}?`
          : `no ${TARGET_LABEL[ref.target]} with that id exists in ${TARGET_HOME[ref.target]}`,
      );
    }
  };

  // Cross-references: only meaningful for items that passed their own schema.
  for (const kind of COLLECTION_KINDS) {
    const extract = REF_EXTRACTORS[kind];
    if (!extract) continue;
    for (const [, entry] of parsed[kind]) {
      const index = /^\[(\d+)\]/.exec(entry.field)?.[0] ?? '';
      checkRefs(entry.file, index, extract(entry.value as never));
    }
  }
  if (creation) checkRefs('data/creation.json', '', creationRefs(creation));
  if (appearance) checkRefs('data/appearance.json', '', appearanceRefs(appearance));
  if (life) checkRefs('data/life.json', '', lifeRefs(life));

  // ---- Pass 3: coherence ---------------------------------------------------------------------

  const fieldOf = (entry: Entry, field: string) =>
    `${entry.field}${entry.field !== '' ? '.' : ''}${field}`;

  for (const kind of [
    'races',
    'birthplaces',
    'legacies',
    'occupations',
    'names',
    'foci',
  ] as const) {
    if (parsed[kind].size === 0 && invalidIds[kind].size === 0) {
      error(
        `data/${kind}/`,
        '(file)',
        `Character creation needs at least one ${COLLECTIONS[kind].label}`,
        `add a file to data/${kind}/`,
      );
    }
  }

  const birthplaceRaces = new Set<string>();
  for (const [, entry] of parsed.birthplaces) {
    for (const race of (entry.value as { races: string[] }).races) birthplaceRaces.add(race);
  }
  const heightOptions = appearance?.fields.find((f) => f.id === 'height')?.options ?? [];
  for (const [id, entry] of parsed.races) {
    const race = entry.value as { heights: Record<string, unknown> };
    if (parsed.birthplaces.size > 0 && !birthplaceRaces.has(id)) {
      error(
        entry.file,
        fieldOf(entry, 'id'),
        `No birthplace lists "${id}", so this race can never be born`,
        'add it to the "races" of at least one file in data/birthplaces/',
      );
    }
    for (const option of heightOptions) {
      if (!(option.id in race.heights)) {
        error(
          entry.file,
          fieldOf(entry, 'heights'),
          `Missing the "${option.id}" height class`,
          'every race gives a centimetre range for each height option in data/appearance.json',
        );
      }
    }
    if (appearance) {
      for (const field of appearance.fields) {
        const usable = field.options.some(
          (o) =>
            o.weight > 0 &&
            o.minAge === 0 &&
            (o.races.length === 0 || o.races.includes(id)) &&
            !o.notRaces.includes(id),
        );
        if (!usable) {
          error(
            'data/appearance.json',
            `fields.${field.id}`,
            `No option of "${field.id}" is available to "${id}" at birth`,
            'every race needs at least one option per field with weight above 0 and no minimum age',
          );
        }
      }
    }
  }

  if (life && character) {
    for (const stage of character.stages) {
      if (!(stage.id in life.slots)) {
        error(
          'data/life.json',
          `slots.${stage.id}`,
          `No slot count for the "${stage.id}" life stage`,
          'give every stage in data/character.json a number of activity slots',
        );
      }
    }
  }
  for (const kind of ['activities', 'jobs'] as const) {
    if (parsed[kind].size === 0 && invalidIds[kind].size === 0) {
      error(
        `data/${kind}/`,
        '(file)',
        `The life loop needs at least one ${COLLECTIONS[kind].label}`,
        `add a file to data/${kind}/`,
      );
    }
  }

  for (const [, entry] of parsed.traits) {
    const trait = entry.value as { id: string; excludes: string[] };
    if (trait.excludes.includes(trait.id)) {
      error(entry.file, fieldOf(entry, 'excludes'), 'A trait cannot exclude itself');
    }
  }

  if (creation && calendar) {
    const presentYear = Math.floor(calendar.presentTick / 12);
    const { entry, defaults } = creation;
    if (entry.maxYear >= presentYear) {
      error(
        'data/creation.json',
        'entry.maxYear',
        `The last entry year (${entry.maxYear}) must come before the present (Year ${presentYear})`,
      );
    }
    if (entry.minYear > entry.maxYear || entry.minAge > entry.maxAge) {
      error('data/creation.json', 'entry', 'Each minimum must not be greater than its maximum');
    }
    if (defaults.entryYear < entry.minYear || defaults.entryYear > entry.maxYear) {
      error('data/creation.json', 'defaults.entryYear', 'The default entry year is out of range');
    }
    if (defaults.entryAge < entry.minAge || defaults.entryAge > entry.maxAge) {
      error('data/creation.json', 'defaults.entryAge', 'The default entry age is out of range');
    }
  }

  const ok = !issues.some((i) => i.severity === 'error');
  const toRecord = <T>(kind: CollectionKind): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [id, entry] of parsed[kind]) out[id] = entry.value as T;
    return out;
  };

  let data: GameData | null = null;
  const allSingletons = Object.keys(SINGLETONS).every((path) => path in singletons);
  if (ok && allSingletons) {
    const assembled: Record<string, unknown> = {};
    for (const [path, { key }] of Object.entries(SINGLETONS)) {
      assembled[key] = singletons[path as SingletonPath];
    }
    for (const kind of COLLECTION_KINDS) assembled[kind] = toRecord(kind);
    data = assembled as unknown as GameData;
  }

  return { ok, issues, data, dataHash, fileCount: files.length, counts };
}
