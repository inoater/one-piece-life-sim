import { describe, expect, it } from 'vitest';
import { advance, Rng } from '../../src/core';
import { hashValue } from '../../src/engine/canonical';
import { deserializeSave, serializeSave } from '../../src/engine/saves/manager';
import {
  DEFAULT_WORLD_CONFIG,
  WorldStateSchema,
  type Entity,
  type WorldState,
} from '../../src/engine/state';
import { statValue } from '../../src/engine/stats';
import { appearanceSentence } from '../../src/systems/genesis/appearance';
import { createLife, describeAppearance } from '../../src/systems/genesis/generate';
import { GenesisError, type GenesisOptionsInput } from '../../src/systems/genesis/options';
import { characterSheet } from '../../src/systems/genesis/sheet';
import { humanAgeFor, raceAgeFor, stageAt, stagesFor } from '../../src/systems/genesis/stages';
import { genesisStats } from '../../src/systems/genesis/stats-report';
import { data, dataHash } from '../helpers/data';

const LIMITS = { maxCompressedBytes: 64 << 20, maxDecompressedBytes: 256 << 20 };

const base = (over: Partial<GenesisOptionsInput> = {}): GenesisOptionsInput => ({
  seed: 'genesis-test',
  canonMode: 'canon',
  difficulty: 'normal',
  entryYear: 14,
  entryAge: 16,
  pronouns: 'they',
  ...over,
});

const playerOf = (state: WorldState): Entity => state.entities[state.playerId as string] as Entity;
const total = (state: WorldState, stats: readonly string[]) =>
  stats.reduce(
    (sum, id) => sum + statValue(playerOf(state).stats[id] ?? { base: 0, mods: [] }, state.tick),
    0,
  );
const physical = data.character.physical;
const mental = data.character.mental;

describe('life stages for every race', () => {
  it('uses the human table exactly as written for humans', () => {
    const human = data.races['race_human']!;
    expect(stagesFor(data.character, human).map((s) => s.fromAge)).toEqual(
      data.character.stages.map((s) => s.fromAge),
    );
    for (const age of [0, 5, 12, 33, 64, 90])
      expect(humanAgeFor(data.character, human, age)).toBe(age);
  });

  it('maps every race through its three anchors', () => {
    for (const race of Object.values(data.races)) {
      const { childEnds, primeStarts, elderStarts } = race.anchors;
      expect(stageAt(data.character, race, childEnds - 1).stage.id, race.id).toBe('child');
      expect(stageAt(data.character, race, childEnds).stage.id, race.id).toBe('adolescent');
      expect(humanAgeFor(data.character, race, primeStarts)).toBeCloseTo(20, 9);
      expect(humanAgeFor(data.character, race, elderStarts)).toBeCloseTo(60, 9);
      expect(raceAgeFor(data.character, race, humanAgeFor(data.character, race, 37))).toBeCloseTo(
        37,
        9,
      );
    }
    // The plan's example: a giant born in Year 0 is still a child at 39.
    expect(stageAt(data.character, data.races['race_giant']!, 39).stage.id).toBe('child');
  });
});

describe('character genesis', () => {
  it('is a pure function of its options: same options, same world, byte for byte', () => {
    const a = createLife(data, base({ seed: 'twin' }));
    const b = createLife(data, base({ seed: 'twin' }));
    expect(hashValue(a.state)).toBe(hashValue(b.state));
    expect(hashValue(createLife(data, base({ seed: 'other' })).state)).not.toBe(hashValue(a.state));
  });

  it('makes a world that is valid, starts at the entry month, and saves and loads intact', async () => {
    const { state, playerId } = createLife(data, base({ seed: 'roundtrip', entryAge: 30 }));
    expect(WorldStateSchema.safeParse(state).success).toBe(true);
    expect(state.playerId).toBe(playerId);
    expect(Math.floor(state.tick / 12)).toBe(14);
    expect(state.config).toEqual({ canonMode: 'canon', difficulty: 'normal', rareRaces: false });
    const { bytes } = await serializeSave(state, { dataHash, label: 't', now: 1 }, LIMITS);
    const loaded = await deserializeSave(bytes, { dataHash, limits: LIMITS });
    expect(loaded.report.hashMatches).toBe(true);
    expect(hashValue(loaded.state)).toBe(hashValue(state));
  });

  it('keeps time running afterwards, deterministically', () => {
    const run = () => {
      const { state } = createLife(
        data,
        base({ seed: 'onward', entryAge: 12, legacy: 'legacy_fisher_family' }),
      );
      advance(state, data, Rng.root(state.seed), { kind: 'months', count: 60 }, 'auto-first');
      return hashValue(state);
    };
    expect(run()).toBe(run());
  });

  it('rerolling one section changes only that section', () => {
    const a = createLife(data, base({ seed: 'sections', race: 'race_human', entryAge: 25 }));
    const hair = createLife(
      data,
      base({
        seed: 'sections',
        race: 'race_human',
        entryAge: 25,
        rolls: { appearance: { hairColor: 7 } } as never,
      }),
    );
    const pa = playerOf(a.state).character!;
    const ph = playerOf(hair.state).character!;
    for (const field of Object.keys(pa.appearance)) {
      if (field !== 'hairColor') expect(ph.appearance[field], field).toBe(pa.appearance[field]);
    }
    expect(hashValue(playerOf(hair.state).stats)).toBe(hashValue(playerOf(a.state).stats));
    expect(pa.backstory).toBe(ph.backstory);

    // The talent tier is tied to the seed alone: rerolling sections cannot fish for a better one.
    for (let roll = 1; roll < 6; roll++) {
      const other = createLife(
        data,
        base({
          seed: 'sections',
          entryAge: 25,
          rolls: { race: roll, family: roll, backstory: roll } as never,
        }),
      );
      expect(playerOf(other.state).character!.hidden!.talent).toBe(pa.hidden!.talent);
    }
  });

  it('obeys every explicit choice', () => {
    const { state, resolved } = createLife(
      data,
      base({
        race: 'race_mink',
        birthplace: 'bp_zou',
        legacy: 'legacy_marine_veteran',
        focus: 'focus_scholar',
        entryAge: 20,
        pronouns: 'she',
        givenName: 'Wren',
        familyName: 'Tidewell',
      }),
    );
    const c = playerOf(state).character!;
    expect([
      resolved.race.id,
      resolved.birthplace.id,
      resolved.legacy.id,
      resolved.focus?.id,
    ]).toEqual(['race_mink', 'bp_zou', 'legacy_marine_veteran', 'focus_scholar']);
    expect(playerOf(state).name).toBe('Wren Tidewell');
    expect(c.pronouns).toBe('she');
    expect(c.traits).toEqual(expect.arrayContaining(data.races['race_mink']!.innateTraits));
  });

  it('refuses impossible choices with a clear reason', () => {
    expect(() =>
      createLife(data, base({ race: 'race_giant', birthplace: 'bp_sky_island' })),
    ).toThrow(/cannot be born/);
    expect(() => createLife(data, base({ race: 'race_lunarian' }))).toThrow(/rare race/);
    expect(() =>
      createLife(
        data,
        base({ race: 'race_lunarian', rareRaces: true, birthplace: 'bp_new_world_island' }),
      ),
    ).not.toThrow();
    expect(() => createLife(data, base({ race: 'race_tontatta', entryAge: 81 }))).toThrow(
      GenesisError,
    );
    expect(() => createLife(data, base({ entryYear: 39 }))).toThrow(/entry year/);
  });

  it('flags lifespan mismatches, and refuses an age the race never reaches', () => {
    const edge = createLife(data, base({ race: 'race_human', entryYear: 35, entryAge: 70 }));
    expect(edge.warnings.map((w) => w.id)).toContain('lifespan-edge');
    const outlive = createLife(data, base({ race: 'race_human', entryYear: 5, entryAge: 66 }));
    expect(outlive.warnings.find((w) => w.id === 'outlive')).toMatchObject({ level: 'warn' });
    expect(() =>
      createLife(
        data,
        base({ race: 'race_tontatta', birthplace: 'bp_green_bit', entryAge: 80, entryYear: 0 }),
      ),
    ).not.toThrow();
  });
});

describe('Done when: New Life produces a full sheet in under 200 ms', () => {
  it('holds for the slowest cases (oldest entries, longest-lived races)', () => {
    createLife(data, base({ seed: 'warm-up', entryAge: 40 })); // first call pays for JIT warm-up
    for (const options of [
      base({ seed: 'slow-1', race: 'race_human', entryAge: 80, entryYear: 38 }),
      base({ seed: 'slow-2', race: 'race_giant', entryAge: 80, entryYear: 38 }),
      base({ seed: 'slow-3', race: 'race_lunarian', rareRaces: true, entryAge: 80, entryYear: 38 }),
      base({ seed: 'slow-4', race: 'race_fishman', entryAge: 80, entryYear: 38 }),
    ]) {
      const started = performance.now();
      const { state, playerId } = createLife(data, options);
      const sheet = characterSheet(data, state, playerId, { omniscient: false });
      const ms = performance.now() - started;
      expect(sheet?.backstory, options.seed).toBeTruthy();
      expect(ms, `${options.seed} took ${ms.toFixed(1)} ms`).toBeLessThan(200);
    }
  });
});

describe('Done when: 1,000 rolls per race match the cap table', () => {
  for (const raceId of Object.keys(data.races).sort()) {
    it(`${raceId}`, () => {
      const stats = genesisStats(data, raceId, 1000);
      expect(stats.problems).toEqual([]);
      expect(stats.ok).toBe(true);
      for (const row of stats.stats) {
        // Ordinary characters average the race cap from the table, within 3%.
        expect(Math.abs(row.capDeviationPct), row.stat).toBeLessThan(3);
        expect(row.histogram.reduce((a, b) => a + b, 0)).toBe(1000);
      }
    });
  }
});

describe('Done when: entry ages 0, 16, 30 and 60 give clearly different stats and backstories', () => {
  const lives = [0, 16, 30, 60].map((entryAge) =>
    createLife(
      data,
      base({
        seed: 'ages',
        race: 'race_human',
        birthplace: 'bp_east_blue_village',
        legacy: 'legacy_fisher_family',
        focus: 'focus_fighter',
        entryYear: 30,
        entryAge,
      }),
    ),
  );
  const [newborn, teen, adult, senior] = lives.map((l) => l.state) as [
    WorldState,
    WorldState,
    WorldState,
    WorldState,
  ];
  const backstoryLines = (s: WorldState) => s.log.filter((r) => r.kind === 'backstory').length;

  it('stats grow from birth to adulthood, and the body declines in later life', () => {
    expect(total(teen, physical)).toBeGreaterThan(total(newborn, physical) * 3);
    expect(total(adult, physical)).toBeGreaterThan(total(teen, physical) * 1.15);
    expect(total(senior, mental)).toBeGreaterThan(total(adult, mental));
    const age = playerOf(senior).stats['strength']!.mods.find((m) => m.source === 'Age');
    expect(age?.value).toBeLessThan(0);
    expect(playerOf(adult).stats['strength']!.mods.some((m) => m.source === 'Age')).toBe(false);
  });

  it('a newborn has no past; older entries have longer, different ones', () => {
    expect(backstoryLines(newborn)).toBe(1); // only "You were born ..."
    expect(backstoryLines(teen)).toBeGreaterThan(1);
    expect(backstoryLines(adult)).toBeGreaterThan(backstoryLines(teen));
    expect(backstoryLines(senior)).toBeGreaterThan(backstoryLines(adult));
    const paragraphs = [newborn, teen, adult, senior].map((s) => playerOf(s).character!.backstory);
    expect(new Set(paragraphs).size).toBe(4);
    expect(paragraphs[0]).toContain('Your story begins the day you are born');
    expect(paragraphs[2]).toContain('as a fighter');
  });

  it('only entries older than 12 get a backstory focus', () => {
    expect(lives.map((l) => l.resolved.focus?.id ?? null)).toEqual([
      null,
      'focus_fighter',
      'focus_fighter',
      'focus_fighter',
    ]);
    expect(playerOf(newborn).character!.focus).toBeUndefined();
  });
});

describe('Done when: every race and birthplace pair writes an appearance sentence with no gaps', () => {
  const GAPS = [
    /\{|\}/,
    /undefined|null|NaN/,
    / {2}/,
    / ,/,
    /,,/,
    / \./,
    /\bwith ,/,
    /\band and\b/,
  ];
  for (const race of Object.values(data.races)) {
    const places = Object.values(data.birthplaces).filter((b) => b.races.includes(race.id));
    it(`${race.name} in ${places.length} birthplace${places.length === 1 ? '' : 's'}`, () => {
      for (const place of places) {
        for (const [i, entryAge] of [0, 3, 9, 16, 40, 80].entries()) {
          for (const pronouns of ['he', 'she', 'they'] as const) {
            const { state, playerId } = createLife(
              data,
              base({
                seed: `looks-${i}-${pronouns}`,
                race: race.id,
                birthplace: place.id,
                rareRaces: true,
                entryAge,
                entryYear: 38,
                pronouns,
              }),
              { allowBlocked: true },
            );
            const sentence = describeAppearance(data, state, playerId);
            const where = `${race.id} / ${place.id} / age ${entryAge} / ${pronouns}: "${sentence}"`;
            expect(sentence, where).toMatch(/^An? \S/);
            expect(sentence.endsWith('.'), where).toBe(true);
            for (const gap of GAPS)
              expect(gap.test(sentence), `${where} matches ${gap}`).toBe(false);
          }
        }
      }
    });
  }

  it('writes every option of every field into a sentence', () => {
    const { state, playerId } = createLife(data, base({ race: 'race_human', entryAge: 40 }));
    const c = playerOf(state).character!;
    for (const field of data.appearance.fields) {
      for (const option of field.options) {
        if (option.races.length > 0 && !option.races.includes('race_human')) continue;
        const sentence = appearanceSentence(
          { data, race: data.races['race_human']!, age: 40, pronouns: 'they' },
          { ...c.appearance, [field.id]: option.id },
        );
        expect(sentence, `${field.id}.${option.id}`).not.toMatch(/ {2}| ,|\{|undefined/);
        if (option.text) expect(sentence, `${field.id}.${option.id}`).toContain(option.text);
      }
    }
    void playerId;
  });
});

describe('Done when: the Giant newborn warning appears', () => {
  it('warns, and suggests entry ages that give a grown life', () => {
    const { warnings } = createLife(data, base({ race: 'race_giant', entryYear: 0, entryAge: 0 }), {
      allowBlocked: true,
    });
    const warning = warnings.find((w) => w.id === 'child-at-present');
    expect(warning?.level).toBe('warn');
    expect(warning?.text).toMatch(/Giant is a child until 40/);
    expect(warning?.suggestions.map((s) => s.entryAge)).toEqual([1, 55]);
    // Following the suggestion clears it.
    const older = createLife(data, base({ race: 'race_giant', entryYear: 0, entryAge: 55 }));
    expect(older.warnings.some((w) => w.id === 'child-at-present')).toBe(false);
    // A human newborn in Year 0 is grown by the present, so is not warned.
    const human = createLife(data, base({ race: 'race_human', entryYear: 0, entryAge: 0 }));
    expect(human.warnings.some((w) => w.id === 'child-at-present')).toBe(false);
  });

  it('flags a birth before God Valley', () => {
    const { warnings, state } = createLife(data, base({ entryYear: 3, entryAge: 20 }));
    expect(warnings.find((w) => w.id === 'before-god-valley')?.text).toMatch(
      /Year -17: 17 years before God Valley/,
    );
    expect(playerOf(state).character!.backstory).toContain('before God Valley');
  });
});

describe('what a new character is made of', () => {
  const sample = Array.from({ length: 60 }, (_, i) =>
    createLife(data, base({ seed: `sample-${i}`, entryAge: (i * 7) % 61, rareRaces: true })),
  );

  it('two innate traits (race and birth), one from the family, at most one quirk; never a dev fixture', () => {
    for (const { state, resolved } of sample) {
      const c = playerOf(state).character!;
      const traits = c.traits.map((id) => data.traits[id]!);
      expect(
        traits.every((t) => !t.tags.includes('dev')),
        state.seed,
      ).toBe(true);
      expect(c.traits).toEqual(expect.arrayContaining(resolved.race.innateTraits));
      expect(traits.filter((t) => t.category === 'quirk').length).toBeLessThanOrEqual(1);
      expect(c.traits.some((id) => resolved.legacy.traitPool.includes(id))).toBe(true);
      // No two traits that exclude each other.
      for (const t of traits)
        for (const ex of t.excludes) expect(c.traits, `${t.id} with ${ex}`).not.toContain(ex);
      expect(new Set(c.traits).size).toBe(c.traits.length);
    }
  });

  it('every stat is base plus named modifiers, and nothing is negative or not a number', () => {
    for (const { state } of sample) {
      for (const [id, stat] of Object.entries(playerOf(state).stats)) {
        expect(Number.isFinite(stat.base), id).toBe(true);
        for (const mod of stat.mods) expect(mod.source.length, id).toBeGreaterThan(0);
        expect(statValue(stat, state.tick), `${state.seed} ${id}`).toBeGreaterThanOrEqual(0);
      }
      const hidden = playerOf(state).character!.hidden!;
      for (const stat of [...physical, ...mental])
        expect(hidden.potential[stat]?.base).toBeGreaterThan(0);
    }
  });

  it('family members are linked both ways, and birth order matches the siblings', () => {
    for (const { state } of sample) {
      const player = playerOf(state);
      const c = player.character!;
      for (const rel of c.relationships) {
        const other = state.entities[rel.id]!;
        expect(other.origin).toBe('generated');
        expect(
          other.character!.relationships.some((r) => r.id === player.id),
          rel.kind,
        ).toBe(true);
        expect(other.character!.givenName).not.toBe(c.givenName);
      }
      const family = c.family!;
      const older = family.siblingIds.filter(
        (id) => state.entities[id]!.character!.birthTick < c.birthTick,
      ).length;
      const count = family.siblingIds.length + family.expected.length;
      const expected =
        count === 0 ? 'only' : older === 0 ? 'eldest' : older === count ? 'youngest' : 'middle';
      expect(family.birthOrder).toBe(expected);
      for (const e of family.expected) expect(e.birthTick).toBeGreaterThan(state.tick);
      expect(
        c.relationships.filter((r) => !['parent', 'sibling', 'guardian'].includes(r.kind)).length,
      ).toBeLessThanOrEqual(data.creation.maxRelationships);
    }
  });

  it('an orphan has no parents, a guardian, and nothing to start with', () => {
    const { state } = createLife(data, base({ legacy: 'legacy_orphan', entryAge: 10 }));
    const c = playerOf(state).character!;
    expect(c.family?.parentIds).toEqual([]);
    expect(c.relationships.map((r) => r.kind)).toContain('guardian');
    expect(c.family?.wealth).toBe('destitute');
    expect(c.backstory).toContain('to parents nobody could name');
  });

  it('a pirate parent is away at sea with a bounty', () => {
    const { state } = createLife(data, base({ legacy: 'legacy_pirate_parent', entryAge: 8 }));
    const parents = playerOf(state).character!.family!.parentIds.map((id) => state.entities[id]!);
    const pirate = parents.find((p) => p.character!.occupation === 'occ_pirate')!;
    expect(pirate.flags['absent']).toBe(true);
    expect(pirate.flags['bounty']).toBeGreaterThanOrEqual(3_000_000);
  });

  it('starting Berries follow difficulty, and some families start in debt', () => {
    const berries = (difficulty: string) =>
      playerOf(createLife(data, base({ seed: 'money', difficulty, entryAge: 10 })).state).character!
        .berries;
    expect(berries('easy')).toBeGreaterThan(berries('brutal'));
    const debts = Array.from({ length: 80 }, (_, i) =>
      createLife(data, base({ seed: `debt-${i}`, entryAge: 4 })),
    ).filter((l) => playerOf(l.state).character!.family?.wealth === 'indebted');
    expect(debts.length).toBeGreaterThan(0);
    expect(debts.some((l) => playerOf(l.state).character!.berries < 0)).toBe(true);
  });
});

describe('the family legacy event chain', () => {
  it('is scheduled for later when it lies ahead, and fires with names filled in', () => {
    const { state } = createLife(
      data,
      base({ seed: 'chain', legacy: 'legacy_marine_veteran', race: 'race_human', entryAge: 10 }),
    );
    const chain = state.scheduled.find((s) => s.eventId === 'evt_legacy_marine_letter');
    expect(chain).toBeDefined();
    const birth = playerOf(state).character!.birthTick;
    expect(chain!.tick).toBe(birth + 16 * 12);
    advance(state, data, Rng.root(state.seed), {
      kind: 'months',
      count: chain!.tick - state.tick + 1,
    });
    const fired = state.log.find(
      (r) => r.cause === 'evt_legacy_marine_letter' && r.kind === 'event',
    );
    expect(fired?.summary).toMatch(/your (mother|father)'s old unit/);
    expect(fired?.summary).not.toMatch(/\{|undefined/);
    expect(state.pending[0]?.eventId).toBe('evt_legacy_marine_letter');
  });

  it('becomes part of the backstory when it already happened', () => {
    const { state } = createLife(
      data,
      base({
        seed: 'chain-past',
        legacy: 'legacy_marine_veteran',
        race: 'race_human',
        entryAge: 25,
      }),
    );
    expect(state.scheduled.some((s) => s.eventId === 'evt_legacy_marine_letter')).toBe(false);
    expect(
      state.log.some((r) => r.summary.startsWith('Age 16: A letter came from the commander')),
    ).toBe(true);
  });
});

describe('truth and knowledge (rule 4) on the sheet', () => {
  it('hides potential, talent and Luck from the player, and shows them to an omniscient viewer', () => {
    const { state, playerId } = createLife(data, base({ seed: 'secrets', entryAge: 20 }));
    const seen = characterSheet(data, state, playerId, { omniscient: false })!;
    expect(seen.hidden).toBeNull();
    expect(seen.stats.some((s) => s.id === 'luck')).toBe(false);
    expect(seen.stats.every((s) => s.potential === undefined)).toBe(true);
    expect(seen.talentHint.length).toBeGreaterThan(0);
    const all = characterSheet(data, state, playerId, { omniscient: true })!;
    expect(all.hidden?.talent.id).toBe(playerOf(state).character!.hidden!.talent);
    expect(all.stats.find((s) => s.id === 'luck')?.hidden).toBe(true);
    expect(all.stats.find((s) => s.id === 'strength')?.potential?.total).toBeGreaterThan(0);
  });

  it('explains every stat and every derived value', () => {
    const { state, playerId } = createLife(data, base({ seed: 'explain', entryAge: 25 }));
    const sheet = characterSheet(data, state, playerId, { omniscient: false })!;
    for (const stat of sheet.stats)
      expect(stat.description).toMatch(new RegExp(`^${stat.label} [\\d.]+ = `));
    const health = sheet.derived.find((d) => d.id === 'maxHealth')!;
    const dur = sheet.stats.find((s) => s.id === 'durability')!.total;
    const end = sheet.stats.find((s) => s.id === 'endurance')!.total;
    expect(health.value).toBe(Math.round(50 + dur * 1.2 + end * 0.8));
    expect(health.formula).toMatch(/^Max Health \d+ = 50 \+ 1\.2 x Durability/);
    expect(sheet.derived.find((d) => d.id === 'vigor')!.value).toBe(Math.floor(6 + end / 20));
  });
});

describe('save format version 2', () => {
  it('gives worlds from version 1 the default configuration', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { ROOT } = await import('../helpers/data');
    const bytes = new Uint8Array(
      readFileSync(join(ROOT, 'tests', 'fixtures', 'golden', 'world_v1.opsim')),
    );
    const { state, report } = await deserializeSave(bytes, { dataHash, limits: LIMITS });
    expect(report.migratedFrom).toBe(1);
    expect(state.config).toEqual(DEFAULT_WORLD_CONFIG);
    expect(state.playerId).toBeNull();
  });
});
