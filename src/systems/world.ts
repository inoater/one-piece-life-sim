import { templateVarsFor } from '../engine/calendar';
import { appendLog } from '../engine/log';
import type { TickContext, TickStep } from '../engine/pipeline';
import type { WorldState } from '../engine/state';
import { renderTemplate } from '../engine/template';
import { storyVars } from './events';

/**
 * Step 4: update world state (factions, territory, economy).
 *
 * Each world system is a function in the list below; Phase 3 adds factions, territory and the
 * economy as one line each. Today: the entropy probe (dev) and epidemics (Phase 2).
 */
export type WorldSystem = (state: WorldState, ctx: TickContext) => void;

/** Random draws the probe makes per tick. */
export const PROBE_DRAWS = 8;

/**
 * Entropy probe (dev only). When the world was created with `probe: true`, it draws random
 * numbers every tick and folds them into a flag. That makes the world's hash depend on the RNG,
 * so the determinism tests (same seed gives the same hash, different seeds differ, replays match)
 * actually test something. Worlds without the flag are untouched.
 */
export const entropyProbe: WorldSystem = (state, ctx) => {
  if (state.flags['dev.probe'] !== true) return;
  const rng = ctx.rng.fork('probe');
  const previous = state.flags['dev.probe.acc'];
  let acc = typeof previous === 'number' ? previous : 0;
  for (let i = 0; i < PROBE_DRAWS; i++) acc = (Math.imul(acc, 31) + rng.nextU32()) | 0;
  state.flags['dev.probe.acc'] = acc;
  const draws = state.flags['dev.probe.draws'];
  state.flags['dev.probe.draws'] = (typeof draws === 'number' ? draws : 0) + PROBE_DRAWS;
};

/**
 * Epidemics (Phase 2): now and then a sickness reaches the player's home for a few months, which
 * makes that illness far likelier there (data/life.json `epidemic`) and makes the news. Phase 3's
 * world events will spread them between islands.
 */
export const epidemics: WorldSystem = (state, ctx) => {
  const player = state.playerId ? state.entities[state.playerId] : undefined;
  const c = player?.character;
  if (!c?.alive || !c.life) return;
  const until = state.flags['epidemic.until'];
  if (typeof until === 'number' && until > ctx.tick) return;
  const rules = ctx.data.life.epidemic;
  const rng = ctx.rng.fork('epidemic');
  if (!rng.chance(rules.chance)) return;
  state.flags['epidemic.until'] = ctx.tick + rng.int(rules.months.min, rules.months.max);
  state.flags['epidemic.place'] = c.birthplace;
  const vars = { ...templateVarsFor(ctx.date), ...storyVars(state, ctx.data) };
  const text = renderTemplate(rng.pick(rules.news), vars);
  const record = appendLog(state, ctx.tick, {
    kind: 'event',
    summary: text,
    tags: ['world', 'news', 'illness'],
    place: c.birthplace,
    cause: 'sys:epidemic',
  });
  ctx.newsDrafts.push({ text, tags: ['news', 'illness'], sourceSeq: record.seq });
};

export const WORLD_SYSTEMS: readonly WorldSystem[] = [entropyProbe, epidemics];

export function createUpdateWorldStep(systems: readonly WorldSystem[]): TickStep {
  return {
    id: 'updateWorld',
    run(state, ctx) {
      for (const system of systems) system(state, ctx);
    },
  };
}

export const updateWorld = createUpdateWorldStep(WORLD_SYSTEMS);
