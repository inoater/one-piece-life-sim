import { describe, expect, it } from 'vitest';
import { WorldStateSchema } from '../../src/engine/state';
import { lockReason } from '../../src/systems/life/activities';
import { ensureLife } from '../../src/systems/life/body';
import { newsDelay } from '../../src/systems/places/graph';
import { ensureWorldLayer } from '../../src/systems/places/history';
import { routeOptions } from '../../src/systems/voyage/plan';
import { vesselNow } from '../../src/systems/voyage/progress';
import { travelView } from '../../src/systems/voyage/view';
import { startLife, type TestLife } from '../helpers/life';

/**
 * Travel (Phase 3): the planner, voyages month by month, what is locked at sea, ships, orders,
 * arriving, and the news that waits in port.
 */

function life(over: Parameters<typeof startLife>[0] = {}): TestLife {
  const t = startLife({ entryAge: 24, seed: 'travel', ...over });
  ensureWorldLayer(t.state, t.data);
  t.player().character!.berries = 500_000;
  return t;
}

function route(t: TestLife, to: string) {
  const r = routeOptions(t.state, t.data, t.person()).find((x) => x.to === to);
  if (!r) throw new Error(`no route to ${to}`);
  return r;
}

const atSea = (t: TestLife) => t.player().character!.travel?.voyage ?? null;

describe('Done when: sailing between two islands takes the computed number of months', () => {
  it('arrives on exactly the month the planner said, for every way of travelling', () => {
    for (const mode of ['passenger', 'crew', 'stowaway'] as const) {
      const t = life({ seed: `months-${mode}` });
      const r = route(t, 'loc_shells_town');
      const option = r.modes.find((m) => m.mode === mode)!;
      expect(option.lock, mode).toBeNull();
      t.act({ type: 'travel/sail', lane: r.lane.id, mode });
      const start = t.state.tick;
      let months = 0;
      while (atSea(t) && months < 24) {
        t.run(1);
        months += 1;
      }
      expect(months, mode).toBe(option.months);
      expect(t.player().character!.place).toBe('loc_shells_town');
      expect(t.state.tick - start).toBe(option.months);
    }
  });

  it('a voyage longer than one month arrives on its last month (the plan: a 45-day trip arrives on the second tick)', () => {
    const t = life({ seed: 'two-ticks' });
    const r = route(t, 'loc_shells_town');
    const option = r.modes.find((m) => m.mode === 'passenger')!;
    expect(option.months).toBeGreaterThanOrEqual(2);
    t.act({ type: 'travel/sail', lane: r.lane.id, mode: 'passenger' });
    t.run(option.months - 1);
    expect(atSea(t)).not.toBeNull();
    t.run(1);
    expect(atSea(t)).toBeNull();
  });
});

describe('Done when: ... and locks the listed actions', () => {
  it('locks local work, schools, shops, land crime and inland exploring at sea, with how long is left', () => {
    const t = life({ seed: 'locks' });
    t.act({ type: 'life/job', jobId: 'job_fisher' });
    const r = route(t, 'loc_shells_town');
    t.act({ type: 'travel/sail', lane: r.lane.id, mode: 'passenger' });
    expect(t.life().job).toBeNull(); // a fisher's work stays ashore
    const env = t.env('locks');
    for (const id of [
      'act_school',
      'act_shop_help',
      'act_pickpocket',
      'act_wander',
      'act_library',
      'act_see_doctor',
      'act_befriend',
    ]) {
      expect(lockReason(env, t.data.activities[id]!), id).toMatch(
        /^At sea: \d+ months? to the next island$/,
      );
    }
    for (const id of [
      'act_run_laps',
      'act_read',
      'act_study_charts',
      'act_stand_watch',
      'act_shipmates',
      'act_fish',
      'act_sleep_in',
    ]) {
      expect(lockReason(env, t.data.activities[id]!), id).toBeNull();
    }
    // Ship duty is only for the sea.
    t.run(1);
  });

  it('opens ship duty only at sea, and trains Body at 70% there', () => {
    const t = life({ seed: 'duty' });
    expect(lockReason(t.env(), t.data.activities['act_stand_watch']!)).toBe('Only at sea');
    expect(t.data.travel.atSea.trainBody).toBe(0.7);
  });
});

describe('the planner', () => {
  it('lists every lane from here with each way of taking it, and says why a way is closed', () => {
    const t = life({ seed: 'planner' });
    const routes = routeOptions(t.state, t.data, t.person());
    expect(routes.map((r) => r.to).sort()).toEqual(['loc_dawn_island', 'loc_shells_town']);
    const own = route(t, 'loc_dawn_island').modes.find((m) => m.mode === 'own')!;
    expect(own.lock).toBe('You have no ship moored here');
    const marine = route(t, 'loc_dawn_island').modes.find((m) => m.mode === 'marine')!;
    expect(marine.lock).toBe('Only for those who serve in the Marines');
  });

  it('holds a Grand Line crew on an island until its Log Pose has set', () => {
    const t = life({ seed: 'pose' });
    t.act({ type: 'debug/teleport', location: 'loc_little_garden' });
    const r = route(t, 'loc_drum');
    expect(r.modes.find((m) => m.mode === 'passenger')!.lock).toMatch(
      /Log Pose is still setting on this island \(12 more months\)/,
    );
    t.run(12);
    expect(route(t, 'loc_drum').modes.find((m) => m.mode === 'passenger')!.lock).toBeNull();
  });

  it('closes Wano to those born there, and the Holy Land to those without leave', () => {
    const t = life({ seed: 'wano', birthplace: 'bp_wano' });
    expect(
      route(t, 'loc_zou').modes.every((m) => m.lock?.includes("Wano's borders are closed")),
    ).toBe(true);
    const s = life({ seed: 'holy' });
    s.act({ type: 'debug/teleport', location: 'loc_sabaody' });
    expect(route(s, 'loc_mary_geoise').modes.find((m) => m.mode === 'foot')!.lock).toContain(
      "Government's leave",
    );
  });
});

describe('a ship of your own', () => {
  it('buys, crews, stocks and sails a ship; the stores are eaten and the hands paid', () => {
    const t = life({ seed: 'captain' });
    t.act({ type: 'debug/teleport', location: 'loc_loguetown' });
    t.act({ type: 'travel/buyShip', vessel: 'vessel_fishing_boat' });
    t.act({ type: 'travel/hire', count: 2 });
    t.act({ type: 'travel/provision', months: 4 });
    const view = travelView(t.state, t.data)!;
    expect(view.harbour?.ship).toMatchObject({ className: 'Fishing boat', crew: 2, supplies: 12 });
    const r = route(t, 'loc_cocoyashi');
    const own = r.modes.find((m) => m.mode === 'own')!;
    expect(own.lock).toBeNull();
    const before = t.player().character!.berries;
    t.act({ type: 'travel/sail', lane: r.lane.id, mode: 'own' });
    t.run(1);
    const voyage = atSea(t);
    if (voyage) {
      const vessel = vesselNow(t.state, voyage)!;
      expect(vessel.supplies).toBe(12 - 3);
    }
    expect(t.player().character!.berries).toBeLessThan(before); // wages
  });

  it('obeys the captain: push speed wears the hull, turning back heads home', () => {
    const t = life({ seed: 'orders' });
    t.player().character!.berries = 3_000_000;
    t.act({ type: 'debug/teleport', location: 'loc_loguetown' });
    t.act({ type: 'travel/buyShip', vessel: 'vessel_caravel' });
    t.act({ type: 'travel/hire', count: 7 });
    t.act({ type: 'travel/provision', months: 6 });
    t.act({ type: 'travel/sail', lane: 'lane_baratie_loguetown', mode: 'own' });
    t.act({ type: 'travel/order', order: 'push' });
    t.run(1);
    const v = atSea(t);
    expect(v).not.toBeNull();
    expect(vesselNow(t.state, v!)!.hull).toBe(90 - 3);
    t.act({ type: 'travel/order', order: 'turn_back' });
    t.run(1);
    expect(atSea(t)?.to ?? t.player().character!.place).toBe('loc_loguetown');
  });

  it('passes the ship on to whoever carries the story on', () => {
    const t = life({ seed: 'heir-ship' });
    t.act({ type: 'debug/teleport', location: 'loc_loguetown' });
    t.act({ type: 'travel/buyShip', vessel: 'vessel_dinghy' });
    const ship = Object.values(t.state.entities).find((e) => e.ship)!;
    const sibling = t.player().character!.family?.siblingIds[0];
    t.act({ type: 'debug/kill', cause: 'a test' });
    if (sibling && t.state.entities[sibling]?.character?.alive) {
      t.act({ type: 'life/continue', mode: 'sibling', targetId: sibling });
      expect(ship.ship!.ownerId).toBe(sibling);
    } else {
      expect(ship.ship!.ownerId).toBe(t.state.playerId);
    }
  });
});

describe('arriving', () => {
  it('reads the headlines that could not reach the ship, and writes the arrival in the chronicle', () => {
    const t = life({ seed: 'missed', entryYear: 13 });
    const r = route(t, 'loc_shells_town');
    t.act({ type: 'travel/sail', lane: r.lane.id, mode: 'passenger' });
    // News raised while at sea waits for the port.
    t.state.news.push({
      id: 999,
      tick: t.state.tick,
      text: 'Far news.',
      tags: ['news'],
      place: 'loc_alabasta',
      reachTick: null,
    });
    while (atSea(t)) t.run(1);
    const item = t.state.news.find((n) => n.id === 999)!;
    expect(item.reachTick).not.toBeNull();
    expect(
      t.state.log.some(
        (r2) => r2.tags.includes('arrival') && r2.summary.startsWith('You reached Shells Town'),
      ),
    ).toBe(true);
    expect(WorldStateSchema.safeParse(t.state).success).toBe(true);
  });

  it('delays news by distance: here at once, the same sea a month, a neighbouring sea two, beyond that three', () => {
    const t = life({ seed: 'delay' });
    const p = ensureLife(t.state, t.data)!;
    expect(p.place.location?.id).toBe('loc_east_blue_village');
    expect(newsDelay(t.data, 'loc_east_blue_village', 'loc_east_blue_village')).toBe(0);
    expect(newsDelay(t.data, 'loc_loguetown', 'loc_east_blue_village')).toBe(1);
    expect(newsDelay(t.data, 'loc_marineford', 'loc_east_blue_village')).toBe(2);
    expect(newsDelay(t.data, 'loc_wano', 'loc_east_blue_village')).toBe(3);
  });
});
