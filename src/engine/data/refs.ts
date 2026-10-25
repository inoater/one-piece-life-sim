import type {
  FightSpec,
  BattleRules,
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
  FruitDef,
  Job,
  Lane,
  Legacy,
  LifeEffect,
  LifeRules,
  Location,
  Requires,
  Risk,
  Moveset,
  Occupation,
  PersonalityRules,
  PowerRules,
  Race,
  Technique,
  Track,
  Trait,
  TravelRules,
  WorldRules,
  HandsRules,
  ItemDef,
  Recipe,
  ShipRules,
  Weapon,
} from './schemas';
import type { ShipDesign } from './defs';

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
  | 'npcGoals'
  // Phase 4
  | 'axes'
  | 'driftTags'
  | 'counters'
  | 'groups'
  | 'primitives'
  | 'immunities'
  // Phase 5
  | 'foes'
  | 'contests'
  // Phase 6
  | 'goods'
  | 'shipHulls'
  | 'shipMaterials'
  | 'shipRigs'
  | 'shipDrives'
  | 'shipRooms'
  | 'shipWeapons'
  | 'shipFigureheads';

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
  fruits: 'Devil Fruit',
  tracks: 'power track',
  techniques: 'technique',
  movesets: 'canon moveset',
  axes: 'personality axis',
  driftTags: 'personality tag',
  counters: 'behaviour counter',
  groups: 'opinion group',
  primitives: 'power primitive',
  immunities: 'immunity ("seasickness" or an illness)',
  foes: 'foe',
  contests: 'contest',
  items: 'item',
  recipes: 'recipe',
  goods: 'trade good',
  shipHulls: 'hull',
  shipMaterials: 'hull material',
  shipRigs: 'rig',
  shipDrives: 'drive',
  shipRooms: 'room',
  shipWeapons: 'ship weapon',
  shipFigureheads: 'figurehead',
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
  fruits: 'data/fruits/',
  tracks: 'data/tracks/',
  techniques: 'data/techniques/',
  movesets: 'data/movesets/',
  axes: 'data/personality.json (axes)',
  driftTags: 'data/personality.json (tags)',
  counters: 'data/personality.json (counters)',
  groups: 'data/personality.json (groups)',
  primitives: 'data/powers.json (primitives)',
  immunities: 'data/life.json (illnesses), or "seasickness"',
  foes: 'data/battle.json (foes)',
  contests: 'data/battle.json (contests)',
  items: 'data/items/',
  recipes: 'data/recipes/',
  goods: 'data/hands.json (goods)',
  shipHulls: 'data/ships.json (hulls)',
  shipMaterials: 'data/ships.json (materials)',
  shipRigs: 'data/ships.json (rigs)',
  shipDrives: 'data/ships.json (drives)',
  shipRooms: 'data/ships.json (rooms)',
  shipWeapons: 'data/ships.json (weapons)',
  shipFigureheads: 'data/ships.json (figureheads)',
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
      case 'findItem':
        if (effect.item?.startsWith('weapon_'))
          refs.push({ field: `${at}.item`, target: 'weapons', id: effect.item });
        else refs.push(...one('items', effect.item, `${at}.item`));
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
      // Phase 4
      case 'drift':
        refs.push(...each('driftTags', effect.tags, `${at}.tags`));
        break;
      case 'behaviour':
        refs.push({ field: `${at}.counter`, target: 'counters', id: effect.counter });
        break;
      case 'loseTrait':
        refs.push({ field: `${at}.trait`, target: 'traits', id: effect.trait });
        break;
      case 'powerPoints':
      case 'powerBreakthrough':
        refs.push(...one('tracks', effect.track, `${at}.track`));
        break;
      case 'learnTrack':
        refs.push({ field: `${at}.track`, target: 'tracks', id: effect.track });
        break;
      case 'findFruit':
        refs.push(...one('fruits', effect.fruit, `${at}.fruit`));
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
      // Phase 4
      case 'track':
      case 'notTrack':
        refs.push({ field: `${at}.track`, target: 'tracks', id: condition.track });
        break;
      case 'personality':
        refs.push({ field: `${at}.axis`, target: 'axes', id: condition.axis });
        break;
      case 'counter':
        refs.push({ field: `${at}.counter`, target: 'counters', id: condition.counter });
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
    ...keys('tracks', req.tracks, `${base}.tracks`),
  ];
  req.anyOf.forEach((alt, i) => {
    refs.push(
      ...each('races', alt.races, `${base}.anyOf[${i}].races`),
      ...each('races', alt.notRaces, `${base}.anyOf[${i}].notRaces`),
      ...each('traits', alt.anyTraits, `${base}.anyOf[${i}].anyTraits`),
      ...each('traits', alt.notTraits, `${base}.anyOf[${i}].notTraits`),
      ...keys('tracks', alt.tracks, `${base}.anyOf[${i}].tracks`),
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
    ...each('tracks', act.practice?.tracks ?? [], 'practice.tracks'),
    ...one('foes', act.fight?.foe, 'fight.foe'),
    ...one('contests', act.fight?.contest, 'fight.contest'),
  ];
}

/** An event's or a beat's fight (Phase 5): its foes, contest, ship, commanders and bands. */
function fightRefs(fight: FightSpec, base: string): Ref[] {
  const refs: Ref[] = [];
  fight.foes.forEach((f, i) => {
    if (f.kind === 'foe') refs.push({ field: `${base}.foes[${i}].foe`, target: 'foes', id: f.foe });
    if (f.kind === 'cast')
      refs.push({ field: `${base}.foes[${i}].char`, target: 'cast', id: f.char });
  });
  refs.push(...one('contests', fight.contest, `${base}.contest`));
  refs.push(...one('vessels', fight.ship?.vessel, `${base}.ship.vessel`));
  fight.fronts.forEach((fr, i) => {
    refs.push(...one('cast', fr.mine.commander, `${base}.fronts[${i}].mine.commander`));
    refs.push(...one('cast', fr.theirs.commander, `${base}.fronts[${i}].theirs.commander`));
  });
  for (const band of [
    'criticalSuccess',
    'success',
    'failure',
    'criticalFailure',
    'fled',
  ] as const) {
    const b = fight[band];
    if (b) refs.push(...effectRefs(b.effects, `${base}.${band}.effects`));
  }
  return refs;
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
    if (choice.fight) refs.push(...fightRefs(choice.fight, `choices[${i}].fight`));
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
    ...each('traits', cast.traits, 'traits'),
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
  beat.choices.forEach((c, i) => {
    refs.push(...effectRefs(c.effects, `choices[${i}].effects`));
    if (c.fight) refs.push(...fightRefs(c.fight, `choices[${i}].fight`));
  });
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
  const refs: Ref[] = [
    ...each('traits', trait.excludes, 'excludes'),
    ...trait.locks.map((l, i) => ({
      field: `locks[${i}].activity`,
      target: 'activities' as const,
      id: l.activity,
    })),
    ...each('immunities', trait.immunities, 'immunities'),
    ...trait.opinion.map((o, i) => ({
      field: `opinion[${i}].group`,
      target: 'groups' as const,
      id: o.group,
    })),
    ...one('axes', trait.drift?.axis, 'drift.axis'),
    ...keys('counters', trait.earn?.counters ?? {}, 'earn.counters'),
  ];
  if (trait.evolves) {
    refs.push({ field: 'evolves.to', target: 'traits', id: trait.evolves.to });
    refs.push(...keys('counters', trait.evolves.when.counters, 'evolves.when.counters'));
  }
  for (const key of Object.keys(trait.powerMods)) {
    if (key.startsWith('track_'))
      refs.push({ field: `powerMods.${key}`, target: 'tracks', id: key });
  }
  return refs;
}

// ---- Powers (Phase 4) -------------------------------------------------------------------------

function trackRefs(track: Track): Ref[] {
  const refs: Ref[] = [
    ...requiresRefs(track.learn.requires, 'learn.requires'),
    ...keys('races', track.learn.raceRates, 'learn.raceRates'),
    ...each('tracks', track.learn.opens, 'learn.opens'),
  ];
  track.learn.teachers.forEach((t, i) => {
    const at = `learn.teachers[${i}]`;
    refs.push(...each('locations', t.places, `${at}.places`));
    refs.push(...requiresRefs(t.requires, `${at}.requires`));
    refs.push(...one('occupations', t.occupation, `${at}.occupation`));
  });
  track.stages.forEach((stage, i) => {
    const at = `stages[${i}]`;
    refs.push(...each('techniques', stage.techniques, `${at}.techniques`));
    refs.push(...keys('tracks', stage.requires.tracks, `${at}.requires.tracks`));
    refs.push(...each('locations', stage.requires.places, `${at}.requires.places`));
    refs.push(...each('traits', stage.requires.anyTraits, `${at}.requires.anyTraits`));
    refs.push(...each('traits', stage.requires.notTraits, `${at}.requires.notTraits`));
    refs.push(...each('races', stage.requires.races, `${at}.requires.races`));
  });
  track.ceilings.forEach((c, i) => {
    refs.push(...each('races', c.races, `ceilings[${i}].races`));
    refs.push(...each('traits', c.traits, `ceilings[${i}].traits`));
  });
  return refs;
}

function techniqueRefs(tech: Technique): Ref[] {
  return one('tracks', tech.stage?.track, 'stage.track');
}

function movesetRefs(moveset: Moveset): Ref[] {
  const refs: Ref[] = [{ field: 'char', target: 'cast', id: moveset.char }];
  moveset.eras.forEach((era, i) => refs.push(...keys('tracks', era.tracks, `eras[${i}].tracks`)));
  return refs;
}

function fruitRefs(fruit: FruitDef): Ref[] {
  const refs: Ref[] = [
    ...each('primitives', fruit.primitives, 'primitives'),
    ...one('locations', fruit.start?.place, 'start.place'),
  ];
  fruit.holders.forEach((h, i) => refs.push(...one('cast', h.char, `holders[${i}].char`)));
  return refs;
}

export function powerRulesRefs(powers: PowerRules): Ref[] {
  const refs: Ref[] = [
    { field: 'haki.kingsQualitiesTrait', target: 'traits', id: powers.haki.kingsQualitiesTrait },
    { field: 'haki.voiceTrait', target: 'traits', id: powers.haki.voiceTrait },
    { field: 'fruit.cursedTrait', target: 'traits', id: powers.fruit.cursedTrait },
  ];
  powers.fruit.bodies.forEach((b, i) =>
    refs.push({ field: `fruit.bodies[${i}].place`, target: 'locations', id: b.place }),
  );
  for (const key of Object.keys(powers.generator.grammars)) {
    if (key !== 'default')
      refs.push({ field: `generator.grammars.${key}`, target: 'birthplaces', id: key });
  }
  return refs;
}

/** data/battle.json (Phase 5): the techniques foes know, the traits that make someone take a blow. */
export function battleRulesRefs(battle: BattleRules): Ref[] {
  const refs: Ref[] = [
    ...keys('traits', battle.protect.traits, 'protect.traits'),
    ...keys('techniques', battle.overdrive.techniques, 'overdrive.techniques'),
  ];
  battle.foes.forEach((f, i) =>
    refs.push(...each('techniques', f.techniques, `foes[${i}].techniques`)),
  );
  return refs;
}

export function personalityRefs(rules: PersonalityRules): Ref[] {
  const refs: Ref[] = [];
  for (const [tag, rule] of Object.entries(rules.tags)) {
    refs.push({ field: `tags.${tag}.axis`, target: 'axes', id: rule.axis });
  }
  rules.counters.forEach((c, i) =>
    refs.push(...each('activities', c.activities, `counters[${i}].activities`)),
  );
  for (const [name, group] of Object.entries(rules.groups)) {
    refs.push(...each('occupations', group.occupations, `groups.${name}.occupations`));
    refs.push(...each('races', group.races, `groups.${name}.races`));
  }
  return refs;
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
  return [
    ...keys('appearanceKeys', focus.appearanceWeights, 'appearanceWeights'),
    ...keys('tracks', focus.tracks, 'tracks'),
  ];
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
function weaponRefs(w: Weapon): Ref[] {
  const refs: Ref[] = [];
  w.canon?.holders.forEach((h, i) => {
    refs.push(...one('cast', h.holder, `canon.holders[${i}].holder`));
    refs.push(...one('locations', h.place, `canon.holders[${i}].place`));
  });
  return refs;
}

function itemRefs(item: ItemDef): Ref[] {
  return [...each('locations', item.places, 'places'), ...designRefs(item.design, 'design')];
}

/** A ship design's parts must exist in data/ships.json. */
function designRefs(design: ShipDesign | undefined, base: string): Ref[] {
  if (!design) return [];
  return [
    { field: `${base}.hull`, target: 'shipHulls', id: design.hull },
    { field: `${base}.material`, target: 'shipMaterials', id: design.material },
    { field: `${base}.rig`, target: 'shipRigs', id: design.rig },
    ...each('shipDrives', design.drives, `${base}.drives`),
    ...each('shipRooms', design.rooms, `${base}.rooms`),
    ...keys('shipWeapons', design.weapons, `${base}.weapons`),
    { field: `${base}.figurehead`, target: 'shipFigureheads', id: design.figurehead },
  ];
}

function recipeRefs(r: Recipe): Ref[] {
  return [
    ...one('weapons', r.makes.weapon, 'makes.weapon'),
    ...one('items', r.makes.item, 'makes.item'),
    ...each('locations', r.places, 'places'),
    ...keys('goods', r.goods, 'goods'),
    ...requiresRefs(r.requires, 'requires'),
  ];
}

export function handsRulesRefs(hands: HandsRules): Ref[] {
  const refs: Ref[] = [
    ...each('locations', hands.temper.places, 'temper.places'),
    ...keys('locations', hands.swords.places, 'swords.places'),
    ...each('occupations', hands.swords.occupations, 'swords.occupations'),
    ...each('locations', hands.vivre.places, 'vivre.places'),
    ...each('races', hands.treasure.divers, 'treasure.divers'),
  ];
  for (const [id, curse] of Object.entries(hands.curses))
    refs.push(...each('locations', curse.tame.places, `curses.${id}.tame.places`));
  hands.treasure.canon.forEach((t, i) =>
    refs.push({ field: `treasure.canon[${i}].place`, target: 'locations', id: t.place }),
  );
  hands.schools.forEach((s, i) =>
    refs.push({ field: `schools[${i}].place`, target: 'locations', id: s.place }),
  );
  for (const [occ, weapon] of Object.entries(hands.npcWeapons)) {
    refs.push({ field: `npcWeapons.${occ}`, target: 'occupations', id: occ });
    refs.push({ field: `npcWeapons.${occ}`, target: 'weapons', id: weapon });
  }
  return refs;
}

export function shipRulesRefs(ships: ShipRules): Ref[] {
  const refs: Ref[] = [];
  ships.hulls.forEach((h, i) =>
    refs.push({ field: `hulls[${i}].vessel`, target: 'vessels', id: h.vessel }),
  );
  ships.materials.forEach((m, i) => refs.push(...one('items', m.needs, `materials[${i}].needs`)));
  ships.drives.forEach((d, i) => refs.push(...one('items', d.needs, `drives[${i}].needs`)));
  refs.push(...keys('locations', ships.yards.places, 'yards.places'));
  for (const [rank, design] of Object.entries(ships.standard))
    refs.push(...designRefs(design, `standard.${rank}`));
  return refs;
}

export const REF_EXTRACTORS: Partial<Record<CollectionKind, (item: never) => Ref[]>> = {
  weapons: weaponRefs as (item: never) => Ref[],
  items: itemRefs as (item: never) => Ref[],
  recipes: recipeRefs as (item: never) => Ref[],
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
  tracks: trackRefs as (item: never) => Ref[],
  techniques: techniqueRefs as (item: never) => Ref[],
  movesets: movesetRefs as (item: never) => Ref[],
  fruits: fruitRefs as (item: never) => Ref[],
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
  personality?: PersonalityRules;
  powers?: PowerRules;
  battle?: BattleRules;
  hands?: HandsRules;
  ships?: ShipRules;
}): Partial<Record<RefTarget, Set<string>>> {
  const out: Partial<Record<RefTarget, Set<string>>> = {};
  if (singletons.npcGoalIds) out.npcGoals = new Set(singletons.npcGoalIds);
  const { creation, appearance, life, personality, powers } = singletons;
  if (life) {
    out.severities = new Set(life.injuries.severities.map((s) => s.id));
    out.illnesses = new Set(life.illnesses.map((i) => i.id));
    out.immunities = new Set(['seasickness', ...life.illnesses.map((i) => i.id)]);
  }
  if (personality) {
    out.axes = new Set(personality.axes.map((a) => a.id));
    out.driftTags = new Set(Object.keys(personality.tags));
    out.counters = new Set(personality.counters.map((c) => c.id));
    out.groups = new Set(['everyone', ...Object.keys(personality.groups)]);
  }
  if (powers) out.primitives = new Set(powers.primitives.map((p) => p.id));
  if (singletons.battle) {
    out.foes = new Set(singletons.battle.foes.map((f) => f.id));
    out.contests = new Set(singletons.battle.contests.map((c) => c.id));
  }
  if (singletons.hands) out.goods = new Set(singletons.hands.goods.map((g) => g.id));
  const ships = singletons.ships;
  if (ships) {
    out.shipHulls = new Set(ships.hulls.map((x) => x.id));
    out.shipMaterials = new Set(ships.materials.map((x) => x.id));
    out.shipRigs = new Set(ships.rigs.map((x) => x.id));
    out.shipDrives = new Set(ships.drives.map((x) => x.id));
    out.shipRooms = new Set(ships.rooms.map((x) => x.id));
    out.shipWeapons = new Set(ships.weapons.map((x) => x.id));
    out.shipFigureheads = new Set(ships.figureheads.map((x) => x.id));
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
