import { dueEntities } from '../engine/entities';
import type { TickContext, TickStep } from '../engine/pipeline';
import type { Entity, WorldState } from '../engine/state';
import { followCanon } from './canon/cast';
import { npcQuarter } from './places/people';

/**
 * Step 3: NPC decisions (rule 5, simulation tiers).
 *
 * Tier 1 (canon and notable entities) acts every tick; Tier 2 (named generated NPCs) acts every
 * third tick, i.e. quarterly. The cadence comes from settings.json, not from code. Tier 3 island
 * populations are statistics, not entities, and are not touched here (places/residents.ts).
 *
 * Since Phase 3 two behaviours are registered: the canon cast follows its keyframes (Tier 1,
 * monthly), and Tier 2 people choose one action a quarter by their goals (places/people.ts). Each
 * draws randomness from `ctx.rng.fork(entity.id)`, so one entity's rolls never affect another's.
 */
export type NpcBehaviour = (state: WorldState, ctx: TickContext, entity: Entity) => void;

export function createNpcDecisionsStep(behaviours: readonly NpcBehaviour[]): TickStep {
  return {
    id: 'npcDecisions',
    run(state, ctx) {
      if (behaviours.length === 0) return;
      for (const entity of dueEntities(state, ctx.tiers)) {
        for (const behave of behaviours) behave(state, ctx, entity);
      }
    },
  };
}

/** The canon cast: keyframes while on the story's path, and a body that ages. */
export const canonBehaviour: NpcBehaviour = (state, ctx, entity) => {
  if (entity.type === 'character' && entity.id in ctx.data.cast)
    followCanon(ctx.data, entity, ctx.tick, state);
};

/** Tier 2 people: one goal-driven choice a quarter. */
export const tier2Behaviour: NpcBehaviour = (state, ctx, entity) => {
  if (!entity.character?.npc) return;
  npcQuarter(
    { state, data: ctx.data, tick: ctx.tick, rng: ctx.rng, newsDrafts: ctx.newsDrafts },
    entity,
  );
};

export const npcDecisions = createNpcDecisionsStep([canonBehaviour, tier2Behaviour]);
