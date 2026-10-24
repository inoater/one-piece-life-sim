import type {
  FruitDef,
  GameData,
  PowerRules,
  Rarity,
  TechniqueDef,
  TechForm,
} from '../../engine/data/schemas';
import { FruitDefSchema, RARITIES } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { Entity } from '../../engine/state';

/**
 * The fruit catalogue (Phase 4): canon fruits from data/fruits, and a generator for new ones.
 *
 * A generated fruit (Random mode, a stranger's power, the variety of a long world) is built from a
 * power primitive in data/powers.json ("chime", "rot", "swap"), or an animal or element no canon
 * fruit uses, with a doubled name ("Chime-Chime Fruit"), a type, a weakness and six to ten
 * techniques named by a grammar. It never takes a canon power: its primitive is never the main
 * primitive (the first) of a canon fruit, and its power key never equals a canon one.
 */

export function fruitDefOf(data: GameData, fruit: Entity | undefined): FruitDef | undefined {
  const f = fruit?.fruit;
  if (!f) return undefined;
  return f.def ?? data.fruits[f.defId];
}

interface CanonIndex {
  powers: Set<string>;
  names: Set<string>;
  /** The doubled words of canon names: "gum" (Gum-Gum Fruit). */
  words: Set<string>;
  animals: Set<string>;
}

const indexes = new WeakMap<GameData, CanonIndex>();

/** What canon has taken: power keys, names, main primitives and Zoan animals. */
export function canonIndex(data: GameData): CanonIndex {
  const cached = indexes.get(data);
  if (cached) return cached;
  const index: CanonIndex = {
    powers: new Set(),
    names: new Set(),
    words: new Set(),
    animals: new Set(),
  };
  for (const fruit of Object.values(data.fruits)) {
    index.powers.add(fruit.power);
    index.names.add(fruit.name.toLowerCase());
    const word = fruit.name.split(/[- ]/)[0];
    if (word) index.words.add(word.toLowerCase());
    if (fruit.type === 'zoan') {
      const animal = fruit.power.split(':').pop();
      if (animal) index.animals.add(animal);
    }
  }
  indexes.set(data, index);
  return index;
}

/**
 * The concepts a generated fruit may be built on: data/powers.json's generator concepts, minus any
 * whose word a canon fruit's name already uses ("Gum" from the Gum-Gum Fruit).
 */
export function generatorPrimitives(
  data: GameData,
  type: 'paramecia' | 'logia',
): PowerRules['generator']['concepts'] {
  const { words } = canonIndex(data);
  return data.powers.generator.concepts.filter(
    (p) => p.type === type && !words.has(p.word.toLowerCase()),
  );
}

export function fruitLook(data: GameData, rng: Rng): string {
  const { colours, shapes } = data.powers.generator.looks;
  return `a ${rng.fork('colour').pick(colours)} fruit ${rng.fork('shape').pick(shapes)}, its skin covered in swirls`;
}

const FALLBACK_NOUNS: Record<TechForm, string[]> = {
  strike: ['Strike'],
  barrage: ['Barrage'],
  projectile: ['Shot'],
  area: ['Burst'],
  counter: ['Counter'],
  movement: ['Step'],
  boost: ['Form'],
  grapple: ['Grip'],
  guard: ['Wall'],
  support: ['Blessing'],
};

/** Name a technique with a culture's grammar: "Chime Hammer", "Great Rot Wave". */
export function techniqueName(
  data: GameData,
  rng: Rng,
  culture: string,
  word: string,
  form: TechForm,
  used: Set<string>,
): string {
  const grammars = data.powers.generator.grammars;
  const g = grammars[culture] ?? grammars['default'];
  if (!g) return `${word} ${FALLBACK_NOUNS[form][0]}`;
  for (let i = 0; i < 12; i++) {
    const r = rng.fork('name', i);
    const pattern = r.fork('pattern').pick(g.patterns);
    const nouns = g.nouns[form] ?? grammars['default']?.nouns[form] ?? FALLBACK_NOUNS[form];
    const name = pattern
      .replace('{word}', word)
      .replace('{noun}', r.fork('noun').pick(nouns))
      .replace('{adjective}', r.fork('adj').pick(g.adjectives));
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const name = `${word} ${FALLBACK_NOUNS[form][0]} ${used.size + 1}`;
  used.add(name);
  return name;
}

function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const ZOAN_BOOSTS: Record<
  string,
  { stat: 'strength' | 'durability' | 'endurance' | 'speed'; pct: number }[]
> = {
  regular: [
    { stat: 'strength', pct: 10 },
    { stat: 'endurance', pct: 10 },
    { stat: 'durability', pct: 8 },
  ],
  ancient: [
    { stat: 'strength', pct: 14 },
    { stat: 'endurance', pct: 12 },
    { stat: 'durability', pct: 22 },
  ],
  mythical: [
    { stat: 'strength', pct: 14 },
    { stat: 'endurance', pct: 14 },
    { stat: 'durability', pct: 14 },
    { stat: 'speed', pct: 8 },
  ],
  artificial: [
    { stat: 'strength', pct: 8 },
    { stat: 'durability', pct: 6 },
  ],
};

const WEAKNESS_TEXT: Record<string, string> = {
  haki: 'Haki strikes it as if it were not there.',
  water: 'Water ruins the power.',
  cold: 'Cold slows the power to nothing.',
  heat: 'Great heat breaks it down.',
  fire: 'Fire undoes it.',
  lightning: 'Lightning runs straight through it.',
  blunt: 'A hard enough blow shatters it.',
  slash: 'A clean cut parts it.',
  poison: 'Poison spreads through it.',
  sound: 'Loud sound shakes it apart.',
  light: 'Bright light weakens it.',
  magma: 'Magma burns through it.',
  wind: 'Strong wind scatters it.',
  salt: 'Salt dries it out.',
  fatigue: 'It drains the user fast.',
  distance: 'It weakens with distance.',
  concentration: 'It fails when the user loses focus.',
};

export interface GeneratedFruitInput {
  id: string;
  /** Power keys already in this world (one fruit, one world). */
  taken: Set<string>;
  /** Whose naming grammar the techniques follow. */
  culture?: string;
  rarity?: Rarity;
}

/** Build a new fruit. Never a canon power, never one already taken in this world. */
export function generateFruit(data: GameData, rng: Rng, input: GeneratedFruitInput): FruitDef {
  const gen = data.powers.generator;
  const { powers: canonPowers, names: canonNames, animals: canonAnimals } = canonIndex(data);
  const types = (['paramecia', 'zoan', 'logia'] as const).filter(
    (t) => (gen.typeWeights[t] ?? 0) > 0,
  );
  let type = rng.fork('type').weightedPick(types, (t) => gen.typeWeights[t] ?? 0) ?? 'paramecia';
  const free = (key: string) => !canonPowers.has(key) && !input.taken.has(key);

  let word = '';
  let power = '';
  let primitives: string[] = [];
  let gist = '';
  let zoan: FruitDef['zoan'];
  let model: string | undefined;
  let tags: TechniqueDef['tags'] = ['body'];
  let forms: TechForm[] = ['strike'];
  let effects: TechniqueDef['effects'] = [];
  let weakness: FruitDef['weaknesses'][number]['against'] | undefined;

  const pickPrimitive = (t: 'paramecia' | 'logia') => {
    const pool = generatorPrimitives(data, t).filter((p) => free(`gen:${t}:${p.id}`));
    return pool.length > 0 ? rng.fork('primitive', t).pick(pool) : undefined;
  };

  if (type === 'zoan') {
    const animals = gen.animals.filter(
      (a) => !canonAnimals.has(slugOf(a.animal)) && free(`gen:zoan:${slugOf(a.animal)}`),
    );
    const animal = animals.length > 0 ? rng.fork('animal').pick(animals) : undefined;
    if (animal) {
      word = animal.word;
      zoan = animal.kind;
      model =
        animal.kind === 'regular' || animal.kind === 'artificial'
          ? undefined
          : `Model: ${animal.animal.replace(/^\w/, (s) => s.toUpperCase())}`;
      power = `gen:zoan:${slugOf(animal.animal)}`;
      primitives = ['beast'];
      gist = `can become a ${animal.animal}, or a hybrid of human and ${animal.animal}`;
      tags = ['beast', 'body'];
      forms = ['strike', 'barrage', 'grapple', 'movement', 'boost', 'guard'];
      effects = ['knockback'];
    } else {
      type = 'paramecia';
    }
  }
  if (type === 'logia' || type === 'paramecia') {
    let prim = pickPrimitive(type);
    if (!prim && type === 'logia') {
      type = 'paramecia';
      prim = pickPrimitive('paramecia');
    }
    if (prim) {
      word = prim.word;
      power = `gen:${type}:${prim.id}`;
      primitives = [prim.id];
      gist = prim.gist;
      tags = [...prim.tags];
      forms = [...prim.forms];
      effects = [...prim.effects];
      weakness = prim.weakness;
    } else {
      // Every single primitive is taken in this world: fuse two (still never a canon power).
      const pool = generatorPrimitives(data, 'paramecia');
      const a = rng.fork('fuse', 'a').pick(pool);
      const b = rng.fork('fuse', 'b').pick(pool.filter((p) => p.id !== a.id));
      for (let i = 0; !free(power) || power === ''; i++) {
        power = `gen:paramecia:${a.id}_${b.id}${i > 0 ? `_${i}` : ''}`;
      }
      word = `${a.word}-${b.word}`;
      primitives = [a.id, b.id];
      gist = `${a.gist}, and ${b.gist}`;
      tags = [...new Set([...a.tags, ...b.tags])];
      forms = [...new Set([...a.forms, ...b.forms])];
      effects = [...new Set([...a.effects, ...b.effects])];
      weakness = a.weakness ?? b.weakness;
      type = 'paramecia';
    }
  }

  let name = word.includes('-') ? `${word} Fruit` : `${word}-${word} Fruit`;
  if (canonNames.has(name.toLowerCase())) name = `${word}-${word}-${word} Fruit`;
  const rarity =
    input.rarity ??
    (zoan === 'mythical'
      ? 'legendary'
      : type === 'logia'
        ? 'rare'
        : (rng.fork('rarity').weightedPick([...RARITIES], (r) => gen.rarityWeights[r] ?? 0) ??
          'common'));

  const used = new Set<string>();
  const count = rng.fork('count').int(gen.techniques.min, gen.techniques.max);
  const techniques: TechniqueDef[] = [];
  const base = slugOf(name.replace(/ Fruit$/, '')).replace(/_/g, '');
  for (let i = 0; i < count; i++) {
    const r = rng.fork('tech', i);
    const form = i < forms.length ? (forms[i] as TechForm) : r.fork('form').pick(forms);
    const techName = techniqueName(
      data,
      r,
      input.culture ?? 'default',
      word.split('-')[0] ?? word,
      form,
      used,
    );
    const mastery = Math.round((i / Math.max(1, count - 1)) * 85);
    const tech: TechniqueDef = {
      id: `tech_${input.id.replace(/^[a-z]+_/, '')}_${base}_${i + 1}`,
      name: techName,
      form,
      tags: tags.length > 0 ? [...tags.slice(0, 3)] : ['body'],
      mastery,
      stats: {},
      effects: i > 0 && effects.length > 0 ? [r.fork('effect').pick(effects)] : [],
      finisher: i === count - 1,
      named: false,
    };
    techniques.push(tech);
  }

  const def: FruitDef = {
    id: input.id,
    name,
    type,
    rarity,
    power,
    primitives,
    description: `The user ${gist}.`,
    look: fruitLook(data, rng.fork('look')),
    weaknesses: weakness
      ? [{ against: weakness, text: WEAKNESS_TEXT[weakness] ?? 'It has a weakness.' }]
      : [],
    boosts: zoan ? (ZOAN_BOOSTS[zoan] ?? []).map((b) => ({ ...b })) : [],
    intangible: type === 'logia',
    techniques,
    holders: [],
    origin: 'generated',
    approx: false,
    ...(zoan ? { zoan } : {}),
    ...(model ? { model } : {}),
  };
  input.taken.add(power);
  // A generated fruit is checked against the same schema as a data file (the Done-when test).
  return FruitDefSchema.parse(def);
}
