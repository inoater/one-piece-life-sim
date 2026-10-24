import type { Location, Where } from '../../engine/data/schemas';
import type { WorldState } from '../../engine/state';

/**
 * Where a world event can happen (Phase 3): a place matching the event's `where`. Who holds a
 * place is read from the world (it changes), the rest from the map.
 */
export function checkWhere(state: WorldState, where: Where, loc: Location): boolean {
  if (where.inhabited && loc.population === 'none') return false;
  if (where.regions.length > 0 && !(where.regions as readonly string[]).includes(loc.region))
    return false;
  if (where.features.length > 0 && !where.features.some((f) => loc.features.includes(f)))
    return false;
  if (where.kinds.length > 0 && !(where.kinds as readonly string[]).includes(loc.kind))
    return false;
  if (loc.danger < where.minDanger || loc.danger > where.maxDanger) return false;
  const controller = state.entities[loc.id]?.place?.controller ?? loc.controller;
  if (where.controllers.length > 0 && (!controller || !where.controllers.includes(controller))) {
    return false;
  }
  if (controller && where.notControllers.includes(controller)) return false;
  return true;
}
