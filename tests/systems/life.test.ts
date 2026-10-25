import { describe, expect, it } from 'vitest';
import { advanceOptions } from '../../src/core';
import { hashValue } from '../../src/engine/canonical';
import type { GameData } from '../../src/engine/data/schemas';
import { WorldStateSchema } from '../../src/engine/state';
import { statValue } from '../../src/engine/stats';
import { characterSheet } from '../../src/systems/genesis/sheet';
import { stagesFor } from '../../src/systems/genesis/stages';
import { lockReason } from '../../src/systems/life/activities';
import { humanAgeOf, slotsOf, vigorPoolOf } from '../../src/systems/life/body';
import { continueOptions, lifeRecap } from '../../src/systems/life/death';
import { applyLifeEffect } from '../../src/systems/life/effects';
import { EXHAUSTED_SOURCE, injure, lifePace, mortalityChance } from '../../src/systems/life/health';
import { runHeadlessLife } from '../../src/systems/life/headless';
import { gainFor, trainingCurve } from '../../src/systems/life/training';
import { lifeView } from '../../src/systems/life/view';
import { data } from '../helpers/data';
import { startLife } from '../helpers/life';

const act = (id: string) => {
  const found = data.activities[id];
  if (!found) throw new Error(`no activity ${id}`);
  return found;
};

// ---- The plan's "Done when" -----------------------------------------------------------------------

describe('Done when: a character lives from age 0 to death in one village', () => {
  it('meets at least 40 distinct monthly outcomes, never leaves home, and dies', () => {
    const life = runHeadlessLife(
      data,
      {
        seed: 'forty-outcomes',
        race: 'race_human',
        birthplace: 'bp_east_blue_village',
        variety: true,
        keepState: true,
      },
      advanceOptions('auto-random'),
    );
    expect(life.died).toBe(true);
    expect(life.birthplace).toBe('bp_east_blue_village');
    expect(life.outcomes.length).toBeGreaterThanOrEqual(40);
    // From the infant's first months to the end: lived every stage.
    const state = life.state!;
    const player = state.entities[state.playerId as string]!;
    expect(player.character?.death?.cause).toBeTruthy();
    expect(life.age).toBeGreaterThan(20);
    expect(life.outcomes.some((o) => o.startsWith('act_infancy#'))).toBe(true);
    // Valid all the way through.
    expect(WorldStateSchema.safeParse(state).success).toBe(true);
  });
});

describe('Done when: diminishing returns near potential', () => {
  it('slows as a stat closes on its potential, and drops to a tenth past the soft cap', () => {
    const curve = trainingCurve(data, { potential: 100, start: 10, months: 400, points: 1 });
    const gains = curve.map((p) => p.gain);
    for (let i = 1; i < gains.length; i++)
      expect(gains[i]).toBeLessThanOrEqual(gains[i - 1]! + 1e-12);
    const at = (ratio: number) => curve.find((p) => p.ratio >= ratio)!;
    expect(at(0.5).gain).toBeCloseTo(0.5, 1);
    expect(at(0.8).gain).toBeLessThan(at(0.5).gain / 2);
    const soft = data.character.softCap;
    const past = at(soft.above);
    expect(past.gain).toBeCloseTo((1 - past.ratio) * soft.factor, 9);
    expect(curve[curve.length - 1]!.value).toBeLessThan(100);
  });

  it('is the formula the month uses: base x effort x stage x (1 - current / potential) x traits x teacher', () => {
    expect(gainFor(data, 0.8 * 1.5 * 1.2, 30, 100, 1.1).gain).toBeCloseTo(
      0.8 * 1.5 * 1.2 * 0.7 * 1.1,
      12,
    );
    expect(gainFor(data, 1, 95, 100, 1).gain).toBeCloseTo(0.05 * data.character.softCap.factor, 12);
  });
});

describe('Done when: injuries heal on schedule and scars become traits', () => {
  it('heals minor in 1 month, serious in 3, severe in 12, and lifts the stat penalty on time', () => {
    for (const [severity, months] of [
      ['minor', 1],
      ['serious', 3],
      ['severe', 12],
    ] as const) {
      const t = startLife({ seed: `heal-${severity}` });
      const injury = injure(t.env(), { severity, area: 'arms', cause: 'accident' })!;
      expect(injury.healTick - injury.tick).toBe(months);
      const strength = () => statValue(t.player().stats['strength']!, t.state.tick);
      const hurt = strength();
      t.run(months - 1);
      if (t.player().character?.alive) {
        expect(t.life().injuries.some((i) => i.name === injury.name)).toBe(true);
        t.run(1);
      }
      expect(t.life().injuries.some((i) => i.tick === injury.tick && i.name === injury.name)).toBe(
        false,
      );
      expect(
        t.state.log.some(
          (r) =>
            r.summary.includes(`recovered from ${injury.name}`) ||
            r.summary.includes(`through ${injury.name}`),
        ),
      ).toBe(true);
      expect(strength()).toBeGreaterThan(hurt);
    }
  });

  it('turns a severe wound into a scar trait, written into the appearance', () => {
    const scarred: GameData = structuredClone(data) as GameData;
    for (const s of scarred.life.injuries.severities as {
      scarChance: number;
      lossChance: number;
    }[]) {
      s.scarChance = 1;
      s.lossChance = 0;
    }
    const t = startLife({ seed: 'scar' }, scarred);
    injure(t.env(), { severity: 'severe', area: 'legs', cause: 'accident' });
    t.run(12);
    const c = t.player().character!;
    expect(c.traits).toContain('trait_scar_legs');
    expect(c.scars.some((s) => s.area === 'legs')).toBe(true);
    const sheet = characterSheet(scarred, t.state, t.player().id, { omniscient: false })!;
    expect(sheet.traits.map((x) => x.id)).toContain('trait_scar_legs');
    expect(sheet.appearance.sentence).toMatch(/scar|knee|shin/);
    // The trait's modifier is on the stat, with its source.
    expect(t.player().stats['speed']!.mods.some((m) => m.source === 'Bad Leg (trait)')).toBe(true);
  });

  it('can cost an eye or a limb instead', () => {
    const maimed: GameData = structuredClone(data) as GameData;
    for (const s of maimed.life.injuries.severities as { lossChance: number }[]) s.lossChance = 1;
    const t = startLife({ seed: 'loss' }, maimed);
    injure(t.env(), { severity: 'severe', area: 'eyes', cause: 'violence' });
    t.run(12);
    expect(t.player().character?.traits).toContain('trait_lost_eye');
  });
});

describe('Done when: death offers every continue option and applies the inheritance rules', () => {
  function family() {
    const t = startLife({ seed: 'heirs', entryAge: 30, legacy: 'legacy_pirate_parent' });
    const env = t.env('setup');
    // A child (born the real way, through the month), a protégé and a gang.
    t.life().expecting.push(t.state.tick);
    t.run(1);
    applyLifeEffect(
      t.env('protege'),
      {
        kind: 'relationship',
        role: 'protege',
        opinion: 40,
        ageOffset: { min: -15, max: -10 },
        flags: {},
      },
      { cast: {} },
    );
    applyLifeEffect(t.env('gang'), { kind: 'joinGang', members: { min: 2, max: 2 } }, { cast: {} });
    void env;
    const p = t.player();
    p.character!.berries = 50_000;
    t.life().debt = 9_000;
    p.flags['bounty'] = 3_000_000;
    p.stats['fame'] = { base: 40, mods: [] };
    t.act({ type: 'debug/kill', cause: 'a test' });
    return t;
  }

  it('lists all six options, available where someone can carry on', () => {
    const t = family();
    const options = continueOptions(t.state, data);
    expect(options.map((o) => o.id)).toEqual([
      'heir',
      'protege',
      'crewmate',
      'sibling',
      'newborn',
      'new',
    ]);
    const byId = Object.fromEntries(options.map((o) => [o.id, o]));
    expect(byId['heir']?.available).toBe(true);
    expect(byId['protege']?.available).toBe(true);
    expect(byId['crewmate']?.candidates).toHaveLength(2);
    expect(byId['newborn']?.available).toBe(true);
    expect(byId['new']?.available).toBe(true);
    expect(byId['heir']?.inherits).toBe(true);
    expect(byId['newborn']?.inherits).toBe(false);
    // Time stands still while the choice waits.
    expect(t.run(5).stop).toBe('ended');
  });

  it('passes Berries and half the fame to an heir, not the debt or the bounty', () => {
    const t = family();
    const dead = t.player();
    const heirId = continueOptions(t.state, data).find((o) => o.id === 'heir')!.candidates[0]!.id;
    t.act({ type: 'life/continue', mode: 'heir', targetId: heirId });
    const heir = t.player();
    expect(heir.id).toBe(heirId);
    expect(heir.origin).toBe('player');
    expect(heir.character?.berries).toBe(50_000);
    expect(heir.character?.life?.debt).toBe(0);
    expect(heir.flags['bounty']).toBeUndefined();
    expect(heir.stats['fame']?.mods).toContainEqual({
      source: `Legacy of ${dead.name}`,
      value: 20,
      kind: 'flat',
    });
    expect(heir.character?.life?.generation).toBe(2);
    expect(heir.character?.life?.predecessorId).toBe(dead.id);
    // A whole body: hidden potential, nine stats and Luck, an appearance.
    expect(Object.keys(heir.character?.hidden?.potential ?? {})).toHaveLength(9);
    expect(heir.stats['luck']).toBeDefined();
    expect(Object.keys(heir.character?.appearance ?? {}).length).toBeGreaterThan(5);
    expect(WorldStateSchema.safeParse(t.state).success).toBe(true);
    // And time moves again.
    expect(t.run(2).ticksRun).toBe(2);
  });

  it('gives command of the gang to a crewmate', () => {
    const t = family();
    const gang = t.life().gang;
    t.act({ type: 'life/continue', mode: 'crewmate' });
    expect(t.life().gang).toBe(gang);
    expect(t.player().character?.berries).toBeGreaterThanOrEqual(50_000);
  });

  it('a newborn the same month inherits nothing, and is born at home this very month', () => {
    const t = family();
    const tick = t.state.tick;
    t.act({ type: 'life/continue', mode: 'newborn' });
    const baby = t.player().character!;
    expect(baby.birthTick).toBe(tick);
    expect(baby.berries).toBeLessThan(50_000);
    expect(t.player().stats['fame']?.mods ?? []).toEqual([]);
    expect(WorldStateSchema.safeParse(t.state).success).toBe(true);
    t.run(3);
    expect(baby.alive).toBe(true);
  });

  it('keeps the life recap: age, peak stats, fame, bounty, deeds and cause', () => {
    const t = family();
    const recap = lifeRecap(t.state, data, t.player().id)!;
    expect(recap.cause).toBe('a test');
    expect(recap.age).toBe(30);
    expect(recap.fame).toBe(40);
    expect(recap.bounty).toBe(3_000_000);
    expect(recap.peak).toHaveLength(9);
    expect(recap.children).toBe(1);
  });
});

describe('Done when: lifespans by race', () => {
  // The full check is `npm run lives` (1,000 lives a race, every core): see docs/PHASE2.md. Here,
  // the mortality model alone, exactly: expected age at death of a person no injury reaches, for
  // every race at every place it can be born, within 10% of the middle of its lifespan range.
  for (const race of Object.values(data.races)) {
    it(`${race.name}`, () => {
      const homes = Object.values(data.birthplaces).filter((b) => b.races.includes(race.id));
      const means = homes.map((home) => {
        const t = startLife({
          seed: `mortality-${race.id}`,
          race: race.id,
          birthplace: home.id,
          entryAge: 0,
          entryYear: 0,
        });
        const c = t.player().character!;
        let alive = 1;
        let mean = 0;
        for (let age = 1; age < race.lifespan.max * 2 && alive > 1e-6; age++) {
          const q = mortalityChance({
            data,
            state: t.state,
            p: { race, c, place: { safety: home.safety } },
            tick: c.birthTick + age * 12,
            healthRatio: 1,
          });
          mean += alive * q * age;
          alive *= 1 - q;
        }
        return mean;
      });
      const mid = (race.lifespan.min + race.lifespan.max) / 2;
      for (const mean of means) {
        expect(mean).toBeGreaterThan(mid * 0.9);
        expect(mean).toBeLessThan(mid * 1.1);
      }
    });
  }

  it('paces long-lived races: a giant lives through the table a fraction as fast', () => {
    expect(lifePace(data, data.races['race_human']!)).toBe(1);
    expect(lifePace(data, data.races['race_giant']!)).toBeCloseTo(80 / 275, 9);
  });

  it('a handful of real human lives in the village land inside the range', () => {
    const ages = Array.from(
      { length: 8 },
      (_, i) =>
        runHeadlessLife(
          data,
          { seed: `span-${i}`, race: 'race_human', birthplace: 'bp_east_blue_village' },
          advanceOptions('auto-random'),
        ).age,
    );
    const mean = ages.reduce((a, b) => a + b, 0) / ages.length;
    expect(mean).toBeGreaterThan(55);
    expect(mean).toBeLessThan(100);
  }, 120_000);
});

// ---- The month ------------------------------------------------------------------------------------

describe('age stages and action slots', () => {
  it('gives 0, 1, 1, 2 and 3 slots to an infant, toddler, child, adolescent and adult', () => {
    for (const [age, slots] of [
      [1, 0],
      [4, 1],
      [8, 1],
      [14, 2],
      [25, 3],
      [70, 3],
    ] as const) {
      const t = startLife({ seed: `slots-${age}`, entryAge: age });
      expect(slotsOf(data, t.person(), t.state.tick), `age ${age}`).toBe(slots);
    }
  });

  it('scales the stages of other races through their anchors', () => {
    const giant = data.races['race_giant']!;
    const adolescent = stagesFor(data.character, giant).find((s) => s.stage.id === 'adolescent')!;
    expect(adolescent.fromAge).toBe(giant.anchors.childEnds);
  });

  it('refuses a routine longer than the stage allows', () => {
    const t = startLife({ entryAge: 14 });
    expect(() =>
      t.act({
        type: 'life/routine',
        routine: [
          { activity: 'act_read', effort: 'normal' },
          { activity: 'act_run_laps', effort: 'normal' },
          { activity: 'act_meditate', effort: 'normal' },
          // Phase 6: a deep Vigor pool opens up to three overtime slots, never more.
          { activity: 'act_read', effort: 'light' },
          { activity: 'act_run_laps', effort: 'light' },
          { activity: 'act_meditate', effort: 'light' },
        ],
      }),
    ).toThrow(/2 activity slots/);
  });
});

describe('locked activities say why', () => {
  it('by age, place, injury, money and a cell', () => {
    const young = startLife({ seed: 'young', entryAge: 7 });
    expect(lockReason(young.env(), act('act_spar'))).toBe('From age 12');

    const t = startLife({ seed: 'locks' });
    expect(lockReason(t.env(), act('act_search_ruins'))).toBe('Needs ruins nearby');
    expect(lockReason(t.env(), act('act_library'))).toBe('Needs a library nearby');
    expect(lockReason(t.env(), act('act_work_shift'))).toBe('Needs a job');
    expect(lockReason(t.env(), act('act_sweetheart_time'))).toBe('Needs a sweetheart');

    injure(t.env(), { severity: 'serious', area: 'legs', cause: 'accident' });
    expect(lockReason(t.env(), act('act_run_laps'))).toMatch(/^On bed rest/);
    expect(lockReason(t.env(), act('act_read'))).toBeNull();

    t.player().character!.berries = 10;
    expect(lockReason(t.env(), act('act_see_doctor'))).toMatch(/^The doctor wants/);

    t.life().jailedUntil = t.state.tick + 3;
    expect(lockReason(t.env(), act('act_read'))).toMatch(/^In a cell until/);
  });

  it('skips a locked activity in the routine and says so on the month card', () => {
    const t = startLife({ seed: 'skip' });
    t.act({ type: 'life/routine', routine: [{ activity: 'act_work_shift', effort: 'normal' }] });
    t.run(1);
    expect(
      t.life().report?.lines.some((l) => l.text.startsWith('Work a shift: skipped (needs a job)')),
    ).toBe(true);
  });
});

describe('effort, Vigor and exhaustion', () => {
  it('costs Vigor by effort; past the pool, every stat takes the exhaustion penalty; rest lifts it', () => {
    const t = startLife({ seed: 'tired', entryAge: 25 });
    t.player().stats['endurance'] = { base: 10, mods: [] };
    const pool = vigorPoolOf(data, t.player(), t.state.tick);
    expect(pool).toBe(6); // 6 + Endurance 10 / 20, rounded down
    t.act({
      type: 'life/routine',
      routine: [
        { activity: 'act_run_laps', effort: 'hard' },
        { activity: 'act_conditioning', effort: 'hard' },
        { activity: 'act_meditate', effort: 'hard' },
      ],
    });
    // Three Hard activities cost 9 against a pool of 6: the month ends exhausted.
    {
      t.run(1);
      expect(t.life().report?.vigor.spent).toBe(9);
      expect(t.life().exhausted).toBe(true);
      expect(
        t
          .player()
          .stats['strength']!.mods.some(
            (m) => m.source === EXHAUSTED_SOURCE && m.value === data.life.exhaustion.statPct,
          ),
      ).toBe(true);
      t.act({ type: 'life/routine', routine: [{ activity: 'act_sleep_in', effort: 'normal' }] });
      t.run(1);
      expect(t.life().exhausted).toBe(false);
      expect(t.player().stats['strength']!.mods.some((m) => m.source === EXHAUSTED_SOURCE)).toBe(
        false,
      );
    }
  });

  it('trains harder at Hard effort than at Light', () => {
    const gain = (effort: 'light' | 'hard') => {
      const t = startLife({ seed: 'effort' });
      const before = statValue(t.player().stats['speed']!, t.state.tick);
      t.act({ type: 'life/routine', routine: [{ activity: 'act_run_laps', effort }] });
      t.run(1);
      return statValue(t.player().stats['speed']!, t.state.tick) - before;
    };
    expect(gain('hard')).toBeGreaterThan(gain('light'));
  });
});

describe('jobs and money', () => {
  it('holds a job behind its requirements, pays its wage, and promotes on a rank track', () => {
    const t = startLife({
      seed: 'marine',
      birthplace: 'bp_marine_base_town',
      legacy: 'legacy_marine_veteran',
      entryAge: 18,
    });
    t.act({ type: 'life/job', jobId: 'job_marine_recruit' });
    expect(t.player().flags['marine.title']).toBe('Seaman Recruit');
    const routine = t.life().routine;
    expect(routine.some((s) => s.activity === 'act_work_shift')).toBe(true);
    const before = t.player().character!.berries;
    t.run(1);
    expect(t.life().report?.berries.income).toBeGreaterThanOrEqual(Math.round(2000 * 1));
    expect(t.player().character!.berries).not.toBe(before);
    t.run(18);
    if (t.player().character?.alive && t.life().job) {
      expect(t.player().flags['marine.title']).toBe('Seaman Apprentice');
    }
  });

  it('refuses a job out of reach, with the reason', () => {
    const t = startLife({ seed: 'weak', entryAge: 18 });
    t.player().stats['strength'] = { base: 5, mods: [] };
    expect(() => t.act({ type: 'life/job', jobId: 'job_dockworker' })).toThrow(/Needs Strength 20/);
    expect(() => t.act({ type: 'life/job', jobId: 'job_mercenary' })).toThrow(/Combat Power 250/);
  });

  it('charges adults the cost of living, turns a shortfall into debt, and charges interest', () => {
    const t = startLife({ seed: 'debt', entryAge: 25 });
    t.player().character!.berries = 100;
    t.run(1);
    const life = t.life();
    expect(life.debt).toBeGreaterThan(0);
    expect(t.player().character!.berries).toBe(0);
    const debt = life.debt;
    t.run(1);
    expect(t.life().debt).toBeGreaterThan(debt);
  });

  it('borrows and repays', () => {
    const t = startLife({ seed: 'loan', entryAge: 25 });
    const cash = t.player().character!.berries;
    t.act({ type: 'life/borrow', amount: 5000 });
    expect(t.player().character!.berries).toBe(cash + 5000);
    expect(t.life().debt).toBe(5000);
    t.act({ type: 'life/repay', amount: 2000 });
    expect(t.life().debt).toBe(3000);
    expect(() => t.act({ type: 'life/borrow', amount: 1234 })).toThrow(/No loan shark/);
  });

  it('sends the collector, whose choices hurt through the life loop', () => {
    const t = startLife({ seed: 'collector', entryAge: 25 });
    t.life().debt = 20_000;
    const stop = t.run(3, 'stop');
    expect(stop.stop).toBe('decision');
    const decision = t.state.pending.find((d) => d.eventId === 'evt_debt_collector')!;
    expect(decision).toBeDefined();
    t.act({ type: 'decision/resolve', decisionId: decision.id, choiceId: 'refuse' });
    expect(t.life().injuries.some((i) => i.severity === 'serious')).toBe(true);
  });
});

describe('the life view the page gets', () => {
  it('has slots, every non-automatic activity with its lock, jobs, money and health', () => {
    const t = startLife({ seed: 'view' });
    const view = lifeView(t.state, data)!;
    expect(view.slots).toBe(3);
    expect(view.activities.length).toBe(
      Object.values(data.activities).filter((a) => !a.automatic).length,
    );
    expect(view.activities.find((a) => a.id === 'act_search_ruins')?.lock).toBe(
      'Needs ruins nearby',
    );
    expect(view.jobs).toHaveLength(Object.keys(data.jobs).length);
    expect(view.health.current).toBe(view.health.max);
    expect(view.recap).toBeNull();
  });

  it('never changes the world it describes', () => {
    const t = startLife({ seed: 'pure' });
    const before = hashValue(t.state);
    lifeView(t.state, data);
    characterSheet(data, t.state, t.player().id, { omniscient: true });
    expect(hashValue(t.state)).toBe(before);
  });
});

describe('determinism', () => {
  it('the same seed and routine give the same world, month by month', () => {
    const play = () => {
      const t = startLife({ seed: 'twin' });
      t.act({ type: 'life/job', jobId: 'job_fisher' });
      t.act({
        type: 'life/routine',
        routine: [
          { activity: 'act_work_shift', effort: 'normal' },
          { activity: 'act_spar', effort: 'hard' },
          { activity: 'act_befriend', effort: 'light' },
        ],
      });
      t.run(60);
      return hashValue(t.state);
    };
    expect(play()).toBe(play());
  });

  it('runs a long-lived life without falling behind (age in human terms grows slowly)', () => {
    const t = startLife({
      seed: 'giant',
      race: 'race_giant',
      birthplace: 'bp_elbaf_highlands',
      entryAge: 10,
    });
    const before = humanAgeOf(data, t.person(), t.state.tick);
    t.run(120);
    expect(humanAgeOf(data, t.person(), t.state.tick) - before).toBeLessThan(5);
  });
});
