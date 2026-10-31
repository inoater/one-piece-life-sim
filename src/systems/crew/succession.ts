import type { GameData } from '../../engine/data/schemas';
import type { Entity, WorldState } from '../../engine/state';
import { removeMember } from './members';
import { CAPTAIN, crewLedBy, crewLog, IN_CREW, LEADS } from './state';

/**
 * When the captain dies (Phase 2's inheritance rules: crew command passes on): whoever carries
 * the story on leads the crew from here. If they were in it, they leave its ranks for the
 * captain's place; everyone else now answers to them.
 */
export function passCrew(
  state: WorldState,
  data: GameData,
  dead: Entity,
  heir: Entity,
): string | null {
  const crewEnt = crewLedBy(state, dead);
  const crew = crewEnt?.crew;
  if (!crewEnt || !crew) return null;
  if (crew.members.some((m) => m.id === heir.id))
    removeMember(state, data, crewEnt, heir.id, 'became captain', state.tick, 'keep');
  delete dead.flags[LEADS];
  heir.flags[LEADS] = crewEnt.id;
  crew.leaderId = heir.id;
  delete heir.flags[CAPTAIN];
  delete heir.flags[IN_CREW];
  for (const member of crew.members) {
    const e = state.entities[member.id];
    if (!e?.character) continue;
    e.flags[CAPTAIN] = heir.id;
    // Each crewmate's tie is to the new captain now (Phase 7's bond, begun fresh).
    if (!e.character.relationships.some((r) => r.id === heir.id))
      e.character.relationships.push({
        id: heir.id,
        kind: 'crewmate',
        opinion: { base: 20, mods: [] },
        sinceTick: state.tick,
      });
    else for (const r of e.character.relationships) if (r.id === heir.id) r.kind = 'crewmate';
    const mine = heir.character?.relationships.find((r) => r.id === e.id);
    if (mine) mine.kind = 'crewmate';
    else
      heir.character?.relationships.push({
        id: e.id,
        kind: 'crewmate',
        opinion: { base: 20, mods: [] },
        sinceTick: state.tick,
      });
  }
  crewLog(crew, state.tick, `${dead.name} is gone. ${heir.name} is captain now.`);
  return `command of ${crewEnt.name}`;
}
