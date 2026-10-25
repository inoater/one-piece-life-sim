import { advance, type AdvanceOptions } from '../../engine/advance';
import type { GameData } from '../../engine/data/schemas';
import { Rng } from '../../engine/rng';
import type { RoutineSlot } from '../../engine/state';
import { createLife } from '../genesis/generate';
import { ensureLife, isUnwell, slotsOf, vigorPoolOf } from '../life/body';
import { doctorCost } from '../life/activities';
import { commitMax, overtimeSlots } from '../life/drive';
import type { LifeEnv } from '../life/env';
import { jobLock, takeJob } from '../life/jobs';
import { repay } from '../life/money';
import { priceMult } from '../places/place';

/**
 * The economy sweep (Phase 6): one hard-working life with one job, from 16 in an East Blue village,
 * working every shift the month and its Vigor allow (Hard, pushed past Hard when there is Vigor to
 * spare), resting when spent, paying debts, buying nothing. How long until they can afford a
 * caravel at Loguetown's yard, and do they ever afford a galleon? The plan's target: a caravel in
 * three to five years of hard work, and a galleon as a mark of real success.
 */

export interface EarnerOptions {
  seed: string;
  job: string;
  /** Years to follow them (default 15). */
  years?: number;
  birthplace?: string;
}

export interface EarnerLife {
  seed: string;
  job: string;
  /** Null when the job could not be had (its requirements). */
  available: boolean;
  /** Months until their Berries first reached a caravel's price (null: never). */
  caravel: number | null;
  galleon: number | null;
  /** Berries after 5 years, and at the end. */
  at5: number;
  final: number;
  died: boolean;
}

export function shipPrice(
  data: GameData,
  state: Parameters<typeof priceMult>[0],
  vessel: string,
): number {
  return Math.round((data.vessels[vessel]?.cost ?? 0) * priceMult(state, data, 'loc_loguetown'));
}

/** A hard worker's month: as many shifts as Vigor allows, pushed past Hard with what is left. */
function plan(env: LifeEnv): RoutineSlot[] {
  const { data, p, life, tick } = env;
  const work = Object.values(data.activities).find((a) => a.worksJob);
  const rest =
    data.activities['act_sleep_in'] ??
    Object.values(data.activities).find((a) => a.restful && !a.doctor);
  if (!work) return [];
  const base = slotsOf(data, p, tick);
  const pool = vigorPoolOf(data, p.entity, tick);
  const slots = base + overtimeSlots(data, pool, base);
  const out: RoutineSlot[] = [];
  if (
    isUnwell(life, tick) &&
    p.c.berries >= doctorCost(env) + 500 &&
    data.activities['act_see_doctor']
  )
    out.push({ activity: 'act_see_doctor', effort: 'normal' });
  if (life.exhausted && rest) out.push({ activity: rest.id, effort: 'normal' });
  const hard = data.life.efforts.hard.vigor + work.extraVigor;
  const surcharge = data.life.drive.overtime.surcharge;
  let budget = pool;
  while (out.length < slots) {
    const cost = hard + (out.length >= base ? surcharge : 0);
    if (budget < cost) break;
    out.push({ activity: work.id, effort: 'hard' });
    budget -= cost;
  }
  // Vigor to spare goes into pushing the shifts past Hard.
  const most = commitMax(data, pool);
  for (const slot of out) {
    if (slot.activity !== work.id || budget <= 0) continue;
    const push = Math.min(most, budget);
    if (push > 0) {
      slot.commit = push;
      budget -= push;
    }
  }
  if (out.length === 0 && rest) out.push({ activity: rest.id, effort: 'normal' });
  return out;
}

export function runEarnerLife(
  data: GameData,
  options: EarnerOptions,
  advanceOptions: AdvanceOptions,
): EarnerLife {
  const { state, playerId } = createLife(
    data,
    {
      seed: options.seed,
      canonMode: 'canon',
      difficulty: 'normal',
      rareRaces: false,
      race: 'race_human',
      birthplace: options.birthplace ?? 'bp_east_blue_village',
      legacy: 'random',
      focus: 'random',
      entryYear: 20,
      entryAge: 16,
      pronouns: 'they',
    },
    { allowBlocked: true, population: 'none' },
  );
  state.flags['dev.quiet'] = true;
  const rng = Rng.root(options.seed);
  const out: EarnerLife = {
    seed: options.seed,
    job: options.job,
    available: true,
    caravel: null,
    galleon: null,
    at5: 0,
    final: 0,
    died: false,
  };
  const months = (options.years ?? 15) * 12;
  const job = data.jobs[options.job];
  for (let m = 0; m < months; m++) {
    const p = ensureLife(state, data);
    if (!p?.c.life || !p.c.alive) {
      out.died = true;
      break;
    }
    const env: LifeEnv = {
      state,
      data,
      tick: state.tick,
      rng: rng.fork('earner', m),
      p,
      life: p.c.life,
      cause: 'sys:earner',
    };
    if (job && p.c.life.job?.id !== job.id) {
      if (jobLock(state, data, p, job, state.tick) === null) takeJob(env, job);
      else if (m === 0) {
        out.available = false;
        break;
      }
    }
    if (p.c.life.debt > 0 && p.c.berries > 3000) repay(env, p.c.berries - 2000);
    p.c.life.routine = plan(env);
    advance(state, data, rng, { kind: 'months', count: 1 }, advanceOptions);
    const berries = state.entities[playerId]?.character?.berries ?? 0;
    if (out.caravel === null && berries >= shipPrice(data, state, 'vessel_caravel'))
      out.caravel = m + 1;
    if (out.galleon === null && berries >= shipPrice(data, state, 'vessel_galleon'))
      out.galleon = m + 1;
    if (m === 59) out.at5 = berries;
    out.final = berries;
  }
  return out;
}
