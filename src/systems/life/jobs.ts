import type { GameData, Job } from '../../engine/data/schemas';
import type { WorldState } from '../../engine/state';
import {
  humanAgeOf,
  isJailed,
  raceYearsFor,
  reputation,
  requirementReason,
  type Person,
} from './body';
import { lifeLog, renderLife, reportLine, type LifeEnv } from './env';

/**
 * Jobs (Phase 2): a job is held, not done once. Working it is the "Work a shift" activity, which
 * pays the job's wage (scaled by effort), trains its stats on the side and draws one of its
 * outcomes. Requirements come from the job file: an age, a place, stats or Combat Power. Some
 * jobs grant flags that open other things (the smith's path) or carry a rank track.
 */

/** Why this person cannot take this job, or null. */
export function jobLock(
  state: WorldState,
  data: GameData,
  p: Person,
  job: Job,
  tick: number,
): string | null {
  const life = p.c.life;
  if (!p.c.alive) return 'Your life has ended';
  if (life && isJailed(life, tick)) return 'Not from a cell';
  if (humanAgeOf(data, p, tick) < job.minAge)
    return `From age ${raceYearsFor(data, p.race, job.minAge)}`;
  if (life?.job?.id === job.id) return 'Your current job';
  return requirementReason(state, data, p, job.requires, tick);
}

export function takeJob(env: LifeEnv, job: Job): void {
  const { life, p, tick, data } = env;
  life.job = { id: job.id, sinceTick: tick, months: 0 };
  Object.assign(p.entity.flags, job.grants);
  if (job.ranks) {
    const first = job.ranks.titles[0];
    if (first) p.entity.flags[job.ranks.flag] = first;
  }
  const text = renderLife(env, data.life.lines.hired, { job: job.name.toLowerCase() });
  lifeLog(env, text, { kind: 'event', tags: ['personal', 'work', 'money'] });
  reportLine(env, text, 'good');
}

export function quitJob(env: LifeEnv): void {
  const { life, data } = env;
  if (!life.job) return;
  const job = data.jobs[life.job.id];
  const text = renderLife(env, data.life.lines.quit, {
    job: (job?.name ?? life.job.id).toLowerCase(),
  });
  life.job = null;
  lifeLog(env, text, { tags: ['personal', 'work'] });
  reportLine(env, text, 'plain');
}

/** A month of service: counts toward the next rank. */
export function advanceJob(env: LifeEnv, job: Job): void {
  const { life, p, data } = env;
  if (!life.job) return;
  life.job.months += 1;
  const ranks = job.ranks;
  if (!ranks) return;
  const index = Math.min(ranks.titles.length - 1, Math.floor(life.job.months / ranks.everyMonths));
  const title = ranks.titles[index];
  if (!title || p.entity.flags[ranks.flag] === title) return;
  p.entity.flags[ranks.flag] = title;
  const text = renderLife(env, data.life.lines.promoted, {
    months: String(life.job.months),
    title,
  });
  lifeLog(env, text, { kind: 'event', tags: ['personal', 'work'] });
  reportLine(env, text, 'good');
  reputation(p.entity, 'fame').base += 1;
}
