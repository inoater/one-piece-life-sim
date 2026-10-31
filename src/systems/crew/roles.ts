import type { CrewRole, GameData } from '../../engine/data/schemas';
import type { Entity } from '../../engine/state';
import { renderTemplate } from '../../engine/template';
import { statTotal } from '../life/body';
import { byId } from './state';

/**
 * Role fit (Phase 8): how well someone would serve each crew role, as a number and in words, with
 * the reasons ("can cook; has never held a chart"). It reads their stats, the Phase 6 skills and
 * crafts, the Phase 4 tracks, their traits and trade, and the role's mastery they have earned.
 */

export interface Fit {
  role: string;
  score: number;
  words: string;
  reasons: string[];
}

const PRONOUNS = {
  he: { they: 'he', them: 'him', their: 'his' },
  she: { they: 'she', them: 'her', their: 'her' },
  they: { they: 'they', them: 'them', their: 'their' },
} as const;

function pronounVars(entity: Entity): Record<string, string> {
  const p = PRONOUNS[entity.character?.pronouns ?? 'they'];
  return { ...p, They: p.they.replace(/^./, (c) => c.toUpperCase()), Their: p.their };
}

export function fitWords(data: GameData, score: number): string {
  return data.crew.fit.words.find((w) => score >= w.min)?.text ?? 'a poor fit';
}

function skillOf(entity: Entity, key: string): number {
  const hands = entity.character?.hands;
  if (!hands) return 0;
  const craft = (hands.crafts as Record<string, number | undefined>)[key];
  return craft ?? hands.skills[key] ?? 0;
}

/** The number alone (the auto-fill scores every post against everyone, every month). */
export function roleScore(
  data: GameData,
  entity: Entity,
  role: CrewRole,
  tick: number,
  mastery = 0,
): number {
  const c = entity.character;
  let score = 0;
  for (const [stat, w] of Object.entries(role.stats))
    score += (w ?? 0) * statTotal(entity, stat, tick);
  for (const [skill, w] of Object.entries(role.skills)) score += w * skillOf(entity, skill);
  for (const [trackId, w] of Object.entries(role.tracks)) {
    const ts = c?.powers?.tracks[trackId];
    const track = data.tracks[trackId];
    if (ts && track) score += (w * (ts.stage + 1)) / Math.max(1, track.stages.length);
  }
  for (const [trait, w] of Object.entries(role.traits)) if (c?.traits.includes(trait)) score += w;
  const occ = c?.occupation;
  if (occ) score += role.occupations[occ] ?? 0;
  return Math.round(score + (mastery / 100) * data.crew.fit.mastery);
}

/** Their fit for a role, 0 to about 120. `mastery` is the role skill they have earned (0 to 100). */
export function roleFit(
  data: GameData,
  entity: Entity,
  role: CrewRole,
  tick: number,
  mastery = 0,
): Fit {
  const c = entity.character;
  let score = 0;
  const notes: string[] = [];
  for (const [stat, w] of Object.entries(role.stats))
    score += (w ?? 0) * statTotal(entity, stat, tick);
  for (const [skill, w] of Object.entries(role.skills)) score += w * skillOf(entity, skill);
  for (const [trackId, w] of Object.entries(role.tracks)) {
    const ts = c?.powers?.tracks[trackId];
    const track = data.tracks[trackId];
    if (ts && track) score += (w * (ts.stage + 1)) / Math.max(1, track.stages.length);
  }
  for (const [trait, w] of Object.entries(role.traits)) {
    if (!c?.traits.includes(trait)) continue;
    score += w;
    const name = data.traits[trait]?.name;
    if (name && w > 0) notes.push(name.toLowerCase());
  }
  const occ = c?.occupation;
  if (occ && role.occupations[occ] !== undefined) {
    score += role.occupations[occ] ?? 0;
    const name = data.occupations[occ]?.name;
    if (name) notes.push(`was ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name.toLowerCase()}`);
  }
  score += (mastery / 100) * data.crew.fit.mastery;
  if (mastery >= 20) notes.push(`${Math.round(mastery)} role mastery`);
  const reason = renderTemplate(score >= 45 ? role.good : role.bad, pronounVars(entity));
  return {
    role: role.id,
    score: Math.round(score),
    words: fitWords(data, score),
    reasons: [reason, ...notes],
  };
}

/** Every role, best first. */
export function roleFits(
  data: GameData,
  entity: Entity,
  tick: number,
  mastery: Readonly<Record<string, number>> = {},
): Fit[] {
  return data.crew.roles
    .map((r) => roleFit(data, entity, r, tick, mastery[r.id] ?? 0))
    .sort((a, b) => b.score - a.score || a.role.localeCompare(b.role));
}

/** The role someone is best at, leaving the captain's to the captain. */
export function bestRole(data: GameData, entity: Entity, tick: number): string {
  return roleFits(data, entity, tick).find((f) => f.role !== 'captain')?.role ?? 'hand';
}

export function roleOf(data: GameData, id: string): CrewRole | undefined {
  return byId(data.crew.roles, id);
}
