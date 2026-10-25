import { formatBerries } from '../genesis/text';
import { statTotal } from '../life/body';
import { lifeLog, pay, renderLife, reportLine, type LifeEnv } from '../life/env';
import { ensureHands, HandsError } from './items';

/**
 * Gambling (Phase 6): dice dens and card tables wherever a place has an underworld or an arena.
 * Fair games favour the house a little; rigged ones a lot, and the rougher the place the likelier
 * the dealer cheats. Sharp eyes (Perception) see the trick and walk away; luck nudges the dice.
 */

export function denHere(env: Pick<LifeEnv, 'p'>): boolean {
  const f = env.p.place.features as readonly string[];
  return !env.p.place.atSea && (f.includes('underworld') || f.includes('arena'));
}

/** Bets placed this month. */
export function betsThisMonth(env: Pick<LifeEnv, 'p' | 'tick'>): number {
  const hands = env.p.c.hands;
  if (!hands || hands.last['gamble'] !== env.tick) return 0;
  return hands.tally['bets.month'] ?? 0;
}

export function gambleLock(
  env: Pick<LifeEnv, 'p' | 'tick' | 'data'>,
  stake: number,
): string | null {
  if (!denHere(env)) return 'There is no gambling den here';
  if (env.p.c.berries < stake) return `You have ${formatBerries(env.p.c.berries)} Berries`;
  if (stake > env.data.hands.gambling.maxStake)
    return `No table here takes more than ${formatBerries(env.data.hands.gambling.maxStake)}`;
  if (betsThisMonth(env) >= env.data.hands.gambling.perMonth) return 'Enough for one month';
  return null;
}

/** Bet `stake` on a game. Returns what was won (negative: lost; zero: walked away from a cheat). */
export function gamble(env: LifeEnv, gameId: string, stake: number): number {
  const { data, p, tick } = env;
  const g = data.hands.gambling;
  const game = g.games.find((x) => x.id === gameId);
  if (!game) throw new HandsError(`There is no game "${gameId}"`);
  if (stake < 1) throw new HandsError('Put something on the table');
  const lock = gambleLock(env, stake);
  if (lock) throw new HandsError(lock);
  const hands = ensureHands(p.entity);
  if (hands.last['gamble'] !== tick) hands.tally['bets.month'] = 0;
  hands.last['gamble'] = tick;
  hands.tally['bets.month'] = (hands.tally['bets.month'] ?? 0) + 1;
  const rng = env.rng.fork('gamble', gameId, hands.tally['bets.month'] ?? 0);
  const danger = Math.max(0, Math.min(5, Math.round(p.place.danger)));
  const rigged = rng.fork('rigged').chance(g.rigged[danger] ?? 0);
  if (
    rigged &&
    rng.fork('spot').chance(Math.min(0.9, statTotal(p.entity, 'perception', tick) / g.spot))
  ) {
    const text = renderLife(env, data.hands.lines['gambleRigged'] ?? '', {});
    lifeLog(env, text, { tags: ['personal', 'money'] });
    reportLine(env, text, 'plain');
    return 0;
  }
  const luck = statTotal(p.entity, 'luck', tick);
  const odds = Math.max(
    0.01,
    Math.min(0.95, game.odds * (rigged ? g.riggedOdds : 1) + (luck - 50) * 0.001),
  );
  const won = rng.fork('roll').chance(odds);
  const amount = won ? Math.round(stake * game.payout) : -stake;
  pay(env, amount);
  hands.tally[won ? 'gambleWon' : 'gambleLost'] =
    (hands.tally[won ? 'gambleWon' : 'gambleLost'] ?? 0) + Math.abs(amount);
  const text = renderLife(env, data.hands.lines[won ? 'gambleWon' : 'gambleLost'] ?? '', {
    amount: formatBerries(Math.abs(amount)),
  });
  lifeLog(env, text, { tags: ['personal', 'money'] });
  reportLine(env, text, won ? 'good' : 'bad');
  return amount;
}
