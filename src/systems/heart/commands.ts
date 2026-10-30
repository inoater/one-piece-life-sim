import type { GameData, RelAxis } from '../../engine/data/schemas';
import { REL_AXES } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import type { WorldState } from '../../engine/state';
import { moveAxis, moveBar, bondOf, pairOf } from './bonds';
import { feedFruit, takeCompanion } from './companions';
import { adopt, makeWill } from './family';
import { ensureHeart } from './profile';
import { banquet, crewMeeting } from './scenes';
import { heartEnv, talk, TalkError } from './talk';

/**
 * What the player can do with the heart between months (Phase 7): talk to someone (an intent from
 * data/intents, here or over a Den Den Mushi), throw a feast, hold a crew meeting, adopt a child,
 * name an heir, take on an animal, feed it a Devil Fruit, and switch romance on or off. Each
 * checks the same rules the person page shows and throws the reason.
 */

export type HeartCommand =
  | {
      type: 'heart/talk';
      target: string;
      intent: string;
      topic?: string | undefined;
      amount?: number | undefined;
      remote?: boolean | undefined;
    }
  | { type: 'heart/romance'; on: boolean }
  | { type: 'heart/adopt' }
  | { type: 'heart/will'; heir: string }
  | { type: 'heart/companion'; species: string; name?: string | undefined }
  | { type: 'heart/feedFruit'; companion: string; fruit: string }
  | { type: 'heart/banquet' }
  | { type: 'heart/meeting'; mode: 'rule' | 'ask' }
  | { type: 'debug/heart'; target: string; axis: string; value: number };

export function applyHeartCommand(state: WorldState, data: GameData, cmd: HeartCommand): void {
  if (cmd.type === 'heart/romance') {
    state.config.romance = cmd.on;
    appendLog(state, state.tick, {
      kind: 'system',
      summary: `Romance is ${cmd.on ? 'on' : 'off'}.`,
      tags: ['system', 'settings'],
      cause: 'action:heart/romance',
      knownBy: state.playerId ? [state.playerId] : [],
    });
    return;
  }
  const env = heartEnv(state, data, `action:${cmd.type}`);
  if (!env) throw new TalkError('Nobody alive is being played');
  ensureHeart(state, data, env.p.entity);
  switch (cmd.type) {
    case 'heart/talk':
      talk(env, cmd.target, cmd.intent, {
        ...(cmd.topic !== undefined ? { topic: cmd.topic } : {}),
        ...(cmd.amount !== undefined ? { amount: cmd.amount } : {}),
        ...(cmd.remote !== undefined ? { remote: cmd.remote } : {}),
      });
      break;
    case 'heart/adopt':
      adopt(env);
      break;
    case 'heart/will':
      makeWill(env, cmd.heir);
      break;
    case 'heart/companion':
      takeCompanion(env, cmd.species, cmd.name);
      break;
    case 'heart/feedFruit':
      feedFruit(env, cmd.companion, cmd.fruit);
      break;
    case 'heart/banquet':
      banquet(env, '', true);
      break;
    case 'heart/meeting':
      crewMeeting(env, cmd.mode);
      break;
    case 'debug/heart': {
      const other = state.entities[cmd.target];
      const pair = other ? pairOf(env.p.entity, other) : null;
      if (!other || !pair) throw new TalkError('You do not know them');
      const record = appendLog(state, state.tick, {
        kind: 'system',
        summary: `Debug: ${other.name}'s ${cmd.axis} toward you set to about ${cmd.value}.`,
        tags: ['system', 'debug'],
        targetIds: [other.id],
        cause: 'action:debug/heart',
        knownBy: [env.p.entity.id],
      });
      if ((REL_AXES as readonly string[]).includes(cmd.axis)) {
        const now = Math.round(
          pair.theirs.opinion && cmd.axis === 'affection'
            ? pair.theirs.opinion.base + pair.theirs.opinion.mods.reduce((s, m) => s + m.value, 0)
            : (pair.theirs.axes?.[cmd.axis]?.base ?? 0) +
                (pair.theirs.axes?.[cmd.axis]?.mods ?? []).reduce((s, m) => s + m.value, 0),
        );
        moveAxis(
          data,
          pair.theirs,
          cmd.axis as RelAxis,
          cmd.value - now,
          'A debug command',
          record.seq,
          state.tick,
        );
      } else {
        moveBar(
          data,
          pair.theirs,
          bondOf(data, pair.mine.kind),
          cmd.axis,
          cmd.value,
          'A debug command',
          record.seq,
          state.tick,
        );
      }
      break;
    }
  }
}
