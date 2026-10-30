import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { advance, Rng } from '../../src/core';
import { hashValue } from '../../src/engine/canonical';
import { deserializeSave } from '../../src/engine/saves/manager';
import { SAVE_VERSION } from '../../src/engine/version';
import { playGoldenSession } from '../../tools/lib/golden-session';
import { data, dataHash, ROOT } from '../helpers/data';

const dir = join(ROOT, 'tests', 'fixtures', 'golden');
const golden = JSON.parse(readFileSync(join(dir, 'golden.json'), 'utf8')) as {
  seed: string;
  saveVersion: number;
  finalTick: number;
  stateHash: string;
  counts: { log: number; news: number; entities: number };
  probe: { acc: number; draws: number };
};
const LIMITS = { maxCompressedBytes: 64 << 20, maxDecompressedBytes: 256 << 20 };

describe('golden session (regression anchor for determinism)', () => {
  it('replays to exactly the recorded state hash', () => {
    // A failure here means world behaviour changed. If that was intended, run `npm run golden:update`
    // (and bump SAVE_VERSION with a migration if the persisted shape changed). If not, determinism broke.
    const state = playGoldenSession(data);
    expect({ tick: state.tick, hash: hashValue(state) }).toEqual({
      tick: golden.finalTick,
      hash: golden.stateHash,
    });
    expect(state.log.length).toBe(golden.counts.log);
    expect(state.news.length).toBe(golden.counts.news);
    expect(state.flags['dev.probe.acc']).toBe(golden.probe.acc);
    expect(state.flags['dev.probe.draws']).toBe(golden.probe.draws);
  }, 180_000);

  it('covers every feature it is meant to anchor', () => {
    const state = playGoldenSession(data);
    const kinds = new Set(state.log.map((r) => r.kind));
    expect([...kinds].sort()).toEqual(
      expect.arrayContaining(['backstory', 'decision', 'effect', 'event', 'life', 'system']),
    );
    expect(state.news.length).toBeGreaterThan(0);
    // The player, their family, and the dev fixture entity.
    expect(state.playerId).not.toBeNull();
    expect(state.entities[state.playerId as string]?.character?.backstory).toBeTruthy();
    expect(Object.values(state.entities).some((e) => e.flags['dev.fixture'] === true)).toBe(true);
    expect(
      Object.values(state.entities).filter((e) => e.origin === 'generated').length,
    ).toBeGreaterThan(2);
    expect(state.flags['dev.crossroads']).toBe('left');
    expect(state.log.some((r) => r.knownBy.length === 0)).toBe(true); // the secret event
    // Phase 7: a talk, and hearts made for the people the world had reason to know.
    expect(state.log.some((r) => r.tags.includes('talk'))).toBe(true);
    expect(state.entities[state.playerId as string]?.character?.heart).toBeDefined();
  }, 180_000);
});

describe('golden saves: every old save version must keep loading', () => {
  const fixtures = readdirSync(dir)
    .filter((name) => /^world_v\d+\.opsim$/.test(name))
    .map((name) => ({ name, version: Number(/v(\d+)/.exec(name)?.[1]) }))
    .sort((a, b) => a.version - b.version);

  it('has a fixture for the current save version, and keeps the earlier ones', () => {
    expect(fixtures.map((f) => f.version)).toContain(SAVE_VERSION);
    expect(fixtures.map((f) => f.version)).toContain(1);
    expect(golden.saveVersion).toBeLessThanOrEqual(SAVE_VERSION);
  });

  for (const fixture of fixtures) {
    it(`${fixture.name} loads in this version of the game`, async () => {
      const bytes = new Uint8Array(readFileSync(join(dir, fixture.name)));
      const { state, report } = await deserializeSave(bytes, { dataHash, limits: LIMITS });
      expect(report.saveVersion).toBe(SAVE_VERSION);
      expect(report.seed).toBe(golden.seed);
      if (fixture.version === SAVE_VERSION) {
        expect(report.migratedFrom).toBeNull();
        expect(report.hashMatches).toBe(true);
        expect(hashValue(state)).toBe(golden.stateHash);
      } else {
        expect(report.migratedFrom).toBe(fixture.version);
      }
    });
  }

  it('world_v2.opsim, saved before the life loop, carries on living: the player gets a life', async () => {
    const bytes = new Uint8Array(readFileSync(join(dir, 'world_v2.opsim')));
    const { state } = await deserializeSave(bytes, { dataHash, limits: LIMITS });
    const player = state.entities[state.playerId as string];
    expect(player?.character?.life).toBeUndefined();
    advance(state, data, Rng.root(state.seed), { kind: 'months', count: 3 }, 'auto-random');
    expect(player?.character?.life?.health).toBeGreaterThan(0);
  });

  it('world_v4.opsim, saved before powers, gets its Devil Fruits, its canon cast by era and its fighters', async () => {
    const bytes = new Uint8Array(readFileSync(join(dir, 'world_v4.opsim')));
    const { state, report } = await deserializeSave(bytes, { dataHash, limits: LIMITS });
    expect(report.migratedFrom).toBe(4);
    expect(state.flags['fruits.built']).toBeUndefined();
    advance(state, data, Rng.root(state.seed), { kind: 'months', count: 1 }, 'auto-random');
    expect(state.flags['fruits.built']).toBe(true);
    const fruits = Object.values(state.entities).filter((e) => e.type === 'fruit');
    expect(fruits.length).toBeGreaterThanOrEqual(Object.keys(data.fruits).length);
    // One entity per canon fruit, and the canon users of the save's month hold theirs.
    expect(state.entities['fruit_gura_gura']?.fruit?.userId).toBe('char_edward_newgate');
    expect(
      state.entities['char_edward_newgate']?.character?.powers?.tracks['track_armament'],
    ).toBeDefined();
    // Generated fighters were given their powers.
    expect(
      Object.values(state.entities).some(
        (e) => e.tier === 2 && Object.keys(e.character?.powers?.tracks ?? {}).length > 0,
      ),
    ).toBe(true);
  });

  it('world_v5.opsim, saved before battles, has no fight under way and plays on with them', async () => {
    const bytes = new Uint8Array(readFileSync(join(dir, 'world_v5.opsim')));
    const { state, report } = await deserializeSave(bytes, { dataHash, limits: LIMITS });
    expect(report.migratedFrom).toBe(5);
    expect(state.battle).toBeNull();
    expect(state.counters.battleId).toBe(0);
    advance(state, data, Rng.root(state.seed), { kind: 'months', count: 6 }, 'auto-random');
    expect(state.battle).toBeNull();
    // The canon cast stand on their rungs of the ladder from the first month on.
    expect(
      Object.values(state.entities).some((e) =>
        e.stats['combatBonus']?.mods.some((m) => m.source === 'Strength of their era'),
      ),
    ).toBe(true);
  });

  it('world_v3.opsim, saved before the world, gets its map, factions, canon cast and past', async () => {
    const bytes = new Uint8Array(readFileSync(join(dir, 'world_v3.opsim')));
    const { state, report } = await deserializeSave(bytes, { dataHash, limits: LIMITS });
    expect(report.migratedFrom).toBe(3);
    expect(state.canon).toEqual({ beats: {}, divergences: [] });
    expect(state.flags['world.built']).toBeUndefined();
    advance(state, data, Rng.root(state.seed), { kind: 'months', count: 1 }, 'auto-random');
    expect(state.flags['world.built']).toBe(true);
    expect(Object.values(state.entities).filter((e) => e.type === 'location')).toHaveLength(55);
    expect(state.entities['char_gol_d_roger']).toBeDefined();
    expect(Object.keys(state.canon.beats).length).toBeGreaterThan(0);
    const player = state.entities[state.playerId as string]!;
    expect(
      player.character?.place ?? data.birthplaces[player.character!.birthplace]?.location,
    ).toBeTruthy();
  });
});
