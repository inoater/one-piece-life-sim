import { dueEntities } from '../engine/entities';
import type { TickContext, TickStep } from '../engine/pipeline';
import type { Entity, WorldState } from '../engine/state';

/**
 * Step 3: NPC decisions (rule 5, simulation tiers).
 *
 * Tier 1 (canon and notable entities) acts every tick; Tier 2 (named generated NPCs) acts every
 * third tick, i.e. quarterly. The cadence comes from settings.json, not from code. Tier 3 island
 * populations are statistics, not entities, and are not touched here.
 *
 * A behaviour is a function run for each due entity. None exist yet: Phase 3 registers the
 * goal-and-utility behaviour for Tier 2. Each behaviour should draw randomness from
 * `ctx.rng.fork(entity.id)` so one entity's rolls never affect another's.
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

export const npcDecisions = createNpcDecisionsStep([]);
