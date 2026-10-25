import type { ZodType } from 'zod';
import { hashValue } from '../canonical';
import { didYouMean, formatPath, type DataIssue } from './issues';
import {
  appearanceRefs,
  canonRulesRefs,
  creationRefs,
  lifeRefs,
  personalityRefs,
  powerRulesRefs,
  battleRulesRefs,
  handsRulesRefs,
  shipRulesRefs,
  REF_EXTRACTORS,
  singletonTargets,
  TARGET_HOME,
  TARGET_LABEL,
  travelRefs,
  worldRulesRefs,
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
  type CanonRules,
  ENGINE_TRACKS,
  POWER_LINE_IDS,
  BATTLE_LINE_IDS,
  LADDER_TIERS,
  TECH_TAGS,
  type BattleRules,
  type HandsRules,
  type ShipRules,
  type Weapon,
  HANDS_LINE_IDS,
  type CastMember,
  type FruitDef,
  type MatchupRules,
  type Moveset,
  type Track,
  type Trait,
  type PersonalityRules,
  type PowerRules,
  type TravelRules,
  type WorldRules,
  tickOfWhen,
  type When,
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
  const travel = singletons['data/travel.json'] as TravelRules | undefined;
  const worldRules = singletons['data/world.json'] as WorldRules | undefined;
  const canonRules = singletons['data/canon.json'] as CanonRules | undefined;
  const powers = singletons['data/powers.json'] as PowerRules | undefined;
  const personality = singletons['data/personality.json'] as PersonalityRules | undefined;
  const battle = singletons['data/battle.json'] as BattleRules | undefined;
  const hands = singletons['data/hands.json'] as HandsRules | undefined;
  const ships = singletons['data/ships.json'] as ShipRules | undefined;

  // ---- Pass 2: references --------------------------------------------------------------------

  const fromSingletons = singletonTargets({
    ...(creation ? { creation } : {}),
    ...(appearance ? { appearance } : {}),
    ...(character ? { stageIds: character.stages.map((s) => s.id) } : {}),
    ...(life ? { life } : {}),
    ...(calendar ? { seasonIds: calendar.seasons.map((s) => s.id) } : {}),
    ...(worldRules ? { npcGoalIds: worldRules.npc.goals.map((g) => g.id) } : {}),
    ...(personality ? { personality } : {}),
    ...(powers ? { powers } : {}),
    ...(battle ? { battle } : {}),
    ...(hands ? { hands } : {}),
    ...(ships ? { ships } : {}),
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
  if (travel) checkRefs('data/travel.json', '', travelRefs(travel));
  if (worldRules) checkRefs('data/world.json', '', worldRulesRefs(worldRules));
  if (canonRules) checkRefs('data/canon.json', '', canonRulesRefs(canonRules));
  if (powers) checkRefs('data/powers.json', '', powerRulesRefs(powers));
  if (personality) checkRefs('data/personality.json', '', personalityRefs(personality));
  if (battle) checkRefs('data/battle.json', '', battleRulesRefs(battle));
  if (hands) checkRefs('data/hands.json', '', handsRulesRefs(hands));
  if (ships) checkRefs('data/ships.json', '', shipRulesRefs(ships));

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

  // ---- The world (Phase 3) -------------------------------------------------------------------

  for (const kind of ['locations', 'lanes', 'vessels', 'factions'] as const) {
    if (parsed[kind].size === 0 && invalidIds[kind].size === 0) {
      error(
        `data/${kind}/`,
        '(file)',
        `The world needs at least one ${COLLECTIONS[kind].label}`,
        `add a file to data/${kind}/`,
      );
    }
  }

  // The travel graph: every place has a lane, and every place can be reached from every other
  // (lanes followed in either direction; one-way lanes and requirements are the planner's business).
  const neighbours = new Map<string, Set<string>>();
  const pairs = new Map<string, string>();
  for (const id of parsed.locations.keys()) neighbours.set(id, new Set());
  for (const [id, entry] of parsed.lanes) {
    const lane = entry.value as { from: string; to: string };
    neighbours.get(lane.from)?.add(lane.to);
    neighbours.get(lane.to)?.add(lane.from);
    const key = [lane.from, lane.to].sort().join(' ');
    const twin = pairs.get(key);
    if (twin) {
      warn(entry.file, fieldOf(entry, 'to'), `"${id}" joins the same two places as "${twin}"`);
    }
    pairs.set(key, id);
  }
  const reachable = new Set<string>();
  const first = [...parsed.locations.keys()].sort()[0];
  if (first !== undefined && parsed.lanes.size > 0) {
    const queue = [first];
    reachable.add(first);
    while (queue.length > 0) {
      const at = queue.shift() as string;
      for (const next of neighbours.get(at) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
    for (const [id, entry] of parsed.locations) {
      if ((neighbours.get(id)?.size ?? 0) === 0) {
        error(
          entry.file,
          fieldOf(entry, 'id'),
          `No sea lane reaches "${id}"`,
          'add one in data/lanes/',
        );
      } else if (!reachable.has(id)) {
        error(
          entry.file,
          fieldOf(entry, 'id'),
          `"${id}" cannot be reached from "${first}"`,
          'the travel graph must be connected; add a lane between the two groups',
        );
      }
    }
  }

  // Beats: a dependent must name this beat in its "requires", and a dated role must be alive then.
  const beatTick = (w: When) => tickOfWhen(w);
  for (const [id, entry] of parsed.canon) {
    const beat = entry.value as {
      dependents: string[];
      window: { from: When; to: When };
      roles: Record<string, { char: string }>;
      dev: boolean;
    };
    beat.dependents.forEach((dep, i) => {
      const other = parsed.canon.get(dep)?.value as { requires: string[] } | undefined;
      if (other && !other.requires.includes(id)) {
        error(
          entry.file,
          fieldOf(entry, `dependents[${i}]`),
          `"${dep}" is listed as a dependent but does not require "${id}"`,
          `add "${id}" to the "requires" of "${dep}"`,
        );
      }
    });
    for (const [role, ref] of Object.entries(beat.roles)) {
      const cast = parsed.cast.get(ref.char)?.value as { born: When; dev: boolean } | undefined;
      if (cast && beatTick(cast.born) > beatTick(beat.window.to)) {
        error(
          entry.file,
          fieldOf(entry, `roles.${role}.char`),
          `"${ref.char}" is not born until after this beat's window`,
        );
      }
      if (cast && cast.dev !== beat.dev) {
        error(
          entry.file,
          fieldOf(entry, `roles.${role}.char`),
          'dev fixtures and real canon cannot be mixed in one beat',
        );
      }
    }
  }
  for (const [id, entry] of parsed.factions) {
    const faction = entry.value as { kind: string; umbrella?: string; captain?: string };
    if (faction.kind === 'crew' && (!faction.umbrella || !faction.captain)) {
      error(
        entry.file,
        fieldOf(entry, 'kind'),
        `The crew "${id}" needs a captain and an umbrella faction (the pirates)`,
      );
    }
  }
  if (canonRules && creation) {
    for (const mode of creation.canonModes) {
      if (!(mode.id in canonRules.modes)) {
        error(
          'data/canon.json',
          `modes.${mode.id}`,
          `No rules for the "${mode.id}" canon mode`,
          'every canon mode in data/creation.json needs a row here',
        );
      }
    }
  }

  // ---- Powers (Phase 4) ----------------------------------------------------------------------

  // Trait names are modifier sources ("Sturdy (trait)"), so two traits cannot share one.
  const traitNames = new Map<string, string>();
  for (const [id, entry] of parsed.traits) {
    const name = (entry.value as Trait).name;
    const twin = traitNames.get(name);
    if (twin)
      error(
        entry.file,
        fieldOf(entry, 'name'),
        `"${id}" has the same name as "${twin}"`,
        'trait names label their modifiers, so each must be unique',
      );
    traitNames.set(name, id);
  }
  // Every trait does something (rule 1: a trait is its mechanics).
  for (const [id, entry] of parsed.traits) {
    const t = entry.value as Trait;
    const does =
      t.statMods.length +
        t.potentialMods.length +
        t.immunities.length +
        t.locks.length +
        t.opinion.length >
        0 ||
      t.trainingGainPct !== 0 ||
      Object.keys(t.trainingMods).length + Object.keys(t.derivedMods).length > 0 ||
      Object.keys(t.checkBonuses).length + Object.keys(t.powerMods).length > 0 ||
      Object.keys(t.flags).length + Object.keys(t.eventWeights).length > 0;
    if (!does) {
      error(
        entry.file,
        fieldOf(entry, 'id'),
        `The trait "${id}" does nothing`,
        'give it at least one mechanic (stat modifiers, check bonuses, opinions...)',
      );
    }
    if (t.evolves?.to === id)
      error(entry.file, fieldOf(entry, 'evolves.to'), 'A trait cannot evolve into itself');
  }

  // Fruits: one power each, technique ids unique across every fruit and data/techniques.
  const techIds = new Map<string, string>();
  for (const [id, entry] of parsed.techniques) techIds.set(id, entry.file);
  const powerKeys = new Map<string, string>();
  const bodyIds = new Set((powers?.fruit.bodies ?? []).map((b) => b.id));
  for (const [id, entry] of parsed.fruits) {
    const fruit = entry.value as FruitDef;
    const twin = powerKeys.get(fruit.power);
    if (twin)
      error(
        entry.file,
        fieldOf(entry, 'power'),
        `"${id}" has the same power as "${twin}": one power, one fruit`,
      );
    powerKeys.set(fruit.power, id);
    for (const tech of [...fruit.techniques, ...(fruit.secret?.techniques ?? [])]) {
      const other = techIds.get(tech.id);
      if (other)
        error(
          entry.file,
          fieldOf(entry, 'techniques'),
          `Technique id "${tech.id}" is already used in ${other}`,
        );
      techIds.set(tech.id, entry.file);
    }
    fruit.holders.forEach((h, i) => {
      if (h.body && !bodyIds.has(h.body)) {
        error(
          entry.file,
          fieldOf(entry, `holders[${i}].body`),
          `No body "${h.body}" in data/powers.json fruit.bodies`,
        );
      }
    });
  }
  for (const [, entry] of parsed.movesets) {
    const moveset = entry.value as Moveset;
    moveset.eras.forEach((era, i) => {
      for (const tech of [
        ...era.techniques,
        ...(era.signature ? [era.signature] : []),
        ...(era.finisher ? [era.finisher] : []),
      ]) {
        if (!techIds.has(tech)) {
          error(
            entry.file,
            fieldOf(entry, `eras[${i}]`),
            `Unknown technique "${tech}"`,
            'techniques live in data/techniques/ and in each fruit',
          );
        }
      }
    });
  }
  const movesetChars = new Map<string, string>();
  for (const [id, entry] of parsed.movesets) {
    const char = (entry.value as Moveset).char;
    const twin = movesetChars.get(char);
    if (twin)
      error(entry.file, fieldOf(entry, 'char'), `"${char}" already has a moveset ("${twin}")`);
    movesetChars.set(char, id);
  }
  // Tracks: a stage that needs another track names a stage that exists there.
  for (const [, entry] of parsed.tracks) {
    const track = entry.value as Track;
    track.stages.forEach((stage, i) => {
      for (const [other, stageId] of Object.entries(stage.requires.tracks)) {
        const t = parsed.tracks.get(other)?.value as Track | undefined;
        if (t && !t.stages.some((s) => s.id === stageId)) {
          error(
            entry.file,
            fieldOf(entry, `stages[${i}].requires.tracks.${other}`),
            `"${other}" has no stage "${stageId}"`,
          );
        }
      }
    });
  }
  if (parsed.tracks.size > 0) {
    for (const id of ENGINE_TRACKS) {
      if (!parsed.tracks.has(id))
        error('data/tracks/', '(file)', `The haki track "${id}" is missing`);
    }
    for (const type of ['paramecia', 'zoan', 'logia'] as const) {
      const n = [...parsed.tracks.values()].filter(
        (e) => (e.value as Track).family === 'fruit' && (e.value as Track).fruitType === type,
      ).length;
      if (n !== 1)
        error(
          'data/tracks/',
          '(file)',
          `Exactly one fruit track is needed for ${type} fruits (found ${n})`,
        );
    }
  }
  if (powers) {
    for (const id of POWER_LINE_IDS) {
      if (!(id in powers.lines))
        error('data/powers.json', `lines.${id}`, 'Missing line', 'the powers write this line');
    }
    const canonWords = new Set(
      [...parsed.fruits.values()].map((e) =>
        ((e.value as FruitDef).name.split(/[- ]/)[0] ?? '').toLowerCase(),
      ),
    );
    powers.generator.concepts.forEach((c, i) => {
      if (canonWords.has(c.word.toLowerCase())) {
        warn(
          'data/powers.json',
          `generator.concepts[${i}].word`,
          `"${c.word}" names a canon fruit; the generator will skip it`,
        );
      }
    });
  }
  // Phase 6: every line the hands write; canon blades never outnumber their grade's count, and
  // each counted grade has one template its generated swords are made from.
  if (hands) {
    for (const id of HANDS_LINE_IDS) {
      if (!(id in hands.lines))
        error('data/hands.json', `lines.${id}`, 'Missing line', 'the game writes this line');
    }
    const canonByGrade = new Map<string, number>();
    const templates = new Map<string, number>();
    for (const [, entry] of parsed.weapons) {
      const w = entry.value as Weapon;
      if (w.template) templates.set(w.grade, (templates.get(w.grade) ?? 0) + 1);
      else if (w.grade !== 'ungraded' && w.canon)
        canonByGrade.set(w.grade, (canonByGrade.get(w.grade) ?? 0) + 1);
      if (w.grade !== 'ungraded' && !w.canon && !w.template)
        error(
          entry.file,
          `${entry.field}.grade`,
          `A graded weapon is either canon (with holders) or a template`,
          'graded swords are tracked entities: one per sword in the world',
        );
    }
    for (const [grade, rule] of Object.entries(hands.grades)) {
      if (rule.count === null) continue;
      const canon = canonByGrade.get(grade) ?? 0;
      if (canon > rule.count)
        error(
          'data/hands.json',
          `grades.${grade}.count`,
          `${canon} canon ${grade} blades, but only ${rule.count} exist`,
        );
      if ((templates.get(grade) ?? 0) !== 1)
        error('data/weapons/', '(file)', `Exactly one template for ${grade} swords is needed`);
    }
  }
  // Phase 5: battles. Every line the engine writes; the ladder climbs; each contest once; every
  // canon character (fixtures aside) on the ladder, their rungs in date order.
  if (battle) {
    for (const id of BATTLE_LINE_IDS) {
      if (!(id in battle.lines))
        error(
          'data/battle.json',
          `lines.${id}`,
          'Missing line',
          'the battle engine writes this line',
        );
    }
    battle.ladder.forEach((rung, i) => {
      if (rung.id !== LADDER_TIERS[i])
        error(
          'data/battle.json',
          `ladder[${i}].id`,
          `Expected "${LADDER_TIERS[i]}" here`,
          'the ladder runs from civilian to peak',
        );
      const prev = battle.ladder[i - 1];
      if (prev && rung.min <= prev.min)
        error(
          'data/battle.json',
          `ladder[${i}].min`,
          'Each rung must start above the one below it',
        );
    });
    const contests = new Set<string>();
    battle.contests.forEach((c, i) => {
      if (contests.has(c.id))
        error('data/battle.json', `contests[${i}].id`, `Duplicate contest "${c.id}"`);
      contests.add(c.id);
    });
  }
  for (const [, entry] of parsed.cast) {
    const cast = entry.value as CastMember;
    if (cast.dev) continue;
    if (cast.power.length === 0)
      warn(
        entry.file,
        `${entry.field}.power`,
        `${cast.name} has no Combat Power keyframes`,
        'they will not be placed on the ladder',
      );
    let last = -Infinity;
    cast.power.forEach((k, i) => {
      const t = k.from.year * 12 + (k.from.month - 1);
      if (t < last)
        error(entry.file, `${entry.field}.power[${i}].from`, 'Power keyframes in date order');
      last = t;
    });
  }
  const matchups = singletons['data/fruitMatchups.json'] as MatchupRules | undefined;
  matchups?.pairs.forEach((pair, i) => {
    for (const side of [pair.attacker, pair.defender]) {
      if (side.startsWith('power:') && !powerKeys.has(side.slice(6))) {
        error(
          'data/fruitMatchups.json',
          `pairs[${i}]`,
          `No fruit has the power "${side.slice(6)}"`,
        );
      }
      if (side.startsWith('tag:') && !(TECH_TAGS as readonly string[]).includes(side.slice(4))) {
        error('data/fruitMatchups.json', `pairs[${i}]`, `Unknown technique tag "${side.slice(4)}"`);
      }
    }
  });

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
