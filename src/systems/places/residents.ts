import { templateVarsFor, dateOf } from '../../engine/calendar';
import type { GameData } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import type { NewsDraft } from '../../engine/pipeline';
import type { Rng } from '../../engine/rng';
import type { Entity, WorldState } from '../../engine/state';
import { renderTemplate } from '../../engine/template';
import { storyVars } from '../events';
import { lanesFrom, withDevFixtures } from './graph';
import { prosperityOf } from './place';
import { localFlagActive, populationChange, setLocalFlag } from '../story/world-effects';
import { entityIds } from '../../engine/entities';

/**
 * The places' own lives (Phase 3), world systems in step 4:
 *
 *  - Tier 3 people: every January each place's residents are born, grow up, grow old and die as
 *    numbers (world.json `population`), a little faster where times are good.
 *  - Epidemics: an outbreak can start anywhere people live (life.json `epidemic`), lasts a few
 *    months, and can spread along the sea lanes to the next island. Whoever is there is likelier
 *    to catch it, and the news carries it to everyone else.
 */

function placeEntities(state: WorldState): Entity[] {
  return entityIds(state)
    .map((id) => state.entities[id] as Entity)
    .filter((e) => e.place !== undefined);
}

export function residentsYear(state: WorldState, data: GameData, tick: number): void {
  if (tick % 12 !== 0) return;
  const rules = data.world.population;
  for (const entity of placeEntities(state)) {
    const place = entity.place;
    if (!place) continue;
    const r = place.residents;
    const total = r.children + r.adults + r.elders;
    if (total === 0) continue;
    const mood = Math.sqrt(Math.max(0.2, prosperityOf(state, data, entity.id) / 50));
    const births = Math.round(r.adults * rules.birthRate * mood);
    const deaths = Math.round(total * rules.deathRate);
    const grownUp = Math.round(r.children / 16);
    const aged = Math.round(r.adults / 45);
    const adultsBefore = r.adults;
    r.children = Math.max(0, r.children + births - grownUp - Math.round(deaths * 0.2));
    r.adults = Math.max(0, r.adults + grownUp - aged - Math.round(deaths * 0.3));
    r.elders = Math.max(0, r.elders + aged - Math.round(deaths * 0.5));
    if (adultsBefore > 0) {
      const f = r.adults / adultsBefore;
      for (const job of Object.keys(place.jobs)) {
        place.jobs[job] = Math.max(0, Math.round((place.jobs[job] ?? 0) * f));
      }
    }
  }
}

function outbreakNews(
  state: WorldState,
  data: GameData,
  tick: number,
  placeId: string,
  rng: Rng,
): string {
  const loc = data.locations[placeId];
  const vars = {
    ...templateVarsFor(dateOf(data.calendar, tick)),
    ...storyVars(state, data),
    place: loc?.name ?? placeId,
  };
  return renderTemplate(rng.pick(data.life.epidemic.news), vars);
}

function startOutbreak(
  state: WorldState,
  data: GameData,
  tick: number,
  placeId: string,
  rng: Rng,
  newsDrafts: NewsDraft[],
  from?: string,
): void {
  const rules = data.life.epidemic;
  setLocalFlag(
    state,
    placeId,
    'epidemic',
    rules.illness,
    tick,
    rng.int(rules.months.min, rules.months.max),
  );
  populationChange(state, placeId, -1);
  const text = outbreakNews(state, data, tick, placeId, rng.fork('news'));
  const record = appendLog(state, tick, {
    kind: 'world',
    summary: text,
    tags: ['world', 'news', 'illness'],
    place: placeId,
    cause: from ? 'sys:epidemic.spread' : 'sys:epidemic',
    knownBy: [],
  });
  newsDrafts.push({ text, tags: ['news', 'illness'], sourceSeq: record.seq, place: placeId });
}

export function epidemicsMonth(
  state: WorldState,
  data: GameData,
  tick: number,
  rng: Rng,
  newsDrafts: NewsDraft[],
): void {
  const rules = data.life.epidemic;
  const dev = withDevFixtures(state);
  const places = placeEntities(state).filter((e) => {
    const loc = data.locations[e.id];
    return loc && loc.population !== 'none' && (dev || !loc.tags.includes('dev'));
  });
  const sick = places.filter((e) => localFlagActive(state, e.id, 'epidemic', tick));
  // Spread first, from places already sick last month, so an outbreak travels a lane a month.
  for (const entity of sick) {
    const r = rng.fork('spread', entity.id);
    for (const edge of lanesFrom(data, entity.id, dev)) {
      const target = state.entities[edge.to];
      if (!target?.place || data.locations[edge.to]?.population === 'none') continue;
      if (localFlagActive(state, edge.to, 'epidemic', tick)) continue;
      if (r.fork(edge.to).chance(rules.spread)) {
        startOutbreak(state, data, tick, edge.to, r.fork('start', edge.to), newsDrafts, entity.id);
      }
    }
  }
  for (const entity of places) {
    if (localFlagActive(state, entity.id, 'epidemic', tick)) continue;
    const r = rng.fork('outbreak', entity.id);
    if (r.chance(rules.chance)) startOutbreak(state, data, tick, entity.id, r, newsDrafts);
  }
}
