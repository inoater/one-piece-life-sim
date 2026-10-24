import type {
  GameData,
  PowerEvent,
  PowerLevel,
  Track,
  TrackStage,
} from '../../engine/data/schemas';
import { POWER_LEVELS } from '../../engine/data/schemas';
import type { CharacterData, Entity, PowersData, Stat, TrackState } from '../../engine/state';
import { makeStat, removeModsBySource } from '../../engine/stats';

/**
 * A person's powers (Phase 4) as plain state: the tracks they stand on, the fruit they ate, haki
 * stamina, their moveset. Everything else in systems/powers reads and writes through here.
 *
 * Every power that changes a number does it as a modifier with a readable source (rule 3): a
 * stage's Combat Power goes onto the `combatBonus` stat as "Armament Haki: Harden", a Zoan's body
 * onto each stat as "Elephant-Elephant Fruit", so the sheet's tooltips explain themselves.
 */

export const HAKI_TRACKS = {
  observation: 'track_observation',
  armament: 'track_armament',
  conqueror: 'track_conqueror',
} as const;
export type HakiColour = keyof typeof HAKI_TRACKS;
export const HAKI_COLOURS = Object.keys(HAKI_TRACKS) as HakiColour[];

export function freshPowers(): PowersData {
  return {
    tracks: {},
    focus: null,
    fruit: null,
    stamina: 0,
    moves: [],
    drafts: [],
    events: {},
    items: [],
    gear: {},
    known: {},
    rumours: [],
  };
}

/** The powers block, created the first time a power touches someone. */
export function ensurePowers(c: CharacterData): PowersData {
  if (!c.powers) c.powers = freshPowers();
  return c.powers;
}

export function trackStateOf(c: CharacterData, trackId: string): TrackState | undefined {
  return c.powers?.tracks[trackId];
}

export function isOpen(c: CharacterData, trackId: string): boolean {
  return c.powers?.tracks[trackId] !== undefined;
}

export function hakiAwake(c: CharacterData, colour: HakiColour): boolean {
  return isOpen(c, HAKI_TRACKS[colour]);
}

export function stageIndexOf(track: Track, stageId: string): number {
  return track.stages.findIndex((s) => s.id === stageId);
}

/** The stage someone stands on in a track (the first, once it is open). */
export function stageOf(track: Track, ts: TrackState): TrackStage {
  return (track.stages[Math.min(ts.stage, track.stages.length - 1)] ??
    track.stages[0]) as TrackStage;
}

export function nextStageOf(track: Track, ts: TrackState): TrackStage | null {
  return track.stages[ts.stage + 1] ?? null;
}

/** At least this stage ("open" means just begun). */
export function reached(
  data: GameData,
  c: CharacterData,
  trackId: string,
  stageId: string,
): boolean {
  const ts = trackStateOf(c, trackId);
  if (!ts) return false;
  if (stageId === 'open') return true;
  const track = data.tracks[trackId];
  if (!track) return false;
  const want = stageIndexOf(track, stageId);
  return want >= 0 && ts.stage >= want;
}

export function levelIndex(level: PowerLevel): number {
  return POWER_LEVELS.indexOf(level);
}

export function levelName(data: GameData, level: PowerLevel): string {
  return data.powers.levels.find((l) => l.id === level)?.name ?? level;
}

/** Record that something which moves powers happened (rule 6: the log says what, this says when). */
export function notePowerEvent(c: CharacterData, event: PowerEvent, tick: number): void {
  ensurePowers(c).events[event] = tick;
}

/** Whether a power event has happened since a month. */
export function eventSince(c: CharacterData, event: PowerEvent, tick: number): boolean {
  const at = c.powers?.events[event];
  return at !== undefined && at >= tick;
}

// ---- Bonus stats (rule 3) -------------------------------------------------------------------

/** An entity stat that a derived value adds (character.json `bonusStat`), created at 0. */
export function bonusStat(entity: Entity, id: string): Stat {
  let stat = entity.stats[id];
  if (!stat) {
    stat = makeStat(0);
    entity.stats[id] = stat;
  }
  return stat;
}

/** Sources a power puts on stats end with this, so they can be rebuilt in one sweep. */
export const POWER_SUFFIX = ' (power)';

export function powerSource(name: string): string {
  return `${name}${POWER_SUFFIX}`;
}

/** Remove every modifier a power put on this entity's stats (before they are applied again). */
export function clearPowerMods(entity: Entity): void {
  for (const stat of Object.values(entity.stats)) {
    for (const source of new Set(stat.mods.map((m) => m.source))) {
      if (source.endsWith(POWER_SUFFIX)) removeModsBySource(stat, source);
    }
  }
}
