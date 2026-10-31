import type { GameData } from '../../engine/data/schemas';
import { Rng } from '../../engine/rng';
import type { Entity, WorldState } from '../../engine/state';
import { rollAdultHeight, rollAppearance } from '../genesis/appearance';
import { characterSheet, type CharacterSheet } from '../genesis/sheet';
import { relOf } from './bonds';
import { withBody } from '../crew/state';

/**
 * Anyone's character sheet (the player's own, shown on their person page): the same sheet the
 * Character tab draws. People made by the earlier phases' everyday life have no body of numbers
 * and no looks; both are read from streams keyed to their id (never stored by a view), so the same
 * person always looks the same. Rule 4: someone the player hardly knows shows rounded numbers with
 * no breakdown; family, crewmates, close friends and omniscient views show the truth.
 */

const CLOSE = new Set([
  'parent',
  'child',
  'sibling',
  'crewmate',
  'sweetheart',
  'mentor',
  'protege',
  'companion',
  'owner',
]);

function withLooks(data: GameData, entity: Entity, tick: number): Entity {
  const c = entity.character;
  if (!c || Object.keys(c.appearance).length > 0) return entity;
  const race = data.races[c.race];
  const birthplace = data.birthplaces[c.birthplace];
  if (!race || !birthplace) return entity;
  const rng = Rng.root(`looks:${entity.id}`);
  const age = Math.max(0, Math.floor((tick - c.birthTick) / 12));
  const looks = rollAppearance(
    { data, race, birthplace, legacy: null, focus: null, age, pronouns: c.pronouns },
    rng,
    {},
    {},
  );
  return {
    ...entity,
    character: {
      ...c,
      appearance: { ...looks.values },
      adultHeightCm:
        c.adultHeightCm ?? rollAdultHeight(race, looks.values.height, rng.fork('height')),
    },
  };
}

export interface PersonSheet {
  sheet: CharacterSheet;
  /** The numbers are estimates (someone the player hardly knows). */
  estimated: boolean;
}

export function personSheet(
  state: WorldState,
  data: GameData,
  id: string,
  omniscient: boolean,
): PersonSheet | null {
  const stored = state.entities[id];
  if (!stored?.character) return null;
  const tick = state.tick;
  const entity = withLooks(data, withBody(data, stored, tick), tick);
  // A view of the world with them as they would be read: nothing in the real state changes.
  const view: WorldState = { ...state, entities: { ...state.entities, [id]: entity } };
  const sheet = characterSheet(data, view, id, { omniscient });
  if (!sheet) return null;
  // The hints are written to the player ("...against you"): not for anyone else's sheet.
  if (id !== state.playerId && !omniscient) {
    sheet.talentHint = '';
    sheet.traitHints = [];
  }
  const player = state.playerId ? state.entities[state.playerId] : undefined;
  const mine = player ? relOf(player, id) : undefined;
  const known =
    omniscient ||
    id === state.playerId ||
    (mine !== undefined && (CLOSE.has(mine.kind) || tick - mine.sinceTick >= 24));
  if (!known) {
    for (const s of sheet.stats) {
      s.total = Math.round(s.total / 10) * 10;
      s.base = s.total;
      s.subtotal = s.total;
      s.flatTotal = 0;
      s.pctTotal = 0;
      s.lines = [];
      s.description = `${s.label}: about ${s.total} (a guess: you do not know them well).`;
    }
    for (const d of sheet.derived) {
      d.value = Math.round(d.value / 10) * 10;
      d.formula = `${d.name}: about ${d.value} (a guess)`;
      delete d.bonus;
    }
    sheet.flags = {};
  }
  return { sheet, estimated: !known };
}
