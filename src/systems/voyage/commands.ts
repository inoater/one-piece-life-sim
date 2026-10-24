import type { CaptainOrder, GameData, TravelMode } from '../../engine/data/schemas';
import { createEntity } from '../../engine/entities';
import { Rng } from '../../engine/rng';
import { PUBLIC_KNOWLEDGE, type Entity, type WorldState } from '../../engine/state';
import { makeStat } from '../../engine/stats';
import { killCharacter } from '../canon/cast';
import { formatBerries } from '../genesis/text';
import { ensureLife } from '../life/body';
import { lifeLog, pay, renderLife, reportLine, type LifeEnv } from '../life/env';
import { priceMult } from '../places/place';
import { shipHere, shipsOf } from './plan';
import { ensureTravel, setSail, TravelError } from './sea';

/**
 * What the player can do about travel between months (Phase 3): set sail, give the captain's
 * order, and, in port, buy, crew, stock, repair and coat a ship, or buy a Log Pose or an Eternal
 * Pose. Each checks the same rules the views show, and throws with the reason when it cannot.
 */

function commandEnv(state: WorldState, data: GameData, what: string): LifeEnv {
  const p = ensureLife(state, data);
  if (!p?.c.life) throw new TravelError('Nobody alive is being played');
  return {
    state,
    data,
    tick: state.tick,
    rng: Rng.root(state.seed).fork('command', what, state.counters.logSeq),
    p,
    life: p.c.life,
    cause: `action:${what}`,
  };
}

function ashore(env: LifeEnv): string {
  const here = env.p.place.location?.id;
  if (!here || env.p.place.atSea) throw new TravelError('Not while at sea');
  return here;
}

function charge(env: LifeEnv, amount: number, what: string): void {
  if (env.p.c.berries < amount) {
    throw new TravelError(
      `${what} costs ${formatBerries(amount)} Berries (you have ${formatBerries(env.p.c.berries)})`,
    );
  }
  pay(env, -amount);
}

function say(env: LifeEnv, template: string, vars: Record<string, string>, chronicle = true): void {
  const text = renderLife(env, template, vars);
  if (chronicle) lifeLog(env, text, { tags: ['personal', 'voyage', 'money'] });
  reportLine(env, text, 'plain');
}

function myShip(env: LifeEnv): Entity {
  const ship = shipHere(env.state, env.p);
  if (!ship?.ship) throw new TravelError('You have no ship moored here');
  return ship;
}

function shipWords(name: string): string {
  return name.replace(/^the /, '');
}

export function sail(state: WorldState, data: GameData, lane: string, mode: TravelMode): void {
  const env = commandEnv(state, data, 'travel/sail');
  setSail(env, lane, mode);
}

export function giveOrder(state: WorldState, data: GameData, order: CaptainOrder): void {
  const env = commandEnv(state, data, 'travel/order');
  const voyage = env.p.c.travel?.voyage;
  if (!voyage) throw new TravelError('You are not at sea');
  if (voyage.mode !== 'own') throw new TravelError('Only the captain gives orders');
  voyage.order = order;
  say(env, data.travel.lines.order, { title: data.travel.orders[order].name.toLowerCase() }, false);
}

export function buyShip(state: WorldState, data: GameData, vesselId: string): void {
  const env = commandEnv(state, data, 'travel/buyShip');
  const here = ashore(env);
  const vessel = data.vessels[vesselId];
  if (!vessel || vessel.cost === null) throw new TravelError('That ship is not for sale');
  if (!env.p.place.features.includes(vessel.soldAt)) {
    throw new TravelError(`Nobody here sells a ${vessel.name.toLowerCase()}`);
  }
  if (shipsOf(state, env.p.entity.id).length > 0) throw new TravelError('You already own a ship');
  const cost = Math.round(vessel.cost * priceMult(state, data, here));
  charge(env, cost, `A ${vessel.name.toLowerCase()}`);
  const name = env.rng.fork('name').pick(data.travel.shipNames);
  const ship = createEntity(state, {
    type: 'ship',
    origin: 'player',
    name,
    tier: 1,
    stats: {
      speed: makeStat(vessel.speed),
      hull: makeStat(vessel.hull),
      cargo: makeStat(vessel.cargo),
    },
    knownBy: [PUBLIC_KNOWLEDGE],
  });
  ship.ship = {
    vessel: vessel.id,
    ownerId: env.p.entity.id,
    place: here,
    hull: vessel.hull,
    crew: 0,
    morale: data.travel.morale.start,
    supplies: 0,
    coated: vessel.tags.includes('coated'),
    sunk: false,
  };
  ensureTravel(data, env.p);
  say(env, data.travel.lines.bought, {
    title: `a ${vessel.name.toLowerCase()}`,
    ship: shipWords(name),
  });
}

export function sellShip(state: WorldState, data: GameData): void {
  const env = commandEnv(state, data, 'travel/sellShip');
  const here = ashore(env);
  const ship = myShip(env);
  const vessel = data.vessels[ship.ship?.vessel ?? ''];
  const s = ship.ship;
  if (!vessel || !s) throw new TravelError('That ship cannot be sold');
  const worth = Math.round(
    ((vessel.cost ?? 0) / 2) * (s.hull / vessel.hull) * priceMult(state, data, here),
  );
  pay(env, worth);
  s.ownerId = null;
  s.crew = 0;
  const text = `You sold the ${shipWords(ship.name)} for ${formatBerries(worth)} Berries.`;
  lifeLog(env, text, { tags: ['personal', 'voyage', 'money'] });
  reportLine(env, text, 'good');
}

export function hireHands(state: WorldState, data: GameData, count: number): void {
  const env = commandEnv(state, data, 'travel/hire');
  ashore(env);
  if (!env.p.place.features.includes('docks'))
    throw new TravelError('There are no docks here to hire hands from');
  const ship = myShip(env);
  const s = ship.ship;
  const vessel = data.vessels[s?.vessel ?? ''];
  if (!s || !vessel) throw new TravelError('You have no ship here');
  if (s.crew + count + 1 > vessel.maxCrew) {
    throw new TravelError(`The ${shipWords(ship.name)} holds at most ${vessel.maxCrew} with you`);
  }
  charge(env, data.travel.hireCost * count, `Signing on ${count} hands`);
  s.crew += count;
  say(env, data.travel.lines.hired, { amount: String(count) });
}

export function dismissHands(state: WorldState, data: GameData, count: number): void {
  const env = commandEnv(state, data, 'travel/dismiss');
  ashore(env);
  const s = myShip(env).ship;
  if (!s) throw new TravelError('You have no ship here');
  s.crew = Math.max(0, s.crew - count);
  reportLine(env, `You paid off ${count} hands.`, 'plain');
}

/** Person-months of stores a ship can carry. */
export function supplyCapacity(data: GameData, ship: Entity): number {
  const cargo = ship.stats['cargo']?.base ?? data.vessels[ship.ship?.vessel ?? '']?.cargo ?? 0;
  return Math.floor(cargo * data.travel.provisions.perCargo);
}

/** Stock the ship for `months` months for everyone aboard (up to what the hold takes). */
export function provision(state: WorldState, data: GameData, months: number): void {
  const env = commandEnv(state, data, 'travel/provision');
  const here = ashore(env);
  if (!env.p.place.features.includes('market') && !env.p.place.features.includes('docks')) {
    throw new TravelError('There is nowhere to buy stores here');
  }
  const ship = myShip(env);
  const s = ship.ship;
  if (!s) throw new TravelError('You have no ship here');
  const wanted = months * (s.crew + 1);
  const room = Math.max(0, supplyCapacity(data, ship) - s.supplies);
  const amount = Math.min(wanted, room);
  if (amount <= 0) throw new TravelError('The hold is full');
  const cost = Math.round(
    amount * data.travel.provisions.costPerMonth * priceMult(state, data, here),
  );
  charge(env, cost, 'Those stores');
  s.supplies = Math.round((s.supplies + amount) * 10) / 10;
  say(env, data.travel.lines.provisioned, {
    amount: String(Math.round((amount / (s.crew + 1)) * 10) / 10),
    ship: shipWords(ship.name),
  });
}

export function repairShip(state: WorldState, data: GameData): void {
  const env = commandEnv(state, data, 'travel/repair');
  const here = ashore(env);
  const ship = myShip(env);
  const s = ship.ship;
  const vessel = data.vessels[s?.vessel ?? ''];
  if (!s || !vessel) throw new TravelError('You have no ship here');
  const yard = env.p.place.features.includes('shipyard');
  if (!yard && !env.p.place.features.includes('docks'))
    throw new TravelError('There is nobody here to repair a ship');
  const damage = vessel.hull - s.hull;
  if (damage <= 0) throw new TravelError('She needs no repairs');
  const fixed = yard ? damage : Math.ceil(damage / 2);
  const rate = data.travel.repair.perHull * (yard ? 1 : data.travel.repair.docksMult);
  charge(env, Math.round(fixed * rate * priceMult(state, data, here)), 'The repairs');
  s.hull += fixed;
  if (s.sunk) s.sunk = false;
  say(env, data.travel.lines.repaired, { ship: shipWords(ship.name) });
}

export function coatShip(state: WorldState, data: GameData): void {
  const env = commandEnv(state, data, 'travel/coat');
  const here = ashore(env);
  if (!data.travel.coating.at.includes(here)) throw new TravelError('Nobody here coats ships');
  const ship = myShip(env);
  if (ship.ship?.coated) throw new TravelError('She is already coated');
  charge(env, data.travel.coating.cost, 'A coating');
  if (ship.ship) ship.ship.coated = true;
  say(env, data.travel.lines.coated, { ship: shipWords(ship.name) });
}

export function buyPose(
  state: WorldState,
  data: GameData,
  kind: 'log' | 'eternal',
  target?: string,
): void {
  const env = commandEnv(state, data, 'travel/pose');
  const here = ashore(env);
  const travel = ensureTravel(data, env.p);
  if (kind === 'log') {
    if (!data.travel.logPose.at.includes(here))
      throw new TravelError('Nobody here sells a Log Pose');
    if (travel.logPose) throw new TravelError('You already have a Log Pose');
    charge(env, data.travel.logPose.cost, 'A Log Pose');
    travel.logPose = true;
    say(env, data.travel.lines.pose, { title: 'a Log Pose' });
    return;
  }
  const loc = env.p.place.location;
  if (!target || !loc?.eternalPoses.includes(target))
    throw new TravelError('Nobody here sells that Eternal Pose');
  if (travel.eternalPoses.includes(target))
    throw new TravelError('You already have that Eternal Pose');
  charge(env, data.travel.eternalPose.cost, 'An Eternal Pose');
  travel.eternalPoses.push(target);
  say(env, data.travel.lines.pose, {
    title: `an Eternal Pose to ${data.locations[target]?.name ?? target}`,
  });
}

// ---- Debug ----------------------------------------------------------------------------------------

/** Kill anyone who is not the player (a role-holder before their beat, for instance). */
export function debugKillEntity(
  state: WorldState,
  data: GameData,
  entityId: string,
  cause: string,
): void {
  const entity = state.entities[entityId];
  if (!entity?.character) throw new TravelError(`There is no character "${entityId}"`);
  if (entityId === state.playerId) throw new TravelError('Use debug/kill for the player');
  if (!entity.character.alive) throw new TravelError(`${entity.name} is already dead`);
  killCharacter(state, data, entity, { tick: state.tick, canon: false, cause });
}

/** Put the player somewhere on the map at once. */
export function debugTeleport(state: WorldState, data: GameData, location: string): void {
  const env = commandEnv(state, data, 'debug/teleport');
  if (!data.locations[location]) throw new TravelError(`There is no place "${location}"`);
  const travel = ensureTravel(data, env.p);
  travel.voyage = null;
  travel.arrivedTick = state.tick;
  if (!travel.visited.includes(location)) travel.visited.push(location);
  env.p.c.place = location;
}
