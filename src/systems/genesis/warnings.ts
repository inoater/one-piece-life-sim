import type { GameData, Race } from '../../engine/data/schemas';
import { humanAgeFor, raceAgeFor, stageAt } from './stages';
import { numberWords } from './text';

/**
 * What the entry screen says about an entry year and age before anything is generated.
 *
 *  - error: the character cannot start like this (older than the race ever lives);
 *  - warn:  allowed, but probably not what the player wants (a giant still a child at the end of
 *           the 39 years; a life that will end before the present);
 *  - info:  worth knowing (born before God Valley; starts as a child).
 *
 * A warning may carry suggestions: entry ages that avoid the problem, offered as buttons.
 */

export interface EntrySuggestion {
  label: string;
  entryAge: number;
}

export interface EntryWarning {
  id: string;
  level: 'error' | 'warn' | 'info';
  text: string;
  suggestions: EntrySuggestion[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function entryWarnings(
  data: GameData,
  race: Race,
  entryYear: number,
  entryAge: number,
): EntryWarning[] {
  const { entry } = data.creation;
  const rules = data.character;
  const presentYear = Math.floor(data.calendar.presentTick / 12);
  const warnings: EntryWarning[] = [];

  if (entryYear < entry.minYear || entryYear > entry.maxYear) {
    warnings.push({
      id: 'year-range',
      level: 'error',
      text: `The entry year must be between Year ${entry.minYear} and Year ${entry.maxYear}.`,
      suggestions: [],
    });
  }
  if (entryAge < entry.minAge || entryAge > entry.maxAge) {
    warnings.push({
      id: 'age-range',
      level: 'error',
      text: `The entry age must be between ${entry.minAge} and ${entry.maxAge}.`,
      suggestions: [],
    });
  }

  const birthYear = entryYear - entryAge;
  const ageAtPresent = entryAge + (presentYear - entryYear);
  const { lifespan, anchors } = race;
  const clampAge = (age: number) => Math.min(entry.maxAge, Math.max(entry.minAge, age));

  if (entryAge > lifespan.max) {
    warnings.push({
      id: 'too-old',
      level: 'error',
      text: `No ${race.name} lives to ${entryAge}: the longest lives end around ${lifespan.max}.`,
      suggestions: [
        { label: `Enter at ${lifespan.min - 10}`, entryAge: clampAge(lifespan.min - 10) },
      ],
    });
  } else if (entryAge >= lifespan.min) {
    warnings.push({
      id: 'lifespan-edge',
      level: 'warn',
      text: `At ${entryAge} you are already older than many ${race.name} ever get (${lifespan.min} to ${lifespan.max} years). This life may be short.`,
      suggestions: [],
    });
  } else if (ageAtPresent > lifespan.max) {
    const latest = Math.max(entry.minAge, lifespan.max - (presentYear - entryYear));
    warnings.push({
      id: 'outlive',
      level: 'warn',
      text: `Entering at ${entryAge} in Year ${entryYear}, you would turn ${ageAtPresent} in Year ${presentYear}, when the present arrives: past the ${lifespan.max} years a ${race.name} can live. You will not see the present.`,
      suggestions: [{ label: `Enter at ${latest} instead`, entryAge: clampAge(latest) }],
    });
  }

  if (ageAtPresent < anchors.childEnds) {
    const grownByPresent = clampAge(anchors.childEnds - (presentYear - entryYear));
    const youngAdult = clampAge(Math.round(raceAgeFor(rules, race, 18)));
    const suggestions: EntrySuggestion[] = [
      { label: `Grown by the present: enter at ${grownByPresent}`, entryAge: grownByPresent },
    ];
    if (youngAdult !== grownByPresent && youngAdult <= entry.maxAge) {
      suggestions.push({
        label: `Start as a young adult: enter at ${youngAdult}`,
        entryAge: youngAdult,
      });
    }
    warnings.push({
      id: 'child-at-present',
      level: 'warn',
      text: `A ${race.name} is a child until ${anchors.childEnds}. Born in Year ${birthYear}, you would only turn ${ageAtPresent} in Year ${presentYear}, still a child when the present arrives. An older entry age gives you a grown life to play.`,
      suggestions,
    });
  }

  if (birthYear < 0) {
    const yearsBefore = -birthYear;
    warnings.push({
      id: 'before-god-valley',
      level: 'info',
      text: `Born in Year ${birthYear}: ${plural(yearsBefore, 'year')} before God Valley.`,
      suggestions: [],
    });
  }

  const humanAge = humanAgeFor(rules, race, entryAge);
  if (humanAge <= data.creation.entry.focusAboveAge) {
    const stage = stageAt(rules, race, entryAge).stage;
    warnings.push({
      id: 'starts-young',
      level: 'info',
      text:
        entryAge === 0
          ? 'You start on the day you are born: no backstory, everything ahead of you.'
          : `You start as a${/^[aeiou]/i.test(stage.name) ? 'n' : ''} ${stage.name.toLowerCase()} of ${numberWords(entryAge)}, too young for a backstory focus.`,
      suggestions: [],
    });
  }

  return warnings;
}

export function blockingWarning(warnings: readonly EntryWarning[]): EntryWarning | undefined {
  return warnings.find((w) => w.level === 'error');
}
