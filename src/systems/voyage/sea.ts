import type { GameData, TravelMode } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { CharacterData, TravelData, Voyage, WorldState } from '../../engine/state';
import { formatBerries, numberWords } from '../genesis/text';
import { fullName, givenNames, namePool, rollPronouns } from '../genesis/family';
import type { Person } from '../life/body';
import { lifeLog, pay, renderLife, reportLine, withCause, type LifeEnv } from '../life/env';
import { die, fallIll, hurt, injure } from '../life/health';
import { quitJob, takeJob } from '../life/jobs';
import { lanesFrom, withDevFixtures } from '../places/graph';
import { placeOf, priceMult } from '../places/place';
import { deliverWaitingNews } from '../news';
import { fareFor, sailLock, shipHere, shipsOf } from './plan';
import {
  changeVessel,
  monthsToCover,
  mouthsAboard,
  ownShipOf,
  vesselNow,
  voyagePace,
} from './progress';

/**
 * Life at sea (Phase 3). A voyage is a trip along one lane that takes whole months. Each month
 * the ship makes progress at its pace (the captain's order can push it, spend it on resupplying,
 * or turn it around), the stores are eaten, wages and fares are paid, sickness may come aboard,
 * and step 5 rolls the month's voyage events. When the miles are covered the traveller arrives,
 * reads the headlines they missed, and the island's own events can begin.
 */

export class TravelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TravelError';
  }
}

/** The player's travel block, created on first use: they have always lived where they are. */
export function ensureTravel(data: GameData, p: Person): TravelData {
  if (!p.c.travel) {
    const here = p.place.location?.id ?? data.birthplaces[p.c.birthplace]?.location ?? '';
    p.c.travel = {
      arrivedTick: p.c.birthTick,
      visited: here ? [here] : [],
      logPose: false,
      eternalPoses: [],
      voyage: null,
    };
  }
  return p.c.travel;
}

function placeName(data: GameData, id: string): string {
  const loc = data.locations[id];
  return loc?.home ?? loc?.name ?? id;
}

function shipWords(name: string): string {
  return name.startsWith('the ') ? name.slice(4) : name;
}

function monthsWords(n: number): string {
  return n === 1 ? 'a month' : `${numberWords(n)} months`;
}

/** A hired ship's captain: someone of the port's people. */
function captainName(data: GameData, p: Person, rng: Rng): string {
  const pool = namePool(data, { race: p.race, birthplace: p.place.culture });
  const pronouns = rollPronouns(rng.fork('pronouns'));
  return fullName(
    pool,
    rng.fork('given').pick(givenNames(pool, pronouns)),
    rng.fork('family').pick(pool.family),
  );
}

// ---- Setting out --------------------------------------------------------------------------------

export function setSail(env: LifeEnv, laneId: string, mode: TravelMode): Voyage {
  const { state, data, p, tick, life } = env;
  const lock = sailLock(state, data, p, laneId, mode);
  if (lock) throw new TravelError(lock);
  const lane = data.lanes[laneId];
  const from = p.place.location;
  if (!lane || !from) throw new TravelError('There is no such lane here');
  const to = lane.from === from.id ? lane.to : lane.from;
  const travel = ensureTravel(data, p);
  const rng = env.rng.fork('sail', laneId, mode);

  // Work stays behind unless it goes where the worker goes.
  const job = life.job ? data.jobs[life.job.id] : undefined;
  if (life.job && !job?.travels) {
    const text = renderLife(env, data.travel.lines.jobLeft, {
      job: (job?.name ?? life.job.id).toLowerCase(),
    });
    quitJob(env);
    reportLine(env, text, 'plain');
  }
  if (mode === 'crew' && !job?.travels) {
    const hand = data.jobs['job_ships_hand'];
    if (hand) takeJob(env, hand);
  }

  let vessel: Voyage['vessel'] = null;
  let shipId: string | null = null;
  let title: string;
  if (mode === 'own') {
    const ship = shipHere(state, p);
    if (!ship?.ship) throw new TravelError('You have no ship moored here');
    ship.ship.place = null;
    shipId = ship.id;
    title = `in command of ${ship.name}`;
  } else if (mode === 'foot') {
    title = 'on foot';
  } else {
    const carrier = data.vessels[data.travel.carriers[mode]];
    const name = `the ${rng.fork('ship').pick(data.travel.shipNames)}`;
    vessel = {
      name,
      vessel: carrier?.id ?? data.travel.carriers[mode],
      hull: carrier?.hull ?? 60,
      maxHull: carrier?.hull ?? 60,
      speed: carrier?.speed ?? 140,
      crew: carrier
        ? rng
            .fork('crew')
            .int(
              carrier.minCrew,
              Math.max(carrier.minCrew, Math.round((carrier.minCrew + carrier.maxCrew) / 2)),
            )
        : 6,
      morale: data.travel.morale.start,
      supplies: 999,
      captain: captainName(data, p, rng.fork('captain')),
    };
    const as =
      mode === 'crew'
        ? 'as a hand aboard'
        : mode === 'passenger'
          ? 'as a passenger aboard'
          : mode === 'stowaway'
            ? 'hidden in the hold of'
            : 'aboard the Marine warship';
    title = `${as} ${mode === 'marine' ? shipWords(name) : name}`;
  }

  const voyage: Voyage = {
    lane: lane.id,
    from: from.id,
    to,
    mode,
    miles: lane.miles,
    done: 0,
    startTick: tick,
    estimate: 1,
    months: 0,
    order: 'hold',
    vessel,
    shipId,
    fare: mode === 'passenger' ? fareFor(state, data, p) : 0,
    discovered: false,
  };
  voyage.estimate = monthsToCover(lane.miles, (t) => voyagePace(state, data, voyage, t), tick);
  travel.voyage = voyage;
  travel.lastShip = vesselNow(state, voyage)?.name ?? 'the road';
  const text = renderLife(env, data.travel.lines.departed, {
    place: placeName(data, from.id),
    destination: placeName(data, to),
    title,
  });
  lifeLog(env, text, { kind: 'life', tags: ['personal', 'voyage'] });
  reportLine(env, text, 'plain');
  return voyage;
}

// ---- A month at sea -----------------------------------------------------------------------------

function line(
  env: LifeEnv,
  template: string,
  vars: Record<string, string>,
  tone: 'good' | 'bad' | 'plain' | 'alert',
  chronicle = false,
): string {
  const text = renderLife(env, template, vars);
  if (chronicle) lifeLog(env, text, { kind: 'event', tags: ['personal', 'voyage'] });
  reportLine(env, text, tone);
  return text;
}

/** The place a ship would put in at instead: the nearest end, or a neighbour, other than `avoid`. */
function nearestPort(
  state: WorldState,
  data: GameData,
  voyage: Voyage,
  avoid: string | null,
): { place: string; lane: string; miles: number } | null {
  const dev = withDevFixtures(state);
  const candidates: { place: string; lane: string; miles: number }[] = [];
  const add = (place: string, lane: string, miles: number) => {
    if (place !== avoid && data.locations[place]?.features.includes('docks')) {
      candidates.push({ place, lane, miles });
    }
  };
  add(voyage.from, voyage.lane, voyage.done);
  add(voyage.to, voyage.lane, Math.max(0, voyage.miles - voyage.done));
  for (const [end, sailed] of [
    [voyage.from, voyage.done],
    [voyage.to, Math.max(0, voyage.miles - voyage.done)],
  ] as const) {
    for (const edge of lanesFrom(data, end, dev))
      add(edge.to, edge.lane.id, sailed + edge.lane.miles);
  }
  candidates.sort((a, b) => a.miles - b.miles || (a.place < b.place ? -1 : 1));
  return candidates[0] ?? null;
}

/** The voyage puts in somewhere else. */
export function redirect(
  env: LifeEnv,
  voyage: Voyage,
  reason: 'detour' | 'redirect' | 'divert',
): boolean {
  const { state, data } = env;
  const avoid = reason === 'detour' ? null : voyage.to;
  const port = nearestPort(state, data, voyage, avoid);
  if (!port || port.place === voyage.to) return false;
  const from = port.miles === voyage.done && port.place === voyage.from ? voyage.to : voyage.from;
  voyage.from = from;
  voyage.to = port.place;
  voyage.lane = port.lane;
  voyage.miles = Math.max(1, port.miles);
  voyage.done = 0;
  const vessel = vesselNow(state, voyage);
  const template = reason === 'divert' ? data.travel.lines.diverted : data.travel.lines.redirected;
  line(
    env,
    template,
    { destination: placeName(data, port.place), ship: shipWords(vessel?.name ?? 'the ship') },
    'alert',
    true,
  );
  return true;
}

function turnBack(env: LifeEnv, voyage: Voyage): void {
  const { data } = env;
  const back = voyage.from;
  voyage.from = voyage.to;
  voyage.to = back;
  voyage.miles = Math.max(1, voyage.done);
  voyage.done = 0;
  line(env, data.travel.lines.turnedBack, { destination: placeName(data, back) }, 'plain', true);
}

/** The ship goes down. Everyone aboard washes up at the nearer end of the voyage. */
export function wreck(env: LifeEnv, voyage: Voyage): void {
  const { state, data, p, rng } = env;
  const vessel = vesselNow(state, voyage);
  line(
    env,
    data.travel.lines.wrecked,
    { ship: shipWords(vessel?.name ?? 'the ship') },
    'alert',
    true,
  );
  const ship = ownShipOf(state, voyage);
  if (ship?.ship) {
    ship.ship.sunk = true;
    ship.ship.place = null;
    ship.ship.hull = 0;
    ship.ship.supplies = 0;
    ship.ship.crew = Math.round(ship.ship.crew * (1 - data.travel.wreck.crewLost));
  }
  const ashore = voyage.done < voyage.miles / 2 ? voyage.from : voyage.to;
  injure(withCause(env, 'sys:wreck', undefined, rng.fork('wreck')), {
    severity: 'serious',
    area: 'roll',
    cause: 'accident',
  });
  if (!p.c.alive) return;
  land(env, voyage, ashore, true);
}

/** Over the side: an Endurance check against the sea (Phase 4 adds the Devil Fruit users' sinking). */
export function overboard(env: LifeEnv): void {
  const { data, p, rng } = env;
  const rule = data.travel.overboard;
  const stat = p.entity.stats[rule.stat];
  const value = stat ? stat.base : 0;
  const chance = Math.max(0.05, Math.min(0.97, 0.5 + (value - rule.difficulty) / 40));
  const roll = rng.fork('overboard').next();
  if (roll < chance) {
    line(env, data.travel.lines.rescued, {}, 'bad', true);
    hurt(withCause(env, 'sys:overboard'), 0.1, 'accident', 'the cold sea');
    return;
  }
  if (roll > 0.97 - (1 - chance) * 0.1) {
    line(env, data.travel.lines.drowned, {}, 'alert', true);
    die(withCause(env, 'sys:overboard'), 'drowned at sea');
    return;
  }
  injure(withCause(env, 'sys:overboard', undefined, rng.fork('hurt')), {
    severity: 'serious',
    area: 'roll',
    cause: 'accident',
  });
}

/** Reach a place: the voyage ends, the headlines catch up. */
function land(env: LifeEnv, voyage: Voyage, at: string, castaway = false): void {
  const { state, data, p, tick } = env;
  const travel = ensureTravel(data, p);
  const vessel = vesselNow(state, voyage);
  const ship = ownShipOf(state, voyage);
  travel.voyage = null;
  travel.arrivedTick = tick;
  travel.lastShip = vessel?.name ?? travel.lastShip;
  if (!travel.visited.includes(at)) travel.visited.push(at);
  p.c.place = at;
  p.place = placeOf(data, p.c, p.home);
  if (ship?.ship && !ship.ship.sunk) {
    ship.ship.place = at;
    const fee = Math.round(
      data.travel.portFee[data.locations[at]?.wealth ?? 'medium'] * priceMult(state, data, at),
    );
    if (fee > 0) {
      pay(env, -fee);
      line(
        env,
        data.travel.lines.portFee,
        { place: placeName(data, at), amount: formatBerries(fee) },
        'plain',
      );
    }
  }
  if (castaway) {
    line(env, data.travel.lines.castaway, { destination: placeName(data, at) }, 'alert', true);
  } else {
    const text = renderLife(env, data.travel.lines.arrived, {
      destination: placeName(data, at),
      months: monthsWords(Math.max(1, voyage.months)),
      title: voyage.mode === 'foot' ? 'on the road' : 'at sea',
    });
    lifeLog(env, text, { kind: 'event', tags: ['personal', 'voyage', 'arrival'] });
    reportLine(env, text, 'good');
  }
  p.entity.flags['travel.arrived'] = tick;
  const missed = deliverWaitingNews(state, data, at, tick);
  if (missed > 0) {
    line(
      env,
      data.travel.lines.missedNews,
      { amount: String(missed), destination: placeName(data, at) },
      'plain',
    );
  }
}

function payTheMonth(env: LifeEnv, voyage: Voyage): void {
  const { state, data, p } = env;
  if (voyage.mode === 'passenger' && voyage.months > 0) {
    if (p.c.berries >= voyage.fare) {
      pay(env, -voyage.fare);
      line(env, data.travel.lines.fare, { amount: formatBerries(voyage.fare) }, 'plain');
    } else {
      redirect(env, voyage, 'redirect');
    }
  }
  if (voyage.mode !== 'own') return;
  const vessel = vesselNow(state, voyage);
  if (!vessel) return;
  const wages = vessel.crew * data.travel.crewWage;
  if (wages > 0) {
    if (p.c.berries >= wages) pay(env, -wages);
    else {
      changeVessel(state, voyage, 'morale', -data.travel.morale.unpaid);
      line(env, data.travel.lines.unpaid, {}, 'bad');
    }
  }
  const eat = mouthsAboard(vessel);
  if (vessel.supplies >= eat) changeVessel(state, voyage, 'supplies', -eat);
  else {
    changeVessel(state, voyage, 'supplies', -vessel.supplies);
    changeVessel(state, voyage, 'morale', -data.travel.morale.hungry);
    line(env, data.travel.lines.starving, {}, 'alert', true);
    hurt(withCause(env, 'sys:hunger'), data.travel.starvation, 'starvation', 'hunger at sea');
  }
}

function sicknessAtSea(env: LifeEnv, voyage: Voyage): void {
  const { data, p, rng } = env;
  const rules = data.travel;
  if (voyage.months === 1 && voyage.mode !== 'foot' && !p.c.traits.includes('trait_sea_legs')) {
    const mult = p.c.traits.includes(rules.seasickness.trait) ? 2 : 1;
    if (rng.fork('seasick').chance(Math.min(1, rules.seasickness.chance * mult))) {
      fallIll(env, 'seasickness');
    }
  }
  if (
    voyage.months > rules.scurvy.afterMonths &&
    (voyage.mode === 'own' || voyage.mode === 'crew' || voyage.mode === 'stowaway') &&
    rng.fork('scurvy').chance(rules.scurvy.chance)
  ) {
    fallIll(env, 'scurvy');
  }
}

/** One month of a voyage (step 2 of the tick). */
export function sailMonth(env: LifeEnv): void {
  const { state, data, p, tick, rng } = env;
  const voyage = p.c.travel?.voyage;
  if (!voyage) return;
  voyage.months += 1;

  // The captain's order (own ship), or the captain's whims (someone else's).
  let pace = voyagePace(state, data, voyage, tick);
  if (voyage.mode === 'own') {
    const orders = data.travel.orders;
    switch (voyage.order) {
      case 'push':
        pace *= orders.push.speed;
        changeVessel(state, voyage, 'hull', -orders.push.hull);
        break;
      case 'resupply': {
        pace *= orders.resupply.progress;
        const found = rng
          .fork('resupply')
          .float(orders.resupply.supplies.min, orders.resupply.supplies.max);
        const aboard = vesselNow(state, voyage);
        const months = Math.round(found * (aboard ? mouthsAboard(aboard) : 1) * 10) / 10;
        changeVessel(state, voyage, 'supplies', months);
        line(
          env,
          data.travel.lines.resupplied,
          { amount: String(Math.round(found * 10) / 10) },
          'good',
        );
        voyage.order = 'hold';
        break;
      }
      case 'detour':
        if (!redirect(env, voyage, 'detour'))
          reportLine(env, 'The nearest port was where you were going anyway.', 'plain');
        voyage.order = 'hold';
        pace = voyagePace(state, data, voyage, tick);
        break;
      case 'turn_back':
        turnBack(env, voyage);
        voyage.order = 'hold';
        break;
      case 'hold':
        break;
    }
  } else if (voyage.mode === 'crew' || voyage.mode === 'marine') {
    if (voyage.months > 1 && rng.fork('divert').chance(data.travel.divertChance)) {
      redirect(env, voyage, 'divert');
      pace = voyagePace(state, data, voyage, tick);
    }
  }

  payTheMonth(env, voyage);
  if (!p.c.alive || !p.c.travel?.voyage) return;
  sicknessAtSea(env, voyage);
  if (!p.c.alive) return;

  // Morale drifts back toward its resting level.
  const vessel = vesselNow(state, voyage);
  if (vessel) {
    const rest = data.travel.morale.rest;
    const drift = Math.min(data.travel.morale.drift, Math.abs(rest - vessel.morale));
    if (drift > 0) changeVessel(state, voyage, 'morale', vessel.morale < rest ? drift : -drift);
  }

  // The stowaway's luck runs out.
  if (
    voyage.mode === 'stowaway' &&
    !voyage.discovered &&
    rng.fork('found').chance(data.travel.stowaway.discovery)
  ) {
    voyage.discovered = true;
    state.scheduled.push({ eventId: data.travel.stowaway.eventId, tick, source: 'sys:stowaway' });
  }

  if ((vesselNow(state, voyage)?.hull ?? 1) <= 0) {
    wreck(env, voyage);
    return;
  }

  voyage.done = Math.min(voyage.miles, voyage.done + pace);
  if (voyage.done >= voyage.miles - 1e-6) {
    land(env, voyage, voyage.to);
    return;
  }
  const left = monthsToCover(
    voyage.miles - voyage.done,
    (t) => voyagePace(state, data, voyage, t),
    tick + 1,
  );
  line(
    env,
    data.travel.lines.progress,
    { months: monthsWords(left), destination: placeName(data, voyage.to) },
    'plain',
  );
}

/** Ashore: a captain's moored ships still have hands to pay, and unpaid hands drift away. */
export function harbourMonth(env: LifeEnv): void {
  const { state, data, p } = env;
  for (const ship of shipsOf(state, p.entity.id)) {
    const s = ship.ship;
    if (!s || s.crew <= 0) continue;
    const wages = s.crew * data.travel.crewWage;
    if (p.c.berries >= wages) {
      pay(env, -wages);
      continue;
    }
    s.morale = Math.max(0, s.morale - data.travel.morale.unpaid);
    reportLine(env, renderLife(env, data.travel.lines.unpaid), 'bad');
    if (s.morale < data.travel.morale.mutinyBelow) s.crew = Math.max(0, s.crew - 1);
  }
}

// ---- What a month's events can do to the vessel -------------------------------------------------

/** Months added to (or taken off) the voyage: a month's worth of miles per month. */
export function delayVoyage(env: LifeEnv, months: number): void {
  const voyage = env.p.c.travel?.voyage;
  if (!voyage) return;
  const pace = voyagePace(env.state, env.data, voyage, env.tick);
  const done = voyage.done - months * pace;
  // A delay before much sea is behind the ship lengthens what is ahead of it instead.
  if (done < 0) voyage.miles = Math.round((voyage.miles - done) * 10) / 10;
  voyage.done = Math.max(0, Math.min(voyage.miles - 1, done));
}

/** The vessel the player is aboard, or their own ship moored where they are. */
export function shipEffect(
  env: LifeEnv,
  field: 'hull' | 'crew' | 'morale' | 'supplies',
  by: number,
): number {
  const { state, data, p } = env;
  const voyage = p.c.travel?.voyage;
  if (voyage) {
    const change = changeVessel(state, voyage, field, by);
    if (field === 'hull' && (vesselNow(state, voyage)?.hull ?? 1) <= 0) wreck(env, voyage);
    return change;
  }
  const ship = shipHere(state, p);
  if (!ship?.ship) return 0;
  const before = ship.ship[field];
  const vessel = data.vessels[ship.ship.vessel];
  const maxHull = vessel?.hull ?? before;
  let after = before + by;
  if (field === 'hull') after = Math.max(0, Math.min(maxHull, after));
  if (field === 'morale') after = Math.max(0, Math.min(100, after));
  if (field === 'crew' || field === 'supplies') after = Math.max(0, after);
  ship.ship[field] = after;
  return after - before;
}

/** For tests and the debug panel: a voyage's numbers in words. */
export function describeVoyage(data: GameData, c: CharacterData): string | null {
  const voyage = c.travel?.voyage;
  if (!voyage) return null;
  return `${placeName(data, voyage.from)} to ${placeName(data, voyage.to)}: ${Math.round(voyage.done)} of ${voyage.miles} miles`;
}
