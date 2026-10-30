import { advance, applyAction, createLife, Rng, type Action } from '../../src/core';
import { ensureWorldLayer } from '../../src/systems/places/history';
import type { GameData } from '../../src/engine/data/schemas';
import type { WorldState } from '../../src/engine/state';

/**
 * A fixed, scripted play session used as a regression anchor.
 *
 * Replaying it must always produce the same state hash. If a change makes the hash differ, one of
 * two things happened: you changed how the world behaves on purpose (run `npm run golden:update`
 * and, if the persisted shape changed, bump SAVE_VERSION and add a migration), or you broke
 * determinism by accident (find out why; do not just update the file).
 *
 * Since Phase 1 it starts with character genesis (a fixed New Life: race, birthplace, family,
 * 30 years of backstory), so a change to how characters are made shows up here too. Since Phase 2
 * the character lives: a job, a routine of three activities at mixed effort, and the months of
 * training, outcomes, injuries, money and aging that follow. Since Phase 3 the world is full: its
 * places, factions, canon cast and history, two thousand named people, random and world events,
 * and a voyage as a passenger to the next island.
 */

export const GOLDEN_SEED = 'golden-v1';

export const GOLDEN_LIFE = {
  seed: GOLDEN_SEED,
  canonMode: 'canon',
  difficulty: 'normal',
  race: 'race_human',
  birthplace: 'bp_east_blue_village',
  legacy: 'legacy_noble_line',
  focus: 'focus_fighter',
  entryYear: 5,
  entryAge: 30,
  pronouns: 'she',
} as const;

export function playGoldenSession(data: GameData): WorldState {
  const { state } = createLife(data, GOLDEN_LIFE);
  state.flags['dev.probe'] = true;
  ensureWorldLayer(state, data);
  const rng = Rng.root(GOLDEN_SEED);
  const act = (action: Action) => applyAction(state, data, action, { debug: true });
  const run = (months: number, policy: 'stop' | 'auto-random' = 'auto-random') =>
    advance(state, data, rng, { kind: 'months', count: months }, policy);

  act({ type: 'debug/spawnTestEntity' });
  act({ type: 'life/job', jobId: 'job_fisher' });
  act({
    type: 'life/routine',
    routine: [
      { activity: 'act_work_shift', effort: 'normal' },
      { activity: 'act_spar', effort: 'hard' },
      { activity: 'act_read', effort: 'light' },
    ],
  });
  // Phase 7: a word with whoever of theirs is at home (the first who can be talked to).
  for (const rel of state.entities[state.playerId as string]?.character?.relationships ?? []) {
    try {
      act({ type: 'heart/talk', target: rel.id, intent: 'int_chat' });
      break;
    } catch {
      // Not here, or not alive: the next one.
    }
  }
  run(12);
  act({ type: 'travel/sail', lane: 'lane_east_blue_village_shells_town', mode: 'passenger' });
  run(3);
  act({ type: 'debug/forceEvent', eventId: 'evt_test_notice' });
  act({ type: 'debug/forceEvent', eventId: 'evt_test_crossroads' });
  run(6, 'stop'); // stops on the crossroads decision
  const decision = state.pending.find((d) => d.eventId === 'evt_test_crossroads');
  if (!decision) throw new Error('golden session expected the crossroads decision');
  act({ type: 'decision/resolve', decisionId: decision.id, choiceId: 'left' });
  const dummy = Object.values(state.entities).find((e) => e.flags['dev.fixture'] === true);
  if (!dummy) throw new Error('golden session lost its test entity');
  act({
    type: 'debug/addModifier',
    entityId: dummy.id,
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
