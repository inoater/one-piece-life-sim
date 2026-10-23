import { z } from 'zod';
import {
  APPEARANCE_FIELDS,
  type Birthplace,
  type Focus,
  type GameData,
  type Legacy,
  type Race,
} from '../../engine/data/schemas';
import { Rng } from '../../engine/rng';
import { PRONOUNS } from '../../engine/state';

/**
 * What the player chose on the New Life screens. Everything not chosen is rolled, and every roll
 * comes from its own keyed stream (see engine/rng.ts), so:
 *
 *  - the same options always give the same character (the live preview is the real thing);
 *  - rerolling one section (`rolls.birthplace += 1`) changes only what depends on it;
 *  - the hidden talent tier is keyed to the seed alone, so it cannot be fished for by rerolling
 *    sections. Only a new seed rolls a new talent.
 */

export const RANDOM = 'random';
const MAX_SEED = 80;
const MAX_NAME = 40;

const roll = z.number().int().min(0).max(1_000_000).default(0);
const choice = z.string().min(1).default(RANDOM);
const name = z
  .string()
  .max(MAX_NAME)
  // eslint-disable-next-line no-control-regex
  .refine((s) => !/[\u0000-\u001f{}]/.test(s), {
    message: 'names cannot contain { } or control characters',
  })
  .optional();

export const GenesisOptionsSchema = z.strictObject({
  seed: z
    .string()
    .trim()
    .min(1)
    .max(MAX_SEED)
    // eslint-disable-next-line no-control-regex
    .refine((s) => !/[\u0000-\u001f]/.test(s), {
      message: 'a seed cannot contain control characters',
    }),
  canonMode: z.string().min(1),
  difficulty: z.string().min(1),
  rareRaces: z.boolean().default(false),
  race: choice,
  birthplace: choice,
  legacy: choice,
  focus: choice,
  entryYear: z.number().int(),
  entryAge: z.number().int(),
  pronouns: z.enum(PRONOUNS),
  givenName: name,
  familyName: name,
  /** Appearance fields fixed to an option id; the rest are rolled. */
  locks: z.partialRecord(z.enum(APPEARANCE_FIELDS), z.string().min(1)).default({}),
  rolls: z
    .strictObject({
      race: roll,
      birthplace: roll,
      family: roll,
      backstory: roll,
      name: roll,
      appearance: z.partialRecord(z.enum(APPEARANCE_FIELDS), roll).default({}),
    })
    .default({ race: 0, birthplace: 0, family: 0, backstory: 0, name: 0, appearance: {} }),
});
export type GenesisOptions = z.infer<typeof GenesisOptionsSchema>;
export type GenesisOptionsInput = z.input<typeof GenesisOptionsSchema>;

export class GenesisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenesisError';
  }
}

/** Options as a new player first sees them: the data's defaults, everything else random. */
export function defaultOptions(data: GameData, seed: string): GenesisOptions {
  const d = data.creation.defaults;
  return GenesisOptionsSchema.parse({
    seed,
    canonMode: d.canonMode,
    difficulty: d.difficulty,
    entryYear: d.entryYear,
    entryAge: d.entryAge,
    pronouns: d.pronouns,
  });
}

export function genesisRng(seed: string): Rng {
  return Rng.root(seed).fork('genesis');
}

const sortedCache = new WeakMap<object, readonly unknown[]>();

/**
 * The items of a data collection in id order. Game data never changes once loaded, so the sorted
 * list is kept per collection (the life loop asks for it every month). Callers get a copy.
 */
export function sortedValues<T extends { id: string }>(record: Readonly<Record<string, T>>): T[] {
  let sorted = sortedCache.get(record) as readonly T[] | undefined;
  if (!sorted) {
    sorted = Object.values(record).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    sortedCache.set(record, sorted);
  }
  return [...sorted];
}

/** Races that may be picked under these options (rare races only when world setup allows them). */
export function availableRaces(data: GameData, rareRaces: boolean): Race[] {
  return sortedValues(data.races).filter((r) => rareRaces || !r.rare);
}

export function birthplacesFor(data: GameData, raceId: string): Birthplace[] {
  return sortedValues(data.birthplaces).filter((b) => b.races.includes(raceId));
}

export function legacyWeight(legacy: Legacy, place: Birthplace): number {
  return legacy.weight * (place.legacyWeights[legacy.id] ?? 1);
}

export function focusWeight(focus: Focus, place: Birthplace, legacy: Legacy): number {
  return focus.weight * (place.focusWeights[focus.id] ?? 1) * (legacy.focusWeights[focus.id] ?? 1);
}

/** Whether the backstory focus applies: only when entering older than `focusAboveAge` (human years). */
export function focusApplies(data: GameData, humanEntryAge: number): boolean {
  return humanEntryAge > data.creation.entry.focusAboveAge;
}

export interface Resolved {
  race: Race;
  birthplace: Birthplace;
  legacy: Legacy;
  /** Null when the character is too young for a backstory focus. */
  focus: Focus | null;
  /** Which of the four were picked at random. */
  random: { race: boolean; birthplace: boolean; legacy: boolean; focus: boolean };
}

function pick<T>(rng: Rng, items: readonly T[], weight: (item: T) => number, what: string): T {
  const found = rng.weightedPick(items, weight) ?? items[0];
  if (found === undefined) throw new GenesisError(`There is no ${what} to choose from`);
  return found;
}

/**
 * Turn "random" into concrete choices and check the explicit ones. Throws a GenesisError naming
 * the problem when a choice is impossible (a giant on a sky island, an unknown id).
 */
export function resolveChoices(
  data: GameData,
  options: GenesisOptions,
  focusNeeded: (race: Race) => boolean,
): Resolved {
  const rng = genesisRng(options.seed);
  const races = availableRaces(data, options.rareRaces);

  let race: Race;
  if (options.race === RANDOM) {
    race = pick(rng.fork('race', options.rolls.race), races, (r) => r.weight, 'race');
  } else {
    const found = data.races[options.race];
    if (!found) throw new GenesisError(`There is no race "${options.race}"`);
    if (found.rare && !options.rareRaces) {
      throw new GenesisError(`${found.name} is a rare race: allow rare races in world setup first`);
    }
    race = found;
  }

  const places = birthplacesFor(data, race.id);
  let birthplace: Birthplace;
  if (options.birthplace === RANDOM) {
    birthplace = pick(
      rng.fork('birthplace', race.id, options.rolls.birthplace),
      places,
      () => 1,
      'birthplace',
    );
  } else {
    const found = data.birthplaces[options.birthplace];
    if (!found) throw new GenesisError(`There is no birthplace "${options.birthplace}"`);
    if (!found.races.includes(race.id)) {
      throw new GenesisError(`A ${race.name} cannot be born in ${found.name}`);
    }
    birthplace = found;
  }

  let legacy: Legacy;
  if (options.legacy === RANDOM) {
    legacy = pick(
      rng.fork('family', options.rolls.family, 'legacy'),
      sortedValues(data.legacies),
      (l) => legacyWeight(l, birthplace),
      'family legacy',
    );
  } else {
    const found = data.legacies[options.legacy];
    if (!found) throw new GenesisError(`There is no family legacy "${options.legacy}"`);
    legacy = found;
  }

  let focus: Focus | null = null;
  if (focusNeeded(race)) {
    if (options.focus === RANDOM) {
      focus = pick(
        rng.fork('backstory', options.rolls.backstory, 'focus'),
        sortedValues(data.foci),
        (f) => focusWeight(f, birthplace, legacy),
        'backstory focus',
      );
    } else {
      const found = data.foci[options.focus];
      if (!found) throw new GenesisError(`There is no backstory focus "${options.focus}"`);
      focus = found;
    }
  }

  return {
    race,
    birthplace,
    legacy,
    focus,
    random: {
      race: options.race === RANDOM,
      birthplace: options.birthplace === RANDOM,
      legacy: options.legacy === RANDOM,
      focus: focus !== null && options.focus === RANDOM,
    },
  };
}
