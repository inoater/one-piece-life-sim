import type { GameData } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import type { Entity, PendingDecision, WorldState } from '../../engine/state';
import { heartOrRoll } from '../heart/profile';
import { heartEnv } from '../heart/talk';
import type { LifeEnv } from '../life/env';
import { crewHooks } from './hooks';
import { addMember, crewSay, removeMember } from './members';
import { hereOf, byId, crewLedBy, membersOf, moveCrewBar, crewLog } from './state';

/**
 * A crew's decisions (Phase 8): splitting the loot, a quarrel on deck, a traitor, a crewmate's
 * child who wants to sail, mutiny brewing, and the moment a would-be recruit is at their lowest.
 * The captain rules or calls a vote, as the creed's command style says; a crew remembers being
 * ignored. Each waits as a decision marked `crew`, resolved here rather than by the event engine.
 */

export interface CrewDecisionSpec {
  kind: 'moment' | 'loot' | 'friction' | 'traitor' | 'child' | 'mutiny';
  title: string;
  text: string;
  choices: { id: string; label: string }[];
  roles: Record<string, string>;
}

export function pushCrewDecision(state: WorldState, data: GameData, spec: CrewDecisionSpec): void {
  if (
    state.pending.some(
      (d) =>
        d.crew &&
        d.eventId === `crew:${spec.kind}` &&
        JSON.stringify(d.roles) === JSON.stringify(spec.roles),
    )
  )
    return;
  const crew = state.playerId ? crewLedBy(state, state.entities[state.playerId])?.crew : undefined;
  const command = crew ? byId(data.crew.commands, crew.command) : undefined;
  const voting =
    spec.kind !== 'moment' && command && command.id !== 'word' && (crew?.members.length ?? 0) >= 2;
  const record = appendLog(state, state.tick, {
    kind: 'event',
    summary: spec.text,
    tags: ['personal', 'crew', 'decision', `crew:${spec.kind}`],
    actorIds: state.playerId ? [state.playerId] : [],
    targetIds: Object.values(spec.roles),
    place: null,
    cause: `crew:${spec.kind}`,
    knownBy: state.playerId ? [state.playerId] : [],
  });
  state.counters.decisionId += 1;
  const choices = [...spec.choices];
  if (voting)
    choices.push({
      id: 'vote',
      label: command.id === 'vote' ? 'Put it to the crew' : 'Ask the officers',
    });
  state.pending.push({
    id: state.counters.decisionId,
    eventId: `crew:${spec.kind}`,
    firedTick: state.tick,
    recordSeq: record.seq,
    title: spec.title,
    text: spec.text,
    choices,
    roles: spec.roles,
    crew: true,
  });
}

/** What the crew would choose, by their natures (a vote; the officers' voice in a council). */
function crewChoice(
  state: WorldState,
  data: GameData,
  kind: string,
  choices: readonly string[],
  voters: readonly Entity[],
): string {
  const tally = new Map<string, number>();
  for (const v of voters) {
    const axes = heartOrRoll(state, data, v).profile.axes;
    const kindAxis = axes['kind'] ?? 0;
    const free = axes['free'] ?? 0;
    const pick =
      kind === 'loot'
        ? free > 0 || kindAxis > 20
          ? 'equal'
          : 'rank'
        : kind === 'traitor'
          ? kindAxis > 30
            ? 'forgive'
            : kindAxis < -30
              ? 'execute'
              : 'maroon'
          : kind === 'friction'
            ? 'settle'
            : kind === 'child'
              ? 'yes'
              : kind === 'mutiny'
                ? 'concede'
                : (choices[0] ?? '');
    if (choices.includes(pick)) tally.set(pick, (tally.get(pick) ?? 0) + 1);
  }
  let best = choices[0] ?? '';
  let n = -1;
  for (const c of choices)
    if ((tally.get(c) ?? 0) > n) {
      best = c;
      n = tally.get(c) ?? 0;
    }
  return best;
}

export function resolveCrewDecision(
  state: WorldState,
  data: GameData,
  decision: PendingDecision,
  choiceId: string,
): void {
  const index = state.pending.findIndex((d) => d.id === decision.id);
  if (index >= 0) state.pending.splice(index, 1);
  // A decision outlived the captain (they died with it waiting): it goes with them.
  const env = heartEnv(state, data, decision.eventId);
  if (!env) return;
  const kind = decision.eventId.slice('crew:'.length);
  const crewEnt = crewLedBy(state, env.p.entity);
  const crew = crewEnt?.crew;
  const roles = decision.roles ?? {};
  const record = appendLog(state, state.tick, {
    kind: 'decision',
    summary: `Chose "${decision.choices.find((c) => c.id === choiceId)?.label ?? choiceId}" (${decision.title}).`,
    tags: ['decision', 'crew'],
    actorIds: [env.p.entity.id],
    targetIds: Object.values(roles),
    place: hereOf(data, env.p.entity),
    cause: decision.eventId,
    causeSeq: decision.recordSeq,
    knownBy: [env.p.entity.id],
  });
  const seq = record.seq;
  let choice = choiceId;
  const real = decision.choices.map((c) => c.id).filter((c) => c !== 'vote');
  if (crew && crewEnt) {
    const voters = membersOf(state, crew).map((m) => m.entity);
    const command = byId(data.crew.commands, crew.command);
    const wanted = crewChoice(state, data, kind, real, voters);
    if (choice === 'vote') {
      choice = wanted;
      crew.morale = Math.min(100, crew.morale + (command?.asked ?? 2));
      crewLog(crew, state.tick, `The crew was asked (${decision.title.toLowerCase()}), and chose.`);
    } else if (
      command &&
      command.id !== 'word' &&
      real.length > 1 &&
      choice !== wanted &&
      voters.length >= 2 &&
      kind !== 'moment'
    ) {
      // The captain overrules them: a crew remembers being ignored.
      crew.ignored += 1;
      for (const v of voters)
        moveCrewBar(
          data,
          env.p.entity,
          v,
          'loyalty',
          -command.ignored,
          'Overruled by the captain',
          seq,
          state.tick,
        );
    }
  }
  applyChoice(env, kind, choice, roles, seq);
}

function applyChoice(
  env: LifeEnv,
  kind: string,
  choice: string,
  roles: Record<string, string>,
  seq: number,
): void {
  const { state, data, tick, p } = env;
  const crewEnt = crewLedBy(state, p.entity);
  const crew = crewEnt?.crew;
  const other = roles['other'] ? state.entities[roles['other']] : undefined;
  const second = roles['second'] ? state.entities[roles['second']] : undefined;
  switch (kind) {
    case 'moment': {
      if (!other?.character?.recruit?.quest) return;
      if (choice === 'help') {
        other.character.recruit.quest.progress = 1;
        other.character.recruit.quest.status = 'met';
        if (crewEnt) addMember(env, crewEnt, other, { how: 'moment', loyalty: 25 });
      } else {
        other.character.recruit.quest.status = 'failed';
      }
      return;
    }
    case 'loot': {
      if (!crew || !crewEnt) return;
      const amount = Number(roles['amount'] ?? '0');
      const members = membersOf(state, crew);
      const creedLoot = crew.creed['loot'] ?? 'equal';
      // Split equally, by rank, the lion's share, or bank it in the common purse.
      if (choice === 'bank') crew.treasury += amount;
      else {
        const mine = choice === 'lion' ? 0.5 : choice === 'rank' ? 0.25 : 1 / (members.length + 1);
        env.p.c.berries += Math.round(amount * mine);
        crew.treasury += Math.round(amount * (1 - mine) * 0.1);
      }
      const unfair = choice === 'lion' || (choice === 'rank' && creedLoot === 'equal');
      const tags = unfair
        ? ['unfair_split', 'greedy']
        : choice === 'bank'
          ? []
          : ['fair_split', 'generous'];
      crewHooks.deed?.(env, tags, seq);
      for (const { entity, member } of members) {
        const fairLedger =
          (member.mastery['quartermaster'] ?? 0) >= 50 &&
          crew.members.some((m) => m.role === 'quartermaster');
        const by = unfair && !fairLedger ? data.crew.loyalty.unfair : data.crew.loyalty.fair;
        moveCrewBar(
          data,
          p.entity,
          entity,
          'loyalty',
          by,
          unfair ? 'An unfair split' : 'A fair share',
          seq,
          tick,
        );
      }
      return;
    }
    case 'friction': {
      if (!other || !second || !crew) return;
      const sides: [Entity, number][] =
        choice === 'side_a'
          ? [
              [other, 4],
              [second, -6],
            ]
          : choice === 'side_b'
            ? [
                [other, -6],
                [second, 4],
              ]
            : choice === 'punish'
              ? [
                  [other, -3],
                  [second, -3],
                ]
              : [
                  [other, 1],
                  [second, 1],
                ];
      for (const [e, by] of sides)
        moveCrewBar(data, p.entity, e, 'loyalty', by, 'How you settled a quarrel', seq, tick);
      if (choice === 'settle') crew.morale = Math.max(0, crew.morale - 2);
      return;
    }
    case 'traitor': {
      if (!other || !crewEnt) return;
      const tags =
        choice === 'forgive'
          ? ['spare_deserter', 'kind']
          : choice === 'maroon'
            ? ['punish_deserter']
            : choice === 'execute'
              ? ['kill_deserter', 'punish_deserter', 'cruel', 'kill']
              : ['punish_deserter'];
      crewHooks.deed?.(env, tags, seq);
      if (choice === 'forgive') {
        moveCrewBar(data, p.entity, other, 'loyalty', 20, 'Forgiven', seq, tick);
        delete other.flags['spy.for'];
        return;
      }
      removeMember(
        state,
        data,
        crewEnt,
        other.id,
        choice === 'execute'
          ? 'executed as a traitor'
          : choice === 'maroon'
            ? 'marooned as a traitor'
            : 'handed to the Marines',
        tick,
      );
      if (choice === 'execute' && other.character) {
        other.character.alive = false;
        other.character.death = { tick, cause: 'execution' };
      }
      if (choice === 'marines') other.flags['status'] = 'imprisoned';
      return;
    }
    case 'child': {
      if (!other || !crewEnt) return;
      if (choice === 'yes') addMember(env, crewEnt, other, { how: 'child', loyalty: 10 });
      return;
    }
    case 'mutiny': {
      if (!crew || !crewEnt) return;
      if (choice === 'concede') {
        crew.morale = Math.min(100, crew.morale + 15);
        crew.unpaid = 0;
        env.p.c.berries -= Math.min(env.p.c.berries, 5000 * crew.members.length);
      } else {
        // Facing them down: the first mate's word against the ringleader's.
        const leader = other;
        if (leader) {
          removeMember(state, data, crewEnt, leader.id, 'put ashore for mutiny', tick);
          crewSay(env, crewEnt, leader, 'left', {}, 'bad', ['mutiny']);
        }
      }
      return;
    }
  }
}
