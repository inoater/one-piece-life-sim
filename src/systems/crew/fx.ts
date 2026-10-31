import type { GameData } from '../../engine/data/schemas';
import type { Entity, WorldState } from '../../engine/state';
import { combatPowerOf } from '../life/body';
import type { LifeEnv } from '../life/env';
import { fleetInBattle, prisonRoom, takePrisoners } from './holdings';
import { crewEffect } from './posts';
import { hereOf, onHand, playerCrew } from './state';

/**
 * What the rest of the game asks of the player's crew (Phase 8), in one place: what a post is
 * worth to a system (`crewEffect`), who stands with the captain in a fight, how much room the brig
 * has. Systems that predate crews import this and nothing else of the crew's.
 */

export { crewEffect };

/** Crewmates on hand where the player is (strongest first), and the fleet's ranks for a battle. */
export function onHandCrew(
  state: WorldState,
  data: GameData,
): { members: Entity[]; fleet: number } {
  const crewEnt = playerCrew(state);
  const crew = crewEnt?.crew;
  const leader = crew ? state.entities[crew.leaderId] : undefined;
  if (!crew || !leader) return { members: [], fleet: 0 };
  const here = hereOf(data, leader);
  const tick = state.tick;
  const members = onHand(state, crew, tick)
    .map((m) => m.entity)
    .filter((e) => here === null || hereOf(data, e) === here)
    .sort(
      (a, b) =>
        combatPowerOf(data, b, tick) - combatPowerOf(data, a, tick) || a.id.localeCompare(b.id),
    );
  return { members, fleet: fleetInBattle(state, data, leader) };
}

export function prisonRoomHook(state: WorldState, data: GameData): number {
  const crewEnt = playerCrew(state);
  const leader = crewEnt?.crew ? state.entities[crewEnt.crew.leaderId] : undefined;
  if (!crewEnt?.crew || !leader) return 0;
  return prisonRoom(state, data, leader) - crewEnt.crew.prisoners.length;
}

export function takePrisonersHook(env: LifeEnv, ids: readonly string[]): string[] {
  return takePrisoners(env, ids);
}
