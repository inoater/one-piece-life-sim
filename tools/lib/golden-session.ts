import { advance, applyAction, createWorld, Rng, type Action } from '../../src/core';
import type { GameData } from '../../src/engine/data/schemas';
import type { WorldState } from '../../src/engine/state';

/**
 * A fixed, scripted play session used as a regression anchor.
 *
 * Replaying it must always produce the same state hash. If a change makes the hash differ, one of
 * two things happened: you changed how the world behaves on purpose (run `npm run golden:update`
 * and, if the persisted shape changed, bump SAVE_VERSION and add a migration), or you broke
 * determinism by accident (find out why; do not just update the file).
 */

export const GOLDEN_SEED = 'golden-v1';

export function playGoldenSession(data: GameData): WorldState {
  const state = createWorld({ seed: GOLDEN_SEED, probe: true });
  const rng = Rng.root(GOLDEN_SEED);
  const act = (action: Action) => applyAction(state, data, action, { debug: true });
  const run = (months: number, policy: 'stop' | 'auto-random' = 'auto-random') =>
    advance(state, data, rng, { kind: 'months', count: months }, policy);

  act({ type: 'debug/spawnTestEntity' });
  run(12);
  act({ type: 'debug/forceEvent', eventId: 'evt_test_notice' });
  act({ type: 'debug/forceEvent', eventId: 'evt_test_crossroads' });
  run(6, 'stop'); // stops on the crossroads decision
  act({ type: 'decision/resolve', decisionId: 1, choiceId: 'left' });
  const [entityId] = Object.keys(state.entities);
  if (!entityId) throw new Error('golden session lost its test entity');
  act({
    type: 'debug/addModifier',
    entityId,
    stat: 'strength',
    value: 15,
    modKind: 'pct',
    months: 30,
  });
  run(60);
  act({ type: 'debug/forceEvent', eventId: 'evt_test_secret' });
  run(150);
  return state;
}
