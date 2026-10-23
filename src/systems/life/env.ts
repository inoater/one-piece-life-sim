import { dateOf, templateVarsFor } from '../../engine/calendar';
import type { GameData } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import type { Rng } from '../../engine/rng';
import type { EventRecord, LifeData, MonthReport, WorldState } from '../../engine/state';
import { renderTemplate } from '../../engine/template';
import { storyVars } from '../events';
import { capitalize, numberWords } from '../genesis/text';
import { ageYears, stageOf, type Person } from './body';

/**
 * What every part of the life loop works with while it changes one person's month: the world, the
 * data, the month, a keyed random stream, the person and their life block, and what caused the
 * change (for the log's cause chain, rule 6).
 */
export interface LifeEnv {
  state: WorldState;
  data: GameData;
  tick: number;
  rng: Rng;
  p: Person;
  life: LifeData;
  /** "act_spar#won", "evt_debt_collector", "sys:life". */
  cause: string;
  causeSeq?: number;
}

export function withCause(env: LifeEnv, cause: string, causeSeq?: number, rng?: Rng): LifeEnv {
  const next: LifeEnv = { ...env, cause, rng: rng ?? env.rng };
  if (causeSeq !== undefined) next.causeSeq = causeSeq;
  else delete next.causeSeq;
  return next;
}

/** The month-end card for this month, started if it is not already. */
export function reportOf(env: LifeEnv): MonthReport {
  const { life, tick } = env;
  if (!life.report || life.report.tick !== tick) {
    life.report = {
      tick,
      done: [],
      vigor: { pool: 0, spent: 0 },
      berries: { income: 0, costs: 0 },
      lines: [],
    };
  }
  return life.report;
}

export function reportLine(
  env: LifeEnv,
  text: string,
  tone: 'good' | 'bad' | 'plain' | 'alert',
): void {
  reportOf(env).lines.push({ text, tone });
}

/** Money in or out, counted on the month-end card. */
export function pay(env: LifeEnv, amount: number): void {
  if (amount === 0) return;
  env.p.c.berries += amount;
  const report = reportOf(env).berries;
  if (amount > 0) report.income += amount;
  else report.costs -= amount;
}

/**
 * The variables that stay the same for a whole month, built once per month and person: a busy
 * month renders a dozen sentences, and the world's variables cost a walk over the family.
 */
const monthVars = new WeakMap<WorldState, { key: string; vars: Record<string, string> }>();

function baseVars(env: LifeEnv): Record<string, string> {
  const { data, state, tick, p } = env;
  const key = `${tick}:${p.entity.id}:${p.entity.name}`;
  const cached = monthVars.get(state);
  if (cached?.key === key) return cached.vars;
  const age = ageYears(p.c, tick);
  const vars: Record<string, string> = {
    ...templateVarsFor(dateOf(data.calendar, tick)),
    ...storyVars(state, data),
    age: String(age),
    ageWords: numberWords(age),
    home: p.home.home,
    stage: stageOf(data, p, tick).name.toLowerCase(),
    name: p.entity.name,
    other: 'someone',
    job: 'a worker',
    amount: '0',
    parent: 'your family',
    sibling: 'your family',
    friend: 'a friend',
    spouse: 'your spouse',
    child: 'your child',
    mentor: 'your teacher',
    sweetheart: 'your sweetheart',
    protege: 'your apprentice',
    injury: 'an injury',
    illness: 'an illness',
    gang: 'your gang',
    title: '',
    cause: 'unknown causes',
    stat: 'body',
    months: '0',
  };
  monthVars.set(state, { key, vars });
  return vars;
}

/** Variables for life-loop text: the world's, plus this person's age, home and the people named. */
export function lifeVars(
  env: LifeEnv,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return { ...baseVars(env), ...extra };
}

export function renderLife(
  env: LifeEnv,
  template: string,
  extra: Readonly<Record<string, string>> = {},
): string {
  return capitalize(renderTemplate(template, lifeVars(env, extra)));
}

export interface LifeLogInput {
  /** "life" for the everyday, "event" for what "Skip to next event" should stop on. */
  kind?: 'life' | 'event' | 'family';
  tags?: string[];
  others?: string[];
  /** Who knows: the player by default; '*' for what the whole island hears of. */
  knownBy?: string[];
}

export function lifeLog(env: LifeEnv, summary: string, input: LifeLogInput = {}): EventRecord {
  const tags = input.tags ?? ['personal'];
  return appendLog(env.state, env.tick, {
    kind: input.kind ?? 'life',
    summary,
    tags: [...new Set(tags)],
    actorIds: [env.p.entity.id],
    targetIds: input.others ?? [],
    place: env.p.home.id,
    cause: env.cause,
    ...(env.causeSeq !== undefined ? { causeSeq: env.causeSeq } : {}),
    knownBy: input.knownBy ?? [env.p.entity.id],
  });
}
