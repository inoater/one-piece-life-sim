import {
  APPEARANCE_FIELDS,
  type AppearanceField,
  type AppearanceOption,
  type Birthplace,
  type Focus,
  type GameData,
  type Legacy,
  type Race,
} from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { Pronouns, Scar } from '../../engine/state';
import { renderTemplate } from '../../engine/template';
import { humanAgeFor, stageAt } from './stages';
import { articleFor, joinAnd } from './text';

/**
 * Appearance: stored as option ids (data/appearance.json), written as a sentence now, drawn as
 * avatar layers in Phase 7. Each field is rolled from its own keyed stream, so rerolling one field
 * leaves the others alone, and any field can be locked to an option.
 */

export interface AppearanceContext {
  data: GameData;
  race: Race;
  birthplace: Birthplace;
  legacy: Legacy | null;
  focus: Focus | null;
  /** Real age in years at the moment described. */
  age: number;
  pronouns: Pronouns;
}

/** Options of a field that this race at this age can have. */
export function optionsFor(
  ctx: Pick<AppearanceContext, 'data' | 'race' | 'age'>,
  field: AppearanceField,
): AppearanceOption[] {
  const def = ctx.data.appearance.fields.find((f) => f.id === field);
  if (!def) return [];
  const humanAge = humanAgeFor(ctx.data.character, ctx.race, ctx.age);
  return def.options.filter(
    (o) =>
      (o.races.length === 0 || o.races.includes(ctx.race.id)) &&
      !o.notRaces.includes(ctx.race.id) &&
      humanAge >= o.minAge &&
      (o.maxAge === undefined || humanAge < o.maxAge + 1),
  );
}

/** Weight of an option after every multiplier from race, birthplace, family and focus. */
export function optionWeight(
  ctx: AppearanceContext,
  field: AppearanceField,
  option: AppearanceOption,
): number {
  const humanAge = humanAgeFor(ctx.data.character, ctx.race, ctx.age);
  let weight = option.weight;
  if (option.ageMult && humanAge >= option.ageMult.from) weight *= option.ageMult.mult;
  const keys = [`${field}.${option.id}`, ...option.tags.map((t) => `tag:${t}`)];
  const sources = [
    ctx.race.appearanceWeights,
    ctx.birthplace.appearanceWeights,
    ctx.legacy?.appearanceWeights ?? {},
    ctx.focus?.appearanceWeights ?? {},
  ];
  for (const source of sources) for (const key of keys) weight *= source[key] ?? 1;
  return weight;
}

export interface AppearanceRoll {
  values: Record<AppearanceField, string>;
  /** Locks that could not be honoured (the option does not suit this race or age). */
  dropped: AppearanceField[];
}

export function rollAppearance(
  ctx: AppearanceContext,
  rng: Rng,
  locks: Partial<Record<AppearanceField, string>>,
  rolls: Partial<Record<AppearanceField, number>>,
): AppearanceRoll {
  const values = {} as Record<AppearanceField, string>;
  const dropped: AppearanceField[] = [];
  for (const field of APPEARANCE_FIELDS) {
    const options = optionsFor(ctx, field);
    const locked = locks[field];
    if (locked !== undefined) {
      if (options.some((o) => o.id === locked)) {
        values[field] = locked;
        continue;
      }
      dropped.push(field);
    }
    const picked =
      rng
        .fork(field, rolls[field] ?? 0)
        .weightedPick(options, (o) => optionWeight(ctx, field, o)) ?? options[0];
    if (!picked) throw new Error(`appearance field ${field} has no option for ${ctx.race.id}`);
    values[field] = picked.id;
  }
  return { values, dropped };
}

/** A grown height in centimetres inside the race's range for the height class. */
export function rollAdultHeight(race: Race, heightClass: string, rng: Rng): number {
  const range = race.heights[heightClass];
  if (!range) return 0;
  return rng.int(range.min, range.max);
}

/** A child's height as a fraction of their adult height (interpolated from appearance.json). */
export function heightFraction(data: GameData, race: Race, age: number): number {
  const humanAge = humanAgeFor(data.character, race, age);
  const table = data.appearance.childHeight;
  const first = table[0];
  if (!first || humanAge <= first.age) return first?.fraction ?? 1;
  for (let i = 1; i < table.length; i++) {
    const a = table[i - 1] as (typeof table)[number];
    const b = table[i] as (typeof table)[number];
    if (humanAge <= b.age)
      return a.fraction + ((humanAge - a.age) * (b.fraction - a.fraction)) / (b.age - a.age);
  }
  return table[table.length - 1]?.fraction ?? 1;
}

function textOf(
  data: GameData,
  field: AppearanceField,
  id: string | undefined,
): AppearanceOption | undefined {
  return data.appearance.fields.find((f) => f.id === field)?.options.find((o) => o.id === id);
}

const MAX_EXTRAS = 3;

/** The noun for this race, age and pronoun: "baby girl", "fish-man boy", "mermaid". */
export function ageNoun(
  ctx: Pick<AppearanceContext, 'data' | 'race' | 'age' | 'pronouns'>,
): string {
  const stage = stageAt(ctx.data.character, ctx.race, ctx.age).stage;
  const young = ctx.data.appearance.ageNouns[stage.id];
  if (young) return `${ctx.race.adjective} ${young[ctx.pronouns]}`;
  return ctx.race.noun[ctx.pronouns];
}

/**
 * "A wiry, tall human with a long face, weathered tan skin, shaggy black hair and narrow brown
 * eyes, with a scar across the left brow."
 */
export function appearanceSentence(
  ctx: Pick<AppearanceContext, 'data' | 'race' | 'age' | 'pronouns'>,
  values: Readonly<Record<string, string>>,
  scars: readonly Scar[] = [],
): string {
  const { data } = ctx;
  const get = (field: AppearanceField) => textOf(data, field, values[field]);
  const adjectives = [get('build')?.text ?? '', get('height')?.text ?? '']
    .filter((t) => t.trim() !== '')
    .join(', ');
  const noun = ageNoun(ctx);
  const style = get('hairStyle');
  const hair = style?.tags.includes('nohair')
    ? style.text
    : `${style?.text ?? ''} ${get('hairColor')?.text ?? ''} hair`.trim();
  // The race feature, the rolled mark, then the most recent scars: three at most, so the sentence
  // stays a sentence. The sheet lists every scar.
  const extras = [
    get('feature')?.text ?? '',
    get('marks')?.text ?? '',
    ...scars.map((s) => s.text).reverse(),
  ]
    .map((t) => t.trim())
    .filter((t, i, all) => t !== '' && all.indexOf(t) === i)
    .slice(0, MAX_EXTRAS);
  return renderTemplate(data.appearance.sentence, {
    a: articleFor(adjectives || noun),
    adjectives: adjectives === '' ? '' : `${adjectives} `,
    noun,
    face: get('face')?.text ?? '',
    skin: [get('complexion')?.text, get('skin')?.text, ctx.race.skinNoun]
      .filter((t): t is string => t !== undefined && t.trim() !== '')
      .join(' '),
    hair,
    eyes: `${get('eyeShape')?.text ?? ''} ${get('eyeColor')?.text ?? ''} eyes`.trim(),
    extras: extras.length === 0 ? '' : `, with ${joinAnd(extras)}`,
  });
}
