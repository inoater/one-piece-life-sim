import { describe, expect, it } from 'vitest';
import { advanceOptions } from '../../src/core';
import type { Check, EventDef, Trait } from '../../src/engine/data/schemas';
import { EventSchema } from '../../src/engine/data/schemas';
import { Rng } from '../../src/engine/rng';
import type { Entity, WorldState } from '../../src/engine/state';
import { statValue } from '../../src/engine/stats';
import { characterSheet } from '../../src/systems/genesis/sheet';
import { lockReason } from '../../src/systems/life/activities';
import { derived, playerPerson, requirementReason } from '../../src/systems/life/body';
import { fallIll } from '../../src/systems/life/health';
import { runHeadlessLife } from '../../src/systems/life/headless';
import {
  checkDrift,
  checkEarned,
  ensurePersonality,
  type DriftCtx,
} from '../../src/systems/life/personality';
import {
  derivedBonusStat,
  giveTraitTo,
  groupsOf,
  immuneTo,
  opinionMods,
  removeTrait,
  tagWeight,
  trainingModPct,
  traitLock,
} from '../../src/systems/life/traits';
import { statForCheck } from '../../src/systems/story/conditions';
import { growthMultiplier } from '../../src/systems/life/training';
import { practiceRate } from '../../src/systems/powers/tracks';
import { rollCheck } from '../../src/systems/story/checks';
import { playerStory } from '../../src/systems/story/context';
import { eventWeight } from '../../src/systems/story/select';
import { blockedTraits } from '../../src/systems/genesis/context';
import { data } from '../helpers/data';
import { startLife } from '../helpers/life';
import type { LifeEnv } from '../../src/systems/life/env';

/**
 * Phase 4, "Done when": 150 traits load, each with a passing rule test, and personality drift
 * grants and removes traits in a 39-year headless life.
 *
 * Every trait gets its own test, built from its data: each mechanic it declares (stat and potential
 * modifiers, training, derived values, check bonuses, event weights, immunities, locks, opinions,
 * practice of powers, flags, conflicts, earning, evolving, drifting, hiding) is checked against the
 * code that applies it, on a character stripped of every other trait.
 */

const base = startLife({ seed: 'trait-rules', entryYear: 10, entryAge: 25 });
base.run(1);

/** A fresh copy of the base life with no traits at all. */
function blank(): { env: () => LifeEnv; state: WorldState; player: Entity } {
  const state = structuredClone(base.state);
  const player = state.entities[state.playerId as string] as Entity;
  for (const id of [...(player.character?.traits ?? [])]) removeTrait(data, player, id);
  const env = (): LifeEnv => {
    const p = playerPerson(state, data)!;
    return {
      state,
      data,
      tick: state.tick,
      rng: Rng.root('rule'),
      p,
      life: p.c.life!,
      cause: 'test',
    };
  };
  return { env, state, player };
}

function total(entity: Entity, stat: string, tick: number): number {
  const s = entity.stats[stat];
  return s ? statValue(s, tick) : 0;
}

function viewerIn(group: string): Entity {
  const def = data.personality.groups[group];
  const viewer: Entity = {
    id: 'gen_999999',
    type: 'character',
    origin: 'generated',
    name: 'Viewer',
    createdTick: 0,
    tier: 2,
    flags: {},
    stats: {},
    knownBy: [],
    character: {
      givenName: 'Viewer',
      familyName: '',
      pronouns: 'they',
      race: def?.races[0] ?? 'race_human',
      birthTick: -300,
      birthplace: 'bp_east_blue_village',
      alive: true,
      traits: [],
      appearance: {},
      scars: [],
      relationships: [],
      berries: 0,
      ...(def?.occupations[0] ? { occupation: def.occupations[0] } : {}),
    },
  };
  if (!def?.occupations[0] && !def?.races[0] && def?.flags[0]) viewer.flags[def.flags[0]] = true;
  return viewer;
}

function eventTagged(tag: string): EventDef {
  return EventSchema.parse({
    id: 'evt_rule_probe',
    type: 'personal',
    title: 'Probe',
    text: 'A probe.',
    trigger: 'random',
    tags: [tag],
  });
}

function checkOf(stat: Check['stat']): Check {
  return {
    stat,
    difficulty: 50,
    perDanger: 0,
    success: { text: 'ok', effects: [] },
    failure: { text: 'no', effects: [] },
  };
}

const traits = Object.values(data.traits).sort((a, b) => (a.id < b.id ? -1 : 1));

describe('Done when: 150 traits load, each with a passing rule test', () => {
  it('about 150 traits load, and every one does something', () => {
    expect(traits.length).toBeGreaterThanOrEqual(150);
    const kinds = new Set(traits.map((t) => t.kind ?? t.category));
    for (const k of ['personality', 'earned', 'reputation', 'hidden', 'scar'])
      expect(kinds.has(k as never), k).toBe(true);
  });

  it.each(traits.map((t) => [t.id, t] as [string, Trait]))(
    '%s does what its data says',
    (id, trait) => {
      const { env, state, player } = blank();
      const tick = state.tick;
      const c = player.character!;
      const p = playerPerson(state, data)!;
      // Before: what each mechanic reads without the trait.
      // What each stat should read with the trait: the same stat, its modifier added (percent
      // modifiers such as exhaustion scale a flat one, which is why this is not a plain sum).
      const statsExpected = Object.fromEntries(
        [...new Set(trait.statMods.map((m) => m.stat))].map((stat) => {
          const copy = structuredClone(player.stats[stat]!);
          for (const m of trait.statMods)
            if (m.stat === stat)
              copy.mods.push({ source: 'expected', value: m.value, kind: m.kind });
          return [stat, statValue(copy, tick)];
        }),
      );
      const potentialBefore = Object.fromEntries(
        trait.potentialMods.map((m) => [m.stat, statValue(c.hidden!.potential[m.stat]!, tick)]),
      );
      const growthBefore = growthMultiplier(data, c);
      const derivedBefore = Object.fromEntries(
        Object.keys(trait.derivedMods).map((d) => [d, derived(data, player, d, tick)]),
      );
      const checkBase = (stat: string) => statForCheck(playerStory(state, data, tick), stat);
      const checksBefore = Object.fromEntries(
        Object.keys(trait.checkBonuses).map((s) => [
          s,
          rollCheck(playerStory(state, data, tick), checkOf(s as Check['stat']), Rng.root('c'))
            .value - checkBase(s),
        ]),
      );
      const bonusBefore = Object.fromEntries(
        Object.keys(trait.derivedMods).map((d) => {
          const stat = player.stats[derivedBonusStat(data, d as never) ?? ''];
          return [d, stat ? statValue(stat, tick) : 0];
        }),
      );
      const weightsBefore = Object.fromEntries(
        Object.keys(trait.eventWeights).map((tag) => [
          tag,
          eventWeight(playerStory(state, data, tick), eventTagged(tag)),
        ]),
      );
      const ratesBefore = Object.fromEntries(
        Object.keys(trait.powerMods)
          .map((k) =>
            k.startsWith('track_')
              ? k
              : Object.values(data.tracks).find((tr) => `family:${tr.family}` === k)?.id,
          )
          .filter((k): k is string => k !== undefined)
          .map((k) => [k, practiceRate(data, player, c, data.tracks[k]!, tick)]),
      );

      expect(giveTraitTo(data, player, id, 'Rule test', tick), 'it can be given').toBe(true);
      expect(c.traitInfo?.[id]?.source).toBe('Rule test');

      for (const [stat, expected] of Object.entries(statsExpected)) {
        expect(total(player, stat, tick), `${stat} modifier`).toBeCloseTo(expected, 5);
      }
      for (const m of trait.potentialMods) {
        const moved =
          statValue(c.hidden!.potential[m.stat]!, tick) - (potentialBefore[m.stat] ?? 0);
        expect(Math.sign(moved), `${m.stat} potential`).toBe(Math.sign(m.pct));
      }
      if (trait.trainingGainPct !== 0) {
        expect(growthMultiplier(data, c)).toBeCloseTo(
          growthBefore * ((100 + trait.trainingGainPct) / 100),
          5,
        );
      }
      for (const [stat, pct] of Object.entries(trait.trainingMods))
        expect(trainingModPct(data, c, stat)).toBe(pct);
      for (const [d, value] of Object.entries(trait.derivedMods)) {
        const statId = derivedBonusStat(data, d as never);
        expect(statId, `${d} has a bonus stat`).toBeTruthy();
        expect(
          statValue(player.stats[statId!]!, tick) - (bonusBefore[d] ?? 0),
          `${d} bonus`,
        ).toBeCloseTo(value ?? 0, 5);
        // With no stat modifier in the way, the derived value moves by exactly the bonus.
        if (trait.statMods.length === 0 && d !== 'vigor') {
          expect(derived(data, player, d, tick), `${d}`).toBeCloseTo(
            (derivedBefore[d] ?? 0) + (value ?? 0),
            5,
          );
        }
      }
      for (const [stat, bonus] of Object.entries(trait.checkBonuses)) {
        // The value tested is the stat (which a statMod may move too) plus the bonus on top.
        const after =
          rollCheck(playerStory(state, data, tick), checkOf(stat as Check['stat']), Rng.root('c'))
            .value - checkBase(stat);
        expect(after - (checksBefore[stat] ?? 0), `${stat} check`).toBeCloseTo(bonus ?? 0, 5);
      }
      for (const [tag, mult] of Object.entries(trait.eventWeights)) {
        expect(
          eventWeight(playerStory(state, data, tick), eventTagged(tag)),
          `${tag} weight`,
        ).toBeCloseTo((weightsBefore[tag] ?? 0) * mult, 5);
        expect(tagWeight(data, c, [tag])).toBeCloseTo(mult, 5);
      }
      for (const what of trait.immunities) {
        expect(immuneTo(data, c, what), what).toBe(true);
        if (what !== 'seasickness')
          expect(fallIll(env(), what), `never catches ${what}`).toBe(false);
      }
      for (const lock of trait.locks) {
        const act = data.activities[lock.activity]!;
        expect(traitLock(data, c, lock.activity, tick) ?? '', lock.activity).toContain(trait.name);
        // Where nothing else stands in the way, the month's own lock check gives the trait's reason.
        if (
          requirementReason(state, data, p, act.requires, tick) === null &&
          !act.tags.includes('at_sea') === false
        ) {
          expect(lockReason(env(), act) ?? '').toContain(trait.name);
        }
      }
      for (const o of trait.opinion) {
        // What someone of that group feels: every line of the trait that reaches them, added up.
        const viewer = viewerIn(o.group);
        const groups = groupsOf(data, viewer);
        const expected = trait.opinion
          .filter((x) => groups.has(x.group))
          .reduce((sum, x) => sum + x.value, 0);
        const line = opinionMods(data, viewer, player, true).find(
          (m) => m.source === `${trait.name} (trait)`,
        );
        expect(line?.value ?? 0, `${o.group} opinion`).toBe(expected);
      }
      for (const [k, rateBefore] of Object.entries(ratesBefore)) {
        const after = practiceRate(data, player, c, data.tracks[k]!, tick);
        expect(after, `practice of ${k}`).not.toBeCloseTo(rateBefore, 6);
      }
      for (const [flag, value] of Object.entries(trait.flags))
        expect(player.flags[flag], flag).toBe(value);
      for (const other of trait.excludes)
        expect(blockedTraits(data, c.traits).has(other), `excludes ${other}`).toBe(true);

      // Hidden traits: never on the player's sheet, only hinted at.
      if (trait.hidden) {
        const sheet = characterSheet(data, state, player.id, { omniscient: false })!;
        expect(sheet.traits.some((x) => x.id === id)).toBe(false);
        if (trait.hint) expect(sheet.traitHints).toContain(trait.hint);
        const truth = characterSheet(data, state, player.id, { omniscient: true })!;
        expect(truth.traits.some((x) => x.id === id)).toBe(true);
      } else {
        const sheet = characterSheet(data, state, player.id, { omniscient: false })!;
        const line = sheet.traits.find((x) => x.id === id)!;
        expect(line.origin).toContain('Rule test');
      }

      const ctx: DriftCtx = { data, entity: player, c, tick };
      // Earned: reaching the counters grants it (on a character without it).
      if (trait.earn) {
        removeTrait(data, player, id);
        const pers = ensurePersonality(c);
        for (const [counter, n] of Object.entries(trait.earn.counters)) pers.counters[counter] = n;
        checkEarned(ctx);
        expect(c.traits, 'earned').toContain(id);
      }
      // Evolving: the gate reached, it grows into the next trait.
      if (trait.evolves) {
        const pers = ensurePersonality(c);
        for (const [counter, n] of Object.entries(trait.evolves.when.counters))
          pers.counters[counter] = n;
        for (const stat of Object.keys(trait.evolves.when.stats))
          player.stats[stat]!.mods.push({ source: 'test', value: 500, kind: 'flat' });
        if (trait.evolves.when.months > 0)
          c.traitInfo![id]!.tick = tick - trait.evolves.when.months;
        checkEarned(ctx);
        expect(c.traits, 'evolved').toContain(trait.evolves.to);
        expect(c.traits).not.toContain(id);
      }
      // Drifting: the counter past gainAt grants it, back past loseAt takes it away.
      if (trait.drift) {
        const pers = ensurePersonality(c);
        removeTrait(data, player, id);
        for (const other of [...c.traits])
          if (data.traits[other]?.drift?.axis === trait.drift.axis)
            removeTrait(data, player, other);
        pers.axes[trait.drift.axis] = trait.drift.gainAt;
        checkDrift(ctx);
        expect(c.traits, 'drifted in').toContain(id);
        pers.axes[trait.drift.axis] = 0;
        checkDrift(ctx);
        expect(c.traits, 'drifted out').not.toContain(id);
      }
    },
  );
});

describe('Done when: personality drift grants and removes traits in a 39-year headless life', () => {
  it('a 39-year life gains and loses personality traits as it goes, with lines in the chronicle', () => {
    const life = runHeadlessLife(
      data,
      { seed: 'drift-1', race: 'race_human', maxYears: 39, keepState: true },
      advanceOptions('auto-random'),
    );
    const log = life.state!.log;
    const gained = log.filter((r) => r.tags.includes('drift-gained'));
    const lost = log.filter((r) => r.tags.includes('drift-lost'));
    expect(gained.length).toBeGreaterThan(0);
    expect(lost.length).toBeGreaterThan(0);
    for (const r of [...gained, ...lost]) expect(r.summary).not.toMatch(/\{|\}|undefined/);
  }, 120_000);
});
