import type { FactKind, GameData } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { Entity, Fact, WorldState } from '../../engine/state';
import { axisValue, relOf } from './bonds';
import { ensureHeart, heartOf } from './profile';
import { locations, shortestMiles } from '../places/graph';
import { locationIdOf, prosperityOf } from '../places/place';
import { caches } from '../hands/treasure';

/**
 * Knowledge that flows through talk (Phase 7, rule 4). An answer is a claim with a truth value:
 * a deceitful person may lie, and a rumour may be wrong. The player keeps every claim with who
 * told it; the truth is never shown unless they find out (by going and looking) or the view is
 * omniscient.
 */

const DIRECTIONS = ['smithy', 'doctor', 'shipyard', 'dojo', 'library', 'market', 'arena'] as const;
const FEATURE_WORDS: Record<(typeof DIRECTIONS)[number], string> = {
  smithy: 'a good smith',
  doctor: 'a doctor',
  shipyard: 'a shipyard',
  dojo: 'a dojo',
  library: 'a library',
  market: 'a proper market',
  arena: 'a fighting arena',
};

const FACT_OF: Readonly<Record<string, FactKind>> = {
  int_ask_person: 'person',
  int_interrogate: 'person',
  int_ask_place: 'place',
  int_ask_rumour: 'rumour',
  int_ask_fruit: 'fruit',
  int_ask_treasure: 'treasure',
  int_ask_directions: 'directions',
};

/** What an information intent asks about (null: it asks nothing). */
export const factKindOf = (intentId: string): FactKind | null => FACT_OF[intentId] ?? null;

/** Do they lie to the player this time? Deceitful people often do, and anyone who hates them. */
export function willLie(
  state: WorldState,
  data: GameData,
  player: Entity,
  other: Entity,
  rng: Rng,
): boolean {
  const heart = heartOf(other);
  const honest = heart?.profile.axes['honest'] ?? 0;
  const trust = axisValue(data, relOf(other, player.id), 'trust', state.tick);
  const rules = data.heart.talk;
  if (honest < rules.lieBelow) return rng.chance(rules.lieChance);
  if (honest < 0 && trust < -20) return rng.chance(rules.lieChance / 2);
  return false;
}

interface Claim {
  text: string;
  about: string | null;
  place: string | null;
}

function placeName(data: GameData, id: string | null): string {
  return id ? (data.locations[id]?.name ?? 'somewhere') : 'at sea';
}

function otherPlace(data: GameData, not: string | null, rng: Rng): string {
  const pool = locations(data).filter((l) => l.id !== not);
  return rng.pick(pool).id;
}

function personClaim(data: GameData, topic: Entity, lie: boolean, rng: Rng): Claim {
  const c = topic.character;
  if (!c) return { text: `nobody knows ${topic.name}`, about: topic.id, place: null };
  const truthPlace = c.alive ? locationIdOf(data, c) : null;
  if (lie) {
    const place = otherPlace(data, truthPlace, rng);
    return { text: `${topic.name} is in ${placeName(data, place)}`, about: topic.id, place };
  }
  if (!c.alive) return { text: `${topic.name} is dead`, about: topic.id, place: null };
  if (truthPlace === null) return { text: `${topic.name} is at sea`, about: topic.id, place: null };
  return {
    text: `${topic.name} is in ${placeName(data, truthPlace)}`,
    about: topic.id,
    place: truthPlace,
  };
}

function placeClaim(
  state: WorldState,
  data: GameData,
  place: string,
  lie: boolean,
  rng: Rng,
): Claim {
  const loc = data.locations[place];
  const holder = state.entities[place]?.place?.controller;
  const factions = Object.values(data.factions).filter((f) => f.id !== holder);
  const said =
    lie && factions.length > 0
      ? rng.pick(factions).name
      : holder
        ? (data.factions[holder]?.name ?? 'nobody')
        : 'nobody in particular';
  const prosper = prosperityOf(state, data, place);
  const words = (p: number) => (p >= 65 ? 'doing well' : p >= 40 ? 'getting by' : 'struggling');
  const mood = lie ? words(prosper >= 50 ? 20 : 80) : words(prosper);
  return {
    text: `${loc?.name ?? 'That place'} is held by ${said}, and ${mood}`,
    about: null,
    place,
  };
}

function rumourClaim(state: WorldState, data: GameData, lie: boolean, rng: Rng): Claim {
  const wild = Object.values(state.entities)
    .filter((e) => e.fruit && !e.fruit.userId && !e.fruit.holderId && e.fruit.place)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const fruit = wild.length > 0 ? rng.fork('fruit').pick(wild) : undefined;
  if (!fruit || lie) {
    const place = otherPlace(data, fruit?.fruit?.place ?? null, rng.fork('where'));
    return {
      text: `a strange swirled fruit turned up in ${placeName(data, place)}`,
      about: null,
      place,
    };
  }
  const place = fruit.fruit?.place ?? null;
  return {
    text: `a strange swirled fruit turned up in ${placeName(data, place)}`,
    about: fruit.id,
    place,
  };
}

function fruitClaim(state: WorldState, data: GameData, lie: boolean, rng: Rng): Claim {
  const eaten = Object.values(state.entities)
    .filter((e) => e.fruit?.userId && state.entities[e.fruit.userId]?.character?.alive)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const fruit = eaten.length > 0 ? rng.fork('fruit').pick(eaten) : undefined;
  if (!fruit?.fruit?.userId) return rumourClaim(state, data, lie, rng);
  const users = Object.values(state.entities).filter(
    (e) =>
      e.character?.alive && e.id !== fruit.fruit?.userId && e.type === 'character' && e.tier === 1,
  );
  const user =
    lie && users.length > 0 ? rng.fork('user').pick(users) : state.entities[fruit.fruit.userId];
  return { text: `${user?.name ?? 'someone'} ate the ${fruit.name}`, about: fruit.id, place: null };
}

function treasureClaim(state: WorldState, data: GameData, lie: boolean, rng: Rng): Claim {
  const hidden = caches(state).filter(
    (e) =>
      e.item?.container === 'buried' ||
      e.item?.container === 'sunken' ||
      e.item?.container === 'ruins',
  );
  const cache = hidden.length > 0 ? rng.fork('cache').pick(hidden) : undefined;
  const truth = cache?.item?.place ?? null;
  const place = lie || !truth ? otherPlace(data, truth, rng.fork('where')) : truth;
  return {
    text: `there is treasure ${cache?.item?.container === 'sunken' ? 'in a wreck off' : 'buried on'} ${placeName(data, place)}`,
    about: lie ? null : (cache?.id ?? null),
    place,
  };
}

function directionsClaim(data: GameData, here: string | null, lie: boolean, rng: Rng): Claim {
  const feature = rng.fork('feature').pick(DIRECTIONS);
  const all = locations(data);
  const having = all.filter((l) => l.features.includes(feature) && l.id !== here);
  const nearest = here
    ? having.sort(
        (a, b) =>
          shortestMiles(data, here, a.id) - shortestMiles(data, here, b.id) ||
          (a.id < b.id ? -1 : 1),
      )[0]
    : having[0];
  const lacking = all.filter((l) => !l.features.includes(feature) && l.id !== here);
  const place =
    lie && lacking.length > 0 ? rng.fork('wrong').pick(lacking).id : (nearest?.id ?? null);
  return {
    text: `the nearest place with ${FEATURE_WORDS[feature]} is ${placeName(data, place)}`,
    about: null,
    place,
  };
}

/** A secret of theirs: what they fear, or what they cannot resist. Always true. */
export function secretClaim(other: Entity, rng: Rng): Claim {
  const heart = heartOf(other);
  const soft = heart?.profile.softSpot;
  const softWords = soft && soft.includes('_') ? null : soft;
  return rng.chance(0.5) || !softWords
    ? {
        text: `${other.name} is afraid of ${heart?.profile.fear ?? 'the dark'}`,
        about: other.id,
        place: null,
      }
    : { text: `${other.name} cannot resist ${softWords}`, about: other.id, place: null };
}

export interface ToldFact {
  fact: Fact;
  /** Words for {fact}. */
  text: string;
}

/**
 * What someone tells the player when asked: true, or (if they lie) false, kept in the player's
 * knowledge with its source. `forceTruth`: pressed hard enough, they cannot lie.
 */
export function tellFact(
  state: WorldState,
  data: GameData,
  player: Entity,
  other: Entity,
  kind: FactKind | 'secret',
  topic: string | undefined,
  rng: Rng,
  forceTruth = false,
): ToldFact {
  const lie =
    kind !== 'secret' && !forceTruth && willLie(state, data, player, other, rng.fork('lie?'));
  const here = player.character ? locationIdOf(data, player.character) : null;
  const subject = topic ? state.entities[topic] : undefined;
  const claim: Claim =
    kind === 'secret'
      ? secretClaim(other, rng.fork('secret'))
      : kind === 'person' && subject?.character
        ? personClaim(data, subject, lie, rng.fork('person'))
        : kind === 'place'
          ? placeClaim(
              state,
              data,
              topic && topic in data.locations ? topic : (here ?? otherPlace(data, null, rng)),
              lie,
              rng.fork('place'),
            )
          : kind === 'fruit'
            ? fruitClaim(state, data, lie, rng.fork('fruit'))
            : kind === 'treasure'
              ? treasureClaim(state, data, lie, rng.fork('treasure'))
              : kind === 'directions'
                ? directionsClaim(data, here, lie, rng.fork('directions'))
                : rumourClaim(state, data, lie, rng.fork('rumour'));
  const heart = ensureHeart(state, data, player);
  heart.facts ??= [];
  const id = (heart.facts[heart.facts.length - 1]?.id ?? 0) + 1;
  const fact: Fact = {
    id,
    tick: state.tick,
    kind: kind === 'secret' ? 'person' : kind,
    about: claim.about,
    text: claim.text,
    place: claim.place,
    truth: !lie,
    from: other.id,
  };
  heart.facts.push(fact);
  if (heart.facts.length > 60) heart.facts.splice(0, heart.facts.length - 60);
  // A rumour of a fruit joins the Devil Fruit page's rumours, true or not (Phase 4's search).
  if ((kind === 'rumour' || kind === 'fruit') && claim.place && player.character?.powers) {
    player.character.powers.rumours.push({
      tick: state.tick,
      fruitId: lie ? null : claim.about,
      name: 'a strange swirled fruit',
      place: claim.place,
    });
  }
  return { fact, text: claim.text };
}

/**
 * The player stands where a claim about someone said they would be: is it so? A lie found out
 * costs the teller the player's trust; the truth confirmed earns a little.
 */
export function checkFacts(
  state: WorldState,
  data: GameData,
  player: Entity,
  onFound: (fact: Fact, teller: Entity | undefined, truthful: boolean) => void,
): void {
  const heart = player.character?.heart;
  const here = player.character ? locationIdOf(data, player.character) : null;
  if (!heart?.facts || !here) return;
  for (const fact of heart.facts) {
    if (fact.checked || fact.place !== here) continue;
    let truthful: boolean | null = null;
    if (fact.kind === 'person' && fact.about) {
      const person = state.entities[fact.about];
      if (!person?.character) continue;
      const there = person.character.alive && locationIdOf(data, person.character) === here;
      // A true claim may have gone stale (they moved on): only a lie is "found out".
      truthful = there ? true : fact.truth ? null : false;
    } else if (fact.kind === 'directions' || fact.kind === 'treasure' || fact.kind === 'rumour') {
      truthful = fact.truth ? (fact.kind === 'directions' ? true : null) : false;
    }
    if (truthful === null) continue;
    fact.checked = truthful ? 'confirmed' : 'false';
    onFound(fact, state.entities[fact.from], truthful);
  }
}
