import type { CollectionKind, Effect, EventDef } from './schemas';

/**
 * Cross-references between content files.
 *
 * Schemas prove each file is well-formed on its own. This proves the files agree with each other:
 * an event may only name a trait, island or follow-up event that exists. A dangling reference is
 * a build failure that names the file and the field, never a runtime surprise.
 *
 * Reference extraction is explicit per content type (not a blind deep-walk) so that adding a new
 * reference field is a deliberate, reviewed change in one place.
 */

export interface Ref {
  /** Where the reference was written: the field path inside the file. */
  field: string;
  /** Which collection the id must exist in. */
  target: CollectionKind;
  id: string;
}

function effectRefs(effects: readonly Effect[], base: string): Ref[] {
  const refs: Ref[] = [];
  effects.forEach((effect, i) => {
    if (effect.kind === 'schedule') {
      refs.push({ field: `${base}[${i}].eventId`, target: 'events', id: effect.eventId });
    }
  });
  return refs;
}

export function eventRefs(event: EventDef): Ref[] {
  const refs: Ref[] = [];
  event.conditions.forEach((condition, i) => {
    if (condition.kind === 'hasTrait') {
      refs.push({ field: `conditions[${i}].trait`, target: 'traits', id: condition.trait });
    } else if (condition.kind === 'atLocation') {
      refs.push({
        field: `conditions[${i}].location`,
        target: 'locations',
        id: condition.location,
      });
    }
  });
  refs.push(...effectRefs(event.effects, 'effects'));
  event.choices.forEach((choice, i) => {
    refs.push(...effectRefs(choice.effects, `choices[${i}].effects`));
  });
  return refs;
}

/** Collections whose items can refer to other content. Others (traits, weapons, locations) are leaves for now. */
export const REF_EXTRACTORS: Partial<Record<CollectionKind, (item: never) => Ref[]>> = {
  events: eventRefs as (item: never) => Ref[],
};

export const TARGET_LABEL: Record<CollectionKind, string> = {
  traits: 'trait',
  weapons: 'weapon',
  locations: 'location',
  events: 'event',
};
