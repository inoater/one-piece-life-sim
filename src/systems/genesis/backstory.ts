import { dateOf, formatDate } from '../../engine/calendar';
import type { BackstoryEvent, GameData } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { Entity, RelationKind } from '../../engine/state';
import { addMod } from '../../engine/stats';
import { renderTemplate } from '../../engine/template';
import {
  characterOf,
  entityOf,
  giveTrait,
  potentialOf,
  roundTo,
  train,
  wealthRankOf,
  type GenesisCtx,
  type StoryItem,
} from './context';
import { meetSomeone, parentTitle, siblingTitle } from './family';
import { sortedValues } from './options';
import { capitalize, continueSentence, numberWords, ordinalWords } from './text';

/**
 * Backstory events: the 0-3 things that happen in each year lived before the story starts.
 *
 * Candidates are filtered by their conditions, then weighted. A weight is the event's own, times a
 * multiplier for each of its tags from the birthplace, the family legacy, the backstory focus, the
 * character's traits and their place in the family, and (for "hardship") the difficulty and how
 * safe the birthplace is. So a fisher family's child on the East Blue mostly gets sea stories, and
 * a hard difficulty makes for harder pasts.
 */

const PRESENT_PARENT = (e: Entity) => characterOf(e).alive && e.flags['absent'] !== true;

/** The parent an event is about: the legacy's parent for legacy events, else one at home. */
function parentFor(ctx: GenesisCtx, event: BackstoryEvent, rng: Rng): Entity | undefined {
  if (event.conditions.legacies.length > 0 && ctx.legacyParentId) {
    const carrier = entityOf(ctx, ctx.legacyParentId);
    return characterOf(carrier).alive ? carrier : undefined;
  }
  const home = ctx.parentIds.map((id) => entityOf(ctx, id)).filter(PRESENT_PARENT);
  return home.length === 0 ? undefined : rng.pick(home);
}

function siblingsBorn(ctx: GenesisCtx, tick: number): Entity[] {
  return ctx.siblingIds
    .map((id) => entityOf(ctx, id))
    .filter((e) => characterOf(e).alive && characterOf(e).birthTick <= tick);
}

function livingRelation(ctx: GenesisCtx, kind: RelationKind): Entity | undefined {
  for (let i = ctx.pc.relationships.length - 1; i >= 0; i--) {
    const rel = ctx.pc.relationships[i];
    if (!rel || rel.kind !== kind) continue;
    const other = ctx.state.entities[rel.id];
    if (other && characterOf(other).alive) return other;
  }
  return undefined;
}

export function eligible(
  ctx: GenesisCtx,
  event: BackstoryEvent,
  age: number,
  humanAge: number,
  tick: number,
): boolean {
  const c = event.conditions;
  if (humanAge < event.ages.min || humanAge >= event.ages.max + 1) return false;
  const last = ctx.happened.get(event.id);
  if (last !== undefined && (event.once || age - last < Math.max(1, event.cooldownYears)))
    return false;
  if (c.races.length > 0 && !c.races.includes(ctx.race.id)) return false;
  if (c.notRaces.includes(ctx.race.id)) return false;
  if (c.birthplaces.length > 0 && !c.birthplaces.includes(ctx.birthplace.id)) return false;
  if (c.regions.length > 0 && !c.regions.includes(ctx.birthplace.region)) return false;
  if (c.legacies.length > 0 && !c.legacies.includes(ctx.legacy.id)) return false;
  if (c.foci.length > 0 && (ctx.focus === null || !c.foci.includes(ctx.focus.id))) return false;
  if (c.wealthMin !== undefined && ctx.wealthRank < wealthRankOf(ctx.data, c.wealthMin))
    return false;
  if (c.wealthMax !== undefined && ctx.wealthRank > wealthRankOf(ctx.data, c.wealthMax))
    return false;
  if (c.traits.some((t) => !ctx.pc.traits.includes(t))) return false;
  if (c.notTraits.some((t) => ctx.pc.traits.includes(t))) return false;
  for (const [flag, value] of Object.entries(c.flags))
    if (ctx.player.flags[flag] !== value) return false;
  if (c.notFlags.some((flag) => flag in ctx.player.flags)) return false;
  if (c.birthOrders.length > 0 && !c.birthOrders.includes(ctx.birthOrder)) return false;
  if (c.hasSibling === true && siblingsBorn(ctx, tick).length === 0) return false;
  if (c.hasSibling === false && siblingsBorn(ctx, tick).length > 0) return false;
  if (c.hasRelation !== undefined && !livingRelation(ctx, c.hasRelation)) return false;
  if (c.parentAlive !== undefined) {
    const alive =
      c.legacies.length > 0 && ctx.legacyParentId
        ? characterOf(entityOf(ctx, ctx.legacyParentId)).alive
        : ctx.parentIds.some((id) => PRESENT_PARENT(entityOf(ctx, id)));
    if (alive !== c.parentAlive) return false;
  }
  const meets = event.effects.some((e) => e.kind === 'relationship');
  if (meets && ctx.relationshipsMade >= ctx.data.creation.maxRelationships) return false;
  return true;
}

export function eventWeight(ctx: GenesisCtx, event: BackstoryEvent): number {
  const { data, birthplace, legacy, focus, difficulty } = ctx;
  const order = data.creation.birthOrder[ctx.birthOrder];
  let weight = event.weight;
  for (const tag of event.tags) {
    weight *= birthplace.eventTags[tag] ?? 1;
    weight *= legacy.eventTags[tag] ?? 1;
    if (focus) weight *= focus.eventTags[tag] ?? 1;
    weight *= order?.eventTags[tag] ?? 1;
    for (const id of ctx.pc.traits) weight *= data.traits[id]?.eventWeights[tag] ?? 1;
    if (tag === 'hardship') {
      weight *= difficulty.hardshipMult * data.creation.safetyHardship[birthplace.safety];
    }
  }
  return weight;
}

export function pickEvent(
  ctx: GenesisCtx,
  rng: Rng,
  age: number,
  humanAge: number,
  tick: number,
): BackstoryEvent | undefined {
  const candidates = sortedValues(ctx.data.backstory).filter((e) =>
    eligible(ctx, e, age, humanAge, tick),
  );
  return rng.weightedPick(candidates, (e) => eventWeight(ctx, e));
}

/** Apply an event's effects and write it down. */
export function applyEvent(
  ctx: GenesisCtx,
  event: BackstoryEvent,
  rng: Rng,
  tick: number,
  age: number,
  humanAge: number,
): StoryItem {
  ctx.happened.set(event.id, age);
  const parent = parentFor(ctx, event, rng.fork('parent'));
  const siblings = siblingsBorn(ctx, tick);
  const sibling = siblings.length === 0 ? undefined : rng.fork('sibling').pick(siblings);
  let other: Entity | undefined;
  const statIds = [...ctx.data.character.physical, ...ctx.data.character.mental];

  event.effects.forEach((effect, i) => {
    const effectRng = rng.fork('effect', i);
    switch (effect.kind) {
      case 'train':
        for (const [stat, points] of Object.entries(effect.stats))
          train(ctx, stat, points ?? 0, tick);
        break;
      case 'mod': {
        const stat = ctx.player.stats[effect.stat];
        if (stat) addMod(stat, { source: effect.source, value: effect.value, kind: effect.mod });
        break;
      }
      case 'trait':
        giveTrait(ctx, effect.trait, tick);
        break;
      case 'scar':
        ctx.pc.scars.push({ area: effect.area, text: effect.text, tick });
        break;
      case 'berries':
        ctx.berries += effectRng.int(effect.min, effect.max);
        break;
      case 'relationship':
        other = meetSomeone(
          ctx,
          effectRng,
          effect.role,
          effect.opinion,
          effect.ageOffset,
          effect.occupation,
          tick,
          humanAge,
        );
        ctx.relationshipsMade += 1;
        break;
      case 'parentDies':
        if (parent) {
          const pc = characterOf(parent);
          pc.alive = false;
          pc.death = { tick, cause: effect.cause };
        }
        break;
      case 'relationDies': {
        other = livingRelation(ctx, effect.role);
        if (other) {
          const oc = characterOf(other);
          oc.alive = false;
          oc.death = { tick, cause: effect.cause };
        }
        break;
      }
      case 'flag':
        ctx.player.flags[effect.flag] = effect.value;
        break;
      case 'wealth': {
        const max = ctx.data.creation.wealthTiers.length - 1;
        ctx.wealthRank = Math.min(max, Math.max(0, ctx.wealthRank + effect.shift));
        break;
      }
      case 'potential': {
        const stat = effect.stat === 'random' ? effectRng.pick(statIds) : effect.stat;
        const pct = roundTo(effectRng.float(effect.min, effect.max), 1);
        if (pct > 0) {
          addMod(potentialOf(ctx, stat), {
            source: 'Breakthrough (backstory)',
            value: pct,
            kind: 'pct',
          });
        }
        break;
      }
    }
  });

  const text = renderBackstory(ctx, event.text, tick, age, {
    ...(parent ? { parent } : {}),
    ...(sibling ? { sibling } : {}),
    ...(other ? { other } : {}),
  });
  return {
    tick,
    age,
    text,
    template: event.text,
    notability: event.notability,
    kind: 'backstory',
    tags: event.tags,
    others: [parent?.id, sibling?.id, other?.id].filter((id): id is string => id !== undefined),
  };
}

export function renderBackstory(
  ctx: GenesisCtx,
  template: string,
  tick: number,
  age: number,
  people: { parent?: Entity; sibling?: Entity; other?: Entity },
): string {
  const date = dateOf(ctx.data.calendar, tick);
  return capitalize(
    renderTemplate(template, {
      age: String(age),
      home: ctx.birthplace.home,
      race: ctx.race.name,
      familyName: ctx.pc.familyName || ctx.pc.givenName,
      parent: people.parent ? parentTitle(people.parent) : 'your parent',
      parentName: people.parent?.name ?? 'your parent',
      sibling: people.sibling ? siblingTitle(ctx, people.sibling) : 'your sibling',
      other: people.other?.name ?? 'someone',
      monthName: date.monthName,
      season: date.seasonName.toLowerCase(),
    }),
  );
}

// ---- The written paragraph ------------------------------------------------------------------

function parentsClause(ctx: GenesisCtx): string {
  const { data } = ctx;
  if (ctx.legacy.guardian) return '';
  const parents = ctx.parentIds.map((id) => entityOf(ctx, id));
  const describe = (p: Entity): string => {
    const c = characterOf(p);
    const title = p.flags['family.title'];
    const job =
      typeof title === 'string'
        ? title
        : c.occupation
          ? `${/^[aeiou]/i.test(data.occupations[c.occupation]?.name ?? '') ? 'an' : 'a'} ${data.occupations[c.occupation]?.name ?? c.occupation}`
          : 'without a trade';
    return `${capitalize(parentTitle(p))}, ${c.givenName}, was ${job}.`;
  };
  return parents.map(describe).join(' ');
}

function birthSentence(ctx: GenesisCtx): string {
  const date = dateOf(ctx.data.calendar, ctx.birthTick);
  const place = ctx.birthplace.bornIn;
  const children = ctx.siblingIds.length + 1 + (ctx.pc.family?.expected.length ?? 0);
  let family: string;
  if (ctx.legacy.guardian) {
    family = ', to parents nobody could name';
  } else if (children === 1) {
    family = ', an only child';
  } else {
    const position =
      ctx.siblingIds.filter((id) => characterOf(entityOf(ctx, id)).birthTick < ctx.birthTick)
        .length + 1;
    family = `, the ${ordinalWords(position)} of ${numberWords(children)} children`;
  }
  const beforeGodValley =
    date.year < 0 ? `, ${numberWords(-date.year)} years before God Valley` : '';
  return `You were born in ${date.monthName} ${date.canonYear} ${date.era}${beforeGodValley}, ${place}${family}.`;
}

/** Up to `paragraphEvents` of the most notable moments, told in order. */
function chosenMoments(ctx: GenesisCtx): StoryItem[] {
  const max = ctx.data.creation.paragraphEvents;
  const candidates = ctx.story
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.notability > 0 && item.kind !== 'birth');
  candidates.sort(
    (a, b) =>
      b.item.notability - a.item.notability || a.item.tick - b.item.tick || a.index - b.index,
  );
  return candidates
    .slice(0, max)
    .sort((a, b) => a.item.tick - b.item.tick || a.index - b.index)
    .map(({ item }) => item);
}

export function writeParagraph(ctx: GenesisCtx, data: GameData): string {
  const sentences: string[] = [birthSentence(ctx)];
  const parents = parentsClause(ctx);
  if (parents) sentences.push(parents);
  else if (ctx.legacy.guardian) sentences.push(`You were raised by ${ctx.legacy.guardian.title}.`);
  const tier = data.creation.wealthTiers[ctx.wealthRank];
  if (tier && !ctx.legacy.guardian) sentences.push(`The family was ${tier.name.toLowerCase()}.`);

  let previousAge = -1;
  for (const item of chosenMoments(ctx)) {
    const lead =
      item.age === previousAge
        ? 'The same year, '
        : item.age === 0
          ? 'As a baby, '
          : `At ${numberWords(item.age)}, `;
    previousAge = item.age;
    sentences.push(lead + continueSentence(item.template, item.text));
  }

  const entry = dateOf(data.calendar, ctx.entryTick);
  const age = ctx.options.entryAge;
  if (age === 0) {
    sentences.push(`Your story begins the day you are born, in ${formatDate(entry)}.`);
  } else if (ctx.focus) {
    sentences.push(
      `Now it is ${formatDate(entry)}. You are ${numberWords(age)}, shaped by a life as a ${ctx.focus.name.toLowerCase()}, and your story begins.`,
    );
  } else {
    sentences.push(
      `Now it is ${formatDate(entry)}, you are ${numberWords(age)}, and your story begins.`,
    );
  }
  return sentences.join(' ');
}
