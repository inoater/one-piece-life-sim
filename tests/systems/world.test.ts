import { describe, expect, it } from 'vitest';
import { advance, createWorld, Rng } from '../../src/core';
import { statValue } from '../../src/engine/stats';
import { DEFAULT_WORLD_CONFIG, WorldStateSchema, type WorldState } from '../../src/engine/state';
import { MEMBERS, TERRITORY, strengthOf } from '../../src/systems/factions';
import { ensureWorldLayer } from '../../src/systems/places/history';
import { POPULATED } from '../../src/systems/places/people';
import { mapView, placeView, worldSummary } from '../../src/systems/places/view';
import { data } from '../helpers/data';
import { startLife } from '../helpers/life';

/**
 * The world (Phase 3): places, factions and territory, the economy, Tier 2 people choosing by
 * their goals, Tier 3 people as numbers, epidemics, and the world built for a life that begins
 * late, with its past.
 */

function world(seed: string, tick = 0, population: 'full' | 'none' = 'none'): WorldState {
  const state = createWorld({
    seed,
    startTick: tick,
    config: { ...DEFAULT_WORLD_CONFIG, population },
    intro: false,
  });
  ensureWorldLayer(state, data);
  return state;
}

const run = (state: WorldState, months: number) =>
  advance(state, data, Rng.root(state.seed), { kind: 'months', count: months }, 'auto-first');

describe('the map in the world', () => {
  it('has a location entity for every place, with Tier 3 people split by age and trade', () => {
    const state = world('places');
    const places = Object.values(state.entities).filter((e) => e.type === 'location');
    expect(places.length).toBe(55);
    const loguetown = state.entities['loc_loguetown']!.place!;
    expect(loguetown.controller).toBe('org_marines');
    const r = loguetown.residents;
    expect(r.children + r.adults + r.elders).toBe(30000);
    expect(Object.values(loguetown.jobs).reduce((a, b) => a + b, 0)).toBeGreaterThan(
      r.adults * 0.95,
    );
    expect(state.entities['loc_test_harbor']).toBeUndefined(); // dev fixtures only in dev worlds
  });

  it('shows the map: places with coordinates, and the lanes between them', () => {
    const t = startLife({ seed: 'map-view' });
    ensureWorldLayer(t.state, t.data);
    const view = mapView(t.state, data);
    expect(view.places).toHaveLength(55);
    expect(view.lanes.length).toBeGreaterThan(80);
    expect(view.here).toBe('loc_east_blue_village');
    expect(
      view.places
        .filter((p) => p.reachable)
        .map((p) => p.id)
        .sort(),
    ).toEqual(['loc_dawn_island', 'loc_shells_town']);
    const detail = placeView(t.state, data, 'loc_loguetown')!;
    expect(detail.controller?.name).toBe('The Marines');
    expect(detail.prosperity.value).toBe(50);
    expect(detail.route).toBeNull();
  });
});

describe('factions, territory and the economy', () => {
  it('moves strength by its trend: the Revolutionary Army is low, and rising', () => {
    const state = world('trend');
    const rev = state.entities['org_revolutionary_army']!;
    const before = rev.stats['strength']!.base;
    run(state, 24);
    expect(rev.stats['strength']!.base).toBeCloseTo(
      before + 2 * data.factions['org_revolutionary_army']!.trend,
      5,
    );
  });

  it('counts the crews toward the pirates, and the places each faction holds, as named modifiers', () => {
    const state = world('umbrella');
    run(state, 1);
    const pirates = state.entities['org_pirates']!;
    const members = pirates.stats['strength']!.mods.find((m) => m.source === MEMBERS);
    expect(members?.value).toBeGreaterThan(0);
    const wg = state.entities['org_world_government']!.stats['strength']!.mods.find(
      (m) => m.source === TERRITORY,
    );
    expect(wg?.value).toBeGreaterThan(0);
    expect(strengthOf(pirates, state.tick)).toBeCloseTo(
      statValue(pirates.stats['strength']!, state.tick),
      5,
    );
  });

  it('brings crews into being on their founding, and changes hands by the story', () => {
    const state = world('founding', 9 * 12);
    expect(state.entities['org_beasts_pirates']).toBeDefined();
    expect(state.entities['org_red_hair_pirates']).toBeUndefined();
    run(state, 10 * 12);
    expect(state.entities['org_red_hair_pirates']?.org?.active).toBe(true);
    expect(state.entities['loc_wano']?.place?.controller).toBe('org_beasts_pirates');
  });

  it('sums up the world for the World tab', () => {
    const state = world('summary', 20 * 12);
    const s = worldSummary(state, data);
    expect(s.built).toBe(true);
    expect(s.factions[0]!.strength).toBeGreaterThan(50);
    expect(s.canon.fired).toBeGreaterThan(5);
    expect(s.population.places).toBe(55);
  });
});

describe('the people', () => {
  it('populates about two thousand named people, out of their places’ numbers, with goals', () => {
    const state = world('crowd', 30 * 12, 'full');
    expect(state.flags[POPULATED]).toBe(true);
    const npcs = Object.values(state.entities).filter((e) => e.character?.npc);
    expect(npcs.length).toBeGreaterThan(1700);
    expect(npcs.length).toBeLessThan(2400);
    const goals = new Set(npcs.map((e) => e.character!.npc!.goal));
    expect([...goals].sort()).toEqual(['freedom', 'glory', 'revenge', 'survive', 'wealth']);
    for (const e of npcs.slice(0, 50)) expect(data.locations[e.character!.place!]).toBeDefined();
  });

  it('lets them choose a quarter at a time: work, train, sail, marry, turn pirate, enlist', () => {
    const state = world('choices', 30 * 12, 'full');
    run(state, 24);
    const npcs = Object.values(state.entities).filter((e) => e.character?.npc);
    const chose = new Set(npcs.map((e) => e.character!.npc!.last).filter(Boolean));
    for (const action of ['work', 'train', 'voyage', 'rest'])
      expect(chose.has(action), action).toBe(true);
    expect(npcs.some((e) => e.flags['married'] === true)).toBe(true);
    expect(WorldStateSchema.safeParse(state).success).toBe(true);
  });

  it('keeps Tier 3 people as numbers that are born, grow old and die every January', () => {
    const state = world('tier3', 12 * 12 - 1);
    const before = { ...state.entities['loc_alabasta']!.place!.residents };
    run(state, 2);
    const after = state.entities['loc_alabasta']!.place!.residents;
    expect(after).not.toEqual(before);
    expect(after.children + after.adults + after.elders).toBeGreaterThan(100000);
  });
});

describe('epidemics', () => {
  it('break out somewhere, spread along the lanes, make the news, and make people there sick', () => {
    const state = world('plague');
    state.flags['dev.probe'] = false;
    const until = (id: string) => state.entities[id]?.flags['epidemic.until'];
    run(state, 12 * 20);
    const hit = Object.keys(state.entities).filter((id) => typeof until(id) === 'number');
    expect(hit.length).toBeGreaterThan(1);
    expect(state.news.some((n) => /wasting fever|Sickness spreads/.test(n.text))).toBe(true);
  });
});

describe('a life that begins late begins after the past', () => {
  it('plays the years before it, so Year 20 comes after the Pirate King died', () => {
    const t = startLife({ seed: 'late', entryYear: 20, entryAge: 25 });
    ensureWorldLayer(t.state, t.data);
    expect(t.state.tick).toBeGreaterThanOrEqual(20 * 12);
    expect(t.state.entities['char_gol_d_roger']?.character?.alive).toBe(false);
    expect(t.state.canon.beats['beat_roger_execution']?.status).toBe('fired');
    // The past's news has already reached home.
    expect(t.state.news.some((n) => n.text.startsWith('GOL D. ROGER EXECUTED'))).toBe(true);
    expect(t.state.playerId).toBe(t.player().id);
  });
});
