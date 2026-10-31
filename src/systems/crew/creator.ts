import type { GameData } from '../../engine/data/schemas';
import { createEntity } from '../../engine/entities';
import { Rng } from '../../engine/rng';
import type { CrewState, Entity } from '../../engine/state';
import { renderTemplate } from '../../engine/template';
import { storyVars } from '../events';
import { makePerson } from '../life/people';
import type { LifeEnv } from '../life/env';
import { addMember, crewSay } from './members';
import { autoFill } from './posts';
import { roleFits } from './roles';
import { byId, CrewError, crewLedBy, kindOf, LEADS } from './state';

/**
 * The crew creator (Phase 8): one creator builds every group the player can lead. Kind, name and
 * symbol, creed, command style, structure, pay, home, colours and dress; a Marine unit's structure
 * is fixed by the service and a Revolutionary cell's by the army, a pirate crew's is free. A crew
 * can be exported as a file and used to start a new game with the same companions, generated
 * fresh in the new world.
 */

export interface CrewSpec {
  kind: string;
  name?: string | undefined;
  symbol?: string | undefined;
  colours?: string | undefined;
  dress?: string | undefined;
  creed?: Readonly<Record<string, string>> | undefined;
  command?: string | undefined;
  structure?: string | undefined;
  pay?: string | undefined;
  home?: 'ship' | 'base' | 'none' | undefined;
}

/** What the kind's template fixes, and why: null when the choice is free. */
export function fixedReason(
  data: GameData,
  kindId: string,
  field: 'command' | 'structure' | 'pay',
): string | null {
  const kind = byId(data.crew.kinds, kindId);
  if (!kind?.fixed[field]) return null;
  return kind.id === 'marine' || kind.id === 'cipher'
    ? 'Fixed by the service'
    : kind.id === 'revolutionary'
      ? 'Fixed by the army'
      : 'Fixed for this kind';
}

/** Check a spec against data/crew.json and the kind's template; the first problem, or null. */
export function specProblem(data: GameData, spec: CrewSpec): string | null {
  const kind = byId(data.crew.kinds, spec.kind);
  if (!kind) return `There is no kind of group "${spec.kind}"`;
  if (spec.name !== undefined && (spec.name.trim().length === 0 || spec.name.length > 60))
    return 'A name of 1 to 60 letters';
  for (const field of ['command', 'structure', 'pay'] as const) {
    const value = spec[field];
    if (value === undefined) continue;
    const list: readonly { id: string }[] =
      field === 'command'
        ? data.crew.commands
        : field === 'structure'
          ? data.crew.structures
          : data.crew.pays;
    if (!byId(list, value)) return `There is no ${field} "${value}"`;
    const fixed = kind.fixed[field];
    if (fixed && fixed !== value)
      return `${fixedReason(data, kind.id, field)}: ${field} is ${fixed}`;
  }
  for (const [rule, option] of Object.entries(spec.creed ?? {})) {
    const def = byId(data.crew.creed, rule);
    if (!def) return `There is no creed rule "${rule}"`;
    if (!byId(def.options, option))
      return `"${option}" is not a choice for ${def.name.toLowerCase()}`;
  }
  for (const text of [spec.symbol, spec.colours, spec.dress])
    if (text !== undefined && text.length > 120) return 'Keep the words under 120 letters';
  return null;
}

function apply(data: GameData, crew: CrewState, spec: CrewSpec): void {
  const kind = kindOf(data, crew);
  crew.command = kind.fixed.command ?? spec.command ?? crew.command;
  crew.structure = kind.fixed.structure ?? spec.structure ?? crew.structure;
  crew.pay = kind.fixed.pay ?? spec.pay ?? crew.pay;
  if (spec.creed)
    for (const [rule, option] of Object.entries(spec.creed)) crew.creed[rule] = option;
  if (spec.symbol !== undefined) crew.symbol = spec.symbol;
  if (spec.colours !== undefined) crew.colours = spec.colours;
  if (spec.dress !== undefined) crew.dress = spec.dress;
  if (spec.home !== undefined)
    crew.home = { kind: spec.home, id: spec.home === 'none' ? null : crew.home.id };
  // A structure without divisions keeps none.
  const structure = byId(data.crew.structures, crew.structure);
  if (structure && crew.divisions.length > structure.divisions)
    crew.divisions = crew.divisions.slice(0, structure.divisions);
}

/** Found a group the player leads. */
export function foundCrew(env: LifeEnv, spec: CrewSpec): Entity {
  const { state, data, tick, p } = env;
  if (crewLedBy(state, p.entity)) throw new CrewError('You already lead a crew: change it instead');
  const problem = specProblem(data, spec);
  if (problem) throw new CrewError(problem);
  const kind = byId(data.crew.kinds, spec.kind);
  if (!kind) throw new CrewError(`There is no kind of group "${spec.kind}"`);
  const name =
    spec.name?.trim() ||
    renderTemplate(kind.defaultName, {
      ...storyVars(state, data),
      'player.familyName': p.c.familyName || p.c.givenName,
    });
  const entity = createEntity(state, {
    type: 'organization',
    origin: 'player',
    name,
    tier: 1,
    knownBy: [p.entity.id],
  });
  const ship = Object.values(state.entities).find(
    (e) => e.ship?.ownerId === p.entity.id && !e.ship.sunk,
  );
  const crew: CrewState = {
    kind: kind.id,
    leaderId: p.entity.id,
    symbol: spec.symbol ?? '',
    colours: spec.colours ?? '',
    dress: spec.dress ?? '',
    creed: { ...kind.defaults.creed },
    command: kind.defaults.command,
    structure: kind.defaults.structure,
    pay: kind.defaults.pay,
    home: { kind: ship ? 'ship' : 'none', id: ship?.id ?? null },
    foundedTick: tick,
    members: [],
    former: [],
    lineups: {},
    locks: {},
    auto: true,
    morale: data.crew.morale.rest,
    treasury: 0,
    unpaid: 0,
    traditions: [],
    log: [],
    ignored: 0,
    divisions: [],
    fleet: [],
    alliances: [],
    bases: [],
    prisoners: [],
    tally: {},
  };
  apply(data, crew, spec);
  entity.crew = crew;
  p.entity.flags[LEADS] = entity.id;
  crew.log.push({ tick, text: `${name} was founded.` });
  crewSay(env, entity, null, 'founded', {}, 'good', ['founded']);
  // Phase 7's crewmates (anyone already sailing with the player) are its first members.
  for (const rel of p.c.relationships) {
    const other = state.entities[rel.id];
    if (
      rel.kind === 'crewmate' &&
      other?.character?.alive &&
      other.flags['crew.of'] === p.entity.id
    )
      addMember(env, entity, other, { how: 'founding' });
  }
  autoFill(state, data, entity, tick);
  return entity;
}

/** Change a crew the player leads (anything but its kind). */
export function editCrew(env: LifeEnv, spec: Omit<CrewSpec, 'kind'> & { kind?: string }): void {
  const crewEnt = crewLedBy(env.state, env.p.entity);
  const crew = crewEnt?.crew;
  if (!crewEnt || !crew) throw new CrewError('You lead no crew');
  if (spec.kind !== undefined && spec.kind !== crew.kind)
    throw new CrewError('A crew cannot change what it is: found another');
  const problem = specProblem(env.data, { ...spec, kind: crew.kind });
  if (problem) throw new CrewError(problem);
  if (spec.name !== undefined) crewEnt.name = spec.name.trim();
  apply(env.data, crew, { ...spec, kind: crew.kind });
}

// ---- Export and import ---------------------------------------------------------------------------

export interface CrewFile {
  format: 'opsim-crew';
  version: 1;
  name: string;
  kind: string;
  symbol: string;
  colours: string;
  dress: string;
  creed: Record<string, string>;
  command: string;
  structure: string;
  pay: string;
  companions: {
    givenName: string;
    familyName: string;
    pronouns: 'he' | 'she' | 'they';
    role: string;
    traits: string[];
  }[];
}

export function exportCrew(crewEnt: Entity, members: readonly Entity[]): string {
  const crew = crewEnt.crew;
  if (!crew) throw new CrewError('Not a crew');
  const file: CrewFile = {
    format: 'opsim-crew',
    version: 1,
    name: crewEnt.name,
    kind: crew.kind,
    symbol: crew.symbol,
    colours: crew.colours,
    dress: crew.dress,
    creed: { ...crew.creed },
    command: crew.command,
    structure: crew.structure,
    pay: crew.pay,
    companions: members.map((m) => ({
      givenName: m.character?.givenName ?? m.name,
      familyName: m.character?.familyName ?? '',
      pronouns: m.character?.pronouns ?? 'they',
      role: crew.members.find((x) => x.id === m.id)?.role ?? 'hand',
      traits: (m.character?.traits ?? []).slice(0, 4),
    })),
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Start from a saved crew: the same kind, name, creed and ways, and the same companions by name,
 * role and nature, generated fresh in this world (their own stats, pasts and powers).
 */
export function importCrew(env: LifeEnv, text: string): Entity {
  let file: CrewFile;
  try {
    file = JSON.parse(text) as CrewFile;
  } catch {
    throw new CrewError('That is not a crew file');
  }
  if (file?.format !== 'opsim-crew' || !Array.isArray(file.companions))
    throw new CrewError('That is not a crew file');
  const crewEnt = foundCrew(env, {
    kind: byId(env.data.crew.kinds, file.kind) ? file.kind : 'pirate',
    name: String(file.name ?? '').slice(0, 60) || undefined,
    symbol: String(file.symbol ?? '').slice(0, 120),
    colours: String(file.colours ?? '').slice(0, 120),
    dress: String(file.dress ?? '').slice(0, 120),
  });
  try {
    editCrew(env, {
      creed: file.creed,
      command: file.command,
      structure: file.structure,
      pay: file.pay,
    });
  } catch {
    // A creed this world's data no longer has: the kind's defaults stand.
  }
  const { state, data, tick, p } = env;
  const rng = Rng.root(state.seed).fork('crew-import', tick);
  file.companions.slice(0, 20).forEach((spec, i) => {
    const r = rng.fork(i);
    const age = r.fork('age').int(17, 35);
    const other = makePerson(state, data, p, r, {
      birthTick: tick - age * 12 - r.fork('month').int(0, 11),
      pronouns: spec.pronouns === 'he' || spec.pronouns === 'she' ? spec.pronouns : 'they',
      familyName: String(spec.familyName ?? ''),
    });
    if (other.character && spec.givenName) {
      other.character.givenName = String(spec.givenName).slice(0, 30);
      other.name = `${other.character.givenName}${other.character.familyName ? ` ${other.character.familyName}` : ''}`;
      for (const t of spec.traits ?? [])
        if (data.traits[t] && !other.character.traits.includes(t)) other.character.traits.push(t);
    }
    // Fresh in this world: ordinary stats for their age, shaped toward their old role.
    for (const id of Object.keys(data.crew.roles.find((x) => x.id === spec.role)?.stats ?? {})) {
      const s = other.stats[id];
      if (s) s.base += 6;
    }
    for (const id of [
      'strength',
      'speed',
      'endurance',
      'durability',
      'dexterity',
      'intellect',
      'willpower',
      'charisma',
      'perception',
    ])
      other.stats[id] ??= { base: Math.round(r.fork('stat', id).normal(36, 8)), mods: [] };
    const role = data.crew.roles.some((x) => x.id === spec.role)
      ? spec.role
      : (roleFits(data, other, tick)[0]?.role ?? 'hand');
    addMember(env, crewEnt, other, { role, how: 'import' });
  });
  autoFill(state, data, crewEnt, tick);
  return crewEnt;
}
