import { formatBerries } from '../genesis/text';
import { scheduleEvent } from '../events';
import { humanAgeOf } from './body';
import { lifeLog, pay, renderLife, reportLine, withCause, type LifeEnv } from './env';
import { hurt } from './health';
import { priceMult } from '../places/place';

/**
 * Money (Phase 2). Berries in hand are cash; what is owed to a loan shark is debt, which grows by
 * monthly interest. Cash that falls below zero (an indebted family, a month that cost more than it
 * paid) becomes debt: the shark covers it, at a price. Adults pay the cost of living where they
 * live; a debt beyond a threshold brings the collector (an event with choices); a debt beyond
 * what anyone will lend, with nothing in hand, means going hungry.
 */

export function monthOfMoney(env: LifeEnv): void {
  const { data, state, tick, p, life } = env;
  const m = data.life.money;
  const humanAge = humanAgeOf(data, p, tick);

  // At sea the fare, the ship's stores or the captain's table feed you instead (Phase 3).
  if (humanAge >= m.independentAge && !p.place.atSea) {
    const cost = Math.round(m.livingCost[p.place.wealth] * priceMult(state, data, p.place.id));
    pay(env, -cost);
    reportLine(
      env,
      renderLife(env, data.life.lines.livingCost, { amount: formatBerries(cost) }),
      'plain',
    );
  }

  if (humanAge >= m.interestFromAge && p.c.berries < 0) {
    life.debt += -p.c.berries;
    p.c.berries = 0;
    const text = renderLife(env, data.life.lines.broke);
    lifeLog(env, text, { tags: ['personal', 'money'] });
    reportLine(env, text, 'bad');
  }

  if (life.debt > 0 && humanAge >= m.interestFromAge) {
    const interest = Math.ceil((life.debt * m.interestPct) / 100);
    life.debt += interest;
    reportLine(
      env,
      renderLife(env, data.life.lines.interest, { amount: formatBerries(interest) }),
      'bad',
    );
  }

  const collector = m.collector;
  const due = life.collectorTick === null || tick - life.collectorTick >= collector.everyMonths;
  const coming =
    state.scheduled.some((s) => s.eventId === collector.eventId) ||
    state.pending.some((d) => d.eventId === collector.eventId);
  if (life.debt > collector.above && due && !coming && data.events[collector.eventId]) {
    life.collectorTick = tick;
    scheduleEvent(state, collector.eventId, tick + 1, 'sys:debt');
  }

  if (humanAge >= m.independentAge && p.c.berries <= 0 && life.debt >= m.maxDebt) {
    hurt(withCause(env, 'sys:hunger'), 0.1, 'starvation', 'hunger');
  }
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Why a loan of this size is refused, or null. */
export function loanLock(env: LifeEnv, amount: number): string | null {
  const { data, p, tick, life } = env;
  const m = data.life.money;
  if (!m.loans.includes(amount)) return 'No loan shark lends that amount';
  if (humanAgeOf(data, p, tick) < m.loanFromAge) return 'Nobody lends to a child';
  if (life.debt + amount > m.maxDebt) return 'Nobody will lend you more';
  return null;
}

export function borrow(env: LifeEnv, amount: number): void {
  const reason = loanLock(env, amount);
  if (reason) throw new MoneyError(reason);
  env.life.debt += amount;
  env.p.c.berries += amount;
  const text = `You borrowed ${formatBerries(amount)} Berries from a loan shark, at ${env.data.life.money.interestPct}% a month.`;
  lifeLog(env, text, { tags: ['personal', 'money'] });
}

export function repay(env: LifeEnv, amount: number): void {
  const { life, p } = env;
  const paid = Math.min(Math.floor(amount), life.debt, p.c.berries);
  if (paid <= 0)
    throw new MoneyError(life.debt <= 0 ? 'You owe nothing' : 'You have nothing to pay with');
  life.debt -= paid;
  p.c.berries -= paid;
  const text =
    life.debt === 0
      ? `You paid off the last ${formatBerries(paid)} Berries of your debt.`
      : `You paid ${formatBerries(paid)} Berries toward your debt (${formatBerries(life.debt)} left).`;
  lifeLog(env, text, { tags: ['personal', 'money'] });
}
