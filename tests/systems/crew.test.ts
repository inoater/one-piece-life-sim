import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { advance, Rng } from '../../src/core';
import { CREW_EFFECT_KEYS } from '../../src/engine/data/schemas';
import { createEntity } from '../../src/engine/entities';
import { makeStat } from '../../src/engine/stats';
import type { Entity } from '../../src/engine/state';
import { CREW_SITUATIONS } from '../../src/engine/crew-state';
import { autopilot } from '../../src/systems/life/autopilot';
import { meetPerson, relate } from '../../src/systems/life/people';
import { humanAgeOf, reputation } from '../../src/systems/life/body';
import { ensureWorldLayer } from '../../src/systems/places/history';
import { ensureHeart } from '../../src/systems/heart/profile';
import { readBar, relOf } from '../../src/systems/heart/bonds';
import { makeItem } from '../../src/systems/hands/items';
import { listPrice } from '../../src/systems/hands/market';
import { addMember, meet } from '../../src/systems/crew/members';
import { takePrisoners } from '../../src/systems/crew/holdings';
import { crewHooks } from '../../src/systems/crew/hooks';
import { crewEffect, lineupOf, postsOf } from '../../src/systems/crew/posts';
import { startQuest } from '../../src/systems/crew/quests';
import { catchChance, plantSpy } from '../../src/systems/crew/spies';
import { crewLedBy, hereOf, playerCrew } from '../../src/systems/crew/state';
import { crewView, recruitView } from '../../src/systems/crew/view';
import { listingsAt, makeCandidate, seedLegends } from '../../src/systems/crew/world';
import { rollCheck } from '../../src/systems/story/checks';
import { playerStory } from '../../src/systems/story/context';
import { applyLifeEffect } from '../../src/systems/life/effects';
import { data, ROOT } from '../helpers/data';
import { startLife, type TestLife } from '../helpers/life';
import '../../src/systems/crew/month';

/**
 * Phase 8, "Done when": every recruit source makes candidates with a full profile and no template
 * gaps; twenty kinds of joining condition each work end to end; the creator builds every kind of
 * group, and breaking the creed costs loyalty; in ten years crewmates train, learn a technique
 * from each other, finish a personal arc and earn bounties; a mission's report is shaped by the
 * member's stats; a spy is caught in one crew and missed in another, by their stats; every post
 * changes its system, and an empty post shows its cost.
 */

function adult(seed: string): TestLife {
  const t = startLife({ seed, entryYear: 20, entryAge: 22 });
  ensureWorldLayer(t.state, data);
  return t;
}

function captain(seed: string, kind = 'pirate'): TestLife {
  const t = adult(seed);
  t.act({ type: 'crew/found', kind });
  return t;
}

/** Someone looking for a ship where the player stands. */
function candidate(t: TestLife, i = 0, source = 'board'): Entity {
  const env = t.env(`cand-${i}`);
  const here = hereOf(data, t.player()) as string;
  const e = makeCandidate(env, here, source, env.rng.fork('c', i));
  if (!e) throw new Error('no candidate');
  return e;
}

/** A strong player: fights won, checks passed. */
function strong(t: TestLife, by = 400): void {
  for (const stat of [
    'strength',
    'speed',
    'durability',
    'dexterity',
    'willpower',
    'perception',
    'charisma',
    'intellect',
    'endurance',
  ])
    t.act({ type: 'debug/addModifier', entityId: t.player().id, stat, value: by, modKind: 'flat' });
}

/** Play out whatever waits (fights in quick mode, a fate: let them go). */
function settle(t: TestLife): void {
  for (let i = 0; i < 20 && t.state.pending.length > 0; i++) {
    const d = t.state.pending[0];
    if (!d) break;
    const choice =
      d.choices.find((c) => c.id === 'let_go') ??
      d.choices.find((c) => c.id === 'help') ??
      d.choices[0];
    t.act({ type: 'decision/resolve', decisionId: d.id, choiceId: choice?.id ?? '' });
  }
}

function inCrew(t: TestLife, e: Entity): boolean {
  return (
    e.flags['crew.of'] === t.player().id &&
    (playerCrew(t.state)?.crew?.members.some((m) => m.id === e.id) ?? false)
  );
}

const GAP = /[{}]|undefined|NaN/;

/** Every string in a view, however deep (a profile's words must have no template gaps). */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('where recruits come from', () => {
  it('every source makes candidates with a full profile and no template gaps', () => {
    const t = captain('crew-sources');
    const env = t.env('sources');
    const place = (feature: string) =>
      Object.values(data.locations).find(
        (l) => l.features.includes(feature as never) && !l.tags.includes('dev'),
      )?.id as string;
    const ids: Record<string, string> = {};
    // People already met (a contact).
    const contact = meetPerson(
      t.state,
      data,
      env.p,
      env.rng.fork('meet'),
      t.state.tick,
      humanAgeOf(data, env.p, t.state.tick),
      { ageOffset: { min: 0, max: 3 } },
    );
    relate(env.p.entity, contact, 'friend', 40, t.state.tick, env.rng.fork('r'));
    ids['contact'] = contact.id;
    // The board, the cells, the auction block: made the month the player is there.
    t.act({ type: 'debug/teleport', location: place('docks') });
    t.run(1);
    ids['board'] = listingsAt(t.state, place('docks')).board[0] as string;
    t.act({ type: 'debug/teleport', location: place('marine_base') });
    t.run(1);
    ids['prison'] = listingsAt(t.state, place('marine_base')).prison[0] as string;
    t.act({ type: 'debug/teleport', location: place('underworld') });
    t.run(1);
    ids['auction'] = listingsAt(t.state, place('underworld')).auction[0] as string;
    ids['defector'] = candidate(t, 1, 'defector').id;
    ids['mission'] = candidate(t, 2, 'mission').id;
    // A defeated enemy, spared and offered a place.
    const spared = candidate(t, 3, 'spared');
    crewHooks.join?.(t.env('spared'), spared, undefined, 'spared');
    ids['spared'] = spared.id;
    // A rival crew's member (poaching).
    const rival = candidate(t, 4, 'board');
    const org = createEntity(t.state, {
      type: 'organization',
      origin: 'generated',
      name: 'The Gull Pirates',
      tier: 2,
      knownBy: ['*'],
    });
    org.org = {
      kind: 'crew',
      active: true,
      leaderId: null,
      members: [rival.id],
      opinions: {},
      umbrella: 'org_pirates',
      home: null,
      foundedTick: 0,
      endedTick: null,
    };
    if (rival.character) rival.character.npc = { goal: 'glory', crewId: org.id };
    ids['poach'] = rival.id;
    // A legend, by rumour; a canon character.
    seedLegends(t.state, data, t.state.tick);
    ids['legend'] = t.state.crews?.legends[0] as string;
    ids['canon'] = Object.values(t.state.entities).find(
      (e) => e.origin === 'canon' && e.character?.alive,
    )?.id as string;
    for (const [source, id] of Object.entries(ids)) {
      expect(id, source).toBeTruthy();
      const p = recruitView(t.state, data, id, false);
      expect(p, source).not.toBeNull();
      if (!p) continue;
      expect(p.background.born.length, source).toBeGreaterThan(0);
      expect(p.stats.length, source).toBeGreaterThanOrEqual(9);
      for (const s of p.stats) expect(s.words.length, `${source} ${s.id}`).toBeGreaterThan(0);
      expect(p.fits.length, source).toBe(5);
      for (const f of p.fits)
        expect(f.reasons[0]?.length ?? 0, `${source} ${f.role}`).toBeGreaterThan(0);
      expect(p.values.length, source).toBeGreaterThan(0);
      expect(p.joining.pitches.length, source).toBe(data.crew.recruit.pitches.length);
      expect(p.potential.length, source).toBeGreaterThan(0);
      for (const s of strings(p)) expect(s, source).not.toMatch(GAP);
    }
    // Strangers' numbers are words; a crewmate's are exact (rule 4).
    expect(recruitView(t.state, data, ids['board'] as string, false)?.stats[0]?.value).toBeNull();
    const mate = candidate(t, 9);
    addMember(t.env('mate'), playerCrew(t.state) as Entity, mate, { how: 'test' });
    expect(recruitView(t.state, data, mate.id, false)?.stats[0]?.value).not.toBeNull();
    // The rival crew's member holds to their captain: an objection to answer.
    expect(recruitView(t.state, data, ids['poach'] as string, false)?.status.crew).toBe(
      'The Gull Pirates',
    );
    // Every crew line written in all of this has no gaps.
    for (const r of t.state.log.filter((x) => x.tags.includes('crew')))
      expect(r.summary).not.toMatch(/[{}]|undefined/);
  });

  it('a pitch, an objection answered, and someone joins (or names their condition)', () => {
    const t = captain('crew-pitch');
    strong(t, 60);
    let joined = 0;
    for (let i = 0; i < 12; i++) {
      const e = candidate(t, i);
      const best = [...(recruitView(t.state, data, e.id, false)?.joining.pitches ?? [])].sort(
        (a, b) => b.chance - a.chance,
      )[0];
      try {
        t.act({ type: 'crew/pitch', target: e.id, pitch: best?.id ?? 'dream' });
      } catch {
        continue;
      }
      for (const o of recruitView(t.state, data, e.id, false)?.joining.objections ?? [])
        try {
          t.act({
            type: 'crew/answer',
            target: e.id,
            objection: o.id,
            answer: o.answers.find((a) => a.kind === 'promise')?.id ?? o.answers[0]?.id ?? '',
          });
        } catch {
          // A refusal.
        }
      if (inCrew(t, e) || e.character?.recruit?.quest) joined += 1;
    }
    expect(joined).toBeGreaterThan(3);
    // A refusal is remembered: the same pitch again needs something new to show.
    const refused = Object.values(t.state.entities).find(
      (e) => e.character?.recruit?.refused !== null && e.character?.recruit?.refused !== undefined,
    );
    if (refused) {
      const tried = refused.character?.recruit?.pitched[0] ?? 'dream';
      expect(() => t.act({ type: 'crew/pitch', target: refused.id, pitch: tried })).toThrow(
        /heard that already/,
      );
    }
  });
});

describe('joining conditions', () => {
  /** Do what the condition asks, the way a player would. */
  function satisfy(t: TestLife, e: Entity): void {
    const q = e.character?.recruit?.quest;
    if (!q) return;
    const kind = data.conditions[q.id]?.kind;
    const p = t.player();
    const go = (place: string | null) =>
      place && t.act({ type: 'debug/teleport', location: place });
    p.character!.berries += 200000;
    switch (kind) {
      case 'duel':
      case 'home':
        strong(t);
        t.act({ type: 'crew/quest', target: e.id, act: 'fight' });
        settle(t);
        break;
      case 'rival':
        strong(t);
        go(q.place);
        t.act({ type: 'crew/quest', target: e.id, act: 'fight' });
        settle(t);
        break;
      case 'debt':
      case 'signing':
      case 'doctor':
        t.act({ type: 'crew/quest', target: e.id, act: 'pay' });
        break;
      case 'kin':
      case 'escort':
        go(q.place);
        break;
      case 'blessing':
        strong(t);
        go(q.place);
        for (let i = 0; i < 6 && q.progress < 1; i++)
          t.act({ type: 'crew/quest', target: e.id, act: 'ask' });
        break;
      case 'strength':
        strong(t, 2000);
        break;
      case 'fame':
        reputation(p, 'fame').base += 1000;
        break;
      case 'ship': {
        const ship = createEntity(t.state, {
          type: 'ship',
          origin: 'player',
          name: 'the Gull',
          tier: 1,
          stats: { hull: makeStat(150), speed: makeStat(200) },
          knownBy: [p.id],
        });
        ship.ship = {
          vessel: 'vessel_galleon',
          ownerId: p.id,
          place: hereOf(data, p),
          hull: 150,
          crew: 0,
          morale: 60,
          supplies: 10,
          coated: false,
          sunk: false,
        };
        break;
      }
      case 'fruit':
        t.act({ type: 'debug/giveFruit' });
        t.act({ type: 'crew/quest', target: e.id, act: 'give' });
        break;
      case 'blade': {
        const def = Object.values(data.weapons).find((w) => w.grade === 'great' && w.template);
        makeItem(t.state, data, {
          defId: def?.id ?? 'weapon_template_great',
          container: 'held',
          holder: p,
          tick: t.state.tick,
          story: 'A test.',
        });
        t.act({ type: 'crew/quest', target: e.id, act: 'give' });
        break;
      }
      case 'honour': {
        const heart = ensureHeart(t.state, data, p);
        heart.rep = {
          ...(heart.rep ?? {}),
          [q.place as string]: { honour: 100, kindness: 0, courage: 0, generosity: 0 },
        };
        break;
      }
      case 'moment':
        q.at = t.state.tick;
        break;
      case 'teach':
        t.act({
          type: 'debug/powerPoints',
          track: 'track_brawling',
          points: 3000,
          breakthrough: false,
        });
        for (let i = 0; i < q.amount; i++) {
          t.act({ type: 'crew/quest', target: e.id, act: 'lesson' });
          if (i < q.amount - 1) t.run(1);
        }
        break;
      case 'prison':
        go(q.place);
        t.act({ type: 'crew/quest', target: e.id, act: 'pay' });
        break;
      case 'trust':
        t.act({ type: 'debug/heart', target: e.id, axis: 'trust', value: 95 });
        q.since -= 24;
        break;
      case 'contest':
        strong(t, 2000);
        for (let i = 0; i < 6 && q.progress < 1; i++)
          t.act({ type: 'crew/quest', target: e.id, act: 'contest' });
        break;
    }
  }

  const ids = Object.keys(data.conditions).sort();

  it('there are twenty kinds, one condition or more each', () => {
    expect(new Set(Object.values(data.conditions).map((c) => c.kind)).size).toBe(20);
  });

  it.each(ids)('%s works end to end as a personal quest', (id) => {
    const t = captain(`jc-${id}`);
    const e = candidate(t);
    meet(t.env('meet'), e);
    startQuest(t.env('quest'), e, id);
    const q = e.character?.recruit?.quest;
    expect(q?.id).toBe(id);
    expect(q?.status).toBe('open');
    // The tracker reads cleanly.
    const view = recruitView(t.state, data, e.id, false);
    expect(view?.joining.quest?.tracker ?? '').not.toMatch(/[{}]|undefined/);
    satisfy(t, e);
    t.run(1, 'stop');
    settle(t);
    if (!inCrew(t, e)) t.run(1, 'stop');
    settle(t);
    expect(e.character?.recruit?.quest?.status).toBe('met');
    expect(inCrew(t, e)).toBe(true);
    // A bound passenger who reached their place is a crewmate like any other.
    expect(playerCrew(t.state)?.crew?.members.find((m) => m.id === e.id)?.bound ?? null).toBeNull();
  });
});

describe('the crew creator and the creed', () => {
  it.each(data.crew.kinds.map((k) => k.id))('builds a %s', (kind) => {
    const t = captain(`kind-${kind}`, kind);
    const crewEnt = playerCrew(t.state);
    const def = data.crew.kinds.find((k) => k.id === kind);
    expect(crewEnt?.crew?.kind).toBe(kind);
    expect(crewEnt?.name.length).toBeGreaterThan(0);
    for (const field of ['command', 'structure', 'pay'] as const) {
      const fixed = def?.fixed[field];
      if (fixed) {
        expect(crewEnt?.crew?.[field]).toBe(fixed);
        const other = data.crew[
          field === 'command' ? 'commands' : field === 'structure' ? 'structures' : 'pays'
        ].find((x) => x.id !== fixed)?.id as string;
        expect(() => t.act({ type: 'crew/edit', [field]: other })).toThrow(/Fixed/);
      }
    }
    for (const rule of data.crew.creed)
      expect(crewEnt?.crew?.creed[rule.id]).toBe(def?.defaults.creed[rule.id]);
  });

  it('exports a crew and starts a new game with the same companions, made fresh', async () => {
    const t = captain('crew-export');
    for (let i = 0; i < 3; i++)
      addMember(t.env(`m${i}`), playerCrew(t.state) as Entity, candidate(t, i), { how: 'test' });
    const crewEnt = playerCrew(t.state) as Entity;
    const { crewExportText } = await import('../../src/systems/crew/view');
    const text = crewExportText(t.state) as string;
    const t2 = adult('crew-import');
    t2.act({ type: 'crew/import', text });
    const again = playerCrew(t2.state);
    expect(again?.name).toBe(crewEnt.name);
    expect(again?.crew?.members.length).toBe(3);
    const names = (e: Entity | null) =>
      (e?.crew?.members ?? [])
        .map(
          (m) =>
            t2.state.entities[m.id]?.character?.givenName ??
            t.state.entities[m.id]?.character?.givenName,
        )
        .sort();
    expect(names(again)).toEqual(
      crewEnt.crew!.members.map((m) => t.state.entities[m.id]?.character?.givenName).sort(),
    );
    expect(again?.crew?.members[0]?.id).not.toBe(crewEnt.crew?.members[0]?.id);
  });

  it('breaking the creed costs loyalty, traced to the deed (seeded)', () => {
    const t = captain('crew-creed');
    t.act({ type: 'crew/edit', creed: { kill: 'never' } });
    const crewEnt = playerCrew(t.state) as Entity;
    const kind = candidate(t, 0);
    const cruel = candidate(t, 1);
    addMember(t.env('a'), crewEnt, kind, { how: 'test' });
    addMember(t.env('b'), crewEnt, cruel, { how: 'test' });
    ensureHeart(t.state, data, kind).profile.axes['kind'] = 90;
    ensureHeart(t.state, data, cruel).profile.axes['kind'] = -90;
    const loyal = (e: Entity) =>
      readBar(data, relOf(e, t.player().id)!, 'crewmate', 'loyalty', t.state.tick);
    const before = [loyal(kind), loyal(cruel)];
    // A real fight, and the beaten finished off: the fate the creed is about.
    strong(t);
    t.act({
      type: 'debug/fight',
      foe: 'foe_thug',
      count: 1,
      scale: 'duel',
      intent: 'capture',
      mode: 'quick',
    });
    for (let i = 0; i < 10 && t.state.pending.length > 0; i++) {
      const d = t.state.pending[0]!;
      t.act({
        type: 'decision/resolve',
        decisionId: d.id,
        choiceId: d.choices.find((c) => c.id === 'kill')?.id ?? d.choices[0]!.id,
      });
    }
    const after = [loyal(kind), loyal(cruel)];
    expect(after[0]).toBeLessThan((before[0] ?? 0) - 5);
    // Someone who never liked the rule minds far less.
    expect((before[1] ?? 0) - (after[1] ?? 0)).toBeLessThan((before[0] ?? 0) - (after[0] ?? 0));
    const mod = relOf(kind, t.player().id)?.bars?.['loyalty']?.mods.find((m) =>
      m.source.startsWith('The creed broken'),
    );
    expect(mod?.seq).toBeDefined();
    expect(t.state.log.find((r) => r.seq === mod?.seq)?.tags).toContain('crew:creedBroken');
  });
});

describe('teammates grow', () => {
  function decade(seed: string) {
    const t = adult(seed);
    delete t.state.flags['dev.quiet'];
    t.state.config.canonMode = 'probable';
    const rng = Rng.root(seed);
    const ports = Object.values(data.locations)
      .filter(
        (l) =>
          l.features.includes('docks') &&
          !l.tags.includes('dev') &&
          (l.region === 'east_blue' || l.region === 'paradise'),
      )
      .map((l) => l.id)
      .sort();
    for (let m = 0; m < 120 && t.player().character?.alive; m++) {
      if (m % 18 === 0) {
        try {
          t.act({
            type: 'debug/teleport',
            location: ports[Math.floor(m / 18) % ports.length] as string,
          });
        } catch {
          // At sea.
        }
      }
      autopilot(t.state, data, rng.fork('auto', t.state.tick), { captain: true });
      advance(t.state, data, rng, { kind: 'months', count: 1 }, 'auto-random');
    }
    const count = (tag: string) => t.state.log.filter((r) => r.tags.includes(tag)).length;
    const crew = crewLedBy(t.state, t.player())?.crew;
    const everyone = new Set([
      ...(crew?.members.map((m) => m.id) ?? []),
      ...(crew?.former.map((f) => f.id) ?? []),
    ]);
    const trained = [...everyone].filter((id) =>
      (t.state.entities[id]?.stats['strength']?.mods ?? [])
        .concat(
          t.state.entities[id]?.stats['dexterity']?.mods ?? [],
          t.state.entities[id]?.stats['intellect']?.mods ?? [],
        )
        .some((x) => x.source === 'training' && x.value > 0.5),
    ).length;
    return {
      trained,
      technique: count('technique:taught'),
      arcs: count('arcDone'),
      bounties: [...everyone].filter(
        (id) => typeof t.state.entities[id]?.flags['bounty'] === 'number',
      ).length,
    };
  }

  it(
    'in a ten-year headless run, crewmates train, learn a technique from each other, finish an arc and earn bounties',
    { timeout: 120000 },
    () => {
      const runs = ['crew-decade-a', 'crew-decade-b', 'crew-decade-c'].map(decade);
      const all = runs.filter(
        (r) => r.trained > 0 && r.technique > 0 && r.arcs > 0 && r.bounties > 0,
      );
      expect(all.length).toBeGreaterThanOrEqual(1);
      for (const r of runs) {
        expect(r.trained).toBeGreaterThan(0);
        expect(r.arcs).toBeGreaterThan(0);
      }
    },
  );
});

describe('delegation', () => {
  it("a mission's report is shaped by the member's stats", () => {
    const t = captain('crew-mission');
    const crewEnt = playerCrew(t.state) as Entity;
    const sharp = candidate(t, 0);
    const dull = candidate(t, 1);
    for (const [e, v] of [
      [sharp, 120],
      [dull, 3],
    ] as const) {
      for (const s of ['perception', 'speed', 'intellect']) e.stats[s] = makeStat(v);
      addMember(t.env(e.id), crewEnt, e, { how: 'test', role: 'hand' });
    }
    const target = 'loc_loguetown';
    t.act({ type: 'crew/send', member: sharp.id, mission: 'scout', target });
    t.act({ type: 'crew/send', member: dull.id, mission: 'scout', target });
    t.run(4, 'stop');
    settle(t);
    const reportOf = (e: Entity) =>
      t.state.log.find((r) => r.tags.includes('mission:scout') && r.targetIds.includes(e.id));
    const a = reportOf(sharp);
    const b = reportOf(dull);
    expect(a?.tags.some((x) => x === 'band:success' || x === 'band:criticalSuccess')).toBe(true);
    expect(b?.tags.some((x) => x === 'band:failure' || x === 'band:criticalFailure')).toBe(true);
    // The sharp scout's report names more of the place.
    expect(a?.summary.split(',').length ?? 0).toBeGreaterThan(b?.summary.split(',').length ?? 0);
  });
});

describe('spies', () => {
  function spyWorld(seed: string, eye: number) {
    const t = captain(seed);
    const crewEnt = playerCrew(t.state) as Entity;
    const spy = candidate(t, 0);
    addMember(t.env('spy'), crewEnt, spy, { how: 'test' });
    plantSpy(spy, 'org_marines');
    for (const s of ['perception', 'intellect'])
      t.act({
        type: 'debug/addModifier',
        entityId: t.player().id,
        stat: s,
        value: eye,
        modKind: 'flat',
      });
    for (let m = 0; m < 30 && spy.flags['spy.found'] !== true; m++) {
      t.run(1, 'stop');
      // The traitor decision: keep them (forgive), so the crew stays as it was.
      settle(t);
    }
    return { t, spy };
  }

  it('a planted spy is caught in one crew and missed in another, by their stats', () => {
    const sharp = spyWorld('crew-spy', 200);
    const blind = spyWorld('crew-spy', -60);
    expect(sharp.spy.flags['spy.found']).toBe(true);
    expect(blind.spy.flags['spy.found']).not.toBe(true);
    // The signs showed in both: the difference is who saw through them.
    expect(blind.t.state.log.some((r) => r.tags.includes('crew:spySign'))).toBe(true);
    // The world's crews run the same rule.
    const eye = catchChance(sharp.t.state, data, sharp.t.player(), sharp.spy, sharp.t.state.tick);
    const none = catchChance(blind.t.state, data, blind.t.player(), blind.spy, blind.t.state.tick);
    expect(eye).toBeGreaterThan(0.85);
    expect(none).toBeLessThan(0.1);
  });
});

describe('positions aboard', () => {
  function fullCrew(seed: string) {
    const t = captain(seed);
    const crewEnt = playerCrew(t.state) as Entity;
    for (let i = 0; i < 26; i++) {
      const e = candidate(t, i);
      for (const s of [
        'strength',
        'dexterity',
        'intellect',
        'perception',
        'charisma',
        'willpower',
        'endurance',
        'speed',
        'durability',
      ])
        e.stats[s] = makeStat(70);
      addMember(t.env(`m${i}`), crewEnt, e, { how: 'test' });
      for (const m of crewEnt.crew!.members) m.rank = 7;
    }
    t.act({ type: 'crew/auto', on: true });
    return { t, crewEnt };
  }

  it('every post changes its system, and an empty post shows its cost', () => {
    const { t, crewEnt } = fullCrew('crew-posts');
    const crew = crewEnt.crew!;
    for (const situation of CREW_SITUATIONS) {
      for (const post of postsOf(data, situation)) {
        const filled = Object.fromEntries(
          post.effects.map((e) => [e.key, crewEffect(t.state, data, e.key)]),
        );
        expect(crew.lineups[situation]?.[post.id], `${situation}:${post.id} filled`).toBeTruthy();
        t.act({ type: 'crew/post', situation, post: post.id, member: null });
        const fill = lineupOf(t.state, data, crew, t.player(), situation).find(
          (f) => f.post.id === post.id,
        );
        expect(fill?.empty, `${situation}:${post.id} empty`).toBe(true);
        for (const e of post.effects)
          expect(crewEffect(t.state, data, e.key), `${situation}:${post.id} ${e.key}`).not.toBe(
            filled[e.key],
          );
        // The positions screen shows what the empty post costs.
        const view = crewView(t.state, data, false)?.crew?.posts[situation].find(
          (p) => p.id === post.id,
        );
        expect(view?.empty).toBe(true);
        expect(view?.emptyText).toBe(post.emptyText);
        t.act({ type: 'crew/lock', situation, post: post.id, on: false });
        t.act({ type: 'crew/auto', on: true });
      }
    }
  });

  it('each effect key is read by the system it names', () => {
    // Every key is consumed outside the crew's own code (a system the post feeds).
    const consumers = [
      'src/systems/voyage/progress.ts',
      'src/systems/voyage/sea.ts',
      'src/systems/story/select.ts',
      'src/systems/story/checks.ts',
      'src/systems/life/effects.ts',
      'src/systems/battle/player.ts',
      'src/systems/battle/scales.ts',
      'src/systems/battle/aftermath.ts',
      'src/systems/hands/market.ts',
      'src/systems/crew/month.ts',
      'src/systems/crew/world.ts',
      'src/systems/crew/holdings.ts',
    ]
      .map((f) => readFileSync(resolve(ROOT, f), 'utf8'))
      .join('\n');
    for (const key of CREW_EFFECT_KEYS) {
      const read =
        consumers.includes(`'${key}'`) ||
        (key.startsWith('naval.') || key.startsWith('battle.')
          ? consumers.includes("key.startsWith('naval.')")
          : false);
      expect(read, key).toBe(true);
    }
    // And the numbers move: prices, a Perception check at sea, a storm's toll, a sea fight's guns.
    const { t } = fullCrew('crew-systems');
    const player = t.player();
    const here = hereOf(data, player) as string;
    const gear = Object.values(data.weapons).find((w) => w.price !== undefined && !w.template)!;
    const withPurser = listPrice(t.state, data, gear, here, false);
    t.act({ type: 'crew/post', situation: 'port', post: 'purser', member: null });
    expect(listPrice(t.state, data, gear, here, false)).toBeGreaterThan(withPurser);
    // At sea: a voyage of her own.
    const ship = createEntity(t.state, {
      type: 'ship',
      origin: 'player',
      name: 'the Gull',
      tier: 1,
      stats: { hull: makeStat(150), speed: makeStat(200) },
      knownBy: [player.id],
    });
    ship.ship = {
      vessel: 'vessel_galleon',
      ownerId: player.id,
      place: null,
      hull: 100,
      crew: 0,
      morale: 60,
      supplies: 100,
      coated: false,
      sunk: false,
    };
    const lane =
      Object.values(data.lanes).find((l) => l.from === here || l.to === here) ??
      Object.values(data.lanes)[0]!;
    player.character!.travel ??= {
      arrivedTick: 0,
      visited: [],
      logPose: false,
      eternalPoses: [],
      voyage: null,
    };
    player.character!.travel.voyage = {
      lane: lane.id,
      from: lane.from,
      to: lane.to,
      mode: 'own',
      miles: 1000,
      done: 0,
      startTick: t.state.tick,
      estimate: 5,
      months: 0,
      order: 'hold',
      vessel: null,
      shipId: ship.id,
      fare: 0,
      discovered: false,
    };
    const ctx = playerStory(t.state, data, t.state.tick);
    const check = {
      stat: 'perception',
      difficulty: 50,
      perDanger: 0,
      success: { text: 'x', effects: [] },
      failure: { text: 'y', effects: [] },
    } as never;
    const seen = rollCheck(ctx, check, Rng.root('a')).value;
    t.act({ type: 'crew/post', situation: 'sea', post: 'lookout', member: null });
    expect(
      rollCheck(playerStory(t.state, data, t.state.tick), check, Rng.root('a')).value,
    ).toBeLessThan(seen);
    const storm = Object.values(data.events).find((e) => e.tags.includes('weather'))!;
    const hullAfter = () => {
      const before = ship.ship!.hull;
      applyLifeEffect(
        { ...t.env('storm'), cause: storm.id },
        { kind: 'hull', value: -10 } as never,
        { cast: {} },
      );
      const lost = before - ship.ship!.hull;
      ship.ship!.hull = before;
      return lost;
    };
    const manned = hullAfter();
    t.act({ type: 'crew/post', situation: 'storm', post: 'pumps', member: null });
    expect(hullAfter()).toBeGreaterThan(manned);
  });
});

describe('the crew and the save', () => {
  it('a crew survives a save round trip, and Phase 7 crewmates join the first crew founded', () => {
    const t = adult('crew-old');
    const env = t.env('old');
    const mate = meetPerson(
      t.state,
      data,
      env.p,
      env.rng.fork('m'),
      t.state.tick,
      humanAgeOf(data, env.p, t.state.tick),
      { ageOffset: { min: 0, max: 2 } },
    );
    relate(env.p.entity, mate, 'crewmate', 40, t.state.tick, env.rng.fork('r'));
    mate.flags['crew.of'] = env.p.entity.id;
    t.act({ type: 'crew/found', kind: 'pirate', name: 'The Gulls' });
    expect(playerCrew(t.state)?.crew?.members.map((m) => m.id)).toContain(mate.id);
    const clone = JSON.parse(JSON.stringify(t.state));
    expect(clone.entities[playerCrew(t.state)!.id].crew.members.length).toBe(1);
  });
});

describe('what a crew holds', () => {
  it('claims a base, builds a room, pays its upkeep and may be raided', () => {
    const t = captain('crew-base');
    t.player().character!.berries += 2_000_000;
    const here = hereOf(data, t.player()) as string;
    const kind = data.crew.bases.kinds.find((k) =>
      k.needs.every((f) => data.locations[here]?.features.includes(f)),
    )!;
    t.act({ type: 'crew/claimBase', kind: kind.id });
    const crew = playerCrew(t.state)!.crew!;
    expect(crew.bases[0]?.place).toBe(here);
    t.act({ type: 'crew/build', base: crew.bases[0]!.id, room: 'shrine' });
    t.act({ type: 'crew/build', base: crew.bases[0]!.id, room: 'shrine' });
    expect(crew.bases[0]?.rooms['shrine']).toBe(2);
    expect(() => t.act({ type: 'crew/claimBase', kind: kind.id })).toThrow(/already/);
    const berries = t.player().character!.berries;
    t.run(1, 'stop');
    expect(t.player().character!.berries).toBeLessThan(berries);
  });

  it('a captain who respects you swears to your flag; an officer takes a ship of their own', () => {
    const t = captain('crew-fleet');
    const env = t.env('fleet');
    const other = candidate(t, 0);
    meet(env, other);
    const org = createEntity(t.state, {
      type: 'organization',
      origin: 'generated',
      name: 'The Tern Pirates',
      tier: 2,
      knownBy: ['*'],
    });
    org.org = {
      kind: 'crew',
      active: true,
      leaderId: other.id,
      members: [other.id],
      opinions: {},
      umbrella: 'org_pirates',
      home: null,
      foundedTick: 0,
      endedTick: null,
    };
    expect(() => t.act({ type: 'crew/swear', captain: other.id })).toThrow(/respect|fear/);
    t.act({ type: 'debug/heart', target: other.id, axis: 'respect', value: 80 });
    t.act({ type: 'crew/swear', captain: other.id });
    const crew = playerCrew(t.state)!.crew!;
    expect(crew.fleet[0]?.captainId).toBe(other.id);
    t.act({ type: 'crew/order', crew: org.id, order: 'escort', target: null });
    const purse = crew.treasury;
    t.run(1, 'stop');
    expect(crew.treasury).not.toBe(purse);
    // An officer and a second ship: a crew of their own, sworn to the player.
    const mate = candidate(t, 1);
    addMember(t.env('mate'), playerCrew(t.state)!, mate, { how: 'test' });
    crew.members.find((m) => m.id === mate.id)!.officer = true;
    const ship = createEntity(t.state, {
      type: 'ship',
      origin: 'player',
      name: 'the Tern',
      tier: 1,
      stats: { hull: makeStat(90), speed: makeStat(170) },
      knownBy: [t.player().id],
    });
    ship.ship = {
      vessel: 'vessel_caravel',
      ownerId: t.player().id,
      place: hereOf(data, t.player()),
      hull: 90,
      crew: 4,
      morale: 60,
      supplies: 10,
      coated: false,
      sunk: false,
    };
    t.act({ type: 'crew/detach', member: mate.id, ship: ship.id });
    expect(crew.fleet.some((f) => f.captainId === mate.id)).toBe(true);
    expect(ship.ship.ownerId).toBe(mate.id);
    expect(inCrew(t, mate)).toBe(false);
  });

  it('holds prisoners, questions them, and ransoms or lets them go', () => {
    const t = captain('crew-prison');
    const ship = createEntity(t.state, {
      type: 'ship',
      origin: 'player',
      name: 'the Brig',
      tier: 1,
      stats: { hull: makeStat(90), speed: makeStat(170) },
      knownBy: [t.player().id],
    });
    ship.ship = {
      vessel: 'vessel_caravel',
      ownerId: t.player().id,
      place: hereOf(data, t.player()),
      hull: 90,
      crew: 0,
      morale: 60,
      supplies: 10,
      coated: false,
      sunk: false,
    };
    const a = candidate(t, 0);
    const b = candidate(t, 1);
    const c = candidate(t, 2);
    const taken = takePrisoners(t.env('take'), [a.id, b.id, c.id]);
    // A brig holds two.
    expect(taken).toEqual([a.id, b.id]);
    t.act({ type: 'crew/prisoner', prisoner: a.id, act: 'interrogate' });
    expect(() => t.act({ type: 'crew/prisoner', prisoner: a.id, act: 'interrogate' })).toThrow(
      /told you all/,
    );
    const berries = t.player().character!.berries;
    t.act({ type: 'crew/prisoner', prisoner: a.id, act: 'ransom' });
    expect(t.player().character!.berries).toBeGreaterThan(berries);
    t.act({ type: 'crew/prisoner', prisoner: b.id, act: 'release' });
    expect(playerCrew(t.state)!.crew!.prisoners).toEqual([]);
  });

  it('an alliance for a shared goal holds until it is met', () => {
    const t = captain('crew-ally');
    const other = candidate(t, 0);
    meet(t.env('ally'), other);
    t.act({ type: 'debug/heart', target: other.id, axis: 'trust', value: 60 });
    t.act({ type: 'crew/ally', captain: other.id, goal: 'hold', target: null });
    const crew = playerCrew(t.state)!.crew!;
    expect(crew.alliances[0]?.status).toBe('holding');
    t.run(7, 'stop');
    expect(crew.alliances[0]?.status).toBe('met');
  });
});
