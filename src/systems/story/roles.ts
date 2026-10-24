import type { EventDef, GameData } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { Entity, WorldState } from '../../engine/state';
import { humanAgeOf, livingRelations, relationKind } from '../life/body';
import { meetPerson } from '../life/people';
import { canonHere } from './conditions';
import type { StoryCtx } from './context';

/**
 * The people an event casts (Phase 3): someone the player knows, a stranger from the place's
 * people (created only now: the plan's "individuals are created when the player meets them"), a
 * canon character who happens to be here, or the captain of the vessel. Their names, titles and
 * pronouns fill `{role.<name>.<field>}`.
 */

/** Whether every role the event needs can be filled now (without creating anyone). */
export function canCast(ctx: StoryCtx, def: EventDef): boolean {
  for (const spec of Object.values(def.roles)) {
    switch (spec.kind) {
      case 'relation':
        if (!ctx.p || livingRelations(ctx.state, ctx.p.c, relationKind(spec.relation)).length === 0)
          return false;
        break;
      case 'stranger':
        if (!ctx.p || !ctx.place) return false;
        break;
      case 'canon':
        if (canonHere(ctx).length === 0) return false;
        break;
      case 'captain':
        if (!ctx.voyage) return false;
        break;
    }
  }
  return true;
}

/** Fill the roles: role -> entity id. Strangers and hired captains become people now. */
export function castRoles(ctx: StoryCtx, def: EventDef, rng: Rng): Record<string, string> {
  const { state, data, tick, p } = ctx;
  const out: Record<string, string> = {};
  for (const [name, spec] of Object.entries(def.roles).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const r = rng.fork('role', name);
    switch (spec.kind) {
      case 'relation': {
        const people = p ? livingRelations(state, p.c, relationKind(spec.relation)) : [];
        if (people.length > 0) out[name] = r.pick(people).id;
        break;
      }
      case 'stranger': {
        if (!p) break;
        const stranger = meetPerson(state, data, p, r, tick, humanAgeOf(data, p, tick), {
          ageOffset: spec.ageOffset,
          ...(spec.occupation !== undefined ? { occupation: spec.occupation } : {}),
        });
        out[name] = stranger.id;
        break;
      }
      case 'canon': {
        const here = canonHere(ctx);
        if (here.length > 0) out[name] = r.pick(here);
        break;
      }
      case 'captain': {
        if (!p) break;
        if (ctx.voyage?.mode === 'own') out[name] = p.entity.id;
        else {
          const captain = meetPerson(state, data, p, r, tick, humanAgeOf(data, p, tick), {
            ageOffset: { min: 5, max: 25 },
            occupation: 'occ_sailor',
          });
          const named = ctx.voyage?.vessel?.captain;
          if (named) captain.name = named;
          out[name] = captain.id;
        }
        break;
      }
    }
  }
  return out;
}

const PRONOUN_WORDS = {
  he: { they: 'he', them: 'him', their: 'his' },
  she: { they: 'she', them: 'her', their: 'her' },
  they: { they: 'they', them: 'them', their: 'their' },
} as const;

/** How a role-holder is described: "Whitebeard", "the Pirate King", "a fisher". */
export function titleOf(data: GameData, entity: Entity): string {
  const title = entity.flags['title'];
  if (typeof title === 'string') return title;
  const epithet = entity.flags['epithet'];
  if (typeof epithet === 'string') return epithet;
  const occ = entity.character?.occupation;
  const name = occ ? data.occupations[occ]?.name : undefined;
  return name ? `a ${name.toLowerCase()}` : 'a stranger';
}

/** `{role.x.name}` and friends for a cast. */
export function roleVars(
  state: WorldState,
  data: GameData,
  roles: Readonly<Record<string, string>>,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [role, id] of Object.entries(roles)) {
    const entity = state.entities[id];
    const pronouns = entity?.character?.pronouns ?? 'they';
    const words = PRONOUN_WORDS[pronouns];
    vars[`role.${role}.name`] = entity?.name ?? 'someone';
    vars[`role.${role}.title`] = entity ? titleOf(data, entity) : 'someone';
    vars[`role.${role}.they`] = words.they;
    vars[`role.${role}.them`] = words.them;
    vars[`role.${role}.their`] = words.their;
  }
  return vars;
}
