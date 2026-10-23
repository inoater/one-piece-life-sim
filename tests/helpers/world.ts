import { advance, applyAction, createWorld, Rng, type Action } from '../../src/core';
import type { DecisionPolicy } from '../../src/engine/advance';
import { hashValue } from '../../src/engine/canonical';
import type { WorldState } from '../../src/engine/state';
import { data } from './data';

export interface TestWorld {
  state: WorldState;
  rng: Rng;
}

export function makeWorld(
  seed = 'test-seed',
  options: { probe?: boolean; fixtures?: boolean } = {},
): TestWorld {
  const state = createWorld({ seed, ...(options.probe ? { probe: true } : {}) });
  if (options.fixtures) act({ state, rng: Rng.root(seed) }, { type: 'debug/spawnTestEntity' });
  return { state, rng: Rng.root(seed) };
}

export function act(world: TestWorld, action: Action): void {
  applyAction(world.state, data, action, { debug: true });
}

export function run(world: TestWorld, months: number, decisions: DecisionPolicy = 'auto-random') {
  return advance(world.state, data, world.rng, { kind: 'months', count: months }, decisions);
}

export const hashOf = (state: WorldState): string => hashValue(state);
