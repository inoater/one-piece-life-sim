import type { GameData } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import type { NewsDraft } from '../../engine/pipeline';
import type { Rng } from '../../engine/rng';
import type { Entity, WorldState } from '../../engine/state';
import { addMod } from '../../engine/stats';
import { killCharacter } from '../canon/cast';
import { reputation } from '../life/body';
import { tally } from './aftermath';
import { newBattle, resolveAbstract } from './battle';
import { fighterOf, foeFighter } from './fighters';
import { tierOf } from './ladder';

/**
 * Fights nobody plays (Phase 5): Tier 2 people and the canon cast come to blows by the same rules
 * the player fights by, resolved in one roll by the abstract resolver (fitted to the tactical
 * engine). Each one is logged with its reason: a bounty hunter after the Berries on a pirate's
 * head, a Marine on patrol, a crew raiding a town, an old score settled, trouble at sea.
 */

export interface NpcFightSite {
  state: WorldState;
  data: GameData;
  tick: number;
  rng: Rng;
  newsDrafts: NewsDraft[];
}

export interface NpcFightResult {
  winner: Entity;
  loser: Entity;
  died: boolean;
  jailed: boolean;
}

function line(data: GameData, id: string, vars: Record<string, string>): string {
  return (data.battle.lines[id] ?? id).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function berries(n: number): string {
  if (n >= 1e9) return `${Math.round(n / 1e8) / 10} billion`;
  if (n >= 1e6) return `${Math.round(n / 1e5) / 10} million`;
  return n.toLocaleString('en-GB');
}

/** Why a hunter goes after someone, in words. */
export function huntReason(hunter: Entity, target: Entity): string {
  const bounty = typeof target.flags['bounty'] === 'number' ? target.flags['bounty'] : 0;
  if (hunter.flags['affiliation'] === 'org_marines') return 'a Marine on patrol';
  if (bounty > 0) return `a bounty hunter after the ${berries(bounty)} Berries on their head`;
  return 'out to make a name';
}

/** Why two people quarrel, from what the one who started it wants. */
export function quarrelReason(a: Entity): string {
  switch (a.character?.npc?.goal) {
    case 'revenge':
      return 'an old score to settle';
    case 'wealth':
      return 'money owed and not paid';
    case 'glory':
      return 'to prove which of them was stronger';
    case 'freedom':
      return 'someone trying to hold them where they did not want to be';
    default:
      return 'words that went too far';
  }
}

/**
 * Two people fight. `intent` is what the one who started it meant (the other answers in kind,
 * or tries to take a criminal alive if they are a Marine).
 */
export function npcFight(
  site: NpcFightSite,
  a: Entity,
  b: Entity,
  intent: 'spare' | 'capture' | 'kill',
  summary: (winner: Entity, loser: Entity) => string,
  tags: string[],
  /** The summary already says how it ended (a raid driven off). */
  concluded = false,
): NpcFightResult | null {
  const { state, data, tick, rng } = site;
  if (!a.character?.alive || !b.character?.alive) return null;
  const fa = fighterOf(state, data, a, tick, { id: 'a', side: 0, intent });
  const answer =
    b.flags['affiliation'] === 'org_marines' && fa.criminal
      ? 'capture'
      : intent === 'kill'
        ? 'kill'
        : 'spare';
  const fb = fighterOf(state, data, b, tick, { id: 'b', side: 1, intent: answer });
  const res = resolveAbstract(data, [fa], [fb], rng.fork('who'));
  const [winner, loser, wf, lf] = res.winner === 0 ? [a, b, fa, fb] : [b, a, fb, fa];
  let died = false;
  let jailed = false;
  lf.down = 'ko';
  lf.downBy = wf.id;
  if (wf.intent === 'kill' && rng.fork('death').chance(data.battle.death.killBlow)) {
    died = true;
    lf.down = 'dead';
  } else if (wf.marine && lf.criminal && wf.intent === 'capture') {
    jailed = true;
    lf.down = 'captured';
  }
  // Their record, as the player's is kept.
  const battle = newBattle(data, {
    id: 0,
    scale: 'duel',
    mode: 'narrated',
    tick,
    place: a.character.place ?? null,
    fighters: [fa, fb],
    sides: [a.name, b.name],
    source: { kind: 'debug', id: 'npc' },
  });
  battle.result = {
    winner: res.winner,
    how: res.winner === 0 ? 'won' : 'lost',
    decisive: died,
    exchanges: 0,
  };
  tally(state, battle);
  const notable = [fa, fb].some(
    (f) =>
      f.fame >= data.battle.rewards.newsFame ||
      f.bounty >= data.battle.rewards.newsBounty ||
      a.id in data.cast ||
      b.id in data.cast,
  );
  const ending = died
    ? `${loser.name} did not survive it.`
    : jailed
      ? `${loser.name} was taken in chains.`
      : concluded
        ? ''
        : `${winner.name} won.`;
  const text = `${summary(winner, loser)} ${ending}`.trim();
  const record = appendLog(state, tick, {
    kind: 'world',
    summary: text,
    tags: ['world', 'npc', 'fight', ...tags],
    actorIds: [a.id],
    targetIds: [b.id],
    place: a.character.place ?? null,
    cause: 'sys:npc',
    knownBy: [],
  });
  if (notable) {
    site.newsDrafts.push({
      text,
      tags: ['news', 'combat', ...tags],
      sourceSeq: record.seq,
      place: a.character.place ?? null,
    });
  }
  const tier = tierOf(data, lf.cp);
  reputation(winner, 'fame').base += Math.max(0, data.battle.ladder.indexOf(tier)) * 0.5;
  if (died) {
    killCharacter(state, data, loser, {
      tick,
      canon: false,
      cause: `wounds from a fight with ${winner.name}`,
      causeSeq: record.seq,
      newsDrafts: site.newsDrafts,
    });
  } else if (jailed) {
    loser.flags['status'] = 'imprisoned';
    delete loser.flags['affiliation'];
    if (loser.character?.npc) {
      delete loser.character.npc.crewId;
      loser.character.npc.goal = 'freedom';
    }
  } else {
    const strength = loser.stats['strength'];
    if (strength)
      addMod(strength, {
        source: 'Beaten in a fight',
        value: -10,
        kind: 'pct',
        expiresTick: tick + 6,
      });
  }
  return { winner, loser, died, jailed };
}

/** A pirate crew's captain raids the town: its strongest defender stands against them, or nobody does. */
export function npcRaid(site: NpcFightSite, captain: Entity, defenders: readonly Entity[]): void {
  const { state, data, tick } = site;
  const place = captain.character?.place;
  const loc = place ? data.locations[place] : undefined;
  if (!place || !loc) return;
  const crew =
    typeof captain.flags['affiliation'] === 'string'
      ? state.entities[captain.flags['affiliation']]
      : undefined;
  const crewName = crew?.name ?? `${captain.name}'s crew`;
  const defender = [...defenders].sort(
    (x, y) => (y.stats['strength']?.base ?? 0) - (x.stats['strength']?.base ?? 0),
  )[0];
  if (defender) {
    npcFight(
      site,
      captain,
      defender,
      data.battle.npc.pirateKills > 0 && site.rng.fork('kills').chance(data.battle.npc.pirateKills)
        ? 'kill'
        : 'spare',
      (w) =>
        `${crewName} raided ${loc.name}, and ${defender.name} stood against them; ${w === captain ? 'the town fell' : 'they were driven off'}.`,
      ['raid', 'pirate'],
      true,
    );
    return;
  }
  const text = line(data, 'npc_raid', { a: crewName, place: loc.name });
  const record = appendLog(state, tick, {
    kind: 'world',
    summary: `${text} Nobody stood against them.`,
    tags: ['world', 'npc', 'fight', 'raid', 'pirate'],
    actorIds: [captain.id],
    place,
    cause: 'sys:npc',
    knownBy: [],
  });
  site.newsDrafts.push({ text, tags: ['news', 'pirate'], sourceSeq: record.seq, place });
  const prosperity = state.entities[place]?.place?.prosperity;
  if (prosperity)
    addMod(prosperity, {
      source: `Raided by ${crewName}`,
      value: -4,
      kind: 'flat',
      expiresTick: tick + 12,
    });
}

/**
 * Trouble on a Tier 2 voyage: pirates (their side against a pirate captain like those in data), or
 * a storm that throws a fruit user overboard with nobody to dive in after them.
 */
export function npcSeaTrouble(site: NpcFightSite, sailor: Entity): void {
  const { state, data, tick, rng } = site;
  const c = sailor.character;
  if (!c?.alive) return;
  const storm = rng.fork('storm?').chance(0.5);
  const fa = fighterOf(state, data, sailor, tick, { id: 'a', side: 0, intent: 'spare' });
  if (storm) {
    if (fa.fruit && !fa.swimmer && rng.fork('overboard').chance(0.25)) {
      const record = appendLog(state, tick, {
        kind: 'world',
        summary: `${line(data, 'npc_sea', { a: sailor.name, reason: 'a storm' })} ${sailor.name}, a Devil Fruit user, went over the side and nobody reached them.`,
        tags: ['world', 'npc', 'sea', 'fruit'],
        actorIds: [sailor.id],
        place: c.place ?? null,
        cause: 'sys:npc',
        knownBy: [],
      });
      killCharacter(state, data, sailor, {
        tick,
        canon: false,
        cause: 'drowning in a storm',
        causeSeq: record.seq,
        newsDrafts: site.newsDrafts,
      });
    }
    return;
  }
  const foe = data.battle.foes.find((f) => f.id === 'foe_pirate_captain');
  if (!foe) return;
  const fb = foeFighter(data, foe, rng.fork('pirates'), { id: 'b', side: 1, intent: 'capture' });
  const res = resolveAbstract(data, [fa], [fb], rng.fork('who'));
  const won = res.winner === 0;
  appendLog(state, tick, {
    kind: 'world',
    summary: `${line(data, 'npc_sea', { a: sailor.name, reason: 'pirates' })} ${won ? `${sailor.name} fought them off.` : `${sailor.name} was robbed and left adrift.`}`,
    tags: ['world', 'npc', 'fight', 'sea', 'pirate'],
    actorIds: [sailor.id],
    place: c.place ?? null,
    cause: 'sys:npc',
    knownBy: [],
  });
  if (!won) c.berries = Math.round(c.berries * 0.5);
}
