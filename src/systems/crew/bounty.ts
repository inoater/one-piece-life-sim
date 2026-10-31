import { Rng } from '../../engine/rng';
import type { Entity } from '../../engine/state';
import type { LifeEnv } from '../life/env';
import { crewSay } from './members';
import { bountyOf } from './state';

/**
 * Bounties and epithets for each member once they are notable (Phase 8; Phase 9 owns the full
 * bounty system): an outlaw crew's fighters earn them in its fights, and the papers find a name
 * for anyone past the notable line, from their traits, their role, or a generic one.
 */

/** Bounties and epithets for members once they are notable. */
export function giveBounty(env: LifeEnv, crewEnt: Entity, entity: Entity, amount: number): void {
  const { data } = env;
  if (amount <= 0) return;
  const before = bountyOf(entity);
  const after = Math.round((before + amount) / 100000) * 100000;
  if (after <= before) return;
  entity.flags['bounty'] = after;
  const notable = data.crew.bounty.notable;
  if (before < notable && after >= notable) {
    crewSay(env, crewEnt, entity, 'bounty', { bounty: after.toLocaleString('en-GB') }, 'alert', [
      'bounty',
    ]);
    if (entity.flags['epithet'] === undefined) {
      const c = entity.character;
      const member = crewEnt.crew?.members.find((m) => m.id === entity.id);
      const rng = Rng.root(`epithet:${entity.id}`);
      const byTrait = (c?.traits ?? []).flatMap((t) => data.crew.bounty.epithets.traits[t] ?? []);
      const byRole = member ? (data.crew.bounty.epithets.roles[member.role] ?? []) : [];
      const pool =
        byTrait.length > 0
          ? byTrait
          : byRole.length > 0
            ? byRole
            : data.crew.bounty.epithets.generic;
      entity.flags['epithet'] = rng.pick(pool);
      crewSay(
        env,
        crewEnt,
        entity,
        'epithet',
        { epithet: String(entity.flags['epithet']) },
        'alert',
        ['epithet'],
      );
    }
  }
}
