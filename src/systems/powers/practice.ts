import type { Activity } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { Effort } from '../../engine/state';
import type { LifeEnv } from '../life/env';
import { hurt } from '../life/health';
import { withCause } from '../life/env';
import { fruitMastery, learnFruitTechniques } from './fruits';
import { spendStamina } from './haki';
import { notePowerEvent, trackStateOf } from './state';
import { chooseMove, draftsMonth, moveName, useMove } from './techniques';
import {
  addProgress,
  fightingTracks,
  line,
  powerCtxOf,
  practiceTarget,
  refreshPowerMods,
  tell,
} from './tracks';

/**
 * A month's practice of a power (Phase 4), run by any activity with `practice` in its data:
 * drills (x1) go to the track the activity names, sparring (x1.5) and real fights (x3) to the
 * focus or the fighting styles in use, teaching (x0.5) to what is taught. Haki training spends haki
 * stamina, and past the pool it costs Vigor. Practice also rolls for any technique being invented
 * on that track, and uses a technique (sparring and fights name it in the chronicle). A fruit at
 * low mastery brings mishaps that stop as mastery grows.
 */

export interface Practised {
  track: string | null;
  /** The technique used this month, for {technique} in the outcome. */
  technique: string | null;
  /** Vigor owed for haki stamina spent past the pool. */
  vigor: number;
}

const EFFORT_STAMINA: Record<Effort, number> = { light: 0.6, normal: 1, hard: 1.6 };

export function practise(
  env: LifeEnv,
  act: Activity,
  effort: Effort,
  lifeScale: number,
  rng: Rng,
): Practised | null {
  const practice = act.practice;
  if (!practice) return null;
  const { data, p, tick } = env;
  const ctx = { ...powerCtxOf(env), rng };
  const candidates = practice.tracks.length > 0 ? practice.tracks : fightingTracks(p.c, data);
  const target = practiceTarget(p.c, data, candidates);
  let vigor = 0;
  if (practice.stamina && target) {
    vigor = spendStamina(data, p.entity, data.powers.haki.trainingStamina * EFFORT_STAMINA[effort]);
  }
  if (act.tags.includes('blindfold')) notePowerEvent(p.c, 'blindfold', tick);
  if (act.tags.includes('water')) notePowerEvent(p.c, 'water_time', tick);
  let technique: string | null = null;
  if (target) {
    const ts = trackStateOf(p.c, target);
    if (ts) ts.months += 1;
    addProgress(ctx, target, practice.points * lifeScale, practice.kind);
    draftsMonth(ctx, target);
    const track = data.tracks[target];
    if (track?.family === 'fruit') {
      learnFruitTechniques(data, p.entity, tick, env.state);
      refreshPowerMods(data, p.entity, tick, env.state);
      mishap(env, rng.fork('mishap'));
    }
  }
  const fight = practice.kind === 'spar' || practice.kind === 'fight';
  const source = fight
    ? undefined
    : target
      ? data.tracks[target]?.family === 'fruit'
        ? 'fruit'
        : `track:${target}`
      : undefined;
  const move = chooseMove(data, p.entity, rng.fork('move'), tick, source);
  if (move && (fight || target)) {
    useMove(data, move, tick);
    technique = `your ${moveName(data, move)}`;
  }
  return { track: target, technique, vigor };
}

/** Low mastery: the power slips its leash (a stretched arm caught in a door, a flame in the galley). */
function mishap(env: LifeEnv, rng: Rng): void {
  const { data, p } = env;
  const rules = data.powers.fruit;
  const mastery = fruitMastery(data, p.c);
  if (mastery >= rules.mishapUntil) return;
  const chance = rules.mishapChance * (1 - mastery / rules.mishapUntil);
  if (!rng.chance(chance)) return;
  tell(powerCtxOf(env), line(data, 'mishap'), {}, ['fruit', 'mishap'], 'bad');
  hurt(withCause(env, 'sys:mishap'), 0.05, 'accident', 'their own power');
}
