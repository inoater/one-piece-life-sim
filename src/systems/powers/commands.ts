import type { GameData, TechForm, TechTag } from '../../engine/data/schemas';
import { createEntity } from '../../engine/entities';
import { Rng } from '../../engine/rng';
import type { WorldState } from '../../engine/state';
import { formatBerries } from '../genesis/text';
import { ensureLife } from '../life/body';
import { pay, type LifeEnv } from '../life/env';
import { buyFruit, eatFruit, findFruit, identifyFruit } from './fruits';
import { wake } from './haki';
import { ensurePowers, type HakiColour } from './state';
import { combine, draftTechnique, moveName } from './techniques';
import {
  addProgress,
  breakthroughTrack,
  learnFromTeacher,
  openTrack,
  powerCtxOf,
  refreshPowerMods,
} from './tracks';

/**
 * What the player can do with their powers between months (Phase 4): be taken on in a style,
 * choose the focus of their practice, eat, identify or buy a Devil Fruit, buy simple gear, invent,
 * rename and combine techniques. Like the life loop's commands, their randomness is keyed to the
 * log position at which they happen.
 */

export class PowersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PowersError';
  }
}

function commandEnv(state: WorldState, data: GameData, what: string): LifeEnv {
  const p = ensureLife(state, data);
  if (!p?.c.life) throw new PowersError('Nobody alive is being played');
  return {
    state,
    data,
    tick: state.tick,
    rng: Rng.root(state.seed).fork('command', what, state.counters.logSeq),
    p,
    life: p.c.life,
    cause: `action:${what}`,
  };
}

function guard<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof PowersError) throw error;
    throw new PowersError(error instanceof Error ? error.message : String(error));
  }
}

export function learnTrackCommand(state: WorldState, data: GameData, trackId: string): void {
  const env = commandEnv(state, data, 'powers/learn');
  guard(() => learnFromTeacher(env, trackId));
}

export function setFocus(state: WorldState, data: GameData, trackId: string | null): void {
  const env = commandEnv(state, data, 'powers/focus');
  const powers = ensurePowers(env.p.c);
  if (trackId !== null && !powers.tracks[trackId])
    throw new PowersError('You have not begun that track');
  powers.focus = trackId;
}

export function eatCommand(state: WorldState, data: GameData, fruitId: string): void {
  const env = commandEnv(state, data, 'powers/eat');
  guard(() => eatFruit(env, fruitId));
}

export function identifyCommand(
  state: WorldState,
  data: GameData,
  fruitId: string,
  how: 'encyclopedia' | 'scholar',
): void {
  const env = commandEnv(state, data, 'powers/identify');
  guard(() => identifyFruit(env, fruitId, how));
}

export function buyFruitCommand(state: WorldState, data: GameData, fruitId: string): void {
  const env = commandEnv(state, data, 'powers/buyFruit');
  guard(() => buyFruit(env, fruitId));
}

/** A sword, a pistol or a bow from a market or a smithy (Phase 6 makes these real items). */
export function buyGear(state: WorldState, data: GameData, weaponId: string): void {
  const env = commandEnv(state, data, 'powers/buyGear');
  const weapon = data.weapons[weaponId];
  if (!weapon?.gear || weapon.price === undefined) throw new PowersError('That is not for sale');
  const { p } = env;
  if (p.place.atSea || !p.place.features.some((f) => f === 'market' || f === 'smithy')) {
    throw new PowersError('No market or smithy here');
  }
  if (p.c.berries < weapon.price)
    throw new PowersError(`It costs ${formatBerries(weapon.price)} Berries`);
  pay(env, -weapon.price);
  const gear = ensurePowers(p.c).gear;
  gear[weapon.gear] = (gear[weapon.gear] ?? 0) + 1;
  // Phase 5: which weapon it is, so its own Combat Power and attack count.
  gear[weapon.id] = (gear[weapon.id] ?? 0) + 1;
  refreshPowerMods(data, p.entity, state.tick, state);
}

export function buyEncyclopedia(state: WorldState, data: GameData): void {
  const env = commandEnv(state, data, 'powers/buyEncyclopedia');
  const rules = data.powers.fruit.encyclopedia;
  const { p } = env;
  if (p.place.atSea || !p.place.features.includes('library'))
    throw new PowersError('Only a library sells it');
  if (p.c.berries < rules.price)
    throw new PowersError(`It costs ${formatBerries(rules.price)} Berries`);
  const powers = ensurePowers(p.c);
  if (powers.items.some((id) => state.entities[id]?.flags['item.kind'] === 'encyclopedia')) {
    throw new PowersError('You already have one');
  }
  pay(env, -rules.price);
  const book = createEntity(state, {
    type: 'item',
    origin: 'generated',
    name: rules.name,
    flags: { 'item.kind': 'encyclopedia' },
    knownBy: [p.entity.id],
  });
  powers.items.push(book.id);
}

export function inventCommand(
  state: WorldState,
  data: GameData,
  parts: { source: string; form: TechForm; tag: TechTag; name: string },
): void {
  const env = commandEnv(state, data, 'powers/invent');
  guard(() => draftTechnique(state, data, env.p.entity, parts, state.tick));
}

export function abandonDraft(state: WorldState, data: GameData, draftId: string): void {
  const env = commandEnv(state, data, 'powers/abandon');
  const powers = ensurePowers(env.p.c);
  const before = powers.drafts.length;
  powers.drafts = powers.drafts.filter((d) => d.def.id !== draftId);
  if (powers.drafts.length === before) throw new PowersError('No such technique in progress');
}

export function renameMove(state: WorldState, data: GameData, moveId: string, name: string): void {
  const env = commandEnv(state, data, 'powers/rename');
  const powers = ensurePowers(env.p.c);
  const move = powers.moves.find((m) => m.id === moveId);
  if (!move) throw new PowersError('You do not know that technique');
  const clean = name.trim();
  if (clean.length === 0) {
    delete move.name;
    return;
  }
  if (clean.length > 40) throw new PowersError('A name of 40 letters at most');
  if (
    powers.moves.some((m) => m !== move && moveName(data, m).toLowerCase() === clean.toLowerCase())
  ) {
    throw new PowersError('You already know a technique by that name');
  }
  move.name = clean;
}

export function combineCommand(
  state: WorldState,
  data: GameData,
  partnerId: string,
  moveId: string,
  partnerMoveId: string,
  name: string,
): void {
  const env = commandEnv(state, data, 'powers/combine');
  const partner = state.entities[partnerId];
  if (!partner?.character?.alive) throw new PowersError('They are not here to train with');
  guard(() => combine(state, data, env.p.entity, partner, moveId, partnerMoveId, name, state.tick));
}

// ---- Debug tools ---------------------------------------------------------------------------

export function debugGiveFruit(state: WorldState, data: GameData, fruitId?: string): void {
  const env = commandEnv(state, data, 'debug/giveFruit');
  guard(() => findFruit(env, fruitId ? { fruit: fruitId } : {}));
}

export function debugWakeHaki(state: WorldState, data: GameData, haki: HakiColour): void {
  const env = commandEnv(state, data, 'debug/wakeHaki');
  wake(powerCtxOf(env), haki, 'event');
}

export function debugPowerPoints(
  state: WorldState,
  data: GameData,
  trackId: string,
  points: number,
  breakthrough: boolean,
): void {
  const env = commandEnv(state, data, 'debug/powerPoints');
  const ctx = powerCtxOf(env);
  if (!env.p.c.powers?.tracks[trackId]) openTrack(ctx, trackId, { source: 'debug' });
  if (breakthrough) breakthroughTrack(ctx, trackId);
  if (points > 0) addProgress(ctx, trackId, points, 'drill');
}
