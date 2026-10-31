import type { GameData } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import { STAT_IDS, statLabel } from '../../engine/stats';
import type { CrewMember, CrewState, Entity, WorldState } from '../../engine/state';
import { heartOrRoll } from '../heart/profile';
import { personOf, stageOf, statTotal } from '../life/body';
import { trainStat } from '../life/training';
import { seedMonth } from '../powers/haki';
import { moveName } from '../powers/techniques';
import { addProgress, openTrack, powerCtxFor } from '../powers/tracks';
import { fruitTrackOf } from '../powers/fruits';
import { fruitDefOf } from '../powers/catalogue';
import { roleOf } from './roles';
import { memberRecord } from './state';

/**
 * Teammates grow (Phase 8): everyone serving with the player is Tier 1 while they serve, living
 * month by month on the player's rules. A training plan (what to train, how hard, with whom) runs
 * the Phase 2 training formula on them, practises their Phase 4 tracks, sows haki seeds that wake
 * by the player's own rule, and grows a fruit's mastery. Crewmates teach each other their styles
 * (the teacher multiplier), and synergy between two makes training together worth more.
 */

export interface Growth {
  /** Stat or track trained, and how much it moved. */
  trained: { what: string; by: number }[];
  /** Tracks they were taught, and by whom. */
  taught: { track: string; by: string }[];
  /** Techniques new to them this month (names), and whether a crewmate taught the style. */
  techniques: { name: string; taughtBy: string | null }[];
  /** Haki that woke (track names). */
  woke: string[];
}

const STYLE_FAMILIES = new Set(['style', 'sword', 'six_powers']);

/** What they train when nobody has said: their role's main stat, or their style. */
export function defaultPlan(data: GameData, member: CrewMember): NonNullable<CrewMember['plan']> {
  const role = roleOf(data, member.role);
  const main =
    Object.entries(role?.stats ?? {}).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ??
    'strength';
  return { focus: main, effort: 'normal', partner: null };
}

/** Two crewmates' chemistry: shared values, near natures (data/crew.json chemistry). */
export function chemistry(state: WorldState, data: GameData, a: Entity, b: Entity): number {
  const pa = heartOrRoll(state, data, a).profile;
  const pb = heartOrRoll(state, data, b).profile;
  const rules = data.crew.chemistry;
  let score = 0;
  for (const v of pa.values) if (pb.values.includes(v)) score += rules.value;
  for (const [axis, w] of Object.entries(rules.axes))
    score += ((w ?? 0) * Math.abs((pa.axes[axis] ?? 0) - (pb.axes[axis] ?? 0))) / 100;
  return Math.round(score * 10) / 10;
}

/** A crewmate on hand who knows a style this one does not (the furthest along), if any. */
function autoPartner(
  state: WorldState,
  data: GameData,
  crew: CrewState,
  member: CrewMember,
  entity: Entity,
): string | null {
  let best: { id: string; stage: number } | null = null;
  const mine = entity.character?.powers?.tracks ?? {};
  for (const other of crew.members) {
    if (other.id === member.id || other.away !== null) continue;
    const tracks = state.entities[other.id]?.character?.powers?.tracks ?? {};
    for (const [id, ts] of Object.entries(tracks)) {
      const t = data.tracks[id];
      if (!t || !STYLE_FAMILIES.has(t.family) || mine[id] || ts.stage < 1) continue;
      if (!best || ts.stage > best.stage || (ts.stage === best.stage && other.id < best.id))
        best = { id: other.id, stage: ts.stage };
    }
  }
  return best?.id ?? null;
}

/** One crewmate's month of growth. `mult`: a base's training ground, a library. */
export function memberGrowth(
  state: WorldState,
  data: GameData,
  crew: CrewState,
  member: CrewMember,
  entity: Entity,
  tick: number,
  rng: Rng,
  mult: { body: number; mind: number } = { body: 1, mind: 1 },
): Growth {
  const out: Growth = { trained: [], taught: [], techniques: [], woke: [] };
  const c = entity.character;
  const person = personOf(data, entity);
  const ctx = powerCtxFor(state, data, entity, tick, rng.fork('powers'));
  if (!c || !person || !ctx || member.away !== null) return out;
  if (member.hurtUntil !== null && member.hurtUntil > tick) return out;
  const plan = member.plan ?? defaultPlan(data, member);
  const rules = data.crew.growth;
  const efficiency = stageOf(data, person, tick).training;
  // With no partner named, they train beside whoever knows a style they lack (or nobody).
  const partnerId =
    plan.partner ?? (member.plan === null ? autoPartner(state, data, crew, member, entity) : null);
  const partnerEntity = partnerId ? state.entities[partnerId] : undefined;
  const partnerMember = partnerId ? memberRecord(crew, partnerId) : undefined;
  const partnerHere =
    partnerEntity?.character?.alive === true && (partnerMember?.away ?? null) === null;
  const synergy =
    partnerHere && partnerEntity
      ? chemistry(state, data, entity, partnerEntity) >= data.crew.chemistry.synergy
      : false;
  const movesBefore = new Set((c.powers?.moves ?? []).map((m) => m.id));
  const points =
    rules.points[plan.effort] * efficiency * (synergy ? data.crew.chemistry.trainBonus : 1);

  if ((STAT_IDS as readonly string[]).includes(plan.focus)) {
    const mental = (data.character.mental as readonly string[]).includes(plan.focus);
    // The Phase 2 teacher multiplier: a better partner, up to 1.5.
    const teacher =
      partnerHere && partnerEntity
        ? Math.min(
            1.5,
            Math.max(
              1,
              1 +
                (statTotal(partnerEntity, plan.focus, tick) - statTotal(entity, plan.focus, tick)) /
                  100,
            ),
          )
        : 1;
    const g = trainStat(
      data,
      entity,
      c,
      plan.focus,
      points * teacher * (mental ? mult.mind : mult.body),
      tick,
    );
    if (g.gain > 0) out.trained.push({ what: statLabel(plan.focus), by: g.gain });
    // Train Spirit sows haki seeds (the player's own rule wakes them).
    if (plan.focus === 'willpower' || plan.focus === 'perception') {
      for (const colour of ['observation', 'armament'] as const) {
        const key = `haki.seed.${colour}`;
        const now = typeof entity.flags[key] === 'number' ? (entity.flags[key] as number) : 0;
        entity.flags[key] =
          now +
          (colour === 'observation' && plan.focus === 'perception'
            ? 1
            : colour === 'armament' && plan.focus === 'willpower'
              ? 1
              : 0.5);
      }
      const before = new Set(Object.keys(c.powers?.tracks ?? {}));
      seedMonth(ctx);
      for (const id of Object.keys(c.powers?.tracks ?? {}))
        if (!before.has(id)) out.woke.push(data.tracks[id]?.name ?? id);
    }
  } else if (data.tracks[plan.focus]) {
    const track = data.tracks[plan.focus];
    const open = c.powers?.tracks[plan.focus] !== undefined;
    if (open) {
      const by = addProgress(
        ctx,
        plan.focus,
        rules.practice * points * 2,
        partnerHere ? 'spar' : 'drill',
      );
      if (by > 0) out.trained.push({ what: track?.name ?? plan.focus, by });
    }
  }

  // Crewmates teach each other their styles: whoever they train with, a style they do not know.
  if (partnerHere && partnerEntity?.character?.powers) {
    const theirs = partnerEntity.character.powers.tracks;
    const want = Object.keys(theirs)
      .sort()
      .filter((id) => {
        const t = data.tracks[id];
        return (
          t &&
          STYLE_FAMILIES.has(t.family) &&
          (theirs[id]?.stage ?? 0) >= 1 &&
          !c.powers?.tracks[id]
        );
      });
    const pick = want.find((id) => id === plan.focus) ?? want[0];
    if (pick && rng.fork('teach', pick).chance(rules.teach * (synergy ? 1.5 : 1))) {
      openTrack(ctx, pick, {
        source: `Taught by ${partnerEntity.name}`,
        teacherMult: rules.teacherMult,
        quiet: true,
      });
      member.taught[pick] = partnerEntity.id;
      out.taught.push({ track: pick, by: partnerEntity.id });
    }
  }

  // A fruit's mastery grows with use.
  const fruit = c.powers?.fruit ? state.entities[c.powers.fruit.id] : undefined;
  const def = fruit ? fruitDefOf(data, fruit) : undefined;
  const fruitTrack = def ? fruitTrackOf(data, def) : null;
  if (fruitTrack && c.powers?.tracks[fruitTrack])
    addProgress(ctx, fruitTrack, rules.practice * 0.5, 'drill');

  for (const m of c.powers?.moves ?? []) {
    if (movesBefore.has(m.id)) continue;
    const track = m.source.startsWith('track:') ? m.source.slice(6) : null;
    out.techniques.push({
      name: moveName(data, m),
      taughtBy: track ? (member.taught[track] ?? null) : null,
    });
  }
  return out;
}
