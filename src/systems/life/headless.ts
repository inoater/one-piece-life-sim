import { advance } from '../../engine/advance';
import type { GameData } from '../../engine/data/schemas';
import { Rng } from '../../engine/rng';
import type { WorldState } from '../../engine/state';
import { createLife } from '../genesis/generate';
import type { GenesisOptionsInput } from '../genesis/options';
import type { AdvanceOptions } from '../../engine/advance';
import { ageYears } from './body';
import { autopilot, type AutopilotOptions } from './autopilot';

/**
 * One whole life with nobody at the controls: born, planned month by month by the autopilot,
 * every decision answered at random, until death. The balancing tool (`npm run lives`), the
 * lifespan check and the "40 distinct outcomes" check all run lives through here.
 */

export interface HeadlessLife {
  seed: string;
  race: string;
  birthplace: string;
  /** Age at death in the race's own years (or at the cap). */
  age: number;
  died: boolean;
  cause: string | null;
  months: number;
  /** Distinct outcomes lived ("act_spar#won"), quiet ones included. */
  outcomes: string[];
  peakCombatPower: number;
  berries: number;
  debt: number;
  job: string | null;
  traits: string[];
  children: number;
  state?: WorldState;
}

export interface HeadlessOptions extends AutopilotOptions {
  seed: string;
  race?: string;
  birthplace?: string;
  difficulty?: string;
  /** Stop after this many years even if alive (default: well past any race's lifespan). */
  maxYears?: number;
  /** Keep the final world (for tests that look inside). */
  keepState?: boolean;
}

export function runHeadlessLife(
  data: GameData,
  options: HeadlessOptions,
  advanceOptions: AdvanceOptions,
): HeadlessLife {
  const input: GenesisOptionsInput = {
    seed: options.seed,
    canonMode: 'canon',
    difficulty: options.difficulty ?? 'normal',
    rareRaces: true,
    race: options.race ?? 'random',
    birthplace: options.birthplace ?? 'random',
    entryYear: 0,
    entryAge: 0,
    pronouns: 'they',
  };
  // Balancing runs live one life at a time: no Tier 2 crowd (Phase 3) to slow them down.
  const { state, playerId } = createLife(data, input, { allowBlocked: true, population: 'none' });
  state.openEnded = true;
  const rng = Rng.root(options.seed);
  const player = state.entities[playerId];
  const c = player?.character;
  if (!player || !c) throw new Error('headless life has no player');
  const maxMonths = (options.maxYears ?? 1200) * 12;
  const outcomes = new Set<string>();
  let months = 0;
  let peakCp = 0;
  const cpDef = data.character.derived.find((d) => d.id === 'combatPower');
  while (months < maxMonths && c.alive) {
    autopilot(state, data, rng.fork('autopilot', state.tick), options);
    const result = advance(state, data, rng, { kind: 'months', count: 1 }, advanceOptions);
    months += result.ticksRun;
    for (const done of c.life?.report?.done ?? []) outcomes.add(done.id);
    if (result.stop === 'ended' || result.ticksRun === 0) break;
    if (months % 12 === 0 && cpDef && c.life) {
      let cp = cpDef.constant;
      for (const term of cpDef.terms) {
        const stat = c.life.peak[term.stat] ?? 0;
        cp += 'factor' in term ? stat * term.factor : stat / term.divide;
      }
      peakCp = Math.max(peakCp, Math.round(cp));
    }
  }
  return {
    seed: options.seed,
    race: c.race,
    birthplace: c.birthplace,
    age: ageYears(c, c.death?.tick ?? state.tick),
    died: !c.alive,
    cause: c.death?.cause ?? null,
    months,
    outcomes: [...outcomes].sort(),
    peakCombatPower: peakCp,
    berries: c.berries,
    debt: c.life?.debt ?? 0,
    job: c.life?.job?.id ?? null,
    traits: [...c.traits],
    children: c.relationships.filter((r) => r.kind === 'child').length,
    ...(options.keepState ? { state } : {}),
  };
}
