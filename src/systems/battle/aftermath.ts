import type { BattleState, FightRecord, Fighter } from '../../engine/battle-state';
import type { GameData } from '../../engine/data/schemas';
import { Rng } from '../../engine/rng';
import type { Entity, WorldState } from '../../engine/state';
import type { NewsDraft } from '../../engine/pipeline';
import { killCharacter } from '../canon/cast';
import { ensureLife, maxHealthOf, reputation, stageOf } from '../life/body';
import { arrest } from '../life/effects';
import { lifeLog, pay, reportLine, type LifeEnv } from '../life/env';
import { die, injure } from '../life/health';
import { relate, shiftOpinion } from '../life/people';
import { trainStat } from '../life/training';
import { powerEvent } from '../powers/haki';
import { fruitTrackOf, eatenFruit } from '../powers/fruits';
import { fruitDefOf } from '../powers/catalogue';
import { HAKI_TRACKS, trackStateOf } from '../powers/state';
import { useMove } from '../powers/techniques';
import { addProgress, fightingTracks, powerCtxOf } from '../powers/tracks';
import { tierIndex, tierOf } from './ladder';
import { handsAfterFight } from '../hands/fight';

/**
 * What a fight leaves (Phase 5): for the player, injuries by the size of each blow (a spar a tenth
 * as many), Health, death if someone meant it or the sea took them, training, practice for the
 * powers they used, the moments that wake haki, fame, infamy and bounty; for everyone, a tally of
 * who beat whom, and a line in the news when anyone noteworthy was there. Tier 2 people and the
 * canon cast die or are taken by the same rules.
 */

export interface Aftermath {
  /** The post-fight card: what it cost and what it taught. */
  lines: { text: string; tone: 'good' | 'bad' | 'plain' | 'alert' }[];
  /** Who saw it: notable names there, and whether it reaches the news. */
  seen: string[];
  news: boolean;
}

function record(c: NonNullable<Entity['character']>): FightRecord {
  c.fights ??= { won: 0, lost: 0, drawn: 0, spars: 0, against: {} };
  return c.fights;
}

/** The tally: each named fighter's result against each named fighter on the other side. */
export function tally(state: WorldState, battle: BattleState): void {
  const winner = battle.result?.winner ?? null;
  for (const f of battle.fighters) {
    const c = f.entityId ? state.entities[f.entityId]?.character : undefined;
    if (!c) continue;
    const r = record(c);
    if (battle.spar) r.spars += 1;
    if (winner === null) r.drawn += 1;
    else if (winner === f.side) r.won += 1;
    else r.lost += 1;
    for (const o of battle.fighters) {
      if (o.side === f.side || !o.entityId) continue;
      const row = r.against[o.entityId] ?? [0, 0, 0];
      if (winner === null) row[2] += 1;
      else if (winner === f.side) row[0] += 1;
      else row[1] += 1;
      r.against[o.entityId] = row;
    }
  }
}

function killerOf(battle: BattleState, f: Fighter): Fighter | undefined {
  return battle.fighters.find((x) => x.id === f.downBy);
}

/** As it follows "died of": "wounds from a fight with Arlong", "drowning". */
function causeOfDeath(battle: BattleState, f: Fighter): string {
  const killer = killerOf(battle, f);
  if (!killer) return 'drowning';
  return `wounds from a fight with ${killer.name}`;
}

/** Tier 2 people and the canon cast: death, prison, a beating that lingers. */
export function settleOthers(
  state: WorldState,
  data: GameData,
  battle: BattleState,
  tick: number,
  drafts: NewsDraft[],
): void {
  for (const f of battle.fighters) {
    if (f.player || !f.entityId) continue;
    const entity = state.entities[f.entityId];
    if (!entity?.character?.alive) continue;
    if (f.down === 'dead') {
      killCharacter(state, data, entity, {
        tick,
        canon: false,
        cause: causeOfDeath(battle, f),
        newsDrafts: drafts,
      });
      continue;
    }
    if (f.down === 'captured' && killerOf(battle, f)?.marine && f.criminal) {
      entity.flags['status'] = 'imprisoned';
      delete entity.flags['affiliation'];
      if (entity.character.npc) {
        delete entity.character.npc.crewId;
        entity.character.npc.goal = 'freedom';
      }
    }
  }
}

function playerEnv(
  state: WorldState,
  data: GameData,
  tick: number,
  battle: BattleState,
): LifeEnv | null {
  const p = ensureLife(state, data);
  if (!p?.c.life) return null;
  return {
    state,
    data,
    tick,
    rng: Rng.root(state.seed).fork('aftermath', battle.id),
    p,
    life: p.c.life,
    cause: `battle:${battle.source.id}`,
    ...(battle.source.causeSeq !== undefined ? { causeSeq: battle.source.causeSeq } : {}),
  };
}

const SEVERITY_WORD = { minor: 'minor', serious: 'serious', severe: 'severe' } as const;

/** The tracks a fight trained: those of the moves used and the haki used; else the fighting styles. */
function tracksUsed(data: GameData, state: WorldState, entity: Entity, me: Fighter): string[] {
  const c = entity.character;
  if (!c) return [];
  const out = new Set<string>();
  for (const used of me.totals.used) {
    if (used === 'haki:armament') out.add(HAKI_TRACKS.armament);
    else if (used === 'haki:observation') out.add(HAKI_TRACKS.observation);
    else if (used.startsWith('haki:conqueror')) out.add(HAKI_TRACKS.conqueror);
    const move = me.moves.find((m) => m.id === used);
    if (move?.source.startsWith('track:')) out.add(move.source.slice(6));
    if (move?.source === 'fruit') {
      const fruit = eatenFruit(state, entity);
      const def = fruit ? fruitDefOf(data, fruit) : undefined;
      const track = def ? fruitTrackOf(data, def) : null;
      if (track) out.add(track);
    }
  }
  if (out.size === 0) for (const t of fightingTracks(c, data)) out.add(t);
  return [...out].filter((t) => trackStateOf(c, t) !== undefined);
}

/**
 * The player's part: Health and injuries, death, capture, training and practice, the moments that
 * move haki, fame and bounty, and how a spar moves a relationship. `partnerMult` is a spar's
 * training value for the partner it was against (1 for a real fight).
 */
function playerAftermath(
  state: WorldState,
  data: GameData,
  battle: BattleState,
  tick: number,
  out: Aftermath,
  partnerMult: number,
  train: boolean,
): void {
  const me = battle.fighters.find((f) => f.player);
  const env = playerEnv(state, data, tick, battle);
  if (!me || !env) return;
  const rules = data.battle;
  const { p, life } = env;
  const maxHealth = maxHealthOf(data, p.entity, tick);
  const enemies = battle.fighters.filter((f) => f.side !== me.side);
  const result = battle.result;

  if (me.down === 'dead') {
    die(env, causeOfDeath(battle, me));
    out.lines.push({ text: 'You did not survive it.', tone: 'alert' });
    return;
  }
  // Phase 6: blades dull and wear, skill grows, gear is spent, the ship keeps her damage.
  handsAfterFight(env, battle, out.lines);

  // Injuries: each blow worth one rolls for it, by its size (a spar's a tenth as often), the
  // heaviest first and at most a few a fight. Then Health; a knockout is not a death.
  const share = Math.max(0, Math.min(1, me.hp / me.maxHp));
  life.health = maxHealth;
  let injuries = 0;
  [...me.totals.wounds]
    .sort((a, b) => b - a)
    .forEach((w, i) => {
      if (injuries >= rules.damage.maxInjuries) return;
      const r = env.rng.fork('wound', i);
      const chance =
        Math.min(0.9, w * rules.damage.injuryChance) * (battle.spar ? rules.spar.injuryMult : 1);
      if (!r.fork('roll').chance(chance)) return;
      let severity: 'minor' | 'serious' | 'severe' = 'minor';
      for (const band of rules.damage.severities) if (w >= band.atLeast) severity = band.severity;
      const injury = injure(
        { ...env, rng: r },
        { severity, area: 'roll', cause: 'violence', hurts: false },
      );
      if (!injury) return;
      injuries += 1;
      out.lines.push({ text: `A ${SEVERITY_WORD[severity]} injury: ${injury.name}.`, tone: 'bad' });
    });
  if (!p.c.alive) return;
  const floor = me.down !== null && me.down !== 'fled' ? rules.damage.knockedOutHealth : 0.02;
  // A spar costs bruises, not blood: a share of what the fight took.
  const kept = battle.spar ? 1 - (1 - share) * rules.spar.healthCost : Math.max(share, floor);
  life.health = Math.min(life.health, Math.max(1, Math.round(maxHealth * kept)));

  // Taken: by the Marines, a cell; by anyone else, what was in their pockets.
  if (me.down === 'captured') {
    const captor = killerOf(battle, me);
    if (captor?.marine && me.criminal) {
      arrest(env, 0, 3);
      out.lines.push({ text: 'Taken by the Marines.', tone: 'alert' });
    } else {
      const lost = Math.round(Math.max(0, p.c.berries) * 0.3);
      if (lost > 0) pay(env, -lost);
      out.lines.push({ text: `Robbed of ${lost.toLocaleString('en-GB')} Berries.`, tone: 'bad' });
    }
  }

  // Training, as a fight trains (a spar, by its partner). An activity's fight trains through the
  // activity instead.
  const scale =
    stageOf(data, p, tick).training * (battle.spar ? 0.6 * partnerMult : 1) * (train ? 1 : 0);
  for (const [stat, base] of Object.entries(rules.rewards.gains)) {
    if (scale > 0) trainStat(data, p.entity, p.c, stat, (base ?? 0) * scale, tick);
  }
  const ctx = powerCtxOf(env);
  const before = new Map<string, number>();
  const tracks = tracksUsed(data, state, p.entity, me);
  for (const t of tracks) before.set(t, trackStateOf(p.c, t)?.stage ?? 0);
  if (scale > 0)
    for (const t of tracks)
      addProgress(ctx, t, rules.rewards.trackPoints * scale, battle.spar ? 'spar' : 'fight');
  for (const t of tracks) {
    const now = trackStateOf(p.c, t)?.stage ?? 0;
    if (now > (before.get(t) ?? 0)) {
      const track = data.tracks[t];
      const stage = track?.stages[now];
      if (track && stage) out.lines.push({ text: `${track.name}: ${stage.name}.`, tone: 'good' });
    }
  }
  for (const used of me.totals.used) {
    const move = p.c.powers?.moves.find((m) => m.id === used);
    if (move) useMove(data, move, tick);
  }
  if (tracks.length > 0)
    out.lines.push({
      text: `Practice for ${tracks.map((t) => data.tracks[t]?.name ?? t).join(', ')}.`,
      tone: 'plain',
    });

  // Moments that move haki and break plateaus.
  const strongest = Math.max(0, ...enemies.map((e) => e.cp));
  if (!battle.spar) {
    if (strongest >= me.cp * 1.3) powerEvent(ctx, 'stronger_foe');
    if (me.status.secondWind || share < 0.1) powerEvent(ctx, 'near_death');
    if (result?.how === 'lost' && result.decisive) powerEvent(ctx, 'defeat');
    if (
      me.totals.used.some((u) => u.startsWith('haki:conqueror')) &&
      enemies.some((e) => e.conqueror > 0)
    )
      powerEvent(ctx, 'clash');
    if (battle.log.some((l) => l.text.startsWith(`${me.name} throws themselves in front`)))
      powerEvent(ctx, 'crisis');
  }

  // Fame for beating someone worth beating; infamy for a killing; bounty for beating Marines.
  if (result?.how === 'won' && !battle.spar) {
    const top = Math.max(0, ...enemies.map((e) => tierIndex(data, tierOf(data, e.cp).id)));
    const fame = rules.rewards.famePerTier * top;
    if (fame > 0) {
      reputation(p.entity, 'fame').base += fame;
      out.lines.push({ text: `Fame +${fame}.`, tone: 'good' });
    }
    const marines = enemies.filter((e) => e.marine).reduce((n, e) => n + e.cp, 0);
    if (marines > 0 && me.criminal) {
      const add = Math.round((rules.rewards.bountyPerPower * marines * 100) / 100000) * 100000;
      if (add > 0) {
        const now = typeof p.entity.flags['bounty'] === 'number' ? p.entity.flags['bounty'] : 0;
        p.entity.flags['bounty'] = now + add;
        reputation(p.entity, 'infamy').base += 1;
        out.lines.push({
          text: `Bounty up by ${add.toLocaleString('en-GB')} Berries.`,
          tone: 'alert',
        });
      }
    }
  }
  const killed = enemies.filter((e) => e.down === 'dead' && e.downBy === me.id && !e.criminal);
  if (killed.length > 0)
    reputation(p.entity, 'infamy').base += rules.rewards.infamyForKill * killed.length;

  // A spar moves a relationship: respect for the winner, a rivalry after a close one, a grudge.
  if (battle.spar) {
    const partner = enemies.find((e) => e.entityId);
    const other = partner?.entityId ? state.entities[partner.entityId] : undefined;
    if (partner && other?.character) {
      const close = Math.abs(me.hp / me.maxHp - partner.hp / partner.maxHp) < rules.spar.closeShare;
      const won = result?.winner === me.side;
      if (!p.c.relationships.some((r) => r.id === other.id))
        relate(
          p.entity,
          other,
          close ? 'rival' : 'friend',
          close ? 10 : 25,
          tick,
          env.rng.fork('relate'),
        );
      if (won) shiftOpinion(other, p.entity.id, rules.spar.respect, tick);
      else shiftOpinion(p.entity, other.id, rules.spar.respect, tick);
      const bad = (who: Entity) =>
        who.character?.traits.some((t) => t === 'trait_hot_headed' || t === 'trait_proud');
      if (!won && bad(p.entity)) shiftOpinion(p.entity, other.id, rules.spar.grudge, tick);
      if (won && bad(other)) shiftOpinion(other, p.entity.id, rules.spar.grudge, tick);
      if (close && !p.c.relationships.some((r) => r.id === other.id && r.kind === 'rival'))
        out.lines.push({ text: `A close one: ${other.name} will want another go.`, tone: 'plain' });
    }
  }
  out.lines.unshift({
    text: share >= 0.99 ? 'Not a scratch.' : `Health ${Math.round(life.health)} of ${maxHealth}.`,
    tone: share > 0.5 ? 'plain' : 'bad',
  });
  for (const line of out.lines.slice(1, 4)) reportLine(env, line.text, line.tone);
}

/** Whoever is noteworthy in a fight puts it in the news (and so, by rule 4, everyone hears). */
function notable(data: GameData, f: Fighter): boolean {
  const r = data.battle.rewards;
  return (
    f.fame >= r.newsFame ||
    f.bounty >= r.newsBounty ||
    (f.entityId !== null && f.entityId in data.cast)
  );
}

/**
 * Apply everything a finished fight leaves behind. `partnerMult` scales a spar's training (see
 * spar.ts). Returns the post-fight card.
 */
export function applyAftermath(
  state: WorldState,
  data: GameData,
  battle: BattleState,
  tick: number,
  drafts: NewsDraft[],
  partnerMult = 1,
  train = true,
): Aftermath {
  const out: Aftermath = { lines: [], seen: [], news: false };
  tally(state, battle);
  playerAftermath(state, data, battle, tick, out, partnerMult, train);
  settleOthers(state, data, battle, tick, drafts);
  const seen = battle.fighters.filter((f) => !f.player && notable(data, f)).map((f) => f.name);
  out.seen = seen;
  const result = battle.result;
  if (
    !battle.spar &&
    result?.winner !== null &&
    result?.winner !== undefined &&
    battle.fighters.some(
      (f) => notable(data, f) || (f.player && f.fame >= data.battle.rewards.newsFame),
    )
  ) {
    const win = battle.fighters.filter((f) => f.side === result.winner && f.down === null);
    const lose = battle.fighters.filter((f) => f.side !== result.winner);
    const a = win.find((f) => f.leader)?.name ?? win[0]?.name;
    const b = lose.find((f) => f.leader)?.name ?? lose[0]?.name;
    const place = battle.place ? (data.locations[battle.place]?.name ?? 'sea') : 'sea';
    if (a && b) {
      drafts.push({
        text:
          data.battle.lines['news_fight']
            ?.replace('{a}', a)
            .replace('{b}', b)
            .replace('{place}', place) ?? `${a} defeated ${b}.`,
        tags: ['news', 'combat'],
        ...(battle.place ? { place: battle.place } : {}),
      });
      out.news = true;
    }
  }
  // Phase 7: a battle won with people of the player's about ends in a banquet.
  if (
    !battle.spar &&
    result?.winner === 0 &&
    (battle.scale === 'crew' || battle.scale === 'naval' || battle.scale === 'war')
  )
    feastHook.fire?.(state, data);
  return out;
}

/** The player's fighter id in a battle (always "you"). */
export const PLAYER_FIGHTER = 'you';
export { lifeLog };
import { feastHook } from '../heart/hooks';
