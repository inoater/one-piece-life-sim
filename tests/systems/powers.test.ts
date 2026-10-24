import { describe, expect, it } from 'vitest';
import { advance, applyAction } from '../../src/core';
import { tickOfWhen, type Track, type TrackStage } from '../../src/engine/data/schemas';
import { Rng } from '../../src/engine/rng';
import type { Entity, WorldState } from '../../src/engine/state';
import { statValue } from '../../src/engine/stats';
import { playerPerson } from '../../src/systems/life/body';
import type { LifeEnv } from '../../src/systems/life/env';
import { giveTraitTo, removeTrait } from '../../src/systems/life/traits';
import { makeGeneratedFruit, setUser } from '../../src/systems/powers/fruits';
import {
  powerEvent,
  seedMonth,
  tryWake,
  wakeChance,
  type WakeTrigger,
} from '../../src/systems/powers/haki';
import { armFighter } from '../../src/systems/powers/month';
import {
  applyCanonEra,
  eraAt,
  generatedMoves,
  isOffence,
  movesetOfCast,
  temperamentOf,
} from '../../src/systems/powers/movesets';
import {
  HAKI_COLOURS,
  hakiAwake,
  notePowerEvent,
  trackStateOf,
} from '../../src/systems/powers/state';
import { battleActions, priceTechnique, techniqueIndex } from '../../src/systems/powers/techniques';
import {
  addProgress,
  breakthroughTrack,
  openTrack,
  powerCtxOf,
  setStage,
  type PowerCtx,
} from '../../src/systems/powers/tracks';
import { powersView } from '../../src/systems/powers/view';
import { data } from '../helpers/data';
import { startLife, type TestLife } from '../helpers/life';

/**
 * Phase 4, "Done when", for haki, styles, tracks, movesets and the technique creator.
 */

function env(t: TestLife, label = 'powers'): LifeEnv {
  const p = playerPerson(t.state, data)!;
  return {
    state: t.state,
    data,
    tick: t.state.tick,
    rng: Rng.root(label).fork(t.state.tick),
    p,
    life: p.c.life!,
    cause: `test:${label}`,
  };
}

function ctxOf(t: TestLife, label = 'powers'): PowerCtx {
  return powerCtxOf(env(t, label));
}

function life(seed: string, over: Record<string, unknown> = {}): TestLife {
  const t = startLife({ seed, entryYear: 30, entryAge: 22, ...over });
  t.run(1);
  return t;
}

/** Make every stat huge, so stat minimums never stand in the way. */
function mighty(entity: Entity): void {
  for (const stat of Object.values(entity.stats))
    stat.mods.push({ source: 'test might', value: 400, kind: 'flat' });
  if (entity.character?.hidden) entity.character.hidden.talent = 'anomaly';
}

const base = life('powers-base');

/** A copy of the base life, every helper bound to the copy. */
function fresh(): TestLife {
  const state = structuredClone(base.state);
  const rng = Rng.root('fresh');
  const t: TestLife = {
    state,
    rng,
    data,
    player: () => state.entities[state.playerId as string] as Entity,
    life: () => t.player().character!.life!,
    person: () => playerPerson(state, data)!,
    act: (action) => void applyAction(state, data, action, { debug: true }),
    run: (months, decisions = 'auto-random') =>
      advance(state, data, rng, { kind: 'months', count: months }, decisions),
    env: (label = 'test') => env(t, label),
  };
  return t;
}

// ---- Haki ---------------------------------------------------------------------------------

describe('Done when: haki wakes under each documented trigger', () => {
  const triggers: WakeTrigger[] = ['seed', 'near_death', 'crisis', 'teacher'];
  for (const colour of ['observation', 'armament'] as const) {
    for (const trigger of triggers) {
      it(`${colour} wakes from ${trigger}`, () => {
        let woke = false;
        for (let i = 0; i < 200 && !woke; i++) {
          const t = fresh();
          t.player().stats['willpower']!.mods.push({ source: 'test', value: 40, kind: 'flat' });
          const ctx = { ...ctxOf(t), rng: Rng.root(`${colour}-${trigger}`).fork(i) };
          if (trigger === 'seed') {
            t.player().flags[`haki.seed.${colour}`] = data.powers.haki.seedMonths;
            seedMonth(ctx);
          } else {
            const event = trigger === 'teacher' ? 'mentor_push' : trigger;
            powerEvent(ctx, event);
          }
          woke = hakiAwake(t.player().character!, colour);
        }
        expect(woke).toBe(true);
      });
    }
  }

  it('a seed that has not grown enough, or a will too weak, does not wake', () => {
    const t = fresh();
    t.player().flags['haki.seed.observation'] = data.powers.haki.seedMonths - 1;
    for (let i = 0; i < 300; i++) seedMonth({ ...ctxOf(t), rng: Rng.root('young').fork(i) });
    expect(hakiAwake(t.player().character!, 'observation')).toBe(false);
    const weak = fresh();
    weak.player().stats['willpower']!.mods.push({ source: 'test', value: -500, kind: 'flat' });
    expect(wakeChance(ctxOf(weak), 'armament', 'crisis')).toBe(0);
  });

  it("Conqueror's wakes in a surge for someone with King's Qualities, and knocks out the weak", () => {
    let woke = false;
    for (let i = 0; i < 100 && !woke; i++) {
      const t = fresh();
      giveTraitTo(data, t.player(), 'trait_kings_qualities', 'test', t.state.tick);
      powerEvent({ ...ctxOf(t), rng: Rng.root('king').fork(i) }, 'crisis');
      woke = hakiAwake(t.player().character!, 'conqueror');
      if (woke)
        expect(t.state.log.some((r) => r.summary.includes('dropped where they stood'))).toBe(true);
    }
    expect(woke).toBe(true);
  });

  it("Conqueror's never wakes without King's Qualities across 10,000 lives", () => {
    // Ten thousand people (the base life re-rolled: will, seeds, every trigger, many times each).
    const t = fresh();
    const player = t.player();
    removeTrait(data, player, 'trait_kings_qualities');
    const will = player.stats['willpower']!;
    let woke = 0;
    let tried = 0;
    for (let i = 0; i < 10_000; i++) {
      const r = Rng.root('ten-thousand').fork(i);
      will.mods = [{ source: 'life', value: r.int(0, 200), kind: 'flat' }];
      for (const trigger of ['seed', 'near_death', 'crisis', 'teacher', 'clash'] as const) {
        tried += 1;
        if (tryWake({ ...ctxOf(t), rng: r.fork(trigger) }, 'conqueror', trigger)) woke += 1;
      }
    }
    expect(tried).toBe(50_000);
    expect(woke).toBe(0);
    expect(player.character?.powers?.tracks['track_conqueror']).toBeUndefined();
  });

  it('haki stages add to Combat Power, and haki stamina refills each month', () => {
    const t = fresh();
    const ctx = ctxOf(t);
    const before = powersView(t.state, data)!.combat.total;
    openTrack(ctx, 'track_armament', { source: 'test', quiet: true });
    setStage(ctx, 'track_armament', 2);
    t.run(1);
    const view = powersView(t.state, data)!;
    expect(view.combat.total).toBeGreaterThan(before);
    expect(view.combat.bonus.some((b) => b.source.startsWith('Armament Haki'))).toBe(true);
    expect(view.stamina?.pool).toBeGreaterThan(0);
    expect(view.stamina?.current).toBe(view.stamina?.pool);
  });
});

// ---- Styles from their teachers -----------------------------------------------------------

describe('Done when: each fighting style is learnable from its teacher and place, and its techniques appear on the sheet', () => {
  const taught = Object.values(data.tracks).filter((tr) => tr.learn.how === 'teacher');
  it.each(taught.map((tr) => [tr.id, tr] as [string, Track]))('%s', (id, track) => {
    for (const teacher of track.learn.teachers) {
      const t = fresh();
      const p = t.player();
      mighty(p);
      p.character!.berries = 10_000_000;
      p.flags['marine.enlisted'] = true;
      p.flags[track.learn.outsiderFlag ?? 'none'] = true;
      const powers = p.character!.powers ?? (p.character!.powers = undefined as never);
      void powers;
      for (const [kind, n] of Object.entries(track.learn.requires.gear)) {
        const c = p.character!;
        c.powers ??= {
          tracks: {},
          focus: null,
          fruit: null,
          stamina: 0,
          moves: [],
          drafts: [],
          events: {},
          items: [],
          gear: {},
          known: {},
          rumours: [],
        };
        c.powers.gear[kind] = n ?? 1;
      }
      for (const [other, stage] of Object.entries(track.learn.requires.tracks)) {
        const ot = data.tracks[other]!;
        setStage(
          ctxOf(t),
          other,
          ot.stages.findIndex((s) => s.id === stage),
        );
      }
      // Somewhere this teacher teaches.
      const place =
        teacher.places[0] ??
        Object.values(data.locations).find(
          (l) =>
            (teacher.features.length === 0 ||
              teacher.features.some((f) => l.features.includes(f))) &&
            (teacher.regions.length === 0 || teacher.regions.includes(l.region)) &&
            !l.tags.includes('dev'),
        )!.id;
      t.act({ type: 'debug/teleport', location: place });
      // Away from any teaching place, it cannot be learned.
      t.act({ type: 'powers/learn', track: id });
      const ts = trackStateOf(t.player().character!, id);
      expect(ts, `${teacher.name} at ${place}`).toBeDefined();
      // The best teacher at the place takes them on (there may be more than one).
      expect(ts?.teacherMult).toBeGreaterThanOrEqual(teacher.mult);
      const first = track.stages[0] as TrackStage;
      const view = powersView(t.state, data)!;
      for (const tech of first.techniques) {
        expect(
          view.moves.some((m) => m.id === tech),
          `${tech} on the sheet`,
        ).toBe(true);
      }
    }
  });

  it('nowhere near a teacher, a taught style cannot be begun', () => {
    const t = fresh();
    mighty(t.player());
    t.act({ type: 'debug/teleport', location: 'loc_syrup_village' });
    expect(() => t.act({ type: 'powers/learn', track: 'track_fishman_karate' })).toThrow(
      /teacher|trust/,
    );
  });

  it('styles only an event opens are opened by their event (Okama Kenpo, Dragon Claw, Oden, Sulong)', () => {
    for (const [eventId, trackId] of [
      ['evt_okama_invitation', 'track_okama_kenpo'],
      ['evt_revolutionary_teacher', 'track_dragon_claw'],
      ['evt_oden_scroll', 'track_oden_two_sword'],
      ['evt_full_moon', 'track_sulong'],
    ] as const) {
      const event = data.events[eventId]!;
      const choice = event.choices.find((c) =>
        c.effects.some((e) => e.kind === 'learnTrack' && e.track === trackId),
      );
      expect(choice, `${eventId} teaches ${trackId}`).toBeDefined();
      const t = fresh();
      if (trackId === 'track_oden_two_sword') setStage(ctxOf(t), 'track_swordsmanship', 2);
      t.act({ type: 'debug/forceEvent', eventId });
      t.run(1, 'stop');
      const pending = t.state.pending.find((d) => d.eventId === eventId);
      expect(pending, eventId).toBeDefined();
      t.act({ type: 'decision/resolve', decisionId: pending!.id, choiceId: choice!.id });
      expect(trackStateOf(t.player().character!, trackId), trackId).toBeDefined();
    }
  });

  it('Minks are born with Electro, Skypieans with Mantra and a first sense of Observation', () => {
    const mink = startLife({
      seed: 'mink',
      race: 'race_mink',
      birthplace: 'bp_zou',
      legacy: 'random',
      entryYear: 30,
      entryAge: 20,
    });
    expect(trackStateOf(mink.player().character!, 'track_electro')).toBeDefined();
    const sky = startLife({
      seed: 'sky',
      race: 'race_skypiean',
      birthplace: 'bp_sky_island',
      legacy: 'random',
      entryYear: 30,
      entryAge: 20,
    });
    expect(trackStateOf(sky.player().character!, 'track_mantra')).toBeDefined();
    expect(trackStateOf(sky.player().character!, 'track_observation')).toBeDefined();
  });
});

// ---- Every track, stage by stage -------------------------------------------------------------

/** Meet whatever a stage asks for, but the progress and the breakthrough. */
function prepare(t: TestLife, track: Track, stage: TrackStage): void {
  const p = t.player();
  const c = p.character!;
  const ctx = ctxOf(t);
  const r = stage.requires;
  for (const [other, stageId] of Object.entries(r.tracks)) {
    const ot = data.tracks[other]!;
    if (!trackStateOf(c, other)) openTrack(ctx, other, { source: 'test', quiet: true });
    setStage(
      ctx,
      other,
      ot.stages.findIndex((s) => s.id === stageId),
    );
  }
  for (const id of r.anyTraits) giveTraitTo(data, p, id, 'test', t.state.tick);
  for (const id of r.notTraits) removeTrait(data, p, id);
  Object.assign(p.flags, r.flags);
  for (const [kind, n] of Object.entries(r.gear)) c.powers!.gear[kind] = n ?? 1;
  if (r.races.length > 0) c.race = r.races[0]!;
  let place = r.places[0];
  if (!place && r.features.length > 0)
    place = Object.values(data.locations).find((l) =>
      r.features.some((f) => l.features.includes(f)),
    )!.id;
  if (place) t.act({ type: 'debug/teleport', location: place });
  const ts = trackStateOf(c, track.id)!;
  if (r.teacher) ts.taughtAt = p.character!.place ?? playerPerson(t.state, data)!.place.id;
  if (r.teacher) ts.teacherMult = ts.teacherMult ?? 1.2;
  if (r.event) notePowerEvent(c, r.event, t.state.tick);
}

function climbable(track: Track): boolean {
  return true || track;
}

const families = ['haki', 'fruit', 'six_powers', 'sword', 'style', 'weapon'];
const allTracks = Object.values(data.tracks).filter(
  (tr) => families.includes(tr.family) && climbable(tr),
);

describe('Done when: every haki, fruit, Six Powers, sword, Fish-Man Karate and Jujutsu track can be climbed stage by stage, and a plateau breaks only on a breakthrough', () => {
  it('the tracks the plan names are all here', () => {
    for (const id of [
      'track_observation',
      'track_armament',
      'track_conqueror',
      'track_paramecia',
      'track_zoan',
      'track_logia',
      'track_soru',
      'track_geppo',
      'track_tekkai',
      'track_shigan',
      'track_rankyaku',
      'track_kami_e',
      'track_swordsmanship',
      'track_two_sword',
      'track_three_sword',
      'track_oden_two_sword',
      'track_iai',
      'track_asura',
      'track_fishman_karate',
      'track_fishman_jujutsu',
    ]) {
      expect(data.tracks[id], id).toBeDefined();
    }
  });

  it.each(allTracks.map((tr) => [tr.id, tr] as [string, Track]))(
    '%s climbs to its last stage',
    (id, track) => {
      const t = fresh();
      const p = t.player();
      mighty(p);
      for (const k of ['trait_kings_qualities', 'trait_voice_of_all_things', 'trait_demon_aura'])
        giveTraitTo(data, p, k, 'test', t.state.tick);
      if (track.family === 'fruit') {
        // A fruit of this type, eaten.
        const fruit = Object.values(data.fruits).find((f) => f.type === track.fruitType)!;
        const entity = t.state.entities[fruit.id]!;
        setUser(t.state, data, entity, p, { tick: t.state.tick, text: 'test' });
      } else {
        openTrack(ctxOf(t), id, { source: 'test', quiet: true });
      }
      const c = p.character!;
      let plateaus = 0;
      for (let i = 1; i < track.stages.length; i++) {
        const stage = track.stages[i] as TrackStage;
        const ts = trackStateOf(c, id)!;
        // A strong character may clear several stages at once when nothing else stands in the way.
        if (ts.stage >= i) continue;
        prepare(t, track, stage);
        if (stage.requires.breakthrough) {
          // A plateau: practice alone never opens it.
          for (let n = 0; n < 400; n++)
            addProgress({ ...ctxOf(t), rng: Rng.root('p').fork(n) }, id, 5, 'fight');
          expect(ts.stage, `${stage.id} is a plateau`).toBe(i - 1);
          breakthroughTrack(ctxOf(t), id);
          plateaus += 1;
        }
        for (let n = 0; n < 4000 && ts.stage < i; n++) {
          prepare(t, track, stage);
          addProgress({ ...ctxOf(t), rng: Rng.root('c').fork(n) }, id, 5, 'fight');
        }
        expect(ts.stage, `${track.name}: ${stage.name}`).toBeGreaterThanOrEqual(i);
      }
      expect(plateaus, 'every plateau was met').toBe(
        track.stages.filter((s) => s.requires.breakthrough).length,
      );
      expect(trackStateOf(c, id)!.stage).toBe(track.stages.length - 1);
    },
  );

  it('a track left unused for years rusts inside its stage, never below it', () => {
    const t = fresh();
    const ctx = ctxOf(t);
    openTrack(ctx, 'track_brawling', { source: 'test', quiet: true });
    const ts = trackStateOf(t.player().character!, 'track_brawling')!;
    ts.stage = 1;
    ts.progress = 90;
    ts.lastUsed = t.state.tick;
    t.player().character!.life!.routine = [];
    t.run(12 * 8);
    expect(ts.progress).toBeLessThan(90);
    expect(ts.progress).toBeGreaterThanOrEqual(data.tracks['track_brawling']!.stages[1]!.at);
    expect(ts.stage).toBe(1);
  });

  it('race and talent set ceilings: an ordinary talent stops before Grandmaster', () => {
    const t = fresh();
    mighty(t.player());
    t.player().character!.hidden!.talent = 'ordinary';
    const ctx = ctxOf(t);
    openTrack(ctx, 'track_fishman_karate', { source: 'test', quiet: true });
    for (let n = 0; n < 3000; n++) {
      notePowerEvent(t.player().character!, 'water_time', t.state.tick);
      if (n % 100 === 0) breakthroughTrack(ctx, 'track_fishman_karate');
      addProgress({ ...ctx, rng: Rng.root('o').fork(n) }, 'track_fishman_karate', 5, 'fight');
    }
    const ts = trackStateOf(t.player().character!, 'track_fishman_karate')!;
    expect(data.tracks['track_fishman_karate']!.stages[ts.stage]!.level).not.toBe('grandmaster');
  });
});

// ---- Movesets -------------------------------------------------------------------------------

describe('Done when: 40 canon movesets load by era', () => {
  const late = life('movesets', { entryYear: 38, entryAge: 22 });

  it('forty canon fighters have movesets, and every technique exists', () => {
    const sets = Object.values(data.movesets);
    expect(sets.length).toBeGreaterThanOrEqual(40);
    const index = techniqueIndex(data);
    for (const ms of sets)
      for (const era of ms.eras)
        for (const tech of era.techniques) expect(index.has(tech), tech).toBe(true);
  });

  it.each(Object.values(data.movesets).map((ms) => [ms.char, ms] as const))(
    '%s knows only the moves of their era',
    (char, ms) => {
      for (const era of ms.eras) {
        // Met fresh in that era (a clone of the world, the character as they were then).
        const state: WorldState = structuredClone(late.state);
        const entity = state.entities[char]!;
        expect(entity, char).toBeDefined();
        delete (entity.character as { powers?: unknown }).powers;
        const tick = tickOfWhen(era.from);
        expect(eraAt(ms, tick)).toBe(era);
        delete entity.flags['moveset.era'];
        applyCanonEra(state, data, entity, tick);
        const moves = entity.character?.powers?.moves ?? [];
        const known = new Set(moves.map((m) => m.id));
        for (const tech of era.techniques)
          expect(known.has(tech), `${char} in ${1486 + era.from.year} SC knows ${tech}`).toBe(true);
        // Nothing from a later era: their own moves are exactly the era's, and a style teaches only
        // up to the stage they had reached then.
        for (const m of moves.filter((x) => x.source === 'canon' || x.source === 'fruit'))
          expect(era.techniques, m.id).toContain(m.id);
        const laterOnly = ms.eras
          .filter((e) => tickOfWhen(e.from) > tick)
          .flatMap((e) => e.techniques)
          .filter((x) => !era.techniques.includes(x));
        for (const x of laterOnly) {
          const taught = moves.find((m) => m.id === x);
          expect(
            taught === undefined || taught.source.startsWith('track:'),
            `${x} not yet known`,
          ).toBe(true);
        }
      }
      expect(movesetOfCast(data, char)).toBe(ms);
    },
  );
});

describe('Done when: 1,000 generated fighters get movesets that fit their style, fruit and personality', () => {
  it('a thousand fighters, each moveset built from what they are', () => {
    const t = life('fighters', { entryYear: 30 });
    const state = t.state;
    const occupations = Object.keys(data.powers.fighters).sort();
    const cultures = [
      'bp_wano',
      'bp_fishman_island',
      'bp_west_blue_port',
      'bp_east_blue_village',
      'bp_zou',
      'bp_new_world_island',
    ];
    let aggressiveOffence = 0;
    let aggressiveOwn = 0;
    let cautiousOffence = 0;
    let cautiousOwn = 0;
    let withFruit = 0;
    for (let i = 0; i < 1000; i++) {
      const r = Rng.root('fighter').fork(i);
      const culture = cultures[i % cultures.length]!;
      const race =
        culture === 'bp_fishman_island'
          ? 'race_fishman'
          : culture === 'bp_zou'
            ? 'race_mink'
            : 'race_human';
      const id = `gen_${String(900000 + i)}`;
      const temper = i % 3 === 0 ? ['trait_hot_headed'] : i % 3 === 1 ? ['trait_cautious'] : [];
      const entity: Entity = {
        id,
        type: 'character',
        origin: 'generated',
        name: `Fighter ${i}`,
        createdTick: state.tick,
        tier: 2,
        flags: {},
        stats: Object.fromEntries(
          [
            'strength',
            'speed',
            'endurance',
            'durability',
            'dexterity',
            'intellect',
            'willpower',
            'charisma',
            'perception',
            'luck',
          ].map((s) => [s, { base: 50, mods: [] }]),
        ),
        knownBy: [],
        character: {
          givenName: 'Fighter',
          familyName: String(i),
          pronouns: 'they',
          race,
          birthTick: state.tick - 12 * r.int(20, 50),
          birthplace: culture,
          alive: true,
          traits: [...temper],
          appearance: {},
          scars: [],
          relationships: [],
          berries: 0,
          occupation: occupations[i % occupations.length]!,
          place: data.birthplaces[culture]!.location,
          npc: { goal: 'glory' },
        },
      };
      state.entities[id] = entity;
      armFighter(state, data, entity, state.tick, r);
      if (i % 10 === 0) {
        const fruit = makeGeneratedFruit(
          state,
          data,
          state.tick,
          r.fork('fruit'),
          undefined,
          culture,
        );
        setUser(state, data, fruit, entity, { tick: state.tick, text: 'test' });
        const ft = Object.keys(entity.character!.powers!.tracks).find(
          (k) => data.tracks[k]?.family === 'fruit',
        )!;
        entity.character!.powers!.tracks[ft]!.progress = 60;
      }
      const moves = generatedMoves(state, data, entity, state.seed);
      const tracks = Object.keys(entity.character!.powers?.tracks ?? {});
      expect(moves.length, id).toBeGreaterThan(0);
      for (const m of moves) {
        // Every move comes from something they have: a style they know, or their fruit.
        if (m.source === 'fruit') expect(entity.character!.powers!.fruit, id).not.toBeNull();
        else expect(tracks, `${id} ${m.id}`).toContain(m.source.replace('track:', ''));
      }
      if (entity.character!.powers!.fruit) {
        withFruit += 1;
        expect(
          moves.some((m) => m.source === 'fruit'),
          `${id} uses their fruit`,
        ).toBe(true);
      }
      const own = moves.filter((m) => m.def && m.id.startsWith('tech_gen_'));
      const temperament = temperamentOf(data, entity);
      if (temperament === 'aggressive') {
        aggressiveOwn += own.length;
        aggressiveOffence += own.filter((m) => isOffence(m.def!.form)).length;
      } else if (temperament === 'cautious') {
        cautiousOwn += own.length;
        cautiousOffence += own.filter((m) => isOffence(m.def!.form)).length;
      }
      // Built the same way every time (rule 6).
      expect(generatedMoves(state, data, entity, state.seed)).toEqual(moves);
    }
    // The hundred given a fruit here, and the few (about 4%) who came by one on their own.
    expect(withFruit).toBeGreaterThanOrEqual(100);
    expect(withFruit).toBeLessThan(200);
    // An aggressive brawler leans to offence; a cautious one to counters and guards.
    expect(aggressiveOffence / aggressiveOwn).toBeGreaterThan(cautiousOffence / cautiousOwn + 0.2);
  }, 120_000);

  it('names follow the culture: a Wano fighter and a Fish-Man do not sound alike', () => {
    const wano = data.powers.generator.grammars['bp_wano']!;
    const fishman = data.powers.generator.grammars['bp_fishman_island']!;
    expect(wano.patterns.join()).not.toEqual(fishman.patterns.join());
  });
});

// ---- The technique creator ---------------------------------------------------------------------

describe('Done when: a player-invented technique is priced from its parts and appears in battle', () => {
  it('priced from its parts, it comes together with practice, then it is used in a fight', () => {
    const t = fresh();
    const ctx = ctxOf(t);
    openTrack(ctx, 'track_brawling', { source: 'test', quiet: true });
    setStage(ctx, 'track_brawling', 2);
    t.act({
      type: 'powers/invent',
      source: 'track_brawling',
      form: 'barrage',
      tag: 'blunt',
      name: 'Harbour Hammer',
    });
    const draft = t.player().character!.powers!.drafts[0]!;
    const expected = priceTechnique(data, {
      form: 'barrage',
      tags: ['blunt'],
      mastery: Math.round((2 / 3) * 100),
    });
    expect(draft.def.power).toBe(expected.power);
    expect(draft.def.cost).toBe(expected.cost);
    expect(draft.def.accuracy).toBe(expected.accuracy);
    // A different form prices differently.
    expect(priceTechnique(data, { form: 'area', tags: ['blunt'], mastery: 67 }).power).not.toBe(
      expected.power,
    );

    t.player().character!.life!.routine = [{ activity: 'act_style_drills', effort: 'hard' }];
    for (let i = 0; i < 48 && t.player().character!.powers!.drafts.length > 0; i++) t.run(1);
    const move = t.player().character!.powers!.moves.find((m) => m.def?.name === 'Harbour Hammer');
    expect(move, 'invented').toBeDefined();
    expect(t.state.log.some((r) => r.summary.includes('Harbour Hammer'))).toBe(true);

    const actions = battleActions(data, t.player(), t.state.tick);
    expect(actions.find((a) => a.name === 'Harbour Hammer')?.power).toBeGreaterThan(0);
    // Sparring and real fights use what you know: it gets used, and counted.
    t.player().character!.life!.routine = [{ activity: 'act_spar', effort: 'normal' }];
    for (let i = 0; i < 24 && (move?.uses ?? 0) === 0; i++) t.run(1);
    expect(move!.uses).toBeGreaterThan(0);
    t.act({ type: 'powers/rename', move: move!.id, name: 'Dock Hammer' });
    expect(powersView(t.state, data)!.moves.find((m) => m.id === move!.id)?.name).toBe(
      'Dock Hammer',
    );
  });

  it('a combination technique needs two people close enough, and lands in both movesets', () => {
    const t = fresh();
    const ctx = ctxOf(t);
    openTrack(ctx, 'track_brawling', { source: 'test', quiet: true });
    const p = t.player();
    const friendRel = p.character!.relationships[0]!;
    const friend = t.state.entities[friendRel.id]!;
    expect(() =>
      t.act({
        type: 'powers/combine',
        partner: friend.id,
        move: 'tech_brawl_haymaker',
        partnerMove: 'tech_brawl_headbutt',
        name: 'Two Fists',
      }),
    ).toThrow();
    friendRel.opinion.mods.push({ source: 'test', value: 100, kind: 'flat' });
    friend
      .character!.relationships.find((r) => r.id === p.id)!
      .opinion.mods.push({ source: 'test', value: 100, kind: 'flat' });
    openTrack({ ...ctx, entity: friend, c: friend.character! }, 'track_brawling', {
      source: 'test',
      quiet: true,
    });
    t.act({
      type: 'powers/combine',
      partner: friend.id,
      move: 'tech_brawl_haymaker',
      partnerMove: 'tech_brawl_headbutt',
      name: 'Two Fists',
    });
    expect(p.character!.powers!.moves.some((m) => m.def?.name === 'Two Fists')).toBe(true);
    expect(friend.character!.powers!.moves.some((m) => m.def?.name === 'Two Fists')).toBe(true);
    expect(statValue(friendRel.opinion, t.state.tick)).toBeGreaterThan(60);
  });

  it('unused techniques fade; the most used becomes the signature', () => {
    const t = fresh();
    const ctx = ctxOf(t);
    openTrack(ctx, 'track_brawling', { source: 'test', quiet: true });
    const moves = t.player().character!.powers!.moves;
    moves[0]!.uses = 30;
    const view = powersView(t.state, data)!;
    expect(view.moves.find((m) => m.id === moves[0]!.id)?.signature).toBe(true);
    t.player().character!.life!.routine = [];
    t.run(12 * 10);
    expect(moves.some((m) => m.mastery < 10 || m.faded)).toBe(true);
  });
});

describe('haki colours', () => {
  it('there are three, and only Conqueror is hidden until it wakes', () => {
    expect(HAKI_COLOURS).toEqual(['observation', 'armament', 'conqueror']);
    const t = fresh();
    const names = powersView(t.state, data)!.tracks.map((tr) => tr.id);
    expect(names).not.toContain('track_conqueror');
    expect(names).toContain('track_observation');
  });
});
