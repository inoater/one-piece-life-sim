import type {
  Activity,
  Appearance,
  BackstoryEvent,
  Beat,
  BeatEffect,
  Birthplace,
  CanonRules,
  CastMember,
  CollectionKind,
  Condition,
  Creation,
  Effect,
  EventDef,
  Faction,
  Focus,
  Job,
  Lane,
  Legacy,
  LifeEffect,
  LifeRules,
  Location,
  Requires,
  Risk,
  Occupation,
  Race,
  Trait,
  TravelRules,
  WorldRules,
} from './schemas';

/**
 * Cross-references between content files.
 *
 * Schemas prove each file is well-formed on its own. This proves the files agree with each other:
 * an event may only name a trait, island or follow-up event that exists; a birthplace may only
 * offer races and traits that exist; and so on. A dangling reference is a build failure that names
 * the file and the field, never a runtime surprise.
 *
 * Reference extraction is explicit per content type (not a blind deep-walk) so that adding a new
 * reference field is a deliberate, reviewed change in one place.
 */

/**
 * What an id can refer to: a collection, or a list defined inside one of the single files
 * (wealth tiers in creation.json, appearance options in appearance.json, ...).
 */
export type RefTarget =
  | CollectionKind
  | 'wealthTiers'
  | 'difficulties'
  | 'canonModes'
  | 'stages'
  | 'heightClasses'
  | 'appearanceKeys'
  | 'severities'
  | 'illnesses'
  | 'seasons'
  | 'npcGoals';

export interface Ref {
  /** Where the reference was written: the field path inside the file. */
  field: string;
  /** Which collection or list the id must exist in. */
  target: RefTarget;
  id: string;
}

export const TARGET_LABEL: Record<RefTarget, string> = {
  traits: 'trait',
  weapons: 'weapon',
  locations: 'location',
  events: 'event',
  races: 'race',
  birthplaces: 'birthplace',
  legacies: 'family legacy',
  occupations: 'occupation',
  names: 'name pool',
  foci: 'backstory focus',
  backstory: 'backstory event',
  wealthTiers: 'wealth tier',
  difficulties: 'difficulty',
  canonModes: 'canon mode',
  stages: 'life stage',
  heightClasses: 'height class',
  appearanceKeys: 'appearance option',
  activities: 'activity',
  jobs: 'job',
  severities: 'injury severity',
  illnesses: 'illness',
  seasons: 'season',
  npcGoals: 'NPC goal',
  lanes: 'sea lane',
  vessels: 'vessel',
  factions: 'faction',
  cast: 'canon character',
  canon: 'canon beat',
};

/** Where an author fixes a missing id of this kind. */
export const TARGET_HOME: Record<RefTarget, string> = {
  traits: 'data/traits/',
  weapons: 'data/weapons/',
  locations: 'data/locations/',
  events: 'data/events/',
  races: 'data/races/',
  birthplaces: 'data/birthplaces/',
  legacies: 'data/legacies/',
  occupations: 'data/occupations/',
  names: 'data/names/',
  foci: 'data/foci/',
  backstory: 'data/backstory/',
  wealthTiers: 'data/creation.json (wealthTiers)',
  difficulties: 'data/creation.json (difficulties)',
  canonModes: 'data/creation.json (canonModes)',
  stages: 'data/character.json (stages)',
  heightClasses: 'data/appearance.json (the height field)',
  appearanceKeys: 'data/appearance.json ("field.option" or "tag:name")',
  activities: 'data/activities/',
  jobs: 'data/jobs/',
  severities: 'data/life.json (injuries.severities)',
  illnesses: 'data/life.json (illnesses)',
  seasons: 'data/calendar.json (seasons)',
  npcGoals: 'data/world.json (npc.goals)',
  lanes: 'data/lanes/',
  vessels: 'data/vessels/',
  factions: 'data/factions/',
  cast: 'data/cast/',
  canon: 'data/canon/',
};

const each = (target: RefTarget, ids: readonly string[], field: string): Ref[] =>
  ids.map((id, i) => ({ field: `${field}[${i}]`, target, id }));

const keys = (target: RefTarget, record: Readonly<Record<string, unknown>>, field: string): Ref[] =>
  Object.keys(record).map((id) => ({ field: `${field}.${id}`, target, id }));

const one = (target: RefTarget, id: string | undefined, field: string): Ref[] =>
  id === undefined ? [] : [{ field, target, id }];

function effectRefs(effects: readonly (Effect | LifeEffect)[], base: string): Ref[] {
  const refs: Ref[] = [];
  effects.forEach((effect, i) => {
    const at = `${base}[${i}]`;
    switch (effect.kind) {
      case 'schedule':
        refs.push({ field: `${at}.eventId`, target: 'events', id: effect.eventId });
        break;
      case 'trait':
        refs.push({ field: `${at}.trait`, target: 'traits', id: effect.trait });
        break;
      case 'injury':
        if (effect.severity !== 'roll')
          refs.push({ field: `${at}.severity`, target: 'severities', id: effect.severity });
        break;
      case 'illness':
        refs.push({ field: `${at}.illness`, target: 'illnesses', id: effect.illness });
        break;
      case 'relationship':
        refs.push(...one('occupations', effect.occupation, `${at}.occupation`));
        break;
      case 'faction':
        refs.push({ field: `${at}.org`, target: 'factions', id: effect.org });
        refs.push(...one('factions', effect.opinion?.toward, `${at}.opinion.toward`));
        break;
      case 'control':
        refs.push(...one('factions', effect.org ?? undefined, `${at}.org`));
        refs.push(...one('locations', effect.location, `${at}.location`));
        break;
      case 'prosperity':
        refs.push(...one('locations', effect.location, `${at}.location`));
        break;
    }
  });
  return refs;
}

function conditionRefs(conditions: readonly Condition[], base: string): Ref[] {
  const refs: Ref[] = [];
  conditions.forEach((condition, i) => {
    const at = `${base}[${i}]`;
    switch (condition.kind) {
      case 'hasTrait':
      case 'notTrait':
        refs.push({ field: `${at}.trait`, target: 'traits', id: condition.trait });
        break;
      case 'atLocation':
        refs.push({ field: `${at}.location`, target: 'locations', id: condition.location });
        break;
      case 'canonMode':
        refs.push(...each('canonModes', condition.modes, `${at}.modes`));
        break;
      case 'season':
        refs.push(...each('seasons', condition.seasons, `${at}.seasons`));
        break;
      case 'job':
        refs.push(...each('jobs', condition.jobs, `${at}.jobs`));
        break;
      case 'beat':
        refs.push({ field: `${at}.beat`, target: 'canon', id: condition.beat });
        break;
      case 'lane':
        refs.push(...each('lanes', condition.lanes, `${at}.lanes`));
        break;
    }
  });
  return refs;
}

function requiresRefs(req: Requires, base: string): Ref[] {
  const refs: Ref[] = [
    ...each('races', req.races, `${base}.races`),
    ...each('races', req.notRaces, `${base}.notRaces`),
    ...each('traits', req.anyTraits, `${base}.anyTraits`),
    ...each('traits', req.notTraits, `${base}.notTraits`),
  ];
  req.anyOf.forEach((alt, i) => {
    refs.push(
      ...each('races', alt.races, `${base}.anyOf[${i}].races`),
      ...each('races', alt.notRaces, `${base}.anyOf[${i}].notRaces`),
      ...each('traits', alt.anyTraits, `${base}.anyOf[${i}].anyTraits`),
      ...each('traits', alt.notTraits, `${base}.anyOf[${i}].notTraits`),
    );
  });
  return refs;
}

function riskRefs(risk: Risk, base: string): Ref[] {
  return keys('severities', risk.severities, `${base}.severities`);
}

function outcomeRefs(outcomes: Activity['outcomes'], base: string): Ref[] {
  return outcomes.flatMap((o, i) => effectRefs(o.effects, `${base}[${i}].effects`));
}

function activityRefs(act: Activity): Ref[] {
  return [
    ...requiresRefs(act.requires, 'requires'),
    ...riskRefs(act.risk, 'risk'),
    ...outcomeRefs(act.outcomes, 'outcomes'),
  ];
}

function jobRefs(job: Job): Ref[] {
  return [
    ...requiresRefs(job.requires, 'requires'),
    ...riskRefs(job.risk, 'risk'),
    ...outcomeRefs(job.outcomes, 'outcomes'),
  ];
}

export function eventRefs(event: EventDef): Ref[] {
  const refs: Ref[] = [...conditionRefs(event.conditions, 'conditions')];
  event.weightMods.forEach((mod, i) =>
    refs.push(...conditionRefs(mod.when, `weightMods[${i}].when`)),
  );
  refs.push(...effectRefs(event.effects, 'effects'));
  event.choices.forEach((choice, i) => {
    refs.push(...conditionRefs(choice.requires, `choices[${i}].requires`));
    refs.push(...effectRefs(choice.effects, `choices[${i}].effects`));
    const check = choice.check;
    if (!check) return;
    for (const band of ['criticalSuccess', 'success', 'failure', 'criticalFailure'] as const) {
      const b = check[band];
      if (b) refs.push(...effectRefs(b.effects, `choices[${i}].check.${band}.effects`));
    }
  });
  for (const [name, role] of Object.entries(event.roles)) {
    if (role.kind === 'stranger') {
      refs.push(...one('occupations', role.occupation, `roles.${name}.occupation`));
    }
  }
  if (event.where) {
    refs.push(...each('factions', event.where.controllers, 'where.controllers'));
    refs.push(...each('factions', event.where.notControllers, 'where.notControllers'));
  }
  return refs;
}

// ---- The world (Phase 3) ----------------------------------------------------------------------

function locationRefs(loc: Location): Ref[] {
  return [
    ...one('factions', loc.controller ?? undefined, 'controller'),
    ...each('jobs', loc.jobs, 'jobs'),
    { field: 'culture', target: 'birthplaces', id: loc.culture },
    ...each('locations', loc.eternalPoses, 'eternalPoses'),
  ];
}

function laneRefs(lane: Lane): Ref[] {
  return [
    { field: 'from', target: 'locations', id: lane.from },
    { field: 'to', target: 'locations', id: lane.to },
  ];
}

function factionRefs(faction: Faction): Ref[] {
  return [
    ...one('factions', faction.parent, 'parent'),
    ...one('factions', faction.umbrella, 'umbrella'),
    ...keys('factions', faction.opinions, 'opinions'),
    ...one('cast', faction.captain, 'captain'),
    ...each('cast', faction.succession, 'succession'),
    ...one('locations', faction.home, 'home'),
  ];
}

function castRefs(cast: CastMember): Ref[] {
  const refs: Ref[] = [
    { field: 'race', target: 'races', id: cast.race },
    { field: 'birthplace', target: 'locations', id: cast.birthplace },
    ...each('cast', cast.ties, 'ties'),
  ];
  cast.keyframes.forEach((k, i) => {
    refs.push({ field: `keyframes[${i}].place`, target: 'locations', id: k.place });
    refs.push(...one('factions', k.affiliation, `keyframes[${i}].affiliation`));
  });
  return refs;
}

function beatEffectRefs(effects: readonly BeatEffect[], base: string): Ref[] {
  const refs: Ref[] = [];
  effects.forEach((e, i) => {
    const at = `${base}[${i}]`;
    if ('place' in e) refs.push({ field: `${at}.place`, target: 'locations', id: e.place });
    if (e.kind === 'affiliation' || e.kind === 'crew' || e.kind === 'faction') {
      refs.push({ field: `${at}.org`, target: 'factions', id: e.org });
    }
    if (e.kind === 'control' && e.org !== null) {
      refs.push({ field: `${at}.org`, target: 'factions', id: e.org });
    }
    if (e.kind === 'faction') {
      refs.push(...one('factions', e.opinion?.toward, `${at}.opinion.toward`));
    }
  });
  return refs;
}

function beatRefs(beat: Beat): Ref[] {
  const refs: Ref[] = [
    { field: 'place', target: 'locations', id: beat.place },
    ...each('canon', beat.requires, 'requires'),
    ...each('canon', beat.dependents, 'dependents'),
    ...beatEffectRefs(beat.outcomes, 'outcomes'),
    ...beatEffectRefs(beat.onDiverge, 'onDiverge'),
  ];
  for (const [name, role] of Object.entries(beat.roles)) {
    refs.push({ field: `roles.${name}.char`, target: 'cast', id: role.char });
    refs.push(...each('cast', role.substitutes, `roles.${name}.substitutes`));
  }
  beat.choices.forEach((c, i) => refs.push(...effectRefs(c.effects, `choices[${i}].effects`)));
  return refs;
}

export function travelRefs(travel: TravelRules): Ref[] {
  return [
    ...each('locations', travel.coating.at, 'coating.at'),
    ...each('locations', travel.logPose.at, 'logPose.at'),
    ...keys('seasons', travel.wind, 'wind'),
    { field: 'carriers.crew', target: 'vessels', id: travel.carriers.crew },
    { field: 'carriers.passenger', target: 'vessels', id: travel.carriers.passenger },
    { field: 'carriers.stowaway', target: 'vessels', id: travel.carriers.stowaway },
    { field: 'carriers.marine', target: 'vessels', id: travel.carriers.marine },
    { field: 'stowaway.eventId', target: 'events', id: travel.stowaway.eventId },
    { field: 'seasickness.trait', target: 'traits', id: travel.seasickness.trait },
  ];
}

export function worldRulesRefs(world: WorldRules): Ref[] {
  const refs: Ref[] = [];
  world.npc.goals.forEach((goal, i) => {
    refs.push(...keys('occupations', goal.occupations, `npc.goals[${i}].occupations`));
  });
  world.npc.actions.forEach((action, i) => {
    refs.push(...keys('npcGoals', action.utility, `npc.actions[${i}].utility`));
  });
  for (const [climate, rules] of Object.entries(world.climates)) {
    refs.push(...keys('illnesses', rules.illness, `climates.${climate}.illness`));
  }
  return refs;
}

export function canonRulesRefs(canon: CanonRules): Ref[] {
  return keys('canonModes', canon.modes, 'modes');
}

function traitRefs(trait: Trait): Ref[] {
  return each('traits', trait.excludes, 'excludes');
}

function raceRefs(race: Race): Ref[] {
  return [
    ...each('traits', race.innateTraits, 'innateTraits'),
    ...one('names', race.namePool, 'namePool'),
    ...keys('heightClasses', race.heights, 'heights'),
    ...keys('appearanceKeys', race.appearanceWeights, 'appearanceWeights'),
  ];
}

function birthplaceRefs(place: Birthplace): Ref[] {
  return [
    { field: 'location', target: 'locations', id: place.location },
    ...each('races', place.races, 'races'),
    ...each('traits', place.traitPool, 'traitPool'),
    ...one('names', place.namePool, 'namePool'),
    ...keys('legacies', place.legacyWeights, 'legacyWeights'),
    ...keys('foci', place.focusWeights, 'focusWeights'),
    ...keys('appearanceKeys', place.appearanceWeights, 'appearanceWeights'),
  ];
}

function legacyRefs(legacy: Legacy): Ref[] {
  return [
    ...one('wealthTiers', legacy.wealthFixed, 'wealthFixed'),
    ...each('traits', legacy.traitPool, 'traitPool'),
    ...one('occupations', legacy.parent?.occupation, 'parent.occupation'),
    ...one('occupations', legacy.guardian?.occupation, 'guardian.occupation'),
    ...keys('foci', legacy.focusWeights, 'focusWeights'),
    ...keys('appearanceKeys', legacy.appearanceWeights, 'appearanceWeights'),
    ...one('events', legacy.chain?.eventId, 'chain.eventId'),
  ];
}

function occupationRefs(occupation: Occupation): Ref[] {
  return [
    ...each('birthplaces', occupation.places, 'places'),
    ...each('races', occupation.races, 'races'),
    ...each('wealthTiers', occupation.wealth, 'wealth'),
  ];
}

function focusRefs(focus: Focus): Ref[] {
  return keys('appearanceKeys', focus.appearanceWeights, 'appearanceWeights');
}

function backstoryRefs(event: BackstoryEvent): Ref[] {
  const c = event.conditions;
  const refs: Ref[] = [
    ...each('races', c.races, 'conditions.races'),
    ...each('races', c.notRaces, 'conditions.notRaces'),
    ...each('birthplaces', c.birthplaces, 'conditions.birthplaces'),
    ...each('legacies', c.legacies, 'conditions.legacies'),
    ...each('foci', c.foci, 'conditions.foci'),
    ...one('wealthTiers', c.wealthMin, 'conditions.wealthMin'),
    ...one('wealthTiers', c.wealthMax, 'conditions.wealthMax'),
    ...each('traits', c.traits, 'conditions.traits'),
    ...each('traits', c.notTraits, 'conditions.notTraits'),
  ];
  event.effects.forEach((effect, i) => {
    if (effect.kind === 'trait') refs.push(...one('traits', effect.trait, `effects[${i}].trait`));
    if (effect.kind === 'relationship')
      refs.push(...one('occupations', effect.occupation, `effects[${i}].occupation`));
  });
  return refs;
}

/** Collections whose items can refer to other content. Weapons and vessels are leaves. */
export const REF_EXTRACTORS: Partial<Record<CollectionKind, (item: never) => Ref[]>> = {
  locations: locationRefs as (item: never) => Ref[],
  lanes: laneRefs as (item: never) => Ref[],
  factions: factionRefs as (item: never) => Ref[],
  cast: castRefs as (item: never) => Ref[],
  canon: beatRefs as (item: never) => Ref[],
  events: eventRefs as (item: never) => Ref[],
  traits: traitRefs as (item: never) => Ref[],
  races: raceRefs as (item: never) => Ref[],
  birthplaces: birthplaceRefs as (item: never) => Ref[],
  legacies: legacyRefs as (item: never) => Ref[],
  occupations: occupationRefs as (item: never) => Ref[],
  foci: focusRefs as (item: never) => Ref[],
  backstory: backstoryRefs as (item: never) => Ref[],
  activities: activityRefs as (item: never) => Ref[],
  jobs: jobRefs as (item: never) => Ref[],
};

export function lifeRefs(life: LifeRules): Ref[] {
  const refs: Ref[] = [
    { field: 'money.collector.eventId', target: 'events', id: life.money.collector.eventId },
    ...keys('traits', life.mortality.traits, 'mortality.traits'),
    ...keys('stages', life.slots, 'slots'),
  ];
  life.injuries.areas.forEach((area, i) => {
    refs.push({ field: `injuries.areas[${i}].scarTrait`, target: 'traits', id: area.scarTrait });
    refs.push(...one('traits', area.lossTrait, `injuries.areas[${i}].lossTrait`));
  });
  life.illnesses.forEach((illness, i) => {
    refs.push(...keys('seasons', illness.seasons, `illnesses[${i}].seasons`));
    refs.push(...keys('stages', illness.stages, `illnesses[${i}].stages`));
  });
  return refs;
}

export function creationRefs(creation: Creation): Ref[] {
  return [
    ...one('canonModes', creation.defaults.canonMode, 'defaults.canonMode'),
    ...one('difficulties', creation.defaults.difficulty, 'defaults.difficulty'),
    ...keys('wealthTiers', creation.wealthRolls.low, 'wealthRolls.low'),
    ...keys('wealthTiers', creation.wealthRolls.medium, 'wealthRolls.medium'),
    ...keys('wealthTiers', creation.wealthRolls.high, 'wealthRolls.high'),
  ];
}

export function appearanceRefs(appearance: Appearance): Ref[] {
  const refs: Ref[] = keys('stages', appearance.ageNouns, 'ageNouns');
  appearance.fields.forEach((field, i) => {
    field.options.forEach((option, j) => {
      refs.push(...each('races', option.races, `fields[${i}].options[${j}].races`));
      refs.push(...each('races', option.notRaces, `fields[${i}].options[${j}].notRaces`));
    });
  });
  return refs;
}

/** The ids each singleton-defined target accepts. */
export function singletonTargets(singletons: {
  creation?: Creation;
  appearance?: Appearance;
  stageIds?: readonly string[];
  life?: LifeRules;
  seasonIds?: readonly string[];
  npcGoalIds?: readonly string[];
}): Partial<Record<RefTarget, Set<string>>> {
  const out: Partial<Record<RefTarget, Set<string>>> = {};
  if (singletons.npcGoalIds) out.npcGoals = new Set(singletons.npcGoalIds);
  const { creation, appearance, life } = singletons;
  if (life) {
    out.severities = new Set(life.injuries.severities.map((s) => s.id));
    out.illnesses = new Set(life.illnesses.map((i) => i.id));
  }
  if (singletons.seasonIds) out.seasons = new Set(singletons.seasonIds);
  if (creation) {
    out.wealthTiers = new Set(creation.wealthTiers.map((t) => t.id));
    out.difficulties = new Set(creation.difficulties.map((d) => d.id));
    out.canonModes = new Set(creation.canonModes.map((m) => m.id));
  }
  if (singletons.stageIds) out.stages = new Set(singletons.stageIds);
  if (appearance) {
    const appearanceKeys = new Set<string>();
    for (const field of appearance.fields) {
      for (const option of field.options) {
        appearanceKeys.add(`${field.id}.${option.id}`);
        for (const tag of option.tags) appearanceKeys.add(`tag:${tag}`);
      }
      if (field.id === 'height') out.heightClasses = new Set(field.options.map((o) => o.id));
    }
    out.appearanceKeys = appearanceKeys;
  }
  return out;
}
