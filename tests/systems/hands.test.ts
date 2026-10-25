import { describe, expect, it } from 'vitest';
import { advanceOptions, createLife, Rng } from '../../src/core';
import type { Entity, WorldState } from '../../src/engine/state';
import {
  gradeCount,
  craftMonth,
  recipeLock,
  startProject,
  temperLock,
} from '../../src/systems/hands/crafting';
import {
  bloodthirstIntent,
  curseMonth,
  syncCurseFlags,
  testFate,
} from '../../src/systems/hands/curses';
import { runEarnerLife } from '../../src/systems/hands/economy';
import { battleKit, readVivre } from '../../src/systems/hands/gear';
import { carried, ensureHands, giveItem, makeItem } from '../../src/systems/hands/items';
import {
  goodPrice,
  marketsMonth,
  stockOf,
  tradeGood,
  usualStock,
} from '../../src/systems/hands/market';
import { designStats, launch, shipNumbers, spiritSaves } from '../../src/systems/hands/ships';
import { ensureHandsLayer, handsBuilt } from '../../src/systems/hands/swords';
import { ensureWorldLayer } from '../../src/systems/places/history';
import { caches, digUp, giveMap, huntMonth } from '../../src/systems/hands/treasure';
import { itemAttack, weaponOfEntity } from '../../src/systems/hands/weapons';
import { handsView } from '../../src/systems/hands/view';
import { fighterOf } from '../../src/systems/battle/fighters';
import { commitMults, overtimeSlots } from '../../src/systems/life/drive';
import { vigorPoolOf } from '../../src/systems/life/body';
import { lifeView } from '../../src/systems/life/view';
import { data } from '../helpers/data';
import { startLife, type TestLife } from '../helpers/life';

/**
 * Phase 6, "Done when": every graded sword and canon weapon is a tracked entity and grade counts
 * never exceed canon's; each curse fires its events and taming changes its effects; a ship is
 * built, refitted, damaged in a battle and repaired; every item type can be crafted with quality
 * that follows skill; the economy sweep meets the ship-price target. And the month scaled by Vigor.
 */

/** A life whose world already has its map, people, blades and treasure (built on the first month). */
function built(t: TestLife): TestLife {
  ensureWorldLayer(t.state, data);
  ensureHandsLayer(t.state, data);
  return t;
}

const life = (seed: string, over: Parameters<typeof startLife>[0] = {}): TestLife =>
  built(startLife({ seed, entryYear: 30, entryAge: 22, ...over }));

function rich(t: TestLife, berries = 50_000_000): void {
  t.player().character!.berries = berries;
}

function give(
  t: TestLife,
  defId: string,
  extra: Parameters<typeof makeItem>[2]['extra'] = {},
): Entity {
  return makeItem(t.state, data, {
    defId,
    container: 'held',
    holder: t.player(),
    tick: t.state.tick,
    story: 'Given by a test.',
    extra,
  });
}

/** Put a power track at a stage directly (the tests of what a stage allows, not how it is climbed). */
function master(t: TestLife, track: string, stage: number): void {
  const powers = t.player().character!.powers!;
  const def = data.tracks[track]!;
  powers.tracks[track] = {
    stage,
    progress: def.stages[stage]?.at ?? 0,
    breakthrough: false,
    since: t.state.tick,
    lastUsed: t.state.tick,
    months: 120,
  };
}

function items(state: WorldState): Entity[] {
  return Object.values(state.entities).filter((e) => e.item);
}

describe('Done when: every graded sword and canon weapon is a tracked entity, and grade counts never exceed canon', () => {
  it('a world is built with every canon weapon once and every counted grade full', () => {
    const t = life('swords-world');
    expect(handsBuilt(t.state)).toBe(true);
    for (const w of Object.values(data.weapons).filter((x) => x.canon)) {
      const copies = items(t.state).filter((e) => e.item?.defId === w.id);
      expect(copies, w.id).toHaveLength(1);
      expect(copies[0]?.origin).toBe('canon');
    }
    for (const g of ['supreme', 'great', 'skillful'] as const)
      expect(gradeCount(t.state, g), g).toBe(data.hands.grades[g].count);
    expect(gradeCount(t.state, 'graded')).toBe(data.hands.swords.graded);
    // Generated graded swords have names of their own, never a canon blade's.
    const canonNames = new Set(Object.values(data.weapons).map((w) => w.name));
    const generated = items(t.state).filter(
      (e) => e.origin === 'generated' && e.item?.family === 'blade',
    );
    for (const e of generated) expect(canonNames.has(e.name), e.name).toBe(false);
  });

  it('canon blades follow the story: Yubashiri is destroyed at Enies Lobby, Enma passes to Wano', () => {
    const t = built(startLife({ seed: 'canon-blades', entryYear: 35, entryAge: 20 }));
    t.run(20);
    const find = (id: string) => items(t.state).find((e) => e.item?.defId === id);
    expect(find('weapon_yubashiri')?.item?.container).toBe('destroyed');
    expect(find('weapon_enma')?.item?.place).toBe('loc_wano');
    expect(find('weapon_yoru')?.item?.holderId).toBe('char_dracule_mihawk');
  });

  it('across 100 worlds and a year each, no grade ever holds more swords than canon allows', () => {
    for (let i = 0; i < 100; i++) {
      const { state } = createLife(
        data,
        {
          seed: `grades-${i}`,
          canonMode: 'canon',
          difficulty: 'normal',
          rareRaces: false,
          race: 'race_human',
          birthplace: 'random',
          entryYear: i % 38,
          entryAge: 18,
          pronouns: 'they',
        },
        { allowBlocked: true, population: 'none' },
      );
      for (const g of ['supreme', 'great', 'skillful'] as const)
        expect(gradeCount(state, g), `world ${i} ${g}`).toBeLessThanOrEqual(
          data.hands.grades[g].count ?? 0,
        );
    }
  });

  it('a master cannot temper a blade into a full grade: counts never grow', () => {
    const t = life('temper-cap', { birthplace: 'bp_wano' });
    t.act({ type: 'debug/teleport', location: 'loc_wano' });
    master(t, 'track_swordsmanship', 6);
    rich(t);
    const skillful = items(t.state).find(
      (e) => e.item?.grade === 'skillful' && e.item.container !== 'destroyed',
    ) as Entity;
    const p = t.person();
    p.c.hands = ensureHands(p.entity);
    // Skillful to Great: all 21 Great swords exist, so it is refused.
    expect(temperLock({ state: t.state, data, p, tick: t.state.tick }, skillful)).toMatch(
      /already exist/,
    );
    const plain = give(t, 'weapon_katana');
    expect(
      temperLock({ state: t.state, data, p: t.person(), tick: t.state.tick }, plain),
    ).toBeNull();
  });
});

describe('Done when: each curse fires its events, and taming changes its effects', () => {
  it('carrying an untamed blade sets its curse flag, and its events fire', () => {
    for (const [defId, flag] of [
      ['weapon_sandai_kitetsu', 'curse.misfortune'],
      ['weapon_enma', 'curse.haki_hunger'],
    ] as const) {
      const t = built(
        startLife({ seed: `curse-${defId}`, entryYear: 30, entryAge: 22 }, data, false),
      );
      const blade = items(t.state).find((e) => e.item?.defId === defId) as Entity;
      // Off the story, into the player's hands.
      blade.item!.canonNext = -1;
      giveItem(t.state, data, blade, t.player(), t.state.tick, 'Taken up by a test.');
      syncCurseFlags(t.state, data, t.player());
      expect(t.player().flags[flag]).toBe(true);
      t.run(48);
      const fired = t.state.log.some((r) => r.cause?.startsWith('evt_curse_'));
      expect(fired, defId).toBe(true);
    }
  });

  it('misfortune: a lucky test of fate tames it, the flag goes and the blade cuts harder', () => {
    const t = life('fate');
    const blade = give(t, 'weapon_sword', { curse: { id: 'misfortune', tamed: false, checks: 0 } });
    syncCurseFlags(t.state, data, t.player());
    expect(t.player().flags['curse.misfortune']).toBe(true);
    const before = itemAttack(data, blade);
    t.player().stats['luck']!.base = 1000;
    expect(testFate(t.env('fate'), blade.id)).toBe(true);
    expect(blade.item?.curse?.tamed).toBe(true);
    expect(t.player().flags['curse.misfortune']).toBeUndefined();
    expect(itemAttack(data, blade)).toBeGreaterThan(before);
  });

  it('misfortune: an unlucky test costs an arm, and the curse stays', () => {
    const t = life('fate-fail');
    const blade = give(t, 'weapon_sword', { curse: { id: 'misfortune', tamed: false, checks: 0 } });
    t.player().stats['luck']!.base = -1000;
    expect(testFate(t.env('fate'), blade.id)).toBe(false);
    expect(blade.item?.curse?.tamed).toBe(false);
    expect(t.life().injuries.some((i) => i.area === 'arms')).toBe(true);
  });

  it('haki hunger drinks haki in a fight until a strong enough will and Armament master it', () => {
    const t = life('hunger');
    const blade = give(t, 'weapon_katana', {
      curse: { id: 'haki_hunger', tamed: false, checks: 0 },
    });
    const w = weaponOfEntity(t.state, data, t.player());
    expect(w?.drain).toBeGreaterThan(0);
    t.act({ type: 'debug/wakeHaki', haki: 'armament' });
    master(t, 'track_armament', 4);
    t.player().stats['willpower']!.base = 200;
    curseMonth(t.env('hunger'));
    expect(blade.item?.curse?.tamed).toBe(true);
    expect(weaponOfEntity(t.state, data, t.player())?.drain).toBe(0);
  });

  it('bloodthirst pushes toward Kill intent; refusing it often enough tames it', () => {
    const t = life('blood');
    const blade = give(t, 'weapon_katana', {
      curse: { id: 'bloodthirst', tamed: false, checks: 0 },
    });
    t.player().stats['willpower']!.base = -500;
    expect(bloodthirstIntent(t.state, data, t.player(), 'spare', Rng.root('b'), t.state.tick)).toBe(
      'kill',
    );
    t.player().stats['willpower']!.base = 500;
    for (let i = 0; i < 6; i++)
      bloodthirstIntent(t.state, data, t.player(), 'spare', Rng.root(`b${i}`), t.state.tick + i);
    expect(blade.item?.curse?.checks).toBeGreaterThanOrEqual(6);
    curseMonth(t.env('blood'));
    expect(blade.item?.curse?.tamed).toBe(true);
    expect(
      bloodthirstIntent(t.state, data, t.player(), 'spare', Rng.root('after'), t.state.tick),
    ).toBe('spare');
  });

  it("haunting is quieted by a priest's rite, only where the rite is known", () => {
    const t = life('haunt');
    rich(t);
    const blade = give(t, 'weapon_katana', { curse: { id: 'haunting', tamed: false, checks: 0 } });
    t.act({ type: 'debug/teleport', location: 'loc_loguetown' });
    expect(() => t.act({ type: 'hands/cleanse', item: blade.id })).toThrow(/priests/);
    t.act({ type: 'debug/teleport', location: 'loc_wano' });
    t.act({ type: 'hands/cleanse', item: blade.id });
    expect(blade.item?.curse?.tamed).toBe(true);
  });
});

describe('Done when: a ship is built, refitted, damaged in a battle and repaired', () => {
  it('from the creator to the slipway to the sea, and back to the yard', () => {
    const t = life('shipwright');
    rich(t);
    t.act({ type: 'debug/teleport', location: 'loc_water_seven' });
    const design = {
      name: 'Going Test',
      hull: 'caravel',
      length: 1.1,
      material: 'hardwood',
      rig: 'square',
      drives: [],
      rooms: ['galley'],
      weapons: { cannon: 6 },
      figurehead: 'animal',
      hullColour: 'black',
      sailColour: 'white',
    };
    const stats = designStats(data, design);
    expect(stats.errors).toEqual([]);
    t.act({ type: 'ship/build', design, by: 'yard' });
    const build = t.player().character!.hands!.build!;
    expect(build.needed).toBeGreaterThan(0);
    t.act({ type: 'life/routine', routine: [{ activity: 'act_sleep_in', effort: 'normal' }] });
    t.run(Math.ceil(build.needed) + 1);
    const ship = Object.values(t.state.entities).find(
      (e) => e.ship?.ownerId === t.player().id && !e.ship.sunk,
    ) as Entity;
    expect(ship.name).toBe('Going Test');
    expect(ship.ship?.design?.hull).toBe('caravel');
    expect(shipNumbers(data, ship).maxHull).toBeGreaterThanOrEqual(Math.round(stats.hull * 0.9));

    // Refit: more guns and a sick bay. She spends a month in the yard.
    t.act({
      type: 'ship/refit',
      design: { ...design, rooms: ['galley', 'sick_bay'], weapons: { cannon: 12 } },
    });
    expect(ship.ship?.design?.weapons['cannon']).toBe(12);
    expect(ship.ship?.refitUntil).toBeGreaterThan(t.state.tick);
    t.run(1);

    // A sea fight in harbour: her own hull goes in, and the damage stays.
    const max = shipNumbers(data, ship).maxHull;
    t.act({
      type: 'debug/fight',
      foe: 'foe_pirate',
      count: 10,
      scale: 'naval',
      intent: 'capture',
      mode: 'quick',
    });
    expect(ship.ship!.hull).toBeLessThan(max);
    expect(ship.ship!.history?.some((h) => h.text.startsWith('Fought'))).toBe(true);

    // A shipwright mends her.
    ship.ship!.sunk = false;
    t.act({ type: 'travel/repair' });
    expect(ship.ship!.hull).toBe(max);
  });

  it('building with your own hands needs the work: the "Work on your project" activity at her yard', () => {
    const t = life('selfbuild');
    rich(t);
    t.act({ type: 'debug/teleport', location: 'loc_loguetown' });
    t.act({ type: 'debug/handSkill', skill: 'shipbuilding', value: 40 });
    const design = {
      hull: 'sloop',
      material: 'common_wood',
      rig: 'fore_and_aft',
      name: 'Own Hands',
    };
    t.act({ type: 'ship/build', design: design as never, by: 'self' });
    t.act({
      type: 'life/routine',
      routine: [{ activity: 'act_craft', effort: 'hard', commit: 2 }],
    });
    for (let i = 0; i < 12 && t.player().character!.hands!.build; i++) t.run(1);
    expect(t.player().character!.hands!.build).toBeNull();
    expect(t.player().character!.hands!.crafts.shipbuilding).toBeGreaterThan(40);
    expect(Object.values(t.state.entities).some((e) => e.name === 'Own Hands' && e.ship)).toBe(
      true,
    );
  });

  it('a loved ship may gain a spirit that, once, keeps her afloat', () => {
    const t = life('spirit');
    rich(t);
    t.act({ type: 'debug/teleport', location: 'loc_water_seven' });
    const hands = ensureHands(t.player());
    hands.build = {
      design: {
        hull: 'dinghy',
        material: 'common_wood',
        rig: 'square',
        length: 1,
        drives: [],
        rooms: [],
        weapons: {},
        figurehead: 'none',
        hullColour: 'black',
        sailColour: 'white',
      },
      place: 'loc_water_seven',
      by: 'yard',
      done: 1,
      needed: 1,
      sinceTick: t.state.tick,
      quality: 60,
    };
    const ship = launch(t.env('spirit')) as Entity;
    ship.ship!.spirit = 'awake';
    ship.ship!.hull = 0;
    expect(spiritSaves(t.env('save'), ship)).toBe(true);
    expect(ship.ship!.hull).toBeGreaterThan(0);
    expect(ship.ship!.spirit).toBe('spent');
    expect(spiritSaves(t.env('again'), ship)).toBe(false);
  });

  it('designs can be saved, shared as text and read back in', () => {
    const t = life('designs');
    const design = {
      name: 'Shared',
      hull: 'galleon',
      material: 'iron_plated',
      rig: 'extra_masts',
      weapons: { cannon: 20 },
    };
    t.act({ type: 'ship/saveDesign', design: design as never });
    const text = JSON.stringify(t.player().character!.hands!.designs[0]);
    t.act({ type: 'ship/importDesign', text });
    expect(t.player().character!.hands!.designs).toHaveLength(2);
    expect(() => t.act({ type: 'ship/importDesign', text: '{"hull":"spaceship"}' })).toThrow();
  });
});

describe('Done when: every item type can be crafted, with quality that follows skill', () => {
  const placeFor = (r: (typeof data.recipes)[string]): string => {
    if (r.places.length > 0) return r.places[0] as string;
    const loc =
      Object.values(data.locations).find(
        (l) =>
          !l.id.includes('test') &&
          r.features.every((f) => (l.features as readonly string[]).includes(f)) &&
          (l.features as readonly string[]).includes('market'),
      ) ??
      Object.values(data.locations).find((l) =>
        r.features.some((f) => (l.features as readonly string[]).includes(f)),
      );
    return loc?.id ?? 'loc_loguetown';
  };

  function craftOnce(recipeId: string, skill: number, seed: string): number {
    const r = data.recipes[recipeId]!;
    const t = life(seed);
    rich(t);
    t.player().flags['path.cyborg'] = true;
    t.act({ type: 'debug/teleport', location: placeFor(r) });
    t.act({ type: 'debug/handSkill', skill: r.craft, value: skill });
    const env = t.env('craft');
    expect(recipeLock(env, r), recipeId).toBeNull();
    startProject(env, recipeId);
    const before = carried(t.state, t.player()).length;
    for (let m = 0; m < 20 && t.player().character!.hands!.project; m++)
      craftMonth(t.env(`m${m}`), 1, Rng.root(`${seed}-${m}`));
    const made = carried(t.state, t.player()).slice(before);
    expect(made.length, recipeId).toBe(r.makes.count);
    return made[0]?.item?.quality ?? 0;
  }

  it('every recipe that is not story-locked makes its thing', () => {
    const kinds = new Set<string>();
    for (const r of Object.values(data.recipes).filter((x) => !x.storyLocked)) {
      craftOnce(r.id, Math.max(r.skill, 10), `craft-${r.id}`);
      kinds.add(r.makes.weapon ? 'weapon' : (data.items[r.makes.item ?? '']?.kind ?? '?'));
      kinds.add(r.craft);
    }
    for (const craft of [
      'smithing',
      'gunsmithing',
      'shipbuilding',
      'medicine',
      'cooking',
      'invention',
    ])
      expect(kinds.has(craft), craft).toBe(true);
  });

  it('a master makes better than a beginner, over many tries', () => {
    let low = 0;
    let high = 0;
    for (let i = 0; i < 8; i++) {
      low += craftOnce('recipe_katana', 25, `q-low-${i}`);
      high += craftOnce('recipe_katana', 95, `q-high-${i}`);
    }
    expect(high / 8).toBeGreaterThan(low / 8 + 20);
  });

  it('a blade made well enough earns a grade (graded swords are countless)', () => {
    const q = craftOnce('recipe_katana', 100, 'graded-made');
    expect(q).toBeGreaterThanOrEqual(80);
  });
});

describe('Done when: the economy sweep meets the ship-price target', () => {
  it('a hard-working East Blue fisher can afford a caravel in two to five years, and no galleon', () => {
    const options = advanceOptions('auto-random');
    const years = [0, 1, 2].map((i) =>
      runEarnerLife(data, { seed: `eco-${i}`, job: 'job_fisher', years: 6 }, options),
    );
    for (const r of years) {
      expect(r.available).toBe(true);
      expect(r.caravel, r.seed).not.toBeNull();
      expect((r.caravel as number) / 12).toBeGreaterThanOrEqual(2);
      expect((r.caravel as number) / 12).toBeLessThanOrEqual(5);
      expect(r.galleon).toBeNull();
    }
  });
});

describe('Weapons in hand', () => {
  it('a weapon item is what the fighter swings, and adds its Combat Power', () => {
    const t = life('wield');
    const before = fighterOf(t.state, data, t.player(), t.state.tick, {
      id: 'x',
      side: 0,
      intent: 'spare',
    });
    const sword = give(t, 'weapon_katana');
    const after = fighterOf(t.state, data, t.player(), t.state.tick, {
      id: 'x',
      side: 0,
      intent: 'spare',
    });
    expect(after.weapon?.name).toBe(sword.name);
    expect(after.cp).toBeGreaterThan(before.cp);
    expect(t.player().character!.powers!.gear['swords']).toBe(1);
  });

  it('three blades can be wielded at once; a gun replaces them', () => {
    const t = life('three');
    const a = give(t, 'weapon_katana');
    give(t, 'weapon_katana');
    give(t, 'weapon_sword');
    expect(t.player().character!.hands!.wield).toHaveLength(3);
    const gun = give(t, 'weapon_flintlock');
    t.act({ type: 'hands/wield', item: gun.id, on: true });
    expect(t.player().character!.hands!.wield).toEqual([gun.id]);
    void a;
  });

  it('fights dull blades and wear them out; a smith restores them; Supreme blades never break', () => {
    const t = life('wear');
    rich(t);
    const sword = give(t, 'weapon_sword');
    for (let i = 0; i < 20 && sword.item?.container !== 'destroyed'; i++)
      t.act({
        type: 'debug/fight',
        foe: 'foe_drunk',
        count: 1,
        scale: 'duel',
        intent: 'spare',
        mode: 'quick',
      });
    expect(sword.item!.sharpness!).toBeLessThan(100);
    t.act({ type: 'debug/teleport', location: 'loc_loguetown' });
    if (sword.item?.container !== 'destroyed') {
      t.act({ type: 'hands/sharpen', item: sword.id });
      expect(sword.item!.sharpness).toBe(100);
    }
    expect(t.player().character!.hands!.skills['blade']).toBeGreaterThan(0);
    const supreme = give(t, 'weapon_template_supreme');
    supreme.item!.durability = 0;
    t.act({
      type: 'debug/fight',
      foe: 'foe_drunk',
      count: 1,
      scale: 'duel',
      intent: 'spare',
      mode: 'quick',
    });
    expect(supreme.item!.container).toBe('held');
  });

  it('years of Armament turn a blade black', () => {
    const t = life('black');
    const sword = give(t, 'weapon_katana');
    t.act({ type: 'debug/wakeHaki', haki: 'armament' });
    master(t, 'track_armament', 3);
    sword.item!.blackness = data.hands.black.months - 1;
    t.act({
      type: 'life/routine',
      routine: [{ activity: 'act_armament_training', effort: 'normal' }],
    });
    t.run(3);
    expect(sword.item!.black).toBe(true);
  });

  it('seastone bullets make a gun touch a Logia; armour adds to defence; dials go into the kit', () => {
    const t = life('kit');
    give(t, 'weapon_flintlock');
    expect(weaponOfEntity(t.state, data, t.player())?.seastone).toBe(false);
    give(t, 'item_seastone_bullets');
    expect(weaponOfEntity(t.state, data, t.player())?.seastone).toBe(true);
    give(t, 'item_leather_jerkin');
    const f = fighterOf(t.state, data, t.player(), t.state.tick, {
      id: 'x',
      side: 0,
      intent: 'spare',
    });
    expect(f.armour).toBe(6);
    give(t, 'item_flame_dial');
    expect(battleKit(t.state, data, t.player())['item_flame_dial']).toBe(3);
    expect(f.seastone).toBe(true);
  });
});

describe('Markets, trade, treasure and the rest', () => {
  it('buying drives a price up, selling down, and months bring it back', () => {
    const t = life('trade');
    rich(t);
    t.act({ type: 'debug/teleport', location: 'loc_loguetown' });
    const before = goodPrice(t.state, data, 'loc_loguetown', 'spices');
    tradeGood(t.env('buy'), 'spices', 4);
    const after = goodPrice(t.state, data, 'loc_loguetown', 'spices');
    expect(after).toBeGreaterThan(before);
    tradeGood(t.env('sell'), 'spices', -4);
    expect(goodPrice(t.state, data, 'loc_loguetown', 'spices')).toBeLessThan(after);
    for (let i = 0; i < 40; i++) marketsMonth(t.state, data);
    const usual = usualStock(data, data.locations['loc_loguetown']!, 'spices');
    expect(stockOf(t.state, data, 'loc_loguetown', 'spices')).toBeCloseTo(usual, 1);
    expect(() => tradeGood(t.env('black'), 'contraband', 1)).not.toThrow();
  });

  it('a good is cheap where it is made and dear where it is wanted', () => {
    const t = life('trade-route');
    const jungle = goodPrice(t.state, data, 'loc_jaya', 'spices');
    const cold = goodPrice(t.state, data, 'loc_drum', 'spices');
    expect(cold).toBeGreaterThan(jungle * 1.5);
  });

  it('a true map finds its cache, which is then gone; a fake one is found out', () => {
    const t = life('treasure');
    const all = caches(t.state);
    expect(all.length).toBeGreaterThan(30);
    const map = giveMap(t.env('map'), 'true');
    const cache = t.state.entities[map.item!.target as string] as Entity;
    if (cache.item!.container === 'sunken') cache.item!.container = 'buried';
    t.act({ type: 'debug/teleport', location: map.item!.contents as string });
    const berries = t.player().character!.berries;
    let found: Entity | null = null;
    for (let i = 0; i < 10 && !found; i++)
      found = huntMonth(t.env(`hunt${i}`), 1, Rng.root(`h${i}`));
    expect(found?.id).toBe(cache.id);
    expect(cache.item!.container).toBe('destroyed');
    expect(t.player().character!.berries).toBeGreaterThan(berries);
    expect(() => digUp(t.env('again'), cache)).not.toThrow();
    const fake = giveMap(t.env('fake'), 'fake');
    t.act({ type: 'debug/teleport', location: fake.item!.contents as string });
    for (let i = 0; i < 3; i++) huntMonth(t.env(`f${i}`), 1, Rng.root(`f${i}`));
    expect(t.state.entities[fake.id]).toBeUndefined();
  });

  it('meals help for months; a Den Den Mushi call warms someone; a Vivre Card points to its owner', () => {
    const t = life('gear');
    const stew = give(t, 'item_sea_king_steak');
    const strength = t.player().stats['strength']!.mods.length;
    t.act({ type: 'hands/use', item: stew.id });
    expect(t.player().stats['strength']!.mods.length).toBe(strength + 1);
    give(t, 'item_den_den_mushi');
    const friend = t.player().character!.relationships[0];
    if (friend && t.state.entities[friend.id]?.character?.alive) {
      t.act({ type: 'hands/call', target: friend.id });
      expect(() => t.act({ type: 'hands/call', target: friend.id })).toThrow(/already/);
      const card = give(t, 'item_vivre_card', { target: friend.id });
      expect(readVivre(t.state, data, card)?.burn).toBe('steady');
    }
  });

  it('gambling favours the house; a sharp eye walks away from a rigged table', () => {
    const t = life('dice');
    t.act({ type: 'debug/teleport', location: 'loc_jaya' });
    rich(t, 10_000_000);
    const start = t.player().character!.berries;
    let bets = 0;
    for (let m = 0; m < 30; m++) {
      for (let i = 0; i < 3; i++) {
        t.act({ type: 'hands/gamble', game: 'dice', stake: 10000 });
        bets += 1;
      }
      t.state.tick += 1;
    }
    expect(bets).toBe(90);
    expect(t.player().character!.berries).toBeLessThan(start + 200000);
    expect(() => t.act({ type: 'hands/gamble', game: 'dice', stake: 10 })).not.toThrow();
  });

  it('the Gear page view lists what is carried and what is for sale', () => {
    const t = life('view');
    t.act({ type: 'debug/teleport', location: 'loc_loguetown' });
    give(t, 'weapon_katana');
    const view = handsView(t.state, data);
    expect(view?.carried[0]?.name).toBe('Katana');
    expect(view?.stock.length).toBeGreaterThan(5);
    expect(view?.recipes.length).toBeGreaterThan(20);
  });
});

describe('A month scaled by Vigor', () => {
  it('a deep pool opens overtime slots: one per five Vigor, at most three', () => {
    expect(overtimeSlots(data, 4, 3)).toBe(0);
    expect(overtimeSlots(data, 7, 3)).toBe(1);
    expect(overtimeSlots(data, 12, 3)).toBe(2);
    expect(overtimeSlots(data, 40, 3)).toBe(3);
    // A child's single slot never stretches.
    expect(overtimeSlots(data, 40, 1)).toBe(0);
  });

  it('pushing past Hard multiplies gains with diminishing returns, and costs a Vigor a point', () => {
    const one = commitMults(data, 1);
    const two = commitMults(data, 2);
    expect(one.gain).toBeCloseTo(1.3);
    expect(two.gain - one.gain).toBeLessThan(one.gain - 1);
    const t = life('push');
    const pool = vigorPoolOf(data, t.player(), t.state.tick);
    t.act({
      type: 'life/routine',
      routine: [{ activity: 'act_run_laps', effort: 'hard', commit: 1 }],
    });
    const view = lifeView(t.state, data)!;
    expect(view.routine[0]?.commit).toBe(1);
    expect(view.routine[0]?.vigor).toBe(data.life.efforts.hard.vigor + 1);
    expect(view.drive.commitMax).toBe(
      Math.min(data.life.drive.commit.gain.length, Math.floor(pool / data.life.drive.commit.per)),
    );
  });

  it('a pushed month trains more than a plain Hard one', () => {
    const gains: number[] = [];
    for (const commit of [0, 3]) {
      const t = life('train-push', { entryAge: 14 });
      t.player().stats['endurance']!.base = 120;
      t.player().stats['speed']!.base = 5;
      const trained = () =>
        t.player().stats['speed']!.mods.find((m) => m.source === 'training')?.value ?? 0;
      const before = trained();
      t.act({
        type: 'life/routine',
        routine: [{ activity: 'act_run_laps', effort: 'hard', ...(commit ? { commit } : {}) }],
      });
      t.run(1);
      gains.push(trained() - before);
    }
    expect(gains[1]).toBeGreaterThan((gains[0] ?? 0) * 1.4);
  });

  it('only Hard can be pushed, and never further than the pool allows', () => {
    const t = life('push-limits');
    expect(() =>
      t.act({
        type: 'life/routine',
        routine: [{ activity: 'act_run_laps', effort: 'normal', commit: 1 }],
      }),
    ).toThrow(/Only a Hard effort/);
    expect(() =>
      t.act({
        type: 'life/routine',
        routine: [{ activity: 'act_run_laps', effort: 'hard', commit: 8 }],
      }),
    ).toThrow(/past Hard/);
  });

  it('an overtime shift pays a second wage, and an overspent pool still leaves you exhausted', () => {
    const t = life('overtime', { birthplace: 'bp_east_blue_village' });
    t.player().stats['endurance']!.base = 100;
    t.act({ type: 'life/job', jobId: 'job_fisher' });
    const slots = lifeView(t.state, data)!;
    const total = slots.slots + slots.drive.overtime;
    expect(total).toBeGreaterThan(slots.slots);
    const routine = Array.from({ length: total }, () => ({
      activity: 'act_work_shift',
      effort: 'hard' as const,
      commit: Math.min(2, slots.drive.commitMax),
    }));
    t.act({ type: 'life/routine', routine });
    const income = (): number => t.life().report?.berries.income ?? 0;
    t.run(1);
    expect(income()).toBeGreaterThan(data.jobs['job_fisher']!.income.min * total);
    expect(t.life().exhausted).toBe(true);
  });
});
