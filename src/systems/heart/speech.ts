import type { GameData } from '../../engine/data/schemas';
import type { Rng } from '../../engine/rng';
import type { Entity, Mood, Profile, WorldState } from '../../engine/state';
import {
  renderTemplate,
  SPEECH_ACTS,
  templateVarsUsed,
  type SpeechAct,
} from '../../engine/template';
import { storyVars } from '../events';
import { capitalize } from '../genesis/text';
import { dreamText, heartOf, moodOf } from './profile';

/**
 * How people talk (Phase 7): a template grammar. A line of an intent, an initiative or a milestone
 * says what happens in narration, and `{say.refuse}` puts the other person's own words in it: the
 * act in their register (formal, rough, cheerful, archaic, plain, cold), with their verbal tic or
 * signature laugh, a canon person's few words of their own, and their mood on it (a drunk hiccup,
 * a scared stammer). So a gruff swordsman and a cheerful cook refuse a loan in different words.
 */

const LAUGHING = new Set<SpeechAct>(['laugh', 'pleased', 'tease', 'proud', 'warm', 'agree']);
const CATCHING = new Set<SpeechAct>(['greet', 'pleased', 'proud', 'warm']);

function withTic(line: string, tic: string): string {
  const m = /^(.*?)([.!?]+)$/.exec(line);
  return m ? `${m[1]}, ${tic}${m[2]}` : `${line}, ${tic}`;
}

/** One thing they say, in quotes. */
export function sayLine(
  data: GameData,
  profile: Profile,
  mood: Mood,
  act: SpeechAct,
  rng: Rng,
  catchphrases: readonly string[] = [],
): string {
  const register =
    data.heart.registers[profile.voice.register as keyof typeof data.heart.registers];
  const options = register?.speech[act] ?? data.heart.registers.plain?.speech[act] ?? ['...'];
  let line = rng.fork('line').pick(options);
  if (profile.voice.tic && rng.fork('tic').chance(0.45)) line = withTic(line, profile.voice.tic);
  if (profile.voice.laugh && LAUGHING.has(act) && rng.fork('laugh').chance(0.6))
    line = `${profile.voice.laugh} ${line}`;
  if (catchphrases.length > 0 && CATCHING.has(act) && rng.fork('catch').chance(0.35))
    line = `${line} ${rng.fork('phrase').pick(catchphrases)}`;
  if (mood === 'drunk' && rng.fork('hic').chance(0.6)) line = `Hic. ${line}`;
  if (mood === 'scared' && /^[A-Za-z]/.test(line)) line = `${line.charAt(0)}-${line}`;
  return `“${line}”`;
}

/** The pronoun words for someone. */
function pronounVars(entity: Entity): Record<string, string> {
  const p = entity.character?.pronouns ?? 'they';
  const they = p === 'he' ? 'he' : p === 'she' ? 'she' : 'they';
  const them = p === 'he' ? 'him' : p === 'she' ? 'her' : 'them';
  const their = p === 'he' ? 'his' : p === 'she' ? 'her' : 'their';
  return { they, them, their, They: capitalize(they), Their: capitalize(their) };
}

export interface SpeechExtra {
  topic?: string;
  fact?: string;
  memory?: string;
  amount?: string;
  item?: string;
  value?: string;
  title?: string;
}

/** Every variable a heart line may use, for one person speaking to the player. */
export function heartVars(
  state: WorldState,
  data: GameData,
  other: Entity,
  rng: Rng,
  extra: SpeechExtra = {},
  /** Only these acts (all of them when absent). */
  acts?: readonly SpeechAct[],
): Record<string, string> {
  const player = state.playerId ? state.entities[state.playerId] : undefined;
  const heart = heartOf(other);
  const profile = heart?.profile;
  const mood = moodOf(heart, state.tick);
  const vars: Record<string, string> = {
    ...storyVars(state, data),
    name: other.name,
    given: other.character?.givenName ?? other.name,
    ...pronounVars(other),
    you: player?.character?.givenName ?? player?.name ?? 'you',
    topic: extra.topic ?? 'nothing much',
    fact: extra.fact ?? 'nothing worth repeating',
    like: profile?.likes[1] ?? 'the sea',
    food: profile?.likes[0] ?? 'fresh fish',
    dislike: profile?.dislikes[0] ?? 'bad weather',
    dream: profile ? dreamText(data, profile) : 'live well',
    memory: extra.memory ?? 'the old days',
    amount: extra.amount ?? '0',
    item: extra.item ?? 'something',
    value:
      data.heart.values.find((v) => v.id === profile?.values[0])?.name.toLowerCase() ?? 'peace',
    fear: profile?.fear ?? 'the dark',
    title: extra.title ?? '',
    mood: data.heart.moods[mood]?.name.toLowerCase() ?? 'content',
  };
  const catchphrases = data.heart.canon[other.id]?.catchphrases ?? [];
  for (const act of acts ?? SPEECH_ACTS) {
    vars[`say.${act}`] = profile
      ? sayLine(data, profile, mood, act, rng.fork('say', act), catchphrases)
      : '“...”';
  }
  return vars;
}

/** The speech acts a template uses (so a line says only what it needs to: rendering is hot). */
function actsIn(template: string): SpeechAct[] {
  return templateVarsUsed(template)
    .filter((v) => v.startsWith('say.'))
    .map((v) => v.slice(4) as SpeechAct);
}

/** Render a heart line in someone's voice. Starts with a capital, whatever the first variable. */
export function renderHeart(
  state: WorldState,
  data: GameData,
  other: Entity,
  template: string,
  rng: Rng,
  extra: SpeechExtra = {},
): string {
  return capitalize(
    renderTemplate(template, heartVars(state, data, other, rng, extra, actsIn(template))),
  );
}

/** "Garo is three cups in and swaying.": how their mood colours the talk (or nothing). */
export function moodOpener(
  state: WorldState,
  data: GameData,
  other: Entity,
  rng: Rng,
): string | null {
  const mood = moodOf(heartOf(other), state.tick);
  const openers = data.heart.moods[mood]?.openers ?? [];
  if (openers.length === 0) return null;
  return renderHeart(state, data, other, rng.pick(openers), rng.fork('opener'));
}
