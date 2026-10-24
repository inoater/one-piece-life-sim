import { dateOf, formatDate } from '../../engine/calendar';
import type { DerivedDef, GameData } from '../../engine/data/schemas';
import { Rng } from '../../engine/rng';
import type {
  CharacterData,
  Entity,
  FlagValue,
  Relationship,
  WorldState,
} from '../../engine/state';
import {
  describeBreakdown,
  formatNumber,
  statBreakdown,
  statLabel,
  statValue,
  type BreakdownLine,
} from '../../engine/stats';
import { appearanceSentence, heightFraction } from './appearance';
import { ageAt, humanAgeFor, stageAt } from './stages';
import { formatBerries } from './text';

/**
 * The character sheet: everything about one character, as plain data for the page.
 *
 * Rule 3 runs through it: every stat carries its full breakdown, and every derived value carries
 * the formula that produced it. Rule 4 too: potential, talent tier and Luck are true but known to
 * nobody, so they appear only when the viewer is omniscient; the player gets a hint instead.
 */

export interface SheetStat {
  id: string;
  label: string;
  total: number;
  base: number;
  flatTotal: number;
  pctTotal: number;
  subtotal: number;
  description: string;
  lines: BreakdownLine[];
  /** Hidden from the player (Luck). Present only in omniscient views. */
  hidden: boolean;
  /** Omniscient only: the hidden potential and how it is made up. */
  potential?: { total: number; description: string };
}

export interface SheetDerived {
  id: string;
  name: string;
  value: number;
  /** "Max Health 139 = 50 + 1.2 x Durability 44 + 0.8 x Endurance 45.6" */
  formula: string;
  note?: string;
}

export interface SheetPerson {
  id: string;
  name: string;
  /** "Mother", "Older brother", "Mentor". */
  relation: string;
  kind: string;
  age: number | null;
  alive: boolean;
  /** "Died in Year 3 (lost at sea)". */
  death?: string;
  occupation?: string;
  traits: string[];
  /** "Bounty 12,000,000 Berries", "Away at sea", "a retired Marine lieutenant". */
  notes: string[];
  /** How the character feels about them, -100 to 100. */
  opinion: number;
}

export interface CharacterSheet {
  id: string;
  name: string;
  givenName: string;
  familyName: string;
  pronouns: string;
  race: { id: string; name: string; description: string };
  birthplace: {
    id: string;
    name: string;
    shortName: string;
    /** "on an island in the New World" */
    bornIn: string;
    region: string;
    opens: string;
  };
  age: number;
  stage: { id: string; name: string };
  born: { tick: number; label: string; year: number; beforeGodValley: boolean };
  lifespan: { min: number; max: number };
  alive: boolean;
  appearance: {
    sentence: string;
    /** "about 1.85 m" now (a child's height grows toward the adult one). */
    height: string;
    fields: { id: string; label: string; optionId: string; text: string }[];
  };
  stats: SheetStat[];
  derived: SheetDerived[];
  growth: {
    /** The visible part: traits that change training gains, as a percentage. */
    traitPct: number;
    lines: { source: string; pct: number }[];
    /** Omniscient only: the hidden talent's multiplier. */
    talentMult?: number;
  };
  traits: { id: string; name: string; description: string; category: string }[];
  /** What the player is told instead of their talent tier. */
  talentHint: string;
  hidden: null | {
    talent: { id: string; name: string; potentialMult: number; growthMult: number };
    luck: number;
  };
  family: null | {
    legacy: { id: string; name: string; description: string };
    wealth: { id: string; name: string };
    birthOrder: string;
    members: SheetPerson[];
    expected: number;
  };
  relationships: SheetPerson[];
  scars: { area: string; text: string; age: number }[];
  berries: number;
  focus: { id: string; name: string; description: string } | null;
  backstory: string;
  flags: Record<string, FlagValue>;
  /** The life loop (Phase 2): body, work, reputation, money, deeds. Null before it starts. */
  life: null | {
    health: { current: number; max: number };
    exhausted: boolean;
    injuries: { name: string; severity: string; heals: string }[];
    illnesses: { name: string; heals: string }[];
    job: string | null;
    married: boolean;
    gang: string | null;
    fame: number;
    infamy: number;
    debt: number;
    deeds: { date: string; text: string }[];
  };
}

export interface SheetOptions {
  omniscient: boolean;
}

function derive(def: DerivedDef, totals: Readonly<Record<string, number>>): SheetDerived {
  let value = def.constant;
  const parts: string[] = def.constant !== 0 ? [formatNumber(def.constant)] : [];
  for (const term of def.terms) {
    const stat = totals[term.stat] ?? 0;
    const label = `${statLabel(term.stat)} ${formatNumber(stat)}`;
    if ('factor' in term) {
      value += stat * term.factor;
      parts.push(term.factor === 1 ? label : `${formatNumber(term.factor)} x ${label}`);
    } else {
      value += stat / term.divide;
      parts.push(`${label} / ${formatNumber(term.divide)}`);
    }
  }
  const rounded =
    def.round === 'floor' ? Math.floor(value) : def.round === 'round' ? Math.round(value) : value;
  const rounding =
    def.round === 'floor' ? ', rounded down' : def.round === 'round' ? ', rounded' : '';
  const out: SheetDerived = {
    id: def.id,
    name: def.name,
    value: rounded,
    formula: `${def.name} ${formatNumber(rounded)} = ${parts.join(' + ')}${rounding}`,
  };
  if (def.note) out.note = def.note;
  return out;
}

function heightText(cm: number): string {
  if (cm < 100) return `about ${Math.round(cm)} cm`;
  const metres = cm / 100;
  return `about ${metres < 10 ? metres.toFixed(2) : metres.toFixed(1)} m`;
}

const RELATION_LABEL: Record<string, string> = {
  guardian: 'Guardian',
  mentor: 'Mentor',
  friend: 'Friend',
  rival: 'Rival',
  sweetheart: 'Sweetheart',
  benefactor: 'Benefactor',
  protege: 'Protégé',
  child: 'Child',
  ward: 'Ward',
};

function relationLabel(data: GameData, viewer: Entity, other: Entity, kind: string): string {
  const oc = other.character;
  const p = oc?.pronouns;
  if (kind === 'parent') return p === 'he' ? 'Father' : p === 'she' ? 'Mother' : 'Parent';
  if (kind === 'sibling') {
    const older = (oc?.birthTick ?? 0) < (viewer.character?.birthTick ?? 0);
    const noun = p === 'he' ? 'brother' : p === 'she' ? 'sister' : 'sibling';
    return `${older ? 'Older' : 'Younger'} ${noun}`;
  }
  if (kind === 'sweetheart' && viewer.flags['married'] === true) {
    return p === 'he' ? 'Husband' : p === 'she' ? 'Wife' : 'Spouse';
  }
  void data;
  return RELATION_LABEL[kind] ?? kind;
}

function person(
  data: GameData,
  state: WorldState,
  viewer: Entity,
  rel: Relationship,
): SheetPerson | null {
  const other = state.entities[rel.id];
  const oc = other?.character;
  if (!other || !oc) return null;
  const notes: string[] = [];
  const title = other.flags['family.title'];
  if (typeof title === 'string') notes.push(title);
  if (other.flags['absent'] === true && oc.alive && typeof title !== 'string') {
    notes.push('Away, rarely home');
  }
  const bounty = other.flags['bounty'];
  if (typeof bounty === 'number') notes.push(`Bounty ${formatBerries(bounty)} Berries`);
  const out: SheetPerson = {
    id: other.id,
    name: other.name,
    relation: relationLabel(data, viewer, other, rel.kind),
    kind: rel.kind,
    age: oc.alive ? Math.max(0, ageAt(oc.birthTick, state.tick)) : null,
    alive: oc.alive,
    traits: oc.traits
      .filter((t) => data.traits[t]?.category !== 'racial')
      .map((t) => data.traits[t]?.name ?? t),
    notes,
    opinion: Math.round(statValue(rel.opinion, state.tick)),
  };
  if (oc.death) {
    const year = dateOf(data.calendar, oc.death.tick).year;
    out.death = `Died in Year ${year} (${oc.death.cause}), aged ${ageAt(oc.birthTick, oc.death.tick)}`;
  }
  if (oc.occupation && typeof title !== 'string') {
    out.occupation = data.occupations[oc.occupation]?.name ?? oc.occupation;
  }
  return out;
}

export function characterSheet(
  data: GameData,
  state: WorldState,
  entityId: string,
  options: SheetOptions,
): CharacterSheet | null {
  const entity = state.entities[entityId];
  const c = entity?.character;
  if (!entity || !c) return null;
  const race = data.races[c.race];
  const birthplace = data.birthplaces[c.birthplace];
  if (!race || !birthplace) return null;
  const tick = state.tick;
  const age = Math.max(0, ageAt(c.birthTick, tick));
  const rules = data.character;
  const stage = stageAt(rules, race, age).stage;

  const order = [...rules.physical, ...rules.mental, 'luck'];
  const stats: SheetStat[] = [];
  const totals: Record<string, number> = {};
  for (const id of order) {
    const stat = entity.stats[id];
    if (!stat) continue;
    const b = statBreakdown(stat, tick);
    totals[id] = b.total;
    const hidden = id === 'luck';
    if (hidden && !options.omniscient) continue;
    const view: SheetStat = {
      id,
      label: statLabel(id),
      total: b.total,
      base: b.base,
      flatTotal: b.flatTotal,
      pctTotal: b.pctTotal,
      subtotal: b.subtotal,
      description: describeBreakdown(statLabel(id), b),
      lines: b.lines,
      hidden,
    };
    const potential = c.hidden?.potential[id];
    if (options.omniscient && potential) {
      const pb = statBreakdown(potential, tick);
      view.potential = {
        total: pb.total,
        description: describeBreakdown(`${statLabel(id)} potential`, pb),
      };
    }
    stats.push(view);
  }

  const growthLines = c.traits
    .map((id) => data.traits[id])
    .filter((t): t is NonNullable<typeof t> => t !== undefined && t.trainingGainPct !== 0)
    .map((t) => ({ source: t.name, pct: t.trainingGainPct }));
  const talent = rules.talentTiers.find((t) => t.id === c.hidden?.talent);
  const humanAge = humanAgeFor(rules, race, age);
  const hints = talent ? (humanAge < 6 ? talent.hints.young : talent.hints.older) : [];
  const talentHint =
    hints.length > 0 ? Rng.root(state.seed).fork('hint', entity.id).pick(hints) : '';

  const height = (c.adultHeightCm ?? 0) * heightFraction(data, race, age);
  const birthDate = dateOf(data.calendar, c.birthTick);

  const people = c.relationships
    .map((rel) => ({ rel, view: person(data, state, entity, rel) }))
    .filter((p): p is { rel: Relationship; view: SheetPerson } => p.view !== null);
  const familyKinds = new Set(['parent', 'sibling', 'guardian']);
  const legacy = c.family ? data.legacies[c.family.legacy] : undefined;
  const wealth = c.family
    ? data.creation.wealthTiers.find((t) => t.id === c.family?.wealth)
    : undefined;

  return {
    id: entity.id,
    name: entity.name,
    givenName: c.givenName,
    familyName: c.familyName,
    pronouns: c.pronouns,
    race: { id: race.id, name: race.name, description: race.description },
    birthplace: {
      id: birthplace.id,
      name: birthplace.name,
      shortName: birthplace.shortName,
      bornIn: birthplace.bornIn,
      region: birthplace.region,
      opens: birthplace.opens,
    },
    age,
    stage: { id: stage.id, name: stage.name },
    born: {
      tick: c.birthTick,
      label: formatDate(birthDate),
      year: birthDate.year,
      beforeGodValley: birthDate.year < 0,
    },
    lifespan: { ...race.lifespan },
    alive: c.alive,
    appearance: {
      sentence: appearanceSentence(
        { data, race, age, pronouns: c.pronouns },
        c.appearance,
        c.scars,
      ),
      height: height > 0 ? heightText(height) : 'unknown',
      fields: data.appearance.fields.map((f) => {
        const option = f.options.find((o) => o.id === c.appearance[f.id]);
        return {
          id: f.id,
          label: f.label,
          optionId: c.appearance[f.id] ?? '',
          text: option?.label ?? option?.text ?? '',
        };
      }),
    },
    stats,
    derived: rules.derived.map((def) => derive(def, totals)),
    growth: {
      traitPct: growthLines.reduce((sum, l) => sum + l.pct, 0),
      lines: growthLines,
      ...(options.omniscient && talent ? { talentMult: talent.growthMult } : {}),
    },
    traits: c.traits.map((id) => {
      const t = data.traits[id];
      return {
        id,
        name: t?.name ?? id,
        description: t?.description ?? '',
        category: t?.category ?? '',
      };
    }),
    talentHint,
    hidden:
      options.omniscient && talent
        ? {
            talent: {
              id: talent.id,
              name: talent.name,
              potentialMult: talent.potentialMult,
              growthMult: talent.growthMult,
            },
            luck: totals['luck'] ?? 0,
          }
        : null,
    family:
      c.family && legacy
        ? {
            legacy: { id: legacy.id, name: legacy.name, description: legacy.description },
            wealth: { id: wealth?.id ?? c.family.wealth, name: wealth?.name ?? c.family.wealth },
            birthOrder: data.creation.birthOrder[c.family.birthOrder]?.label ?? c.family.birthOrder,
            members: people.filter((p) => familyKinds.has(p.rel.kind)).map((p) => p.view),
            expected: c.family.expected.length,
          }
        : null,
    relationships: people.filter((p) => !familyKinds.has(p.rel.kind)).map((p) => p.view),
    scars: c.scars.map((s) => ({
      area: s.area,
      text: s.text,
      age: Math.max(0, ageAt(c.birthTick, s.tick)),
    })),
    berries: c.berries,
    focus:
      c.focus && data.foci[c.focus]
        ? {
            id: c.focus,
            name: data.foci[c.focus]?.name ?? c.focus,
            description: data.foci[c.focus]?.description ?? '',
          }
        : null,
    backstory: c.backstory ?? '',
    flags: options.omniscient ? { ...entity.flags } : {},
    life: lifeSection(data, entity, tick),
  };
}

function lifeSection(data: GameData, entity: Entity, tick: number): CharacterSheet['life'] {
  const life = entity.character?.life;
  if (!life) return null;
  const label = (t: number) => formatDate(dateOf(data.calendar, t));
  const job = life.job ? data.jobs[life.job.id] : undefined;
  const title = job?.ranks ? entity.flags[job.ranks.flag] : undefined;
  const totals: Record<string, number> = {};
  for (const [id, stat] of Object.entries(entity.stats)) totals[id] = statValue(stat, tick);
  const maxDef = data.character.derived.find((d) => d.id === 'maxHealth');
  return {
    health: {
      current: Math.round(life.health),
      max: maxDef ? derive(maxDef, totals).value : Math.round(life.health),
    },
    exhausted: life.exhausted,
    injuries: life.injuries
      .filter((i) => i.healTick > tick)
      .map((i) => ({ name: i.name, severity: i.severity, heals: label(i.healTick) })),
    illnesses: life.illnesses
      .filter((i) => i.healTick > tick)
      .map((i) => ({ name: i.name, heals: label(i.healTick) })),
    job: job ? `${job.name}${typeof title === 'string' ? ` (${title})` : ''}` : null,
    married: entity.flags['married'] === true,
    gang: life.gang,
    fame: Math.round(totals['fame'] ?? 0),
    infamy: Math.round(totals['infamy'] ?? 0),
    debt: life.debt,
    deeds: life.deeds.map((d) => ({ date: label(d.tick), text: d.text })),
  };
}

/** Header facts for the masthead: age, where, money. */
export function playerSummary(
  data: GameData,
  state: WorldState,
): null | {
  id: string;
  name: string;
  age: number;
  stage: string;
  location: string;
  berries: number;
  alive: boolean;
} {
  if (!state.playerId) return null;
  const entity = state.entities[state.playerId];
  if (!entity) return null;
  const c = entity.character;
  if (!c)
    return {
      id: entity.id,
      name: entity.name,
      age: 0,
      stage: '',
      location: '',
      berries: 0,
      alive: true,
    };
  const race = data.races[c.race];
  const age = Math.max(0, ageAt(c.birthTick, state.tick));
  return {
    id: entity.id,
    name: entity.name,
    age,
    stage: race ? stageAt(data.character, race, age).stage.name : '',
    location: whereabouts(data, c),
    berries: c.berries,
    alive: c.alive,
  };
}

/** Where someone is, for the header (Phase 3): "Loguetown", or "At sea, bound for Twin Cape". */
function whereabouts(data: GameData, c: CharacterData): string {
  const voyage = c.travel?.voyage;
  if (voyage) {
    const to = data.locations[voyage.to];
    const how = voyage.mode === 'foot' ? 'On the road' : 'At sea';
    return `${how}, bound for ${to?.shortName ?? to?.name ?? voyage.to}`;
  }
  const at = c.place ?? data.birthplaces[c.birthplace]?.location;
  const loc = at ? data.locations[at] : undefined;
  return loc?.shortName ?? loc?.name ?? data.birthplaces[c.birthplace]?.shortName ?? c.birthplace;
}
