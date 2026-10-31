import type { Rng } from '../../engine/rng';
import { humanAgeOf } from '../life/body';
import type { LifeEnv } from '../life/env';
import { foundCrew } from './creator';
import { sendOnMission } from './missions';
import { questAct, questActs } from './quests';
import {
  answerObjection,
  openObjections,
  pitch,
  pitchChance,
  pitchLock,
  pitchParts,
} from './recruit';
import { byId, crewLedBy, crewLimit, hereOf, membersOf } from './state';
import { listingsAt } from './world';

/**
 * What a headless captain does with a crew (Phase 8), for the balancing tools and the tests: found
 * one now and then (at once for the crew sweep), pitch who is looking for a ship, answer their
 * doubts with a promise or a word, do what their quests ask when it is not a fight (any of it, with
 * `variety`), and send someone off on an errand now and then. Never throws: what cannot be done is
 * not done.
 */
export function crewAround(env: LifeEnv, rng: Rng, variety: boolean, captain: boolean): void {
  const { state, data, tick, p } = env;
  if (state.battle || humanAgeOf(data, p, tick) < 16) return;
  let crewEnt = crewLedBy(state, p.entity);
  if (!crewEnt && (captain || rng.fork('found?').chance(0.01))) {
    try {
      crewEnt = foundCrew(env, { kind: 'pirate' });
    } catch {
      return;
    }
  }
  const crew = crewEnt?.crew;
  if (!crew) return;
  const try_ = (fn: () => unknown) => {
    try {
      fn();
    } catch {
      // Not possible after all.
    }
  };
  // Pitch someone looking for a ship here, while there is room.
  const here = hereOf(data, p.entity);
  const { limit } = crewLimit(state, data, p.entity, crew);
  if (here && crew.members.length < limit && rng.fork('pitch?').chance(captain ? 0.6 : 0.3)) {
    const lists = listingsAt(state, here);
    const open = lists.board.filter((id) => {
      const e = state.entities[id];
      return (
        e !== undefined &&
        pitchLock(state, data, p.entity, e) === null &&
        !e.character?.recruit?.listening &&
        e.character?.recruit?.quest == null
      );
    });
    if (open.length > 0) {
      const id = rng.fork('who').pick(open);
      const e = state.entities[id];
      if (e) {
        const tried = new Set(e.character?.recruit?.pitched ?? []);
        const best = data.crew.recruit.pitches
          .filter((x) => !tried.has(x.id) && x.berries <= p.c.berries / 4)
          .map((x) => ({
            id: x.id,
            chance: pitchChance(data, pitchParts(state, data, p.entity, e, x.id)),
          }))
          .sort((a, b) => b.chance - a.chance)[0];
        if (best) try_(() => pitch(env, id, best.id));
      }
    }
  }
  // Answer the doubts of anyone listening; do what a quest asks.
  for (const rel of [...p.c.relationships]) {
    const e = state.entities[rel.id];
    const r = e?.character?.recruit;
    if (!e?.character?.alive || !r) continue;
    if (r.listening && !r.quest) {
      for (const oid of openObjections(state, data, p.entity, e)) {
        const def = byId(data.crew.recruit.objections, oid);
        const answer =
          def?.answers.find((a) => a.kind === 'promise') ??
          def?.answers.find((a) => a.kind === 'pay' && a.amount <= p.c.berries / 3) ??
          def?.answers.find((a) => a.kind === 'check') ??
          def?.answers[0];
        if (answer) try_(() => answerObjection(env, e.id, oid, answer.id));
        if (!e.character.recruit?.listening) break;
      }
    }
    const quest = e.character.recruit?.quest;
    if (quest?.status === 'open') {
      for (const act of questActs(state, data, p.entity, e)) {
        if (act.lock || (act.id === 'fight' && !variety && !rng.fork('fight?', e.id).chance(0.3)))
          continue;
        try_(() => questAct(env, e.id, act.id));
        break;
      }
    }
  }
  // An errand now and then.
  const members = membersOf(state, crew).filter((m) => m.member.away === null);
  if (members.length >= 2 && rng.fork('mission?').chance(0.08)) {
    const m = rng.fork('mission-who').pick(members);
    const missions = data.crew.missions.filter(
      (x) => x.target === 'none' || (x.target === 'place' && here),
    );
    const mission = rng.fork('mission').pick(missions);
    try_(() =>
      sendOnMission(env, m.member.id, mission.id, mission.target === 'place' ? here : null),
    );
  }
}
