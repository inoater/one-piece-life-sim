import { dateOf, formatDate, formatYear } from '../../engine/calendar';
import type { GameData } from '../../engine/data/schemas';
import {
  PUBLIC_KNOWLEDGE,
  type Entity,
  type EventRecord,
  type WorldState,
} from '../../engine/state';
import { ageAt } from './stages';
import { numberWords } from './text';

/**
 * The backstory, kept up to date: the paragraph written when the story began (now in the past
 * tense), then the life since, year by year, from the chronicle's milestones (children born, people
 * lost, deeds, a Devil Fruit, haki waking, a stage of a power reached, a trait earned, a fight that
 * mattered, a canon event lived through), and where things stand now. Only what the person knows
 * (rule 4), and only their own lines.
 */

export interface StoryChapter {
  /** "1517 SC" */
  when: string;
  age: number;
  lines: string[];
}

export interface StoryView {
  /** The opening paragraph, written when the story began. */
  opening: string;
  chapters: StoryChapter[];
  /** "Now it is March 1518 SC. You are twenty-four, a fisher on Fish-Man Island." */
  now: string;
}

/** Which lines are milestones, most telling first. */
const MILESTONES: { test: (r: EventRecord) => boolean; rank: number }[] = [
  { test: (r) => r.tags.includes('death'), rank: 0 },
  { test: (r) => r.tags.includes('birth') && r.kind !== 'backstory', rank: 1 },
  // A fruit found, bought or eaten (not the rumours about one).
  {
    test: (r) => r.tags.includes('fruit') && /^You (found|ate|bought|searched)/.test(r.summary),
    rank: 2,
  },
  { test: (r) => r.tags.includes('haki') && r.tags.includes('power'), rank: 3 },
  { test: (r) => r.tags.includes('power') && r.tags.includes('stage'), rank: 4 },
  { test: (r) => r.tags.includes('canon'), rank: 5 },
  {
    test: (r) =>
      (r.cause ?? '').startsWith('battle:') && r.tags.includes('fight') && !r.tags.includes('spar'),
    rank: 6,
  },
  { test: (r) => r.tags.includes('earned') || r.tags.includes('evolved'), rank: 7 },
  { test: (r) => r.tags.includes('mentoring'), rank: 8 },
  { test: (r) => r.tags.includes('drift-gained'), rank: 9 },
];
const PER_YEAR = 5;

/** "Now it is ... and your story begins." becomes "That was ... when your story began." */
export function pastTense(backstory: string): string {
  return backstory
    .replace(
      /Now it is ([^.]+)\. You are ([^.]+?), and your story begins\./,
      'That was $1. You were $2, when your story began.',
    )
    .replace(
      /Now it is ([^,]+), you are ([^,]+), and your story begins\./,
      'That was $1, when you were $2 and your story began.',
    );
}

function rankOf(r: EventRecord): number | null {
  for (const m of MILESTONES) if (m.test(r)) return m.rank;
  return null;
}

export function lifeStory(data: GameData, state: WorldState, entity: Entity): StoryView | null {
  const c = entity.character;
  if (!c?.backstory) return null;
  const knows = (r: EventRecord) =>
    r.knownBy.includes(entity.id) || r.knownBy.includes(PUBLIC_KNOWLEDGE);
  const start =
    state.log.find((r) => r.tags.includes('genesis') && r.actorIds.includes(entity.id))?.tick ??
    c.birthTick;
  const byYear = new Map<number, { rank: number; seq: number; text: string }[]>();
  const seen = new Set<string>();
  const add = (tick: number, rank: number, seq: number, text: string) => {
    const t = text.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    const year = dateOf(data.calendar, tick).year;
    const list = byYear.get(year) ?? [];
    list.push({ rank, seq, text: t });
    byYear.set(year, list);
  };
  for (const r of state.log) {
    if (r.tick < start || !r.actorIds.includes(entity.id) || !knows(r)) continue;
    if (r.tags.includes('genesis') || r.kind === 'backstory') continue;
    const rank = rankOf(r);
    if (rank !== null) add(r.tick, rank, r.seq, r.summary);
  }
  // Deeds the life loop kept (a proposal accepted, a rescue, a record).
  // (Only those told as a sentence: the terse ones, "Ate a Devil Fruit.", repeat a line above.)
  (c.life?.deeds ?? []).forEach((d, i) => {
    if (d.tick >= start && /^You /.test(d.text)) add(d.tick, 1.5, i, d.text);
  });
  const chapters: StoryChapter[] = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, lines]) => ({
      when: formatYear(data.calendar, year),
      age: Math.max(0, ageAt(c.birthTick, year * 12 + 6)),
      lines: lines
        .sort((a, b) => a.rank - b.rank || a.seq - b.seq)
        .slice(0, PER_YEAR)
        .sort((a, b) => a.seq - b.seq)
        .map((l) => l.text),
    }));
  const tick = c.alive ? state.tick : (c.death?.tick ?? state.tick);
  const age = Math.max(0, ageAt(c.birthTick, tick));
  const job = c.life?.job ? data.jobs[c.life.job.id]?.name : undefined;
  const placeId = c.place ?? data.birthplaces[c.birthplace]?.location;
  const place = placeId ? data.locations[placeId]?.name : undefined;
  const voyage = c.travel?.voyage;
  const where = voyage
    ? `at sea, bound for ${data.locations[voyage.to]?.name ?? voyage.to}`
    : place
      ? `in ${place}`
      : '';
  const now = c.alive
    ? `Now it is ${formatDate(dateOf(data.calendar, tick))}. You are ${numberWords(age)}${job ? `, a ${job.toLowerCase()}` : ''}${where ? `, ${where}` : ''}.`
    : `Your story ended in ${formatDate(dateOf(data.calendar, tick))}, at ${numberWords(age)}.`;
  return { opening: pastTense(c.backstory), chapters, now };
}
