import type { BattleState } from '../../engine/battle-state';
import type { GameData } from '../../engine/data/schemas';
import type { WorldState } from '../../engine/state';

/**
 * What each kind of source does with a finished fight (an event applies its result band, a canon
 * beat its fate). A module with no imports of its own, so registering from events.ts works however
 * the modules that import each other happen to load.
 */

export interface FinishedCard {
  lines: { text: string; tone: 'good' | 'bad' | 'plain' | 'alert' }[];
  seen: string[];
  news: boolean;
}

export type OnFinish = (
  state: WorldState,
  data: GameData,
  battle: BattleState,
  card: FinishedCard,
) => void;

const finishers = new Map<BattleState['source']['kind'], OnFinish>();

export function onFightFinished(kind: BattleState['source']['kind'], fn: OnFinish): void {
  finishers.set(kind, fn);
}

export function finisherFor(kind: BattleState['source']['kind']): OnFinish | undefined {
  return finishers.get(kind);
}
