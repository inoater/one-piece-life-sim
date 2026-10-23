import { advance, advanceOptions, applyAction, createLife, Rng, type Action } from '../../src/core';
import type { GameData } from '../../src/engine/data/schemas';
import type { Entity, LifeData, WorldState } from '../../src/engine/state';
import type { GenesisOptionsInput } from '../../src/systems/genesis/options';
import { ensureLife, type Person } from '../../src/systems/life/body';
import type { LifeEnv } from '../../src/systems/life/env';
import { data as realData } from './data';

/** A life started by character genesis, with the helpers the life-loop tests share. */
export interface TestLife {
  state: WorldState;
  rng: Rng;
  data: GameData;
  player(): Entity;
  life(): LifeData;
  person(): Person;
  act(action: Action): void;
  run(
    months: number,
    decisions?: 'stop' | 'auto-random' | 'auto-first',
  ): ReturnType<typeof advance>;
  /** An environment for calling life-loop functions directly, as the month would. */
  env(label?: string): LifeEnv;
}

export const LIFE_DEFAULTS: GenesisOptionsInput = {
  seed: 'life-test',
  canonMode: 'canon',
  difficulty: 'normal',
  rareRaces: true,
  race: 'race_human',
  birthplace: 'bp_east_blue_village',
  legacy: 'legacy_fisher_family',
  focus: 'focus_fighter',
  entryYear: 10,
  entryAge: 20,
  pronouns: 'they',
};

export function startLife(
  over: Partial<GenesisOptionsInput> = {},
  data: GameData = realData,
): TestLife {
  const options = { ...LIFE_DEFAULTS, ...over } as GenesisOptionsInput;
  const { state } = createLife(data, options, { allowBlocked: true });
  const rng = Rng.root(options.seed);
  const t: TestLife = {
    state,
    rng,
    data,
    player: () => state.entities[state.playerId as string] as Entity,
    life: () => t.player().character?.life as LifeData,
    person: () => {
      const p = ensureLife(state, data);
      if (!p) throw new Error('no living player');
      return p;
    },
    act: (action) => void applyAction(state, data, action, { debug: true }),
    run: (months, decisions = 'auto-random') =>
      advance(state, data, rng, { kind: 'months', count: months }, decisions),
    env: (label = 'test') => {
      const p = t.person();
      return {
        state,
        data,
        tick: state.tick,
        rng: Rng.root(options.seed).fork('test-env', label, state.tick),
        p,
        life: p.c.life as LifeData,
        cause: `test:${label}`,
      };
    },
  };
  return t;
}

export { advanceOptions };
