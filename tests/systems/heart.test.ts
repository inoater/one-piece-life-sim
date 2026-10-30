import { describe, expect, it } from 'vitest';
import { advance, applyAction, createLife, Rng } from '../../src/core';
import type { Band } from '../../src/systems/story/checks';
import type { Entity, RelationKind } from '../../src/engine/state';
import { BOND_KINDS, REGISTERS, REL_AXES } from '../../src/engine/data/schemas';
import { makeStat } from '../../src/engine/stats';
import { autopilot } from '../../src/systems/life/autopilot';
import { meetPerson, relate } from '../../src/systems/life/people';
import { humanAgeOf } from '../../src/systems/life/body';
import { ensureWorldLayer } from '../../src/systems/places/history';
import {
  axisValue,
  barsOf,
  bondOf,
  circle,
  labelOf,
  moveAxis,
  pairOf,
  readBar,
} from '../../src/systems/heart/bonds';
import { ensureHeart } from '../../src/systems/heart/profile';
import { heartEnv, playBand, talkOdds } from '../../src/systems/heart/talk';
import { tellFact } from '../../src/systems/heart/facts';
import { conscienceOf, npcDeed } from '../../src/systems/heart/deeds';
import { playerDeed } from '../../src/systems/heart/effects';
import { heartMonth } from '../../src/systems/heart/month';
import { inheritFrom } from '../../src/systems/heart/family';
import { banquet } from '../../src/systems/heart/scenes';
import { axisBreakdown, heartView, personView } from '../../src/systems/heart/view';
import { data } from '../helpers/data';
import { startLife, type TestLife } from '../helpers/life';

/**
 * Phase 7, "Done when": every axis traced to logged events; every intent with checks and text
 * for six personalities; a lie recorded with its source; at least 15 kinds of people reaching out
 * in ten years; children taking after their parents; every bond's bars and milestones; acting
 * against one's values lowering the conscience and bringing guilt.
 */

const BANDS: Band[] = ['criticalSuccess', 'success', 'failure', 'criticalFailure'];

function adult(seed: string): TestLife {
  const t = startLife({ seed, entryYear: 20, entryAge: 22 });
  ensureWorldLayer(t.state, data);
  return t;
}

/** Someone the player knows, here, related as `kind`. */
function know(t: TestLife, kind: RelationKind = 'friend', opinion = 30, i = 0): Entity {
  const env = t.env(`know-${kind}-${i}`);
  const other = meetPerson(
    t.state,
    data,
    env.p,
    env.rng.fork('meet'),
    t.state.tick,
    humanAgeOf(data, env.p, t.state.tick),
    {
      ageOffset: { min: 0, max: 2 },
    },
  );
  relate(env.p.entity, other, kind, opinion, t.state.tick, env.rng.fork('relate'));
  ensureHeart(t.state, data, other);
  ensureHeart(t.state, data, env.p.entity);
  return other;
}

/** A 10-year life lived by the autopilot, away from home for three of them (letters, absence). */
function decade(seed: string): TestLife {
  const t = adult(seed);
  delete t.state.flags['dev.quiet'];
  const rng = Rng.root(seed);
  for (let m = 0; m < 120 && t.player().character?.alive; m++) {
    if (m === 30) t.act({ type: 'debug/teleport', location: 'loc_loguetown' });
    if (m === 66) t.act({ type: 'debug/teleport', location: 'loc_east_blue_village' });
    autopilot(t.state, data, rng.fork('auto', t.state.tick), { variety: true });
    advance(t.state, data, rng, { kind: 'months', count: 1 }, 'auto-random');
  }
  return t;
}

describe('Done when: every axis on a relationship traces each modifier to a logged event', () => {
  it('in a lived decade, every modifier on every axis names a record that exists', () => {
    const t = decade('heart-trace');
    const player = t.player();
    let checked = 0;
    for (const { other, pair } of circle(t.state, player)) {
      for (const rel of [pair.mine, pair.theirs]) {
        for (const axis of REL_AXES) {
          const b = axisBreakdown(t.state, data, rel, axis, true);
          for (const line of b.lines) {
            checked += 1;
            expect(line.seq, `${other.name} ${axis} "${line.source}"`).not.toBeNull();
            expect(line.what, `${other.name} ${axis} "${line.source}"`).not.toBeNull();
          }
        }
      }
      // The person page shows the same breakdowns.
      const view = personView(t.state, data, other.id, true);
      expect(view?.theirs.length).toBeGreaterThan(0);
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('a talk writes its change as a named modifier pointing at the talk', () => {
    const t = adult('heart-chat');
    const other = know(t);
    const env = heartEnv(t.state, data, 'test')!;
    const pair = pairOf(t.player(), other)!;
    const result = playBand(env, other, pair, data.intents['int_chat']!, 'success', {});
    const mod = pair.theirs.opinion.mods.find((m) => m.source === 'Chat');
    expect(mod?.seq).toBe(result.seq);
    expect(t.state.log.find((r) => r.seq === result.seq)?.summary).toBe(result.text);
  });
});

/** Six people unlike each other: every register, a tic or a laugh, and a mood. */
function sixProfiles(t: TestLife): Entity[] {
  const moods = ['content', 'angry', 'drunk', 'scared', 'elated', 'grieving'] as const;
  return REGISTERS.map((register, i) => {
    const other = know(t, 'friend', 40, i);
    const heart = ensureHeart(t.state, data, other);
    heart.profile.voice = {
      register,
      tic: i % 2 === 0 ? (data.heart.tics[i] ?? null) : null,
      laugh: i % 2 === 1 ? (data.heart.laughs[i] ?? null) : null,
    };
    heart.profile.axes = {
      bold: 80 - i * 30,
      kind: -60 + i * 25,
      honest: 50 - i * 20,
      free: i * 15 - 40,
      proud: 20,
      calm: -50 + i * 20,
      serious: 60 - i * 25,
    };
    heart.mood = { id: moods[i]!, until: t.state.tick + 3 };
    return other;
  });
}

describe('Done when: every intent works with checks and text for six personalities', () => {
  it('every band of every intent renders in each voice with no gaps, and applies', () => {
    const t = adult('heart-voices');
    t.player().character!.berries = 1_000_000;
    const people = sixProfiles(t);
    const env = heartEnv(t.state, data, 'test')!;
    const texts = new Map<string, Set<string>>();
    for (const other of people) {
      const p = env.p;
      for (const id of Object.keys(data.intents).sort()) {
        const intent = data.intents[id]!;
        const odds = talkOdds(t.state, data, p, other, intent, { amount: 500 });
        expect(odds.chance).toBeGreaterThanOrEqual(0);
        expect(odds.chance).toBeLessThanOrEqual(1);
        expect(odds.words.length).toBeGreaterThan(0);
        for (const band of BANDS) {
          const pair = pairOf(t.player(), other)!;
          const result = playBand(env, other, pair, intent, band, {
            amount: 500,
            ...(intent.topic === 'person' ? { topic: people[0]!.id } : {}),
            ...(intent.topic === 'place' ? { topic: 'loc_loguetown' } : {}),
          });
          expect(result.text, `${id} ${band}`).not.toMatch(/[{}]|undefined|NaN/);
          expect(result.text.length).toBeGreaterThan(5);
          const key = `${id}:${band}`;
          if (!texts.has(key)) texts.set(key, new Set());
          texts.get(key)!.add(result.text);
        }
      }
    }
    // A gruff voice and a cheerful one refuse a loan in different words.
    expect(texts.get('int_ask_loan:failure')?.size).toBeGreaterThan(3);
    expect(texts.size).toBe(Object.keys(data.intents).length * 4);
  });

  it('a talk is a real check: refused when locked, rolled when open, over the snail at a distance', () => {
    const t = adult('heart-check');
    const other = know(t, 'friend', 60);
    t.player().character!.berries = 50_000;
    t.act({ type: 'heart/talk', target: other.id, intent: 'int_chat' });
    expect(t.state.log.some((r) => r.tags.includes('int:int_chat'))).toBe(true);
    expect(() => t.act({ type: 'heart/talk', target: other.id, intent: 'int_chat' })).toThrow(
      /Already this month/,
    );
    expect(() => t.act({ type: 'heart/talk', target: other.id, intent: 'int_propose' })).toThrow();
    // Away, without a Den Den Mushi or their number: not possible.
    other.character!.place = 'loc_loguetown';
    expect(() =>
      t.act({ type: 'heart/talk', target: other.id, intent: 'int_joke', remote: true }),
    ).toThrow(/Den Den Mushi/);
    t.act({ type: 'debug/giveItem', item: 'item_den_den_mushi' });
    expect(() =>
      t.act({ type: 'heart/talk', target: other.id, intent: 'int_joke', remote: true }),
    ).toThrow(/number/);
    t.player().character!.hands!.contacts.push(other.id);
    t.act({ type: 'heart/talk', target: other.id, intent: 'int_joke', remote: true });
    expect(t.state.log.some((r) => r.tags.includes('int:int_joke'))).toBe(true);
  });
});

describe('Done when: a deceitful person lies, and the player keeps the false fact with its source', () => {
  it('records the lie, hides the truth, and finds it out on arrival', () => {
    const t = adult('heart-lie');
    const liar = know(t, 'friend', 20);
    const subject = know(t, 'friend', 20, 1);
    ensureHeart(t.state, data, liar).profile.axes['honest'] = -95;
    let told = null as ReturnType<typeof tellFact> | null;
    for (let i = 0; i < 20 && (!told || told.fact.truth); i++)
      told = tellFact(
        t.state,
        data,
        t.player(),
        liar,
        'person',
        subject.id,
        Rng.root('lie').fork(i),
      );
    expect(told?.fact.truth).toBe(false);
    expect(told?.fact.from).toBe(liar.id);
    const facts = t.player().character!.heart!.facts!;
    expect(facts.some((f) => f.from === liar.id && !f.truth)).toBe(true);
    // The player does not see whether it is true; the omniscient view does.
    const plain = heartView(t.state, data, false)!.facts.find((f) => f.fromId === liar.id);
    expect(plain?.truth).toBeNull();
    expect(heartView(t.state, data, true)!.facts.find((f) => f.fromId === liar.id)?.truth).toBe(
      false,
    );
    // Going there shows it up: a line, and trust lost in the liar.
    const claimed = told!.fact.place!;
    t.act({ type: 'debug/teleport', location: claimed });
    heartMonth(t.env('arrive'));
    expect(
      t.state.log.some((r) => r.tags.includes('knowledge') && r.summary.includes(liar.name)),
    ).toBe(true);
    const mine = pairOf(t.player(), liar)!.mine;
    expect(axisValue(data, mine, 'trust', t.state.tick)).toBeLessThan(0);
  });
});

describe('Done when: people start at least 15 kinds of interaction in a 10-year headless life', () => {
  it('in five seeded lives, most reach 15 kinds and the middle one does', () => {
    const counts = ['a', 'b', 'c', 'd', 'e'].map((x) => {
      const t = decade(`heart-decade-${x}`);
      const kinds = new Set<string>();
      for (const r of t.state.log)
        for (const tag of r.tags)
          if (tag.startsWith('ini:') && tag !== 'ini:ini_guilt') kinds.add(tag);
      return kinds.size;
    });
    const sorted = [...counts].sort((a, b) => a - b);
    expect(sorted[2], counts.join(' ')).toBeGreaterThanOrEqual(15);
    expect(counts.filter((n) => n >= 15).length, counts.join(' ')).toBeGreaterThanOrEqual(3);
  }, 120_000);
});

describe('Done when: children inherit traits, potential leanings and appearance ids', () => {
  it('in seeded births, from both parents', () => {
    const t = adult('heart-heredity');
    const env = t.env('parents');
    const mother = t.player();
    const father = know(t, 'sweetheart', 60);
    const fc = father.character!;
    for (const parent of [mother, father]) {
      const c = parent.character!;
      if (!c.traits.includes('trait_sturdy')) c.traits.push('trait_sturdy');
      c.hidden = {
        talent: 'gifted',
        potential: { strength: makeStat(90), intellect: makeStat(40) },
      };
    }
    fc.appearance = { ...mother.character!.appearance };
    let traits = 0;
    let looks = 0;
    let fields = 0;
    let potential = 0;
    const n = 40;
    for (let i = 0; i < n; i++) {
      const child = meetPerson(t.state, data, env.p, Rng.root('kid').fork(i), t.state.tick, 0, {
        ageOffset: { min: -22, max: -22 },
      });
      inheritFrom(t.state, data, child, [mother, father], Rng.root('heredity').fork(i));
      const c = child.character!;
      if (c.traits.includes('trait_sturdy')) traits += 1;
      for (const [field, value] of Object.entries(c.appearance)) {
        fields += 1;
        if (mother.character!.appearance[field] === value) looks += 1;
      }
      potential += c.hidden?.potential['strength']?.base ?? 0;
      expect(c.heart?.profile.axes).toBeDefined();
    }
    expect(traits).toBeGreaterThan(n * 0.15);
    expect(traits).toBeLessThan(n * 0.7);
    expect(looks / fields).toBeGreaterThan(0.75);
    expect(potential / n).toBeGreaterThan(80);
    expect(potential / n).toBeLessThan(100);
  });

  it('a child born in the life loop takes after the player and their spouse', () => {
    const t = adult('heart-born');
    const spouse = know(t, 'sweetheart', 70);
    spouse.flags['married'] = true;
    t.player().flags['married'] = true;
    t.life().expecting.push(t.state.tick);
    t.run(1);
    const child = circle(t.state, t.player()).find(({ pair }) => pair.mine.kind === 'child')?.other;
    expect(child).toBeDefined();
    expect(Object.keys(child!.character!.appearance).length).toBeGreaterThan(0);
    expect(child!.character!.heart).toBeDefined();
  });
});

describe('Done when: every bond kind shows its bars, and each milestone fires at its threshold', () => {
  const KIND_OF: Record<string, RelationKind> = {
    friendship: 'friend',
    romance: 'sweetheart',
    crewmate: 'crewmate',
    student: 'protege',
    mentor: 'mentor',
    rival: 'rival',
    family: 'sibling',
    superior: 'superior',
    subordinate: 'subordinate',
    companion: 'companion',
  };

  it('shows each bond kind with its own bars and breakdowns', () => {
    const t = adult('heart-bars');
    BOND_KINDS.forEach((bond, i) => {
      const other = know(t, KIND_OF[bond]!, 40, i);
      const view = personView(t.state, data, other.id, true)!;
      expect(bondOf(data, KIND_OF[bond]!)).toBe(bond);
      expect(view.bars.map((b) => b.id)).toEqual(barsOf(data, bond).map((b) => b.id));
      for (const bar of view.bars) expect(bar.baseNote.length).toBeGreaterThan(0);
    });
  });

  it('fires each milestone at its threshold and not below it', () => {
    for (const bond of BOND_KINDS) {
      for (const m of data.heart.bonds[bond]?.milestones ?? []) {
        const t = adult(`heart-ms-${bond}-${m.id}`);
        const other = know(t, KIND_OF[bond]!, 0);
        const pair = pairOf(t.player(), other)!;
        pair.mine.sinceTick -= m.months + 1;
        pair.theirs.sinceTick = pair.mine.sinceTick;
        if (m.after) pair.theirs.milestones = [m.after];
        if (bond === 'romance') {
          pair.mine.romance = 'courting';
          pair.theirs.romance = 'courting';
        }
        const set = (id: string, value: number) => {
          const now = readBar(data, pair.theirs, bond, id, t.state.tick);
          if ((REL_AXES as readonly string[]).includes(id))
            moveAxis(data, pair.theirs, id as never, value - now, 'Test', undefined, t.state.tick);
          else {
            pair.theirs.bars ??= {};
            pair.theirs.bars[id] = makeStat(value);
          }
        };
        // Every other bar where it cannot trip a milestone of its own; this one's at its line.
        const atThreshold = () => {
          for (const def of barsOf(data, bond)) if (!def.axis) set(def.id, def.rest);
          for (const [id, v] of Object.entries(m.max)) set(id, v);
          for (const [id, v] of Object.entries(m.min)) set(id, v);
        };
        const fired = () => t.state.log.some((r) => r.tags.includes(`ms:${m.id}`));
        // Just short of it first (where it has a minimum to be short of).
        const firstMin = Object.entries(m.min)[0];
        if (firstMin) {
          atThreshold();
          set(firstMin[0], firstMin[1] - 2);
          heartMonth(t.env(`below-${m.id}`));
          expect(fired(), `${bond}/${m.id} below`).toBe(false);
        }
        atThreshold();
        heartMonth(t.env(`at-${m.id}`));
        expect(fired(), `${bond}/${m.id} at threshold`).toBe(true);
      }
    }
  });
});

describe('Done when: acting against your values lowers your conscience and brings guilt', () => {
  it('the player: conscience falls, Willpower suffers, a guilt decision waits', () => {
    const t = adult('heart-guilt');
    const heart = ensureHeart(t.state, data, t.player());
    heart.profile.values = ['peace', 'family', 'justice'];
    const before = conscienceOf(heart, t.state.tick);
    for (let i = 0; i < 4; i++) {
      const env = t.env(`deed-${i}`);
      const record = t.state.log[t.state.log.length - 1]!;
      playerDeed(env, ['cruel'], record.seq);
    }
    expect(conscienceOf(heart, t.state.tick)).toBeLessThan(before);
    expect(conscienceOf(heart, t.state.tick)).toBeLessThan(data.heart.conscience.guiltBelow);
    expect(t.state.pending.some((d) => d.heart && d.eventId === 'ini_guilt')).toBe(true);
    expect(t.player().stats['willpower']!.mods.some((m) => m.source === 'Guilt')).toBe(true);
    // Owning up eases it.
    const decision = t.state.pending.find((d) => d.eventId === 'ini_guilt')!;
    const low = conscienceOf(heart, t.state.tick);
    t.act({ type: 'decision/resolve', decisionId: decision.id, choiceId: 'confess' });
    expect(conscienceOf(heart, t.state.tick)).toBeGreaterThan(low);
  });

  it('anyone: a kind person made to be cruel feels it, and grows harder', () => {
    const t = adult('heart-npc-guilt');
    const marine = know(t);
    const heart = ensureHeart(t.state, data, marine);
    heart.profile.values = ['justice', 'peace', 'honour'];
    heart.profile.axes['kind'] = 70;
    let guilty = false;
    for (let i = 0; i < 4; i++)
      guilty =
        npcDeed(t.state, data, marine, ['cruel'], 'burned a village on orders').guilty || guilty;
    expect(guilty).toBe(true);
    expect(
      t.state.log.some((r) => r.tags.includes('guilt') && r.actorIds.includes(marine.id)),
    ).toBe(true);
    expect(heart.profile.axes['kind']).toBeLessThan(70);
    expect(marine.stats['willpower']?.mods.some((m) => m.source === 'Guilt')).toBe(true);
  });
});

describe('the rest of the heart', () => {
  it('a banquet brings everyone present closer, and something slips', () => {
    const t = adult('heart-feast');
    const guests = [know(t, 'friend', 30, 0), know(t, 'crewmate', 30, 1), know(t, 'friend', 30, 2)];
    t.player().character!.berries = 50_000;
    const before = guests.map((g) =>
      axisValue(data, pairOf(t.player(), g)!.theirs, 'affection', t.state.tick),
    );
    expect(banquet(t.env('feast'), '', true)).toBeGreaterThanOrEqual(3);
    guests.forEach((g, i) =>
      expect(
        axisValue(data, pairOf(t.player(), g)!.theirs, 'affection', t.state.tick),
      ).toBeGreaterThan(before[i]!),
    );
    expect(
      guests.every((g) => g.character!.heart!.memories.some((m) => m.kind === 'banquet')),
    ).toBe(true);
  });

  it('labels follow the axes and the history', () => {
    const t = adult('heart-labels');
    const friend = know(t, 'friend', 30);
    const pair = pairOf(t.player(), friend)!;
    expect(labelOf(data, pair, t.state.tick).name).toBe('Friend');
    moveAxis(data, pair.theirs, 'affection', -120, 'Test', undefined, t.state.tick);
    expect(labelOf(data, pair, t.state.tick).name).toBe('Enemy');
    pair.mine.sworn = true;
    expect(labelOf(data, pair, t.state.tick).name).toBe('Sworn sibling');
  });

  it('talk moves people, romance can be switched off, and an adult can adopt', () => {
    const t = adult('heart-misc');
    t.player().character!.berries = 100_000;
    const crush = know(t, 'friend', 70);
    ensureHeart(t.state, data, crush).profile.romance = true;
    t.act({ type: 'heart/romance', on: false });
    expect(() => t.act({ type: 'heart/talk', target: crush.id, intent: 'int_confess' })).toThrow(
      /Romance/,
    );
    t.act({ type: 'heart/romance', on: true });
    const town = t.state.entities[t.person().place.location!.id]!.place!;
    town.residents.children = Math.max(1, town.residents.children);
    t.act({ type: 'heart/adopt' });
    expect(
      circle(t.state, t.player()).some(
        ({ other, pair }) => pair.mine.kind === 'child' && other.flags['adopted'] === true,
      ),
    ).toBe(true);
  });

  it('what is said of the player travels, and greets them where they have never been', () => {
    const t = adult('heart-rep');
    for (let i = 0; i < 6; i++) playerDeed(t.env(`kind-${i}`), ['kind'], t.state.log.length - 1);
    const heart = t.player().character!.heart!;
    const here = t.person().place.location!.id;
    expect(heart.rep?.[here]?.['kindness']).toBeGreaterThan(10);
    for (let q = 0; q < 4; q++) {
      t.state.tick += 3 - (t.state.tick % 3) + 2;
      heartMonth(t.env(`q-${q}`));
    }
    const elsewhere = Object.keys(heart.rep ?? {}).filter((s) => s !== here && s in data.locations);
    expect(elsewhere.length).toBeGreaterThan(0);
  });

  it('a save of the shape before Phase 7 plays on: hearts are made as they are needed', () => {
    const { state } = createLife(
      data,
      {
        seed: 'heart-old',
        canonMode: 'canon',
        difficulty: 'normal',
        rareRaces: true,
        race: 'race_human',
        birthplace: 'bp_east_blue_village',
        entryYear: 20,
        entryAge: 20,
        pronouns: 'they',
      },
      { allowBlocked: true, population: 'none' },
    );
    for (const e of Object.values(state.entities)) delete e.character?.heart;
    state.flags['dev.quiet'] = true;
    advance(state, data, Rng.root('old'), { kind: 'months', count: 2 }, 'auto-random');
    expect(state.entities[state.playerId!]!.character!.heart).toBeDefined();
    void applyAction;
  });
});
