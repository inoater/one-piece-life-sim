import type { GameData } from '../../engine/data/schemas';
import { entityIds } from '../../engine/entities';
import { Rng } from '../../engine/rng';
import type { Entity, WorldState } from '../../engine/state';
import type { LifeEnv } from '../life/env';
import { behaviourMonth, drift, driftCtxOf, seedPersonality } from '../life/personality';
import { worldBuilt } from '../places/setup';
import { fruitDefOf } from './catalogue';
import {
  buildFruitLayer,
  discoveryMonth,
  fruitsBuilt,
  seedGeneratedFruits,
  setUser,
  makeGeneratedFruit,
} from './fruits';
import { refillStamina, seedMonth } from './haki';
import { applyCanonEra, arm } from './movesets';
import { fadeMoves, learnMove } from './techniques';
import { statTotal } from '../life/body';
import { ensurePowers } from './state';
import {
  line,
  openTrack,
  powerCtxOf,
  powerCtxFor,
  refreshPowerMods,
  rustMonth,
  tell,
} from './tracks';

/**
 * The powers' part of the player's month (step 7) and of building a world (Phase 4).
 */

/** The player's month: stamina refills, unused tracks rust and moves fade, an eaten fruit is
 * understood bit by bit, Train Spirit seeds may wake haki, a Mythical Zoan pulls at its user, and
 * the month's behaviour counts toward earned traits and personality. */
export function powersMonth(env: LifeEnv): void {
  const { state, data, p, tick } = env;
  const ctx = powerCtxOf(env);
  if (p.c.powers) {
    refillStamina(data, p.entity, tick + 1);
    rustMonth(ctx);
    fadeMoves(data, p.entity, tick);
    discoveryMonth(env);
    const record = p.c.powers.fruit;
    if (record && !record.dud) {
      const def = fruitDefOf(data, state.entities[record.id]);
      if (def?.will && env.rng.fork('will').chance(0.25)) {
        const tag = Object.entries(data.personality.tags).find(
          ([, rule]) =>
            rule.axis === def.will?.axis && Math.sign(rule.by) === Math.sign(def.will?.toward ?? 0),
        )?.[0];
        if (tag) drift(driftCtxOf(env), [tag]);
      }
      // Awakening is the fruit track's last stage; its flag makes the fruit's awakened modifiers count.
      if (p.entity.flags['fruit.awakened'] === true && !record.awakened) {
        record.awakened = true;
        refreshPowerMods(data, p.entity, tick, state);
      }
    }
  }
  sixPowers(env);
  seedMonth(ctx);
  behaviourMonth(env);
}

/**
 * The Six Powers: mastering four opens the elite agent ranks (a flag Phase 9 reads); mastering all
 * six with Willpower 70 opens the seventh, Rokuogan.
 */
function sixPowers(env: LifeEnv): void {
  const { data, p, tick } = env;
  const tracks = p.c.powers?.tracks ?? {};
  let mastered = 0;
  for (const [id, ts] of Object.entries(tracks)) {
    const track = data.tracks[id];
    if (track?.group === 'six_powers' && ts.stage >= track.stages.length - 1) mastered += 1;
  }
  if (mastered === 0) return;
  p.entity.flags['six_powers.mastered'] = mastered;
  if (mastered >= 4) p.entity.flags['cp.elite'] = true;
  const rokuogan = data.techniques['tech_rokuogan'];
  if (mastered < 6 || !rokuogan || statTotal(p.entity, 'willpower', tick) < 70) return;
  if (p.c.powers?.moves.some((m) => m.id === rokuogan.id)) return;
  learnMove(p.entity, { id: rokuogan.id, source: 'track:track_soru', learnedTick: tick });
  tell(powerCtxOf(env), line(data, 'rokuogan'), { title: rokuogan.name }, ['technique']);
}

/**
 * A new person's powers from birth: tracks open to their people from birth (a Mink's Electro, a
 * Skypiean's Mantra and its first sense of Observation), and their personality's starting point.
 */
export function bornPowers(state: WorldState, data: GameData, entity: Entity, tick: number): void {
  const c = entity.character;
  if (!c) return;
  const ctx = powerCtxFor(state, data, entity, tick, Rng.root(`born:${entity.id}`));
  if (!ctx) return;
  for (const track of Object.values(data.tracks).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (track.learn.how !== 'innate' || track.learn.requires.races.length === 0) continue;
    if (!track.learn.requires.races.includes(c.race)) continue;
    openTrack(ctx, track.id, { source: 'Born with it', quiet: true });
  }
  const mantra = entity.flags['haki.observation'];
  if (typeof mantra === 'number' && mantra >= 1 && data.tracks['track_observation']) {
    openTrack(ctx, 'track_observation', { source: 'Mantra, from birth', quiet: true });
  }
  seedPersonality(data, c);
}

/**
 * Give a world built before Phase 4 its fruits (as they stand now), its generated fruits, its
 * fighters' powers and its canon cast's eras: the first month it runs.
 */
export function ensureFruitLayer(state: WorldState, data: GameData): boolean {
  if (!worldBuilt(state) || fruitsBuilt(state)) return false;
  const rng = Rng.root(state.seed).fork('fruits-late');
  buildFruitLayer(state, data, state.tick, rng.fork('canon'));
  seedGeneratedFruits(state, data, state.tick, rng.fork('generated'));
  for (const id of entityIds(state)) {
    const entity = state.entities[id] as Entity;
    if (!entity.character?.alive) continue;
    if (id in data.cast) applyCanonEra(state, data, entity, state.tick);
    else if (entity.tier === 2 && entity.character.occupation)
      armFighter(state, data, entity, state.tick, rng.fork('arm', id));
  }
  return true;
}

/** A generated fighter's powers, and now and then a fruit of their own (Phase 4). */
export function armFighter(
  state: WorldState,
  data: GameData,
  entity: Entity,
  tick: number,
  rng: Rng,
): void {
  const c = entity.character;
  if (!c?.occupation || !data.powers.fighters[c.occupation]) return;
  arm(state, data, entity, tick, rng.fork('arm'));
  if (!fruitsBuilt(state) || !rng.fork('fruit?').chance(data.powers.fruit.fighterChance)) {
    ensurePowers(c).moves = [];
    return;
  }
  const fruit = makeGeneratedFruit(state, data, tick, rng.fork('fruit'), undefined, c.birthplace);
  setUser(state, data, fruit, entity, { tick, text: `${entity.name} ate it.`, identified: true });
  // A fighter with a fruit has had some years with it.
  for (const [id, ts] of Object.entries(ensurePowers(c).tracks)) {
    if (data.tracks[id]?.family === 'fruit')
      ts.progress = Math.round(rng.fork('mastery').float(5, 60));
  }
  refreshPowerMods(data, entity, tick, state);
  // Their moveset is generated from all this when someone looks (movesets.ts); nothing to store.
  ensurePowers(c).moves = [];
}
