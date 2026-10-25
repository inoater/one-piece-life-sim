import type { GameData, Recipe } from '../../engine/data/schemas';
import type { Craft } from '../../engine/data/defs';
import type { Rng } from '../../engine/rng';
import type { Entity, WorldState } from '../../engine/state';
import { formatBerries } from '../genesis/text';
import { requirementReason, statTotal, type Person } from '../life/body';
import { lifeLog, pay, renderLife, reportLine, type LifeEnv } from '../life/env';
import { trackStateOf } from '../powers/state';
import { buildMonth } from './ships';
import { ensureHands, HandsError, itemOf, itemStory, makeItem } from './items';
import { goodPrice, ownShip, spreadFor, tradesHere } from './market';

/**
 * Crafting (Phase 6): smithing, gunsmithing, shipbuilding, medicine, cooking and invention share
 * one schema (data/recipes): inputs, tools, a place, a skill, months of work and a quality roll.
 * A project is started (materials bought), then worked month by month through the "Work on your
 * project" activity, whose effort and commitment past Hard set the pace; each month's work rolls
 * its quality from craft skill and stats, and the finished thing carries the average. Masters and
 * schools are places on the map: working there goes faster and teaches more.
 *
 * Raising a blade's grade is a project too ("temper:<item id>"): a master's months at a master
 * smith's forge, and a chance at the end. Counts never exceed canon's.
 */

export function craftSkill(entity: Entity, craft: Craft): number {
  return entity.character?.hands?.crafts[craft] ?? 0;
}

/** The school here for a craft, if any: its teacher multiplier. */
export function schoolFor(
  data: GameData,
  placeId: string | null | undefined,
  craft: Craft,
): number {
  if (!placeId) return 1;
  return (
    data.hands.schools.find((s) => s.place === placeId && s.crafts.includes(craft))?.teacher ?? 1
  );
}

/** Whether the person's ship (aboard) has a room with this effect. */
export function shipHasRoom(state: WorldState, data: GameData, p: Person, effect: string): boolean {
  const ship = ownShip(state, p);
  const rooms = ship?.ship?.design?.rooms ?? [];
  return rooms.some((id) => data.ships.rooms.find((r) => r.id === id)?.effect === effect);
}

/** Berries the materials cost here: the recipe's own, and goods from the hold or the market. */
export function materialCost(
  env: Pick<LifeEnv, 'state' | 'data' | 'p' | 'tick'>,
  recipe: Recipe,
): number | null {
  const { state, data, p, tick } = env;
  let cost = recipe.cost;
  const hands = p.c.hands;
  for (const [good, n] of Object.entries(recipe.goods)) {
    const have = hands?.cargo[good] ?? 0;
    const missing = Math.max(0, n - have);
    if (missing === 0) continue;
    const loc = p.place.location;
    if (!loc || p.place.atSea || !tradesHere(data, loc, good)) return null;
    cost += Math.round(
      goodPrice(state, data, loc.id, good) * (1 + spreadFor(data, p, tick)) * missing,
    );
  }
  return cost;
}

/** Why a recipe cannot be started here and now, or null. */
export function recipeLock(
  env: Pick<LifeEnv, 'state' | 'data' | 'p' | 'tick'>,
  recipe: Recipe,
): string | null {
  const { state, data, p, tick } = env;
  if (recipe.storyLocked) return 'Only the story makes this';
  const features = p.place.features as readonly string[];
  const placeOk =
    (recipe.features.length === 0 && recipe.places.length === 0) ||
    recipe.features.some((f) => features.includes(f)) ||
    (p.place.location !== null && recipe.places.includes(p.place.location.id));
  const atSeaOk =
    p.place.atSea &&
    recipe.places.length === 0 &&
    (recipe.craft === 'cooking' || shipHasRoom(state, data, p, 'craft'));
  if (!placeOk && !atSeaOk) {
    if (recipe.places.length > 0)
      return `Only at ${recipe.places.map((id) => data.locations[id]?.name ?? id).join(' or ')}`;
    return `Needs ${recipe.features.join(' or ')} (not here)`;
  }
  const skill = craftSkill(p.entity, recipe.craft);
  if (skill < recipe.skill)
    return `Needs ${recipe.craft} skill ${recipe.skill} (you have ${Math.floor(skill)})`;
  const reason = requirementReason(state, data, p, recipe.requires, tick);
  if (reason) return reason;
  const cost = materialCost(env, recipe);
  if (cost === null) return 'The materials are not sold here';
  if (p.c.berries < cost) return `Materials cost ${formatBerries(cost)} Berries`;
  return null;
}

/** Start a project: buy the materials, set it up where you stand. */
export function startProject(env: LifeEnv, recipeId: string): void {
  const { data, p, tick } = env;
  const recipe = data.recipes[recipeId];
  if (!recipe) throw new HandsError(`There is no recipe "${recipeId}"`);
  const hands = ensureHands(p.entity);
  if (hands.project) throw new HandsError('Finish or abandon your current project first');
  const lock = recipeLock(env, recipe);
  if (lock) throw new HandsError(lock);
  const cost = materialCost(env, recipe) ?? 0;
  pay(env, -cost);
  for (const [good, n] of Object.entries(recipe.goods)) {
    const have = hands.cargo[good] ?? 0;
    if (have > 0) {
      const used = Math.min(have, n);
      hands.paid[good] = (hands.paid[good] ?? 0) * (1 - used / have);
      hands.cargo[good] = have - used;
      if (hands.cargo[good] === 0) {
        delete hands.cargo[good];
        delete hands.paid[good];
      }
    }
  }
  hands.project = {
    recipe: recipe.id,
    done: 0,
    needed: recipe.months,
    place: p.place.atSea ? 'sea' : (p.place.location?.id ?? 'sea'),
    sinceTick: tick,
    quality: 0,
  };
  const name = madeName(data, recipe);
  const text = renderLife(env, data.hands.lines['craftStart'] ?? '', { item: name });
  lifeLog(env, text, { tags: ['personal', 'craft'] });
  reportLine(env, `${text} Materials: ${formatBerries(cost)} Berries.`, 'plain');
}

/** Start raising a blade's grade (a master's long work at a master smith's forge). */
export function startTemper(env: LifeEnv, itemId: string): void {
  const { data, p, tick, state } = env;
  const hands = ensureHands(p.entity);
  if (hands.project) throw new HandsError('Finish or abandon your current project first');
  const item = itemOf(state, itemId);
  const b = item?.item;
  if (!item || !b || b.holderId !== p.entity.id || b.family !== 'blade')
    throw new HandsError('You can only temper a blade you carry');
  const lock = temperLock(env, item);
  if (lock) throw new HandsError(lock);
  pay(env, -data.hands.temper.cost);
  hands.project = {
    recipe: `temper:${item.id}`,
    done: 0,
    needed: data.hands.temper.months,
    place: p.place.location?.id ?? 'sea',
    sinceTick: tick,
    quality: 0,
  };
  const text = renderLife(env, data.hands.lines['craftStart'] ?? '', { item: item.name });
  lifeLog(env, text, { tags: ['personal', 'craft'] });
  reportLine(env, text, 'plain');
}

const GRADE_UP: Record<string, string> = {
  ungraded: 'graded',
  graded: 'skillful',
  skillful: 'great',
  great: 'supreme',
};

/** How many swords of a grade exist now (destroyed ones no longer count). */
export function gradeCount(state: WorldState, grade: string): number {
  let n = 0;
  for (const e of Object.values(state.entities)) {
    if (e.item && e.item.grade === grade && e.item.container !== 'destroyed') n += 1;
  }
  return n;
}

export function temperLock(
  env: Pick<LifeEnv, 'state' | 'data' | 'p' | 'tick'>,
  item: Entity,
): string | null {
  const { data, p, state } = env;
  const t = data.hands.temper;
  const here = p.place.location?.id;
  if (!here || !t.places.includes(here))
    return `Only at a master's forge: ${t.places.map((id) => data.locations[id]?.name ?? id).join(' or ')}`;
  const next = GRADE_UP[item.item?.grade ?? 'ungraded'];
  if (!next) return 'No blade is better than this';
  const cap = data.hands.grades[next as keyof typeof data.hands.grades]?.count;
  if (cap !== null && cap !== undefined && gradeCount(state, next) >= cap)
    return `All ${cap} ${data.hands.grades[next as keyof typeof data.hands.grades]?.name ?? next} swords already exist`;
  const track = data.tracks['track_swordsmanship'];
  const ts = trackStateOf(p.c, 'track_swordsmanship');
  const levels = data.powers.levels.map((l) => l.id);
  const need = levels.indexOf(t.level);
  const stage = track && ts ? track.stages[ts.stage] : undefined;
  if (!stage || levels.indexOf(stage.level) < need)
    return `Needs a swordsman at the ${data.powers.levels[need]?.name ?? t.level} level`;
  if (p.c.berries < t.cost) return `A master's forge costs ${formatBerries(t.cost)} Berries`;
  return null;
}

function madeName(data: GameData, recipe: Recipe): string {
  const id = recipe.makes.weapon ?? recipe.makes.item ?? '';
  const name = data.weapons[id]?.name ?? data.items[id]?.name ?? recipe.name;
  return `a ${name.toLowerCase()}`;
}

/** The quality one month's work earns: craft skill, the stats that help, and the hand of chance. */
function monthQuality(env: LifeEnv, recipe: Recipe, rng: Rng): number {
  const { p, tick } = env;
  const q = recipe.quality;
  const skill = craftSkill(p.entity, recipe.craft);
  let stats = 0;
  for (const stat of recipe.stats) stats += statTotal(p.entity, stat, tick) - 50;
  stats /= recipe.stats.length;
  return q.base + skill * q.perSkill + stats * q.perStat + rng.float(-q.spread, q.spread);
}

function growSkill(env: LifeEnv, craft: Craft, scale: number, need: number): void {
  const hands = ensureHands(env.p.entity);
  const now = hands.crafts[craft] ?? 0;
  // Work near the edge of what you can do teaches the most.
  const stretch = now < need + 30 ? 1 : 0.35;
  const gain = env.data.hands.craft.perMonth * scale * stretch * (1 - now / 110);
  hands.crafts[craft] = Math.min(100, Math.round((now + Math.max(0, gain)) * 100) / 100);
}

/**
 * A month of the "Work on your project" activity: the ship on your own slipway first (when you
 * stand at its yard), otherwise the project at the bench.
 */
export function craftMonth(env: LifeEnv, scale: number, rng: Rng): void {
  const { p, data } = env;
  const hands = ensureHands(p.entity);
  if (hands.build?.by === 'self' && hands.build.place === p.place.location?.id) {
    buildMonth(env, scale, rng);
    return;
  }
  const project = hands.project;
  if (!project) {
    reportLine(
      env,
      'Work on your project: you have no project. Start one on the Gear page.',
      'plain',
    );
    return;
  }
  const where = p.place.atSea ? 'sea' : (p.place.location?.id ?? 'sea');
  if (project.place !== where && !(project.place === 'sea' && p.place.atSea)) {
    const name = data.locations[project.place]?.name ?? 'where you started it';
    reportLine(env, `Your project waits at ${name}.`, 'plain');
    return;
  }
  if (project.recipe.startsWith('temper:')) {
    temperMonth(env, project.recipe.slice(7), scale, rng);
    return;
  }
  const recipe = data.recipes[project.recipe];
  if (!recipe) {
    hands.project = null;
    return;
  }
  const teacher = schoolFor(data, p.place.location?.id, recipe.craft);
  const step = Math.min(project.needed - project.done, scale * teacher);
  const quality = monthQuality(env, recipe, rng.fork('quality')) + (teacher - 1) * 10;
  project.quality =
    project.done + step > 0
      ? (project.quality * project.done + quality * step) / (project.done + step)
      : quality;
  project.done = Math.round((project.done + step) * 1000) / 1000;
  growSkill(env, recipe.craft, scale * teacher, recipe.skill);
  if (project.done + 1e-9 < project.needed) {
    reportLine(
      env,
      renderLife(env, data.hands.lines['craftWork'] ?? '', { item: madeName(data, recipe) }),
      'plain',
    );
    return;
  }
  finishProject(env, recipe, project.quality);
  hands.project = null;
}

function finishProject(env: LifeEnv, recipe: Recipe, rawQuality: number): void {
  const { state, data, p, tick } = env;
  const c = data.hands.craft;
  const quality = Math.round(Math.max(c.min, Math.min(c.max, rawQuality)));
  const defId = recipe.makes.weapon ?? recipe.makes.item ?? '';
  const where = p.place.atSea ? 'at sea' : `at ${p.place.name}`;
  let first: Entity | null = null;
  for (let i = 0; i < recipe.makes.count; i++) {
    const weapon = data.weapons[defId];
    // A blade made well enough earns a grade of its own (graded swords are countless).
    const graded = weapon?.family === 'blade' && quality >= 85;
    const item = makeItem(state, data, {
      defId,
      origin: 'player',
      container: 'held',
      holder: p.entity,
      quality,
      ...(graded ? { grade: 'graded' as const } : {}),
      tick,
      story: `Made by ${p.entity.name} ${where}.`,
      extra: { madeBy: p.entity.name, madeTick: tick },
    });
    first ??= item;
  }
  const name = first?.name ?? recipe.name;
  const text = renderLife(env, data.hands.lines['crafted'] ?? '', {
    item: recipe.makes.count > 1 ? `${recipe.makes.count} ${name.toLowerCase()}` : name,
    quality: String(quality),
  });
  lifeLog(env, text, { kind: 'event', tags: ['personal', 'craft'] });
  reportLine(env, text, 'good');
  const hands = ensureHands(p.entity);
  hands.tally['crafted'] = (hands.tally['crafted'] ?? 0) + 1;
}

function temperMonth(env: LifeEnv, itemId: string, scale: number, rng: Rng): void {
  const { state, data, p, tick } = env;
  const hands = ensureHands(p.entity);
  const project = hands.project;
  const item = itemOf(state, itemId);
  if (!project || !item?.item || item.item.holderId !== p.entity.id) {
    hands.project = null;
    return;
  }
  project.done =
    Math.round((project.done + Math.min(scale, project.needed - project.done)) * 1000) / 1000;
  if (project.done + 1e-9 < project.needed) {
    reportLine(
      env,
      renderLife(env, data.hands.lines['craftWork'] ?? '', { item: item.name }),
      'plain',
    );
    return;
  }
  hands.project = null;
  const next = GRADE_UP[item.item.grade ?? 'ungraded'];
  const cap = next ? data.hands.grades[next as keyof typeof data.hands.grades]?.count : 0;
  const room =
    next !== undefined && (cap === null || cap === undefined || gradeCount(state, next) < cap);
  if (room && next && rng.fork('temper').chance(data.hands.temper.chance)) {
    item.item.grade = next as typeof item.item.grade;
    item.item.quality = Math.min(100, item.item.quality + 8);
    const gradeName = data.hands.grades[next as keyof typeof data.hands.grades]?.name ?? next;
    itemStory(item, tick, `Tempered to the ${gradeName} by ${p.entity.name}.`);
    const text = renderLife(env, data.hands.lines['tempered'] ?? '', {
      item: item.name,
      grade: gradeName,
    });
    lifeLog(env, text, { kind: 'event', tags: ['personal', 'craft', 'deed'] });
    reportLine(env, text, 'good');
    p.c.life?.deeds.push({ tick, text });
  } else {
    const text = renderLife(env, data.hands.lines['temperFailed'] ?? '', { item: item.name });
    lifeLog(env, text, { tags: ['personal', 'craft'] });
    reportLine(env, text, 'bad');
  }
}

/** Give up on the project (the materials are lost). */
export function abandonProject(env: LifeEnv): void {
  const hands = ensureHands(env.p.entity);
  if (!hands.project) throw new HandsError('You have no project');
  hands.project = null;
  reportLine(env, 'You set the project aside for good.', 'plain');
}

/** A month at the galley stove (the cook's craft grows with it). */
export function cookMonth(env: LifeEnv, scale: number): void {
  growSkill(env, 'cooking', scale, 0);
}
