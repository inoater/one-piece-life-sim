import type { BattleState } from '../../engine/battle-state';
import type { GameData } from '../../engine/data/schemas';
import { appendLog } from '../../engine/log';
import type { CrewMember, Entity, WorldState } from '../../engine/state';
import { axisValue, relOf } from '../heart/bonds';
import { heartOrRoll } from '../heart/profile';
import { remember } from '../heart/memory';
import { tellFact } from '../heart/facts';
import { heartEnv } from '../heart/talk';
import { combatPowerOf, humanAgeOf, personOf, reputationValue, statTotal } from '../life/body';
import { relate } from '../life/people';
import { pay, type LifeEnv } from '../life/env';
import { trainStat } from '../life/training';
import { successChance } from '../story/checks';
import { arcMonth, arcTalked } from './arcs';
import { pushCrewDecision } from './decisions';
import { chemistry, memberGrowth } from './growth';
import {
  alliancesMonth,
  baseHere,
  basesMonth,
  fleetMonth,
  prisonersMonth,
  roomValue,
  takePrisoners,
} from './holdings';
import { crewHooks } from './hooks';
import { crewSay, ensurePotential, removeMember } from './members';
import { missionsMonth } from './missions';
import { autoFill, crewEffect, lineupOf, serviceMonth, situationNow } from './posts';
import { questFightDone, questMonth, questText } from './quests';
import { conclude, openObjections, recruitOf } from './recruit';
import { roleFit, roleOf } from './roles';
import { betrayalMonth, spiesMonth } from './spies';
import {
  hereOf,
  byId,
  crewLedBy,
  crewLog,
  crewLimit,
  fameTier,
  kindOf,
  loyaltyOf,
  membersOf,
  moveCrewBar,
  barOf,
  crewLine,
  renderCrew,
  bountyOf,
} from './state';
import { legendsMonth, listingsMonth, seedLegends } from './world';
import { giveBounty } from './bounty';

/**
 * A crew's month (Phase 8, step 7 after the heart's): the lists in port, rumours of legends, open
 * quests, then for the crew the player leads: the dead mourned, everyone aboard where the captain
 * is, the posts filled and served, pay and food, morale and loyalty, grumbling, desertion and
 * mutiny, chemistry, every crewmate's training and story, bounties and epithets, lives changing,
 * missions coming back, the fleet, alliances, bases, prisoners, spies and betrayal, and what the
 * port brings. The world's people the player knows well are Tier 1 while they do.
 */

function tone(n: number): 'good' | 'bad' | 'plain' {
  return n > 0 ? 'good' : n < 0 ? 'bad' : 'plain';
}

/** Someone aboard has died: a funeral at sea, the crew's grief, a promise to an absent friend. */
function mourn(
  env: LifeEnv,
  crewEnt: Entity,
  member: CrewMember,
  entity: Entity | undefined,
): void {
  const { state, data, tick, p } = env;
  const crew = crewEnt.crew;
  if (!crew) return;
  const rules = data.crew.lives.funeral;
  const record = entity
    ? crewSay(env, crewEnt, entity, p.c.travel?.voyage ? 'funeral' : 'died', {}, 'bad', [
        'death',
        'funeral',
      ])
    : undefined;
  removeMember(state, data, crewEnt, member.id, 'died', tick);
  crew.morale = Math.max(0, crew.morale + data.crew.morale.death + rules.morale);
  for (const { entity: other } of membersOf(state, crew))
    moveCrewBar(
      data,
      p.entity,
      other,
      'belonging',
      rules.belonging,
      `Mourning ${entity?.name ?? 'a crewmate'}`,
      record?.seq,
      tick,
    );
  tradition(env, crewEnt, 'death', entity ?? null);
}

/** A tradition the crew keeps (or starts keeping) after a moment of this kind. */
export function tradition(
  env: LifeEnv,
  crewEnt: Entity,
  trigger: string,
  about: Entity | null,
): void {
  const { data, tick } = env;
  const crew = crewEnt.crew;
  if (!crew) return;
  for (const t of data.crew.traditions) {
    if (t.trigger !== trigger || crew.members.length < t.minMembers) continue;
    const kept = crew.traditions.find((x) => x.id === t.id);
    if (!kept && !env.rng.fork('tradition', t.id, tick).chance(t.chance)) continue;
    if (kept && kept.last === tick) continue;
    if (kept) kept.last = tick;
    else crew.traditions.push({ id: t.id, since: tick, last: tick });
    crew.morale = Math.min(100, crew.morale + t.morale);
    const text = renderCrew(
      env.state,
      data,
      crewEnt,
      about,
      t.line,
      env.rng.fork('tradition-line', t.id),
    );
    crewSay(
      env,
      crewEnt,
      about,
      'tradition',
      { report: text },
      'good',
      ['tradition', `tradition:${t.id}`],
      false,
    );
  }
}

/** Pay a month: wages from the purse, then the captain's pocket; what each member makes of it. */
function payMonth(env: LifeEnv, crewEnt: Entity): void {
  const { state, data, tick, p } = env;
  const crew = crewEnt.crew;
  if (!crew) return;
  const pays = byId(data.crew.pays, crew.pay);
  const members = membersOf(state, crew);
  if (!pays || members.length === 0) return;
  const wages = pays.wage * members.length;
  if (wages > 0) {
    const fromPurse = Math.min(crew.treasury, wages);
    crew.treasury -= fromPurse;
    const rest = wages - fromPurse;
    if (rest > 0 && p.c.berries >= rest) {
      pay(env, -rest);
      crew.unpaid = 0;
    } else if (rest > 0) {
      crew.unpaid += 1;
      crew.morale = Math.max(0, crew.morale + data.crew.morale.unpaid);
      for (const { entity } of members)
        moveCrewBar(
          data,
          p.entity,
          entity,
          'loyalty',
          data.crew.loyalty.unpaid,
          'Unpaid',
          undefined,
          tick,
        );
    } else crew.unpaid = 0;
  }
  // Pay suits some natures and not others (wages for the careful, the dream for the free).
  for (const { entity } of members) {
    let by = 0;
    for (const v of heartOrRoll(state, data, entity).profile.values) by += pays.values[v] ?? 0;
    if (by !== 0)
      moveCrewBar(data, p.entity, entity, 'loyalty', by, `${pays.name}`, undefined, tick);
  }
}

/** The group's mood: drifts toward rest, lifted by the captain and the galley, strained by numbers. */
function moraleMonth(env: LifeEnv, crewEnt: Entity): void {
  const { state, data, tick, p } = env;
  const crew = crewEnt.crew;
  if (!crew) return;
  const rules = data.crew.morale;
  const cha = statTotal(p.entity, 'charisma', tick);
  const captain =
    Math.max(0, (cha - rules.captain.from) / 10) * rules.captain.per +
    fameTier(data, p.entity, tick) * rules.captain.perFameTier;
  const { limit } = crewLimit(state, data, p.entity, crew);
  const over = Math.max(0, crew.members.length - limit);
  const atSea = p.c.travel?.voyage !== null && p.c.travel?.voyage !== undefined;
  const galley = atSea ? crewEffect(state, data, 'sea.morale') : 0;
  const hungry =
    atSea &&
    (p.c.travel?.voyage?.vessel?.supplies ??
      state.entities[p.c.travel?.voyage?.shipId ?? '']?.ship?.supplies ??
      1) <= 0;
  const target = Math.max(
    0,
    Math.min(
      100,
      rules.rest + captain - over * data.crew.limits.strain + (hungry ? rules.hungry : 0),
    ),
  );
  const step = Math.max(-rules.drift, Math.min(rules.drift, target - crew.morale));
  crew.morale = Math.round(Math.max(0, Math.min(100, crew.morale + step + galley)) * 10) / 10;
  // Each member's own mood leans with the deck's; time together binds them a little.
  for (const { entity, member } of membersOf(state, crew)) {
    const mood = (crew.morale - barOf(state, data, p.entity, entity, 'morale')) / 8;
    if (Math.abs(mood) >= 0.5)
      moveCrewBar(
        data,
        p.entity,
        entity,
        'morale',
        Math.round(mood * 10) / 10,
        'The mood aboard',
        undefined,
        tick,
      );
    if (member.away === null)
      moveCrewBar(
        data,
        p.entity,
        entity,
        'loyalty',
        data.crew.loyalty.together,
        'Time together',
        undefined,
        tick,
      );
  }
}

/** Low morale brings grumbling, then desertion, then mutiny (rolled against the first mate). */
function disciplineMonth(env: LifeEnv, crewEnt: Entity): void {
  const { state, data, tick, p } = env;
  const crew = crewEnt.crew;
  if (!crew || crew.members.length === 0) return;
  const rules = data.crew.morale;
  const atSea = situationNow(p.entity) === 'sea';
  const discipline = Math.max(0.2, 1 + (atSea ? crewEffect(state, data, 'sea.discipline') : 0));
  const rng = env.rng.fork('discipline', tick);
  if (crew.morale < rules.grumble && tick % 3 === 0)
    crewSay(env, crewEnt, null, 'grumble', {}, 'bad', ['morale', 'grumble']);
  if (crew.morale < rules.desert) {
    for (const { entity } of membersOf(state, crew)) {
      if (loyaltyOf(state, data, p.entity, entity) >= 30) continue;
      if (!rng.fork('desert', entity.id).chance(0.15 * discipline)) continue;
      crewSay(env, crewEnt, entity, 'deserted', {}, 'alert', ['desertion']);
      removeMember(state, data, crewEnt, entity.id, 'deserted', tick);
    }
  }
  const members = membersOf(state, crew);
  if (
    crew.morale < rules.mutiny &&
    members.length >= 3 &&
    rng.fork('mutiny?').chance(0.3 * discipline)
  ) {
    // The first mate may put it down before it starts.
    const mate = members.find((m) => m.member.role === 'first_mate');
    const role = roleOf(data, 'first_mate');
    const iron = mate && (mate.member.mastery['first_mate'] ?? 0) >= 60 ? 1.33 : 1;
    const hold =
      mate && role
        ? successChance(
            roleFit(data, mate.entity, role, tick, mate.member.mastery['first_mate'] ?? 0).score *
              iron,
            60,
          )
        : 0;
    if (rng.fork('mate').chance(hold)) return;
    const ringleader = [...members].sort(
      (a, b) =>
        loyaltyOf(state, data, p.entity, a.entity) - loyaltyOf(state, data, p.entity, b.entity),
    )[0];
    if (!ringleader) return;
    pushCrewDecision(state, data, {
      kind: 'mutiny',
      title: 'Mutiny brewing',
      text: renderCrew(
        state,
        data,
        crewEnt,
        ringleader.entity,
        crewLine(data, 'mutiny'),
        rng.fork('line'),
        { count: String(members.length - 1) },
      ).replace('mutinied', 'are close to mutiny'),
      choices: [
        { id: 'concede', label: 'Give them what they want' },
        { id: 'face', label: 'Face them down' },
      ],
      roles: { other: ringleader.entity.id },
    });
  }
}

/** Pairs aboard: synergy (combination attacks, training together) or friction (fights on deck). */
function chemistryMonth(env: LifeEnv, crewEnt: Entity): void {
  const { state, data, tick } = env;
  const crew = crewEnt.crew;
  if (!crew) return;
  const members = membersOf(state, crew).filter((m) => m.member.away === null);
  if (members.length < 2) return;
  const rng = env.rng.fork('chemistry', tick);
  const a = rng.fork('a').pick(members);
  const b = rng.fork('b').pick(members.filter((m) => m !== a));
  if (!a || !b) return;
  const score = chemistry(state, data, a.entity, b.entity);
  const rules = data.crew.chemistry;
  if (score >= rules.synergy && !relOf(a.entity, b.entity.id)) {
    // They become friends of each other (Phase 5's bonds read it: combination attacks).
    relate(a.entity, b.entity, 'friend', 60, tick, rng.fork('relate'));
    crewSay(env, crewEnt, a.entity, 'synergy', { other: b.entity.name }, 'good', [
      'chemistry',
      'synergy',
    ]);
  } else if (score <= rules.friction && rng.fork('friction').chance(rules.frictionChance)) {
    pushCrewDecision(state, data, {
      kind: 'friction',
      title: `${a.entity.name} and ${b.entity.name}`,
      text: renderCrew(
        state,
        data,
        crewEnt,
        a.entity,
        crewLine(data, 'friction'),
        rng.fork('line'),
        { other: b.entity.name },
      ),
      choices: [
        { id: 'side_a', label: `Side with ${a.entity.character?.givenName ?? a.entity.name}` },
        { id: 'side_b', label: `Side with ${b.entity.character?.givenName ?? b.entity.name}` },
        { id: 'punish', label: 'Punish them both' },
        { id: 'settle', label: 'Let them settle it' },
      ],
      roles: { other: a.entity.id, second: b.entity.id },
    });
  }
}

/** Lives that change: promotion, retirement, a dream of their own, a child who wants to sail. */
function livesMonth(env: LifeEnv, crewEnt: Entity): void {
  const { state, data, tick, p } = env;
  const crew = crewEnt.crew;
  if (!crew) return;
  const rules = data.crew.lives;
  const structure = byId(data.crew.structures, crew.structure);
  const kind = kindOf(data, crew);
  const rng = env.rng.fork('lives', tick);
  for (const { member, entity } of membersOf(state, crew)) {
    const served = tick - member.joined;
    const loyalty = loyaltyOf(state, data, p.entity, entity);
    // Promotion: an officer's place, and a rank up a ranked crew's chart every year or so.
    const officers = crew.members.filter((m) => m.officer).length;
    if (
      !member.officer &&
      structure &&
      officers < structure.officers &&
      served >= rules.promote.months &&
      loyalty >= rules.promote.loyalty
    ) {
      member.officer = true;
      crewSay(env, crewEnt, entity, 'promoted', {}, 'good', ['promotion']);
      crewLog(crew, tick, `${entity.name} was made an officer.`);
    }
    if (
      kind.ranks.length > 0 &&
      served > 0 &&
      served % 12 === 0 &&
      member.rank < kind.ranks.length - 1 &&
      loyalty >= 40
    )
      member.rank += 1;
    const person = personOf(data, entity);
    const age = person ? humanAgeOf(data, person, tick) : 30;
    if (age >= rules.retire && rng.fork('retire', member.id).chance(0.04)) {
      crewSay(env, crewEnt, entity, 'retired', {}, 'plain', ['retired']);
      removeMember(state, data, crewEnt, member.id, 'retired', tick);
      continue;
    }
    const arcsDone = member.arcs.length > 0 && member.arcs.every((a) => a.done);
    if (arcsDone && loyalty < 45 && rng.fork('dream', member.id).chance(rules.dreamLeave)) {
      crewSay(env, crewEnt, entity, 'dreamLeave', {}, 'plain', ['dream']);
      removeMember(state, data, crewEnt, member.id, 'left for a dream of their own', tick);
      continue;
    }
    // A crewmate's child, old enough, may ask to sail.
    for (const rel of entity.character?.relationships ?? []) {
      if (rel.kind !== 'child') continue;
      const child = state.entities[rel.id];
      const cp = child ? personOf(data, child) : null;
      if (
        !child?.character?.alive ||
        !cp ||
        child.flags['crew.of'] !== undefined ||
        child.flags['crew.asked'] === true
      )
        continue;
      if (humanAgeOf(data, cp, tick) < rules.childJoins) continue;
      child.flags['crew.asked'] = true;
      pushCrewDecision(state, data, {
        kind: 'child',
        title: `${child.name} wants to sail`,
        text: renderCrew(
          state,
          data,
          crewEnt,
          child,
          crewLine(data, 'childJoins'),
          rng.fork('child', child.id),
          { other: entity.name },
        ),
        choices: [
          { id: 'yes', label: 'Take them aboard' },
          { id: 'no', label: 'Tell them to wait' },
        ],
        roles: { other: child.id, parent: entity.id },
      });
    }
  }
}

/** What the port brings: talk in the taverns (the shore party), thieves (the ship's guard). */
function portMonth(env: LifeEnv, crewEnt: Entity): void {
  const { state, data, tick, p } = env;
  const crew = crewEnt.crew;
  if (!crew || situationNow(p.entity) !== 'port') return;
  const rng = env.rng.fork('port', tick);
  const shore = lineupOf(state, data, crew, p.entity, 'port').find(
    (f) => f.post.id === 'shore_party',
  );
  const teller = shore?.who ? state.entities[shore.who] : undefined;
  if (
    teller &&
    teller.id !== p.entity.id &&
    rng.fork('rumour').chance(crewEffect(state, data, 'port.rumours'))
  ) {
    const told = tellFact(state, data, p.entity, teller, 'rumour', undefined, rng.fork('fact'));
    crewSay(
      env,
      crewEnt,
      teller,
      'missionBack',
      { report: `${teller.name} heard in the taverns: ${told.text}` },
      'plain',
      ['rumour', 'port'],
      false,
    );
  }
  const theft = crewEffect(state, data, 'port.theft');
  if (theft > 0 && rng.fork('theft').chance(theft)) {
    const lost = Math.round(crew.treasury * 0.1);
    crew.treasury -= lost;
    const ship = Object.values(state.entities).find(
      (e) =>
        e.ship?.ownerId === p.entity.id && e.ship.place === hereOf(data, p.entity) && !e.ship.sunk,
    );
    if (ship?.ship) ship.ship.supplies = Math.max(0, ship.ship.supplies - 2);
    crewSay(
      env,
      crewEnt,
      null,
      'missionBack',
      {
        report: `Thieves were aboard in the night${lost > 0 ? ` and took ${lost.toLocaleString('en-GB')} Berries from the purse` : ' and took stores'}.`,
      },
      'bad',
      ['theft'],
      false,
    );
  }
}

/** The people the player knows well are Tier 1 while they do (rule 5), and their lives go on. */
function peopleMonth(env: LifeEnv): void {
  const { state, data, tick, p } = env;
  const quarter = tick % 3 === 0;
  for (const rel of p.c.relationships) {
    const other = state.entities[rel.id];
    if (!other?.character?.alive || other.flags['animal'] !== undefined) continue;
    if (other.flags['crew.of'] === p.entity.id) continue;
    const close =
      ['parent', 'child', 'sibling', 'mentor', 'rival', 'sweetheart', 'protege'].includes(
        rel.kind,
      ) || axisValue(data, rel, 'affection', tick) >= 40;
    other.tier = close ? 1 : 2;
    if (!close || !quarter) continue;
    // Their own months: a little growth in their trade, and now and then news of them.
    ensurePotential(data, other, tick);
    const occ = other.character.occupation;
    const stat =
      occ === 'occ_scholar' || occ === 'occ_teacher'
        ? 'intellect'
        : occ === 'occ_merchant'
          ? 'charisma'
          : 'strength';
    trainStat(data, other, other.character, stat, 0.6, tick);
    const rng = env.rng.fork('people', other.id, tick);
    if (!rng.chance(0.04)) continue;
    let news: string | null = null;
    if (occ === 'occ_marine') news = `${other.name} has been promoted in the Marines.`;
    else if (occ === 'occ_pirate') {
      const bounty = bountyOf(other) + 1000000 * rng.int(1, 5);
      other.flags['bounty'] = bounty;
      news = `${other.name} has a bounty now: ${bounty.toLocaleString('en-GB')} Berries.`;
    } else if (rng.fork('trade').chance(0.5))
      news = `${other.name} is doing well for ${other.character.pronouns === 'they' ? 'themselves' : other.character.pronouns === 'he' ? 'himself' : 'herself'}, people say.`;
    if (!news) continue;
    // News reaches the player in port, not at sea.
    if (p.c.travel?.voyage) continue;
    appendLog(state, tick, {
      kind: 'life',
      summary: news,
      tags: ['personal', 'people', 'news'],
      actorIds: [other.id],
      targetIds: [p.entity.id],
      place: other.character.place ?? null,
      cause: 'crew:people',
      knownBy: [p.entity.id],
    });
  }
}

export function crewMonth(env: LifeEnv): void {
  const { state, data, tick, p } = env;
  seedLegends(state, data, tick);
  listingsMonth(env);
  const explored = (env.life.report?.tick === tick ? env.life.report.done : []).some(
    (d) => data.activities[d.activity]?.category === 'explore',
  );
  legendsMonth(env, explored);
  questMonth(env, (other) => {
    conclude(env, other, 'quest');
  });
  peopleMonth(env);
  const crewEnt = crewLedBy(state, p.entity);
  const crew = crewEnt?.crew;
  if (!crewEnt || !crew) return;

  // The dead are mourned; everyone else is where the captain is; a passenger bound somewhere arrives.
  const here = hereOf(data, p.entity);
  for (const member of [...crew.members]) {
    const entity = state.entities[member.id];
    if (!entity?.character?.alive) {
      mourn(env, crewEnt, member, entity);
      continue;
    }
    entity.tier = 1;
    if (member.away === null && here) entity.character.place = here;
    if (member.bound && here === member.bound) {
      // "Take me somewhere": they are where they wanted to be, and stay aboard.
      member.bound = null;
      const q = entity.character.recruit?.quest;
      if (q && q.status === 'open') {
        q.progress = 1;
        q.status = 'met';
        crewSay(
          env,
          crewEnt,
          entity,
          'questDone',
          { quest: questText(state, data, entity) ?? 'a passage' },
          'good',
          ['quest', 'questDone:escort'],
        );
        moveCrewBar(
          data,
          p.entity,
          entity,
          'loyalty',
          12,
          'Brought where they wanted to go',
          undefined,
          tick,
        );
      }
    }
  }
  if (crew.auto) autoFill(state, data, crewEnt, tick);
  for (const t of serviceMonth(state, data, crew, p.entity, situationNow(p.entity), tick)) {
    const who = state.entities[t.id];
    if (who) crewSay(env, crewEnt, who, 'title', { post: t.title }, 'good', ['title']);
  }
  payMonth(env, crewEnt);
  moraleMonth(env, crewEnt);
  disciplineMonth(env, crewEnt);
  chemistryMonth(env, crewEnt);

  // Every crewmate's month of training and story (faster at a base's training ground or library).
  const base = baseHere(state, data, p.entity);
  const mult = {
    body: 1 + (base ? roomValue(data, base, 'training') : 0),
    mind: 1 + (base ? roomValue(data, base, 'library') : 0),
  };
  for (const { member, entity } of membersOf(state, crew)) {
    const g = memberGrowth(
      state,
      data,
      crew,
      member,
      entity,
      tick,
      env.rng.fork('growth', member.id),
      mult,
    );
    for (const t of g.taught) {
      const teacher = state.entities[t.by];
      if (teacher)
        crewSay(
          env,
          crewEnt,
          teacher,
          'taught',
          { other: entity.name, target: data.tracks[t.track]?.name ?? t.track },
          'good',
          ['taught', 'growth'],
        );
    }
    for (const t of g.techniques)
      crewSay(env, crewEnt, entity, 'technique', { target: t.name }, 'good', [
        'technique',
        'growth',
        ...(t.taughtBy ? ['technique:taught'] : []),
      ]);
    for (const name of g.woke)
      crewSay(env, crewEnt, entity, 'hakiWoke', { target: name }, 'alert', ['haki', 'growth']);
    arcMonth(env, crewEnt, member, entity);
  }
  livesMonth(env, crewEnt);
  missionsMonth(env, crewEnt);
  fleetMonth(env, crewEnt);
  alliancesMonth(env, crewEnt);
  basesMonth(env, crewEnt);
  prisonersMonth(env, crewEnt);
  spiesMonth(env, crewEnt);
  betrayalMonth(env, crewEnt);
  portMonth(env, crewEnt);
  if (tick > crew.foundedTick && (tick - crew.foundedTick) % 12 === 0)
    tradition(env, crewEnt, 'anniversary', null);
  if (here && p.c.travel?.arrivedTick === tick) {
    crewLog(
      crew,
      tick,
      renderCrew(state, data, crewEnt, null, crewLine(data, 'logVoyage'), env.rng.fork('log'), {
        target: data.locations[here]?.name ?? here,
      }),
    );
    crew.tally['voyages'] = (crew.tally['voyages'] ?? 0) + 1;
    tradition(env, crewEnt, 'voyage', null);
  }
}

// ---- Hooks: the heart, fights and deeds reach the crew ------------------------------------------

/** The heart's Recruit intent landed: they are listening (their doubts, then perhaps a condition). */
crewHooks.join = (rawEnv, rawOther, _seq, how) => {
  const env = rawEnv as LifeEnv;
  const other = rawOther as Entity;
  if (!other.character?.alive || other.flags['crew.of'] === env.p.entity.id) return;
  const r = recruitOf(other);
  r.listening = true;
  if (how === 'spared') other.flags['recruit.source'] = 'spared';
  if (how !== 'spared' && openObjections(env.state, env.data, env.p.entity, other).length > 0) {
    crewSay(env, crewLedBy(env.state, env.p.entity), other, 'listening', {}, 'good', ['recruit']);
    return;
  }
  conclude(env, other, how);
};

crewHooks.leave = (rawState, rawData, otherId, why) => {
  const state = rawState as WorldState;
  const data = rawData as GameData;
  const crewEnt = state.playerId ? crewLedBy(state, state.entities[state.playerId]) : null;
  if (crewEnt) removeMember(state, data, crewEnt, otherId, why, state.tick);
};

crewHooks.talked = (rawState, otherId) => {
  const state = rawState as WorldState;
  const data = heartData.get(state);
  if (data) arcTalked(state, data, otherId);
};

/** The talked hook has no data argument (heart/talk passes only the state): remembered here. */
const heartData = new WeakMap<WorldState, GameData>();
export function rememberData(state: WorldState, data: GameData): void {
  heartData.set(state, data);
}

/** A deed of the player's: the creed's rules it breaks or keeps, and promises it breaks. */
crewHooks.deed = (rawEnv, tags, seq) => {
  const env = rawEnv as LifeEnv;
  const { state, data, tick, p } = env;
  const crewEnt = crewLedBy(state, p.entity);
  const crew = crewEnt?.crew;
  if (!crewEnt || !crew || tags.length === 0) return;
  const members = membersOf(state, crew);
  for (const rule of data.crew.creed) {
    const option = rule.options.find((o) => o.id === crew.creed[rule.id]);
    if (!option) continue;
    const broke = option.breaks.some((t) => tags.includes(t));
    const kept = !broke && option.keeps.some((t) => tags.includes(t));
    if (!broke && !kept) continue;
    const key = `creed.${rule.id}`;
    if (crew.tally[key] === tick) continue;
    crew.tally[key] = tick;
    const record = crewSay(
      env,
      crewEnt,
      null,
      broke ? 'creedBroken' : 'creedKept',
      { quest: `${rule.name.toLowerCase()}: ${option.name.toLowerCase()}` },
      broke ? 'bad' : 'good',
      ['creed', broke ? 'broken' : 'kept'],
    );
    for (const { entity } of members) {
      // How much they care that it is kept: by their nature (cares), and a little for anyone.
      const axes = heartOrRoll(state, data, entity).profile.axes;
      let care = 10;
      for (const [axis, w] of Object.entries(option.cares))
        care += ((w ?? 0) * (axes[axis] ?? 0)) / 100;
      const weight = Math.max(0, Math.min(2, care / 30));
      const by = broke
        ? data.crew.loyalty.creedBreak * weight
        : data.crew.loyalty.creedKeep * weight;
      if (Math.abs(by) >= 0.1)
        moveCrewBar(
          data,
          p.entity,
          entity,
          'loyalty',
          Math.round(by * 10) / 10,
          broke
            ? `The creed broken (${rule.name.toLowerCase()})`
            : `The creed kept (${rule.name.toLowerCase()})`,
          record.seq,
          tick,
        );
    }
  }
  // Promises made while recruiting: "never hurt the innocent", broken by cruelty.
  if (tags.some((t) => t === 'prey' || t === 'cruel' || t === 'merciless'))
    for (const { entity } of members) {
      const r = entity.character?.recruit;
      if (!r || !(r.promised.includes('distrust') || r.promised.includes('cause'))) continue;
      const theirs = relOf(entity, p.entity.id);
      if (theirs) {
        moveCrewBar(data, p.entity, entity, 'loyalty', -10, 'A promise broken', seq, tick);
        remember(state, data, entity, {
          about: p.entity.id,
          kind: 'betrayal',
          weight: 25,
          place: hereOf(data, p.entity),
          ...(seq !== undefined ? { seq } : {}),
        });
      }
    }
};

/** A fight is over: quest fights, then the crew's share of a battle (morale, loot, bounties, hurt). */
crewHooks.fought = (rawState, rawData, rawBattle) => {
  const state = rawState as WorldState;
  const data = rawData as GameData;
  const battle = rawBattle as BattleState;
  const won = battle.result?.how === 'won';
  if (battle.source.id.startsWith('crew:'))
    questFightDone(state, data, battle.source.id, battle.source.roles?.['other'], won);
  const env = heartEnv(state, data, `battle:${battle.source.id}`);
  if (!env || battle.spar) return;
  const crewEnt = crewLedBy(state, env.p.entity);
  const crew = crewEnt?.crew;
  if (battle.result?.how === 'fled') crewHooks.deed?.(env, ['cowardly'], undefined);
  if (!crewEnt || !crew) return;
  const big =
    battle.scale === 'crew' ||
    battle.scale === 'naval' ||
    battle.scale === 'war' ||
    battle.scale === 'skirmish';
  if (!big || !battle.result) return;
  const tick = state.tick;
  const ours = new Set(crew.members.map((m) => m.id));
  const fought = battle.fighters.filter((f) => f.side === 0 && f.entityId && ours.has(f.entityId));
  crew.tally[won ? 'won' : 'lost'] = (crew.tally[won ? 'won' : 'lost'] ?? 0) + 1;
  crew.morale = Math.max(
    0,
    Math.min(100, crew.morale + (won ? data.crew.morale.win : data.crew.morale.loss)),
  );
  const record = appendLog(state, tick, {
    kind: 'life',
    summary: `${crewEnt.name}: ${won ? 'a battle won' : 'a battle lost'} against ${battle.sides[1].name}.`,
    tags: ['personal', 'crew', 'battle'],
    actorIds: [env.p.entity.id],
    targetIds: fought.map((f) => f.entityId as string),
    place: battle.place,
    cause: `battle:${battle.source.id}`,
    knownBy: [env.p.entity.id],
  });
  for (const { entity } of membersOf(state, crew))
    moveCrewBar(
      data,
      env.p.entity,
      entity,
      'loyalty',
      won ? data.crew.loyalty.win : data.crew.loyalty.loss,
      won ? 'Victories' : 'Defeats',
      record.seq,
      tick,
    );
  crewLog(
    crew,
    tick,
    `${won ? 'Beat' : 'Lost to'} ${battle.sides[1].name}${battle.place ? ` at ${data.locations[battle.place]?.name ?? battle.place}` : ' at sea'}.`,
  );
  tradition(env, crewEnt, won ? 'victory' : 'loss', null);
  for (const f of fought) {
    const m = crew.members.find((x) => x.id === f.entityId);
    if (m && (f.down === 'ko' || f.hp < f.maxHp * 0.3)) m.hurtUntil = tick + 2;
  }
  if (!won) return;
  // Bounties for an outlaw crew's fighters; loot to split.
  const kind = kindOf(data, crew);
  const foes = battle.fighters.filter((f) => f.side === 1);
  const foePower =
    foes.reduce((n, f) => n + f.cp, 0) + battle.sides[1].ranks * battle.sides[1].rankPower * 0.2;
  if (kind.outlaw)
    for (const f of fought) {
      const e = state.entities[f.entityId as string];
      const role = byId(
        data.crew.roles,
        crew.members.find((x) => x.id === f.entityId)?.role ?? 'hand',
      );
      if (e)
        giveBounty(
          env,
          crewEnt,
          e,
          Math.round(
            (foePower / Math.max(1, fought.length)) *
              data.crew.bounty.perPower *
              (role?.bounty ?? 1),
          ),
        );
    }
  const loot = Math.round((foePower * 25) / 1000) * 1000;
  if (loot > 0 && crew.members.length > 0 && byId(data.crew.pays, crew.pay)?.shares !== false)
    pushCrewDecision(state, data, {
      kind: 'loot',
      title: 'The loot',
      text: `${loot.toLocaleString('en-GB')} Berries' worth from ${battle.sides[1].name}. How is it split?`,
      choices: [
        { id: 'equal', label: 'Equal shares' },
        { id: 'rank', label: 'By rank' },
        { id: 'lion', label: 'The lion’s share for you' },
        { id: 'bank', label: 'Into the common purse' },
      ],
      roles: { amount: String(loot) },
    });
  void combatPowerOf;
  void reputationValue;
  void tone;
};

export { takePrisoners };
