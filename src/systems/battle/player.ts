import type { BattleState, Fighter, ShipInBattle } from '../../engine/battle-state';
import type { ContestDef, FightSpec, FoeDef, GameData, Intent } from '../../engine/data/schemas';
import type { LifeEnv } from '../life/env';
import { runContest } from './spar';
import type { NewsDraft } from '../../engine/pipeline';
import { Rng } from '../../engine/rng';
import type { Entity, PendingDecision, WorldState } from '../../engine/state';
import { appendLog } from '../../engine/log';
import { moveAxis } from '../heart/bonds';
import { speciesOf } from '../heart/companions';
import { feudFor } from '../heart/family';
import { ensureLife, livingRelations, playerPerson } from '../life/body';
import { ensurePowers } from '../powers/state';
import { decide } from './ai';
import { finisherFor } from './finish-hooks';
export { onFightFinished } from './finish-hooks';
import { applyAftermath, PLAYER_FIGHTER, settleOthers, type Aftermath } from './aftermath';
import { ctxOf, newBattle, openingLine, setBonds } from './battle';
import { fighter as fighterById, type Plan } from './engine';
import { fighterOf, foeFighter, foePower } from './fighters';
import { tierSpan } from './ladder';
import { ownShipInBattle } from '../hands/fight';
import { bloodthirstIntent } from '../hands/curses';
import { autoBoard, placeAtFronts, runBattle, stepBattle, type NavalPlan } from './scales';

/**
 * The player's fights (Phase 5). An event's `fight` (or a canon beat's, or a contest's) becomes a
 * battle with the player on side 0. In tactical mode it waits in `state.battle` behind a decision,
 * so time holds still and a skip stops, and each `battle/act` plays one exchange; its one choice
 * ("Let it play out") hands the rest to the player's stance, which is also how headless runs and
 * quick mode play it. When it ends, the event's result band applies, and a winner who beat someone
 * worth deciding about chooses their fate.
 */

export class BattleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BattleError';
  }
}

export const MODE_FLAG = 'battle.mode';
export const STANCE_FLAG = 'battle.stance';

export interface FightSite {
  tick: number;
  place: string | null;
  roles: Readonly<Record<string, string>>;
  source: BattleState['source'];
}

function foeDef(data: GameData, id: string): FoeDef {
  const foe = data.battle.foes.find((f) => f.id === id);
  if (!foe) throw new BattleError(`data/battle.json has no foe "${id}"`);
  return foe;
}

function hands(state: WorldState, player: Entity): number {
  const voyage = player.character?.travel?.voyage;
  if (voyage?.vessel) return voyage.vessel.crew;
  const ship = voyage?.shipId ? state.entities[voyage.shipId]?.ship : undefined;
  if (ship) return ship.crew;
  const owned = Object.values(state.entities).find(
    (e) => e.ship?.ownerId === player.id && !e.ship.sunk,
  );
  return owned?.ship?.crew ?? 0;
}

function playerShip(state: WorldState, data: GameData, player: Entity): ShipInBattle {
  const voyage = player.character?.travel?.voyage;
  const v = voyage?.vessel;
  // Phase 6: in port, her own ship (moored where they stand) is the one that fights.
  const own = voyage?.shipId
    ? state.entities[voyage.shipId]
    : !voyage
      ? Object.values(state.entities).find(
          (e) =>
            e.ship?.ownerId === player.id &&
            !e.ship.sunk &&
            e.ship.place === player.character?.place,
        )
      : undefined;
  const vesselId = v?.vessel ?? own?.ship?.vessel ?? 'vessel_caravel';
  const vessel = data.vessels[vesselId] ?? Object.values(data.vessels)[0];
  const hull = v?.hull ?? own?.ship?.hull ?? vessel?.hull ?? 60;
  const maxHull = v?.maxHull ?? vessel?.hull ?? 60;
  const ship: ShipInBattle = {
    name: v?.name ?? own?.name ?? `the ${vessel?.name ?? 'ship'}`,
    vessel: vesselId,
    hull,
    maxHull,
    cannons: Math.round(maxHull * data.battle.naval.cannonsPerHull),
    speed: v?.speed ?? vessel?.speed ?? 120,
    fire: 0,
    struck: false,
    sunk: false,
  };
  // Phase 6: her own hull, guns and speed, from her design.
  if (own?.ship && !v) {
    Object.assign(ship, ownShipInBattle(data, own));
    if (!own.ship.design)
      ship.cannons = Math.round(ship.maxHull * data.battle.naval.cannonsPerHull);
  }
  return ship;
}

/** The player as a fighter. */
export function playerFighter(
  state: WorldState,
  data: GameData,
  tick: number,
  intent: Intent,
  rules: { noFruits?: boolean; noWeapons?: boolean } = {},
): Fighter {
  const p = playerPerson(state, data);
  if (!p) throw new BattleError('Nobody alive is being played');
  return fighterOf(state, data, p.entity, tick, {
    id: PLAYER_FIGHTER,
    side: 0,
    // Phase 6: a bloodthirsty blade in hand may push its wielder to fight to the death.
    intent: bloodthirstIntent(state, data, p.entity, intent, Rng.root(state.seed), tick),
    player: true,
    leader: true,
    ...rules,
  });
}

/**
 * Build the battle an event's fight describes: the foes, the player and whoever stands with them,
 * the ships for a sea fight, the fronts for a war.
 */
export function buildFight(
  state: WorldState,
  data: GameData,
  spec: FightSpec,
  site: FightSite,
): BattleState {
  const p = ensureLife(state, data);
  if (!p) throw new BattleError('Nobody alive is being played');
  const contest = spec.contest
    ? data.battle.contests.find((c) => c.id === spec.contest)
    : undefined;
  const rules = { noFruits: contest?.noFruits, noWeapons: contest?.noWeapons };
  const rng = Rng.root(state.seed).fork(
    'fight',
    site.source.id,
    site.tick,
    state.counters.battleId + 1,
  );
  const me = playerFighter(state, data, site.tick, spec.mine, rules);
  const fighters: Fighter[] = [me];
  let ranks: [number, number] = [0, 0];
  let rankPower: [number, number] = [0, 0];
  const big = spec.scale === 'crew' || spec.scale === 'naval' || spec.scale === 'war';
  const maxNamed = big ? 4 : spec.scale === 'skirmish' ? 10 : 10;
  let n = 0;
  const sides: [string, string] = [p.entity.name, ''];
  const foeNames: string[] = [];

  for (const ref of spec.foes) {
    if (ref.kind === 'foe') {
      const def = foeDef(data, ref.foe);
      const named = Math.min(ref.count, Math.max(0, maxNamed - n));
      for (let i = 0; i < named; i++) {
        n += 1;
        fighters.push(
          foeFighter(data, def, rng.fork('foe', n), {
            id: `foe${n}`,
            side: 1,
            intent: spec.intent ?? def.intent,
            leader: n === 1,
            name:
              ref.count > 1
                ? `${def.name.replace(/^an? /, '').replace(/^./, (c) => c.toUpperCase())} ${i + 1}`
                : undefined,
            ...rules,
          }),
        );
      }
      if (ref.count > named) {
        ranks[1] += ref.count - named;
        rankPower[1] = foePower(data, def, rng.fork('ranks', ref.foe));
      }
      foeNames.push(ref.count > 1 ? `${ref.count} ${def.plural}` : def.name);
    } else {
      const id = ref.kind === 'role' ? site.roles[ref.role] : ref.char;
      const entity = id ? state.entities[id] : undefined;
      if (!entity?.character?.alive) continue;
      n += 1;
      fighters.push(
        fighterOf(state, data, entity, site.tick, {
          id: `foe${n}`,
          side: 1,
          intent: spec.intent ?? 'capture',
          leader: n === 1,
          ...rules,
        }),
      );
      foeNames.push(entity.name);
    }
  }
  if (fighters.length === 1) throw new BattleError('There is nobody to fight');
  sides[1] = foeNames.join(' and ');

  // Who stands with the player: the ship's hands, or friends who are here.
  if (spec.allies === 'crew' && big) {
    const count = hands(state, p.entity);
    if (count > 0) {
      ranks[0] = count;
      const span = tierSpan(data, 'thug');
      rankPower[0] = Math.round((span.min + (span.max ?? span.min)) / 2);
    }
  } else if (spec.allies === 'friends') {
    const here = p.c.place;
    const friends = [
      ...livingRelations(state, p.c, 'friend'),
      ...livingRelations(state, p.c, 'sweetheart'),
      // Phase 7: crewmates, and an animal that fights at the player's side.
      ...livingRelations(state, p.c, 'crewmate'),
      ...livingRelations(state, p.c, 'companion').filter(
        (e) => speciesOf(data, e)?.kind === 'fighter',
      ),
    ]
      .filter((e) => e.character?.place === here && e.id !== p.entity.id)
      .slice(0, 3);
    friends.forEach((f, i) =>
      fighters.push(
        fighterOf(state, data, f, site.tick, {
          id: `ally${i + 1}`,
          side: 0,
          intent: spec.mine,
          ...rules,
        }),
      ),
    );
  }
  if (!big && fighters.length > 2 && spec.scale === 'duel') {
    // More than one on a side: it is a skirmish.
  }
  const scale = spec.scale === 'duel' && fighters.length > 2 ? 'skirmish' : spec.scale;

  // Sea fights: two ships; wars: fronts with their commanders.
  let ships: ShipInBattle[] = [];
  if (spec.ship) {
    const vessel = data.vessels[spec.ship.vessel];
    const hull = vessel?.hull ?? 60;
    ships = [
      playerShip(state, data, p.entity),
      {
        name: `an enemy ${vessel?.name.toLowerCase() ?? 'ship'}`,
        vessel: spec.ship.vessel,
        hull,
        maxHull: hull,
        cannons: Math.round(hull * data.battle.naval.cannonsPerHull),
        speed: vessel?.speed ?? 140,
        fire: 0,
        struck: false,
        sunk: false,
      },
    ];
    ranks[1] += spec.ship.crew;
    if (rankPower[1] === 0)
      rankPower[1] = foePower(data, foeDef(data, 'foe_pirate'), rng.fork('crew'));
  }
  const fronts: BattleState['fronts'] = [];
  if (scale === 'war') {
    spec.fronts.forEach((fr, i) => {
      const commander = (char: string | undefined, side: 0 | 1): string | null => {
        const entity = char ? state.entities[char] : undefined;
        if (!entity?.character?.alive) return null;
        const id = `cmd${side}_${i}`;
        fighters.push(
          fighterOf(state, data, entity, site.tick, {
            id,
            side,
            intent: side === 0 ? spec.mine : (spec.intent ?? 'kill'),
            leader: true,
          }),
        );
        return id;
      };
      fronts.push({
        name: fr.name,
        strength: [fr.mine.strength, fr.theirs.strength],
        morale: [data.battle.morale.start, data.battle.morale.start],
        commanders: [commander(fr.mine.commander, 0), commander(fr.theirs.commander, 1)],
        broken: [false, false],
      });
    });
    ranks = [
      fronts.reduce((s, f) => s + f.strength[0], 0),
      fronts.reduce((s, f) => s + f.strength[1], 0),
    ];
    const thug = tierSpan(data, 'officer');
    rankPower = [thug.min, thug.min];
  }

  state.counters.battleId += 1;
  const preferred = p.entity.flags[MODE_FLAG];
  const mode =
    spec.mode === 'tactical' || spec.mode === 'quick'
      ? spec.mode
      : preferred === 'tactical' || preferred === 'quick'
        ? preferred
        : scale === 'duel'
          ? 'tactical'
          : 'quick';
  const stance =
    typeof p.entity.flags[STANCE_FLAG] === 'string'
      ? (p.entity.flags[STANCE_FLAG] as string)
      : undefined;
  const battle = newBattle(data, {
    id: state.counters.battleId,
    scale,
    mode,
    tick: site.tick,
    place: site.place,
    fighters,
    sides,
    source: site.source,
    stop: spec.stop ?? contest?.stop ?? null,
    // A fight with a stop rule is a bout (a challenge, a contest): fought as a spar is.
    spar: (spec.stop ?? contest?.stop) !== undefined,
    contest: contest?.id ?? null,
    water: spec.water || ships.length > 0,
    ranks,
    rankPower,
    ships,
    fronts,
    ...(stance ? { stance } : {}),
  });
  setBonds(state, data, battle, site.tick);
  if (scale === 'crew') autoBoard(battle);
  if (scale === 'war') placeAtFronts(battle);
  openingLine(ctxOf(state, data, battle));
  return battle;
}

/** Help answering a Den Den Mushi call: Marines for a Marine or a citizen, pirates for a pirate. */
export function helperFor(
  state: WorldState,
  data: GameData,
  battle: BattleState,
): (caller: Fighter) => Fighter | null {
  return (caller) => {
    const id = caller.marine || !caller.criminal ? 'foe_marine_officer' : 'foe_pirate';
    const def = data.battle.foes.find((f) => f.id === id);
    if (!def) return null;
    const n = battle.fighters.length + 1;
    return foeFighter(data, def, Rng.root(state.seed).fork('helper', battle.id, n), {
      id: `help${n}`,
      side: caller.side,
      intent: caller.intent,
    });
  };
}

function pushNews(state: WorldState, drafts: readonly NewsDraft[]): void {
  for (const d of drafts) {
    state.counters.newsSeq += 1;
    state.news.push({
      id: state.counters.newsSeq,
      tick: state.tick,
      text: d.text,
      tags: d.tags,
      ...(d.place ? { place: d.place, reachTick: state.tick } : {}),
    });
  }
}

// ---- Holding time still for a tactical fight -------------------------------------------------------

function holdTime(state: WorldState, battle: BattleState, title: string): void {
  state.counters.decisionId += 1;
  const decision: PendingDecision = {
    id: state.counters.decisionId,
    eventId: battle.source.id,
    firedTick: state.tick,
    recordSeq: battle.source.causeSeq ?? Math.max(0, state.log.length - 1),
    title,
    text: battle.log[0]?.text ?? 'A fight.',
    choices: [{ id: 'auto', label: 'Let it play out' }],
    battle: true,
  };
  state.pending.push(decision);
  battle.decisionId = decision.id;
}

/**
 * Begin the player's fight: tactical, it waits in `state.battle`; quick, it plays out now with the
 * player's stance and is finished at once.
 */
export function beginFight(
  state: WorldState,
  data: GameData,
  battle: BattleState,
  title: string,
): void {
  // Another fight is already held open (or waits on a fate): this one plays out in quick mode.
  if (state.battle) battle.mode = 'quick';
  if (battle.mode === 'tactical') {
    state.battle = battle;
    holdTime(state, battle, title);
    return;
  }
  const ctx = ctxOf(state, data, battle);
  runBattle(ctx, decide, helperFor(state, data, battle));
  finishFight(state, data, battle, title);
}

function fateChoices(data: GameData, battle: BattleState): PendingDecision['choices'] {
  const beaten = battle.fighters.filter(
    (f) => f.side === 1 && (f.down === 'ko' || f.down === 'captured' || f.down === 'surrendered'),
  );
  if (beaten.length === 0) return [];
  const me = battle.fighters.find((f) => f.player);
  const bounty = beaten.some((f) => f.criminal);
  const choices: PendingDecision['choices'] = [];
  const first =
    me?.intent === 'kill' ? 'kill' : me?.intent === 'capture' && bounty ? 'hand_over' : 'let_go';
  const all: { id: string; label: string }[] = [
    { id: 'let_go', label: 'Let them go' },
    ...(bounty ? [{ id: 'hand_over', label: 'Bind them and hand them to the Marines' }] : []),
    ...(beaten.some((f) => f.entityId)
      ? [{ id: 'recruit', label: 'Offer them a place beside you' }]
      : []),
    { id: 'rob', label: 'Take what they carry' },
    { id: 'kill', label: 'Finish them' },
  ];
  const lead = all.find((c) => c.id === first);
  if (lead) choices.push(lead);
  for (const c of all) if (c.id !== first) choices.push(c);
  void data;
  return choices;
}

/**
 * The fight is over: its aftermath, the source's result, and (when the player beat someone) the
 * choice of their fate, which keeps the battle until it is made.
 */
export function finishFight(
  state: WorldState,
  data: GameData,
  battle: BattleState,
  title: string,
): Aftermath {
  const drafts: NewsDraft[] = [];
  const aftermath = applyAftermath(state, data, battle, state.tick, drafts);
  battle.card = aftermath.lines.map((l) => ({
    exchange: battle.exchange,
    text: l.text,
    tone: l.tone,
  }));
  if (aftermath.seen.length > 0)
    battle.card.push({
      exchange: battle.exchange,
      text: `Seen by ${aftermath.seen.join(', ')}.`,
      tone: 'plain',
    });
  if (aftermath.news)
    battle.card.push({ exchange: battle.exchange, text: 'It will be in the news.', tone: 'plain' });
  const result = battle.result;
  const p = playerPerson(state, data);
  if (p) {
    appendLog(state, state.tick, {
      kind: 'event',
      summary:
        `${title}: ${battle.log.at(-1)?.text ?? ''} ${aftermath.lines.map((l) => l.text).join(' ')}`.trim(),
      tags: ['personal', 'combat', 'fight', ...(battle.spar ? ['spar'] : [])],
      actorIds: [p.entity.id],
      targetIds: battle.fighters
        .filter((f) => f.side === 1 && f.entityId)
        .map((f) => f.entityId as string),
      place: battle.place,
      cause: `battle:${battle.source.id}`,
      ...(battle.source.causeSeq !== undefined ? { causeSeq: battle.source.causeSeq } : {}),
      knownBy: [p.entity.id],
    });
  }
  pushNews(state, drafts);
  finisherFor(battle.source.kind)?.(state, data, battle, aftermath);
  const choices = result?.how === 'won' && p?.c.alive ? fateChoices(data, battle) : [];
  const free = state.battle === null || state.battle === battle;
  if (choices.length > 0 && !battle.spar && battle.contest === null && free) {
    state.battle = battle;
    state.counters.decisionId += 1;
    state.pending.push({
      id: state.counters.decisionId,
      eventId: battle.source.id,
      firedTick: state.tick,
      recordSeq: Math.max(0, state.log.length - 1),
      title: 'Their fate',
      text: `${battle.sides[1].name} lie beaten. What becomes of them is yours to decide.`,
      choices,
      battle: true,
    });
    battle.decisionId = state.counters.decisionId;
  } else if (state.battle === battle) {
    state.battle = null;
  }
  return aftermath;
}

/**
 * An event's contest of several rounds (a colosseum's blocks, a Davy Back Fight's three games):
 * played round by round in quick mode, as an activity's contest is; its result is the event's.
 */
export function beginContest(
  state: WorldState,
  data: GameData,
  contest: ContestDef,
  site: FightSite,
): void {
  const p = ensureLife(state, data);
  if (!p?.c.life) throw new BattleError('Nobody alive is being played');
  const env: LifeEnv = {
    state,
    data,
    tick: site.tick,
    rng: Rng.root(state.seed).fork('contest', site.source.id, site.tick),
    p,
    life: p.c.life,
    cause: `battle:${site.source.id}`,
    ...(site.source.causeSeq !== undefined ? { causeSeq: site.source.causeSeq } : {}),
  };
  const done = runContest(env, contest, env.rng);
  if (!done) return;
  const battle = done.battle;
  battle.source = site.source;
  battle.place = site.place;
  const how = done.result === 'won' ? 'won' : done.result === 'draw' ? 'won' : 'lost';
  battle.result = {
    winner: how === 'won' ? 0 : 1,
    how,
    decisive: done.result === 'won' ? true : done.result === 'lost',
    exchanges: battle.exchange,
  };
  if (done.result === 'draw') battle.result.decisive = false;
  finisherFor(site.source.kind)?.(state, data, battle, { lines: [], seen: [], news: false });
}

/** The winner's choice for the beaten (the player decides; data/battle.json words it). */
function applyFate(state: WorldState, data: GameData, battle: BattleState, fate: string): void {
  const p = playerPerson(state, data);
  if (!p) return;
  const rng = Rng.root(state.seed).fork('fate', battle.id);
  const beaten = battle.fighters.filter(
    (f) => f.side === 1 && (f.down === 'ko' || f.down === 'captured' || f.down === 'surrendered'),
  );
  const names = beaten.map((f) => f.name).join(', ');
  let text = '';
  switch (fate) {
    case 'let_go':
      text = `You let ${names} go.`;
      for (const f of beaten) {
        const e = f.entityId ? state.entities[f.entityId] : undefined;
        const rel = e?.character?.relationships.find((r) => r.id === p.entity.id);
        if (rel) moveAxis(data, rel, 'affection', 5, 'Let go after a fight', undefined, state.tick);
      }
      break;
    case 'hand_over': {
      const bounty = beaten.reduce((n, f) => n + f.bounty, 0);
      const reward = bounty > 0 ? bounty : beaten.filter((f) => f.criminal).length * 50000;
      p.c.berries += reward;
      text = `You handed ${names} to the Marines${reward > 0 ? ` and collected ${reward.toLocaleString('en-GB')} Berries` : ''}.`;
      for (const f of beaten) {
        const e = f.entityId ? state.entities[f.entityId] : undefined;
        if (e) e.flags['status'] = 'imprisoned';
      }
      break;
    }
    case 'recruit': {
      const joined = beaten.filter(
        (f) =>
          f.entityId && rng.fork('join', f.id).chance(0.4 + (f.down === 'surrendered' ? 0.2 : 0)),
      );
      for (const f of joined) {
        const e = state.entities[f.entityId as string];
        if (e?.character && !p.c.relationships.some((r) => r.id === e.id)) {
          // Phase 7: a place beside the player is a place in their crew.
          p.c.relationships.push({
            id: e.id,
            kind: 'crewmate',
            opinion: { base: 20, mods: [] },
            sinceTick: state.tick,
          });
          e.character.relationships.push({
            id: p.entity.id,
            kind: 'crewmate',
            opinion: { base: 25, mods: [] },
            sinceTick: state.tick,
          });
          e.flags['crew.of'] = p.entity.id;
        }
      }
      text =
        joined.length > 0
          ? `${joined.map((f) => f.name).join(', ')} took you up on it.`
          : `${names} would not have it.`;
      break;
    }
    case 'rob': {
      const take = beaten.reduce(
        (n, f) => n + Math.round((f.cp / 10) * rng.fork('loot', f.id).int(20, 80)),
        0,
      );
      p.c.berries += take;
      text = `You went through their pockets: ${take.toLocaleString('en-GB')} Berries.`;
      p.entity.stats['infamy'] ??= { base: 0, mods: [] };
      (p.entity.stats['infamy'] as { base: number }).base += 1;
      break;
    }
    case 'kill': {
      text = `You finished ${names}.`;
      for (const f of beaten) {
        f.down = 'dead';
        f.downBy = PLAYER_FIGHTER;
      }
      const drafts: NewsDraft[] = [];
      // The dead are dealt with as any fight's dead are (Tier 2 people and the cast die for good).
      settleOthers(state, data, battle, state.tick, drafts);
      pushNews(state, drafts);
      p.entity.stats['infamy'] ??= { base: 0, mods: [] };
      (p.entity.stats['infamy'] as { base: number }).base +=
        data.battle.rewards.infamyForKill * beaten.filter((f) => !f.criminal).length;
      break;
    }
  }
  const fateRecord = appendLog(state, state.tick, {
    kind: 'decision',
    summary: text,
    tags: ['decision', 'personal', 'combat'],
    actorIds: [p.entity.id],
    targetIds: beaten.filter((f) => f.entityId).map((f) => f.entityId as string),
    place: battle.place,
    cause: `battle:${battle.source.id}`,
    knownBy: [p.entity.id],
  });
  // Phase 7: a family feud. Whoever the dead leave behind will not forget who did it.
  if (fate === 'kill')
    for (const f of beaten)
      if (f.entityId) feudFor(state, data, f.entityId, p.entity, fateRecord.seq, battle.place);
}

// ---- Commands ----------------------------------------------------------------------------------

function current(state: WorldState): BattleState {
  const battle = state.battle;
  if (!battle) throw new BattleError('There is no fight under way');
  return battle;
}

function dropDecision(state: WorldState, battle: BattleState): void {
  state.pending = state.pending.filter((d) => d.id !== battle.decisionId);
  battle.decisionId = null;
}

/** One exchange of the player's tactical fight, with the action they chose. */
export function battleAct(state: WorldState, data: GameData, plan: Plan, naval?: NavalPlan): void {
  const battle = current(state);
  if (battle.result) throw new BattleError('The fight is over: decide their fate');
  const me = fighterById(battle, PLAYER_FIGHTER);
  const ctx = ctxOf(state, data, battle);
  const plans = new Map<string, Plan>();
  if (me && me.down === null && !me.front) plans.set(me.id, plan);
  stepBattle(ctx, plans, decide, helperFor(state, data, battle), naval);
  // Out of it (down, or at the fronts with nothing left to choose): the rest plays itself.
  if (!battle.result && me && me.down !== null)
    runBattle(ctx, decide, helperFor(state, data, battle));
  if (battle.result) {
    dropDecision(state, battle);
    finishFight(
      state,
      data,
      battle,
      state.pending.find((d) => d.id === battle.decisionId)?.title ?? titleOf(battle),
    );
  }
}

function titleOf(battle: BattleState): string {
  return battle.spar
    ? 'A spar'
    : battle.scale === 'naval'
      ? 'A sea fight'
      : battle.scale === 'war'
        ? 'A war'
        : 'A fight';
}

/**
 * The battle's decision: "auto" plays the rest of the fight with the player's stance; a fate
 * choice decides what becomes of the beaten.
 */
export function resolveBattleDecision(
  state: WorldState,
  data: GameData,
  decision: PendingDecision,
  choiceId: string,
): void {
  const battle = state.battle;
  state.pending = state.pending.filter((d) => d.id !== decision.id);
  if (!battle) return;
  battle.decisionId = null;
  if (battle.result) {
    applyFate(state, data, battle, choiceId);
    state.battle = null;
    return;
  }
  const ctx = ctxOf(state, data, battle);
  runBattle(ctx, decide, helperFor(state, data, battle));
  finishFight(state, data, battle, decision.title);
}

export function setStance(state: WorldState, data: GameData, stance: string): void {
  if (!data.battle.stances.some((s) => s.id === stance))
    throw new BattleError(`No stance "${stance}"`);
  const p = playerPerson(state, data);
  if (p) p.entity.flags[STANCE_FLAG] = stance;
  if (state.battle) state.battle.stance = stance;
}

export function setMode(state: WorldState, data: GameData, mode: 'tactical' | 'quick'): void {
  const p = playerPerson(state, data);
  if (!p) throw new BattleError('Nobody alive is being played');
  p.entity.flags[MODE_FLAG] = mode;
}

export function setOrder(state: WorldState, order: string, target: string | null): void {
  const battle = current(state);
  const side = battle.sides[0];
  side.order = order as typeof side.order;
  side.target = target;
}

export function setBoardCommand(
  state: WorldState,
  pairs: readonly (readonly [string, string])[],
): void {
  const battle = current(state);
  if (battle.scale !== 'crew' && !(battle.scale === 'naval' && battle.boarded))
    throw new BattleError('Only a crew battle has a match-up board');
  autoBoard(battle, pairs);
}

export function moveFront(state: WorldState, index: number): void {
  const battle = current(state);
  if (battle.scale !== 'war') throw new BattleError('Only a war has fronts');
  const front = battle.fronts[index];
  if (!front || front.broken[0]) throw new BattleError('That front has broken');
  battle.playerFront = index;
  placeAtFronts(battle);
}

export function buyKit(state: WorldState, data: GameData, itemId: string): void {
  const item = data.battle.items.find((i) => i.id === itemId);
  const p = playerPerson(state, data);
  if (!item || !p) throw new BattleError('That is not for sale');
  if (p.place.atSea || !p.place.features.some((f) => f === 'market' || f === 'doctor'))
    throw new BattleError('No market here');
  if (p.c.berries < item.price)
    throw new BattleError(`It costs ${item.price.toLocaleString('en-GB')} Berries`);
  p.c.berries -= item.price;
  const powers = ensurePowers(p.c);
  powers.gear[item.id] = (powers.gear[item.id] ?? 0) + 1;
}

export { stepBattle, fighterById };
