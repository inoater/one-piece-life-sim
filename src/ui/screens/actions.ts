import type { LifeView } from '../../worker/protocol';
import type { App } from '../app';
import { activityFacts, openActivityPicker } from '../components/activity-picker';
import { confirmButton } from '../components/confirm-button';
import { h, type Child } from '../dom';
import { formatInteger, plural } from '../format';
import type { UiState } from '../store';
import { travelSections } from './travel';

/**
 * The Actions tab: how the month is spent (Phase 2). A routine of activity slots (how many depends
 * on the stage of life), each with an effort; it repeats every month until changed. Below it, the
 * job, money and health, and everything there is to do, with the reason anything is locked: age,
 * place, injury, money or a cell. Every change is an action sent to the simulation; the page never
 * decides what is allowed (the locks come from the same code the month runs).
 */

type Effort = LifeView['efforts'][number]['id'];
type Slot = { activity: string; effort: Effort; commit?: number };

/** Slots this month can hold: the stage's own, and the overtime a deep Vigor pool opens (Phase 6). */
function slotCount(life: LifeView): number {
  return life.slots + (life.slots > 0 ? life.drive.overtime : 0);
}

function sendRoutine(app: App, life: LifeView, routine: Slot[], note: string) {
  void app.dispatch({ type: 'life/routine', routine: routine.slice(0, slotCount(life)) }, note);
}

function current(life: LifeView): Slot[] {
  return life.routine.slice(0, slotCount(life)).map((s) => ({
    activity: s.activity,
    effort: s.effort,
    ...(s.commit > 0 && s.effort === 'hard' ? { commit: s.commit } : {}),
  }));
}

/**
 * Spend the rest of the pool: push the Hard slots further first (up to what the pool allows), then
 * add more of the last working activity at Hard, until the plan uses the Vigor there is.
 */
export function fillVigor(life: LifeView): Slot[] {
  const routine = current(life);
  const hard = life.efforts.find((e) => e.id === 'hard')?.vigor ?? 3;
  const cost = (s: Slot, i: number) => {
    const act = life.activities.find((a) => a.id === s.activity);
    if (!act || act.restful) return 0;
    const effort = life.efforts.find((e) => e.id === s.effort)?.vigor ?? 2;
    return effort + (s.commit ?? 0) + (i >= life.slots ? life.drive.surcharge : 0);
  };
  const planned = () => routine.reduce((n, s, i) => n + cost(s, i), 0);
  const work = [...routine]
    .reverse()
    .find((s) => !life.activities.find((a) => a.id === s.activity)?.restful);
  // More of the last working activity, while slots and Vigor last.
  while (
    work &&
    routine.length < slotCount(life) &&
    planned() + hard + life.drive.surcharge <= life.vigor.pool
  )
    routine.push({ activity: work.activity, effort: 'hard' });
  // Then push Hard slots one point at a time, round and round.
  for (let guard = 0; guard < 200 && planned() < life.vigor.pool; guard++) {
    const target = routine.findIndex(
      (s) =>
        s.effort === 'hard' &&
        (s.commit ?? 0) < life.drive.commitMax &&
        !life.activities.find((a) => a.id === s.activity)?.restful,
    );
    const softer = routine.findIndex(
      (s) => s.effort !== 'hard' && !life.activities.find((a) => a.id === s.activity)?.restful,
    );
    if (softer >= 0) routine[softer] = { activity: routine[softer]!.activity, effort: 'hard' };
    else if (target >= 0) {
      const lowest = routine.reduce(
        (best, s, i) =>
          s.effort === 'hard' &&
          !life.activities.find((a) => a.id === s.activity)?.restful &&
          (s.commit ?? 0) < life.drive.commitMax &&
          (best < 0 || (s.commit ?? 0) < (routine[best]?.commit ?? 0))
            ? i
            : best,
        -1,
      );
      const s = routine[lowest]!;
      routine[lowest] = { ...s, commit: (s.commit ?? 0) + 1 };
    } else break;
  }
  return routine;
}

function choose(life: LifeView, index: number | null, app: App, activity: string): void {
  const routine = current(life);
  const name = life.activities.find((a) => a.id === activity)?.name ?? activity;
  if (index === null || index >= routine.length) routine.push({ activity, effort: 'normal' });
  else routine[index] = { activity, effort: routine[index]?.effort ?? 'normal' };
  sendRoutine(app, life, routine, `Planned: ${name}.`);
}

/** One slot of the month: what is planned in it, or a button to choose something. */
function slotCard(life: LifeView, index: number, app: App, busy: boolean): HTMLElement {
  const slot = life.routine[index];
  const act = slot ? life.activities.find((a) => a.id === slot.activity) : undefined;
  const pick = () =>
    openActivityPicker({ life, slot: index, onChoose: (id) => choose(life, index, app, id) });
  if (!slot || !act) {
    return h(
      'button',
      {
        class: 'slot-card slot-card--empty',
        type: 'button',
        disabled: busy,
        'aria-label': `Choose an activity for slot ${index + 1}`,
        onclick: pick,
      },
      h('span', { class: 'slot-card__plus', 'aria-hidden': 'true' }, '+'),
      h('span', null, 'Choose an activity'),
    );
  }
  return h(
    'div',
    { class: 'slot-card', dataset: { activity: act.id, category: act.category } },
    h(
      'div',
      { class: 'slot-card__head' },
      h('span', { class: 'slot-card__name' }, act.name),
      h(
        'span',
        { class: 'slot-card__buttons' },
        h(
          'button',
          {
            class: 'button button--tiny',
            type: 'button',
            disabled: busy,
            'aria-label': `Change activity ${index + 1}`,
            onclick: pick,
          },
          'Change',
        ),
        h(
          'button',
          {
            class: 'button button--tiny button--quiet',
            type: 'button',
            disabled: busy,
            'aria-label': `Clear activity ${index + 1}`,
            onclick: () => {
              const routine = current(life);
              routine.splice(index, 1);
              sendRoutine(app, life, routine, 'Slot cleared.');
            },
          },
          'Clear',
        ),
      ),
    ),
    h('p', { class: 'slot-card__text' }, act.description),
    h(
      'p',
      { class: 'slot-card__facts' },
      activityFacts(act, life)
        .slice(1)
        .map((f) => h('span', { class: 'chip-fact' }, f)),
    ),
  );
}

function effortPicker(life: LifeView, index: number, app: App, busy: boolean): HTMLElement {
  const slot = life.routine[index];
  const act = life.activities.find((a) => a.id === slot?.activity);
  const restful = act?.restful ?? false;
  const extra = act?.extraVigor ?? 0;
  return h(
    'div',
    { class: 'effort', role: 'group', 'aria-label': `Effort for activity ${index + 1}` },
    life.efforts.map((e) =>
      h(
        'button',
        {
          class: 'effort__option',
          type: 'button',
          'aria-pressed': String(slot?.effort === e.id),
          disabled: busy || !slot || restful,
          title: restful ? 'Rest costs no Vigor' : `${e.name}: ${e.vigor + extra} Vigor`,
          onclick: () => {
            const routine = current(life);
            const at = routine[index];
            if (!at) return;
            at.effort = e.id;
            if (e.id !== 'hard') delete at.commit;
            sendRoutine(app, life, routine, `${e.name} effort.`);
          },
        },
        e.name,
        restful ? null : h('span', { class: 'effort__cost' }, ` ${e.vigor + extra}`),
      ),
    ),
  );
}

/**
 * Pushing a Hard slot further (Phase 6): each point past Hard costs one more Vigor and multiplies
 * what the slot gives (training, practice, pay, a project's pace), at more risk. How far depends
 * on the Vigor pool.
 */
function pushPicker(life: LifeView, index: number, app: App, busy: boolean): HTMLElement | null {
  const slot = life.routine[index];
  const act = life.activities.find((a) => a.id === slot?.activity);
  if (!slot || !act || act.restful || slot.effort !== 'hard' || life.drive.commitMax === 0)
    return null;
  const set = (n: number) => {
    const routine = current(life);
    const at = routine[index];
    if (!at) return;
    if (n > 0) at.commit = n;
    else delete at.commit;
    sendRoutine(app, life, routine, n > 0 ? `Pushed ${n} past Hard.` : 'Back to plain Hard.');
  };
  const gain = life.drive.commitGains[slot.commit] ?? 1;
  return h(
    'div',
    { class: 'push', role: 'group', 'aria-label': `Push activity ${index + 1} past Hard` },
    h('span', { class: 'push__label' }, 'Push past Hard'),
    h(
      'button',
      {
        class: 'button button--tiny',
        type: 'button',
        disabled: busy || slot.commit <= 0,
        'aria-label': 'Less',
        onclick: () => set(slot.commit - 1),
      },
      '−',
    ),
    h('span', { class: 'push__value' }, slot.commit > 0 ? `+${slot.commit}` : '0'),
    h(
      'button',
      {
        class: 'button button--tiny',
        type: 'button',
        disabled: busy || slot.commit >= life.drive.commitMax,
        'aria-label': 'More',
        onclick: () => set(slot.commit + 1),
      },
      '+',
    ),
    h(
      'span',
      { class: 'push__facts muted' },
      slot.commit > 0
        ? ` ${slot.vigor} Vigor, gains ×${(gain * 1.5).toFixed(2)} (Hard alone ×1.50), pay +${Math.round(life.drive.commitPay * slot.commit * 100)}%, risk +${Math.round(life.drive.commitRisk * slot.commit * 100)}%. Up to +${life.drive.commitMax} with your Vigor.`
        : ` Up to +${life.drive.commitMax} with your Vigor (each +1 Vigor).`,
    ),
  );
}

function meter(value: number, max: number, label: string, tone: string): HTMLElement {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return h(
    'div',
    { class: 'meter', dataset: { tone }, role: 'img', 'aria-label': label },
    h('span', { class: 'meter__fill', style: `width: ${pct.toFixed(1)}%` }),
  );
}

function routineSection(life: LifeView, app: App, busy: boolean): HTMLElement {
  const over = life.vigor.planned > life.vigor.pool;
  const slots: HTMLElement[] = [];
  // The stage's own slots, what is planned beyond them, and one more to add while Vigor allows.
  const total = Math.min(slotCount(life), Math.max(life.slots, life.routine.length + 1));
  for (let i = 0; i < total; i++) {
    const slot = life.routine[i];
    const overtime = i >= life.slots;
    slots.push(
      h(
        'li',
        {
          class: overtime ? 'routine__slot routine__slot--overtime' : 'routine__slot',
          dataset: { locked: String(Boolean(slot?.lock)), overtime: String(overtime) },
        },
        h('span', { class: 'routine__number', 'aria-hidden': 'true' }, String(i + 1)),
        h(
          'div',
          { class: 'routine__body' },
          overtime
            ? h(
                'p',
                { class: 'routine__overtime' },
                `Overtime: +${life.drive.surcharge} Vigor on top of its effort.`,
              )
            : null,
          slotCard(life, i, app, busy),
          slot ? effortPicker(life, i, app, busy) : null,
          slot ? pushPicker(life, i, app, busy) : null,
          slot?.lock ? h('p', { class: 'routine__lock' }, `Will be skipped: ${slot.lock}.`) : null,
        ),
      ),
    );
  }
  return h(
    'section',
    { class: 'planner__section', 'aria-labelledby': 'routine-title' },
    h('h2', { class: 'side-screen__title', id: 'routine-title' }, 'Each month'),
    life.slots === 0
      ? h(
          'p',
          null,
          `At ${life.age} there is nothing to choose: months pass on their own, and you grow.`,
        )
      : [
          h(
            'p',
            { class: 'planner__lead' },
            `${life.stage}: ${plural(life.slots, 'activity', 'activities')} a month. The routine repeats until you change it.`,
            life.drive.overtime > 0
              ? ` Your Vigor (${life.vigor.pool}) opens up to ${plural(life.drive.overtime, 'more slot')} (one for every ${life.drive.perSlot} Vigor), and a Hard slot can be pushed up to +${life.drive.commitMax}: plan until the Vigor runs out.`
              : life.slots >= 2
                ? ` With ${life.drive.perSlot} Vigor you would have an overtime slot.`
                : '',
          ),
          h(
            'div',
            { class: 'planner__vigor' },
            h(
              'span',
              null,
              `Vigor ${life.vigor.planned} of ${life.vigor.pool}`,
              over ? ' planned: you will end the month exhausted' : ' planned',
            ),
            meter(
              life.vigor.planned,
              life.vigor.pool,
              `Vigor planned ${life.vigor.planned} of ${life.vigor.pool}`,
              over ? 'bad' : 'vigor',
            ),
            life.vigor.planned < life.vigor.pool && life.routine.length > 0
              ? h(
                  'button',
                  {
                    class: 'button button--tiny planner__fill',
                    type: 'button',
                    disabled: busy,
                    onclick: () =>
                      sendRoutine(app, life, fillVigor(life), 'Every bit of Vigor is planned.'),
                  },
                  `Use the other ${life.vigor.pool - life.vigor.planned} Vigor`,
                )
              : null,
          ),
          h('ol', { class: 'routine' }, slots),
        ],
  );
}

function workSection(life: LifeView, app: App, busy: boolean): HTMLElement {
  const job = life.job;
  const open = life.jobs.filter((j) => j.lock === null);
  const closed = life.jobs.filter((j) => j.lock !== null && j.id !== job?.id);
  const jobRow = (j: LifeView['jobs'][number]) =>
    h(
      'li',
      { class: 'option', dataset: { locked: String(j.lock !== null) } },
      h(
        'div',
        { class: 'option__main' },
        h('span', { class: 'option__name' }, j.name),
        h('span', { class: 'option__meta' }, `${j.income} a month. ${j.requirement}.`),
        h('span', { class: 'option__text' }, j.description),
        j.lock ? h('span', { class: 'option__lock' }, j.lock) : null,
      ),
      j.lock === null
        ? h(
            'button',
            {
              class: 'button button--tiny',
              type: 'button',
              disabled: busy,
              onclick: () =>
                void app.dispatch({ type: 'life/job', jobId: j.id }, `Hired: ${j.name}.`),
            },
            job ? 'Switch' : 'Take',
          )
        : null,
    );
  return h(
    'section',
    { class: 'planner__section', 'aria-labelledby': 'work-title' },
    h('h2', { class: 'side-screen__title', id: 'work-title' }, 'Work'),
    job
      ? h(
          'div',
          { class: 'job-card' },
          h(
            'p',
            null,
            h('strong', null, job.title ? `${job.name}, ${job.title}` : job.name),
            `. ${job.income} Berries a month of shifts, ${plural(job.months, 'month')} worked.`,
          ),
          life.routine.some((s) => s.activity === 'act_work_shift')
            ? null
            : h('p', { class: 'routine__lock' }, 'Add "Work a shift" to your routine to be paid.'),
          confirmButton({
            label: 'Quit',
            confirmLabel: 'Press again to quit',
            className: 'button button--quiet button--tiny',
            disabled: busy,
            onConfirm: () => void app.dispatch({ type: 'life/job', jobId: null }, 'You quit.'),
          }),
        )
      : h('p', null, open.length > 0 ? 'No job yet.' : 'No job, and none you can take yet.'),
    open.length > 0 ? h('ul', { class: 'options' }, open.map(jobRow)) : null,
    closed.length > 0
      ? h(
          'details',
          { class: 'planner__more' },
          h('summary', null, `Jobs out of reach (${closed.length})`),
          h('ul', { class: 'options' }, closed.map(jobRow)),
        )
      : null,
  );
}

function moneySection(life: LifeView, app: App, busy: boolean): HTMLElement {
  const m = life.money;
  return h(
    'section',
    { class: 'planner__section', 'aria-labelledby': 'money-title' },
    h('h2', { class: 'side-screen__title', id: 'money-title' }, 'Money'),
    h(
      'dl',
      { class: 'facts' },
      h(
        'div',
        { class: 'facts__row' },
        h('dt', null, 'In hand'),
        h('dd', null, `${formatInteger(m.berries)} Berries`),
      ),
      h(
        'div',
        { class: 'facts__row' },
        h('dt', null, 'Debt'),
        h(
          'dd',
          null,
          m.debt > 0 ? `${formatInteger(m.debt)} Berries, ${m.interestPct}% a month` : 'None',
        ),
      ),
      h(
        'div',
        { class: 'facts__row' },
        h('dt', null, 'Cost of living'),
        h(
          'dd',
          null,
          m.paysOwnWay ? `${formatInteger(m.livingCost)} Berries a month` : 'Your family provides',
        ),
      ),
    ),
    h(
      'div',
      { class: 'planner__buttons' },
      m.loans.map((loan) =>
        h(
          'button',
          {
            class: 'button button--tiny',
            type: 'button',
            disabled: busy || loan.lock !== null,
            title: loan.lock ?? `Borrow ${formatInteger(loan.amount)} at ${m.interestPct}% a month`,
            onclick: () =>
              void app.dispatch(
                { type: 'life/borrow', amount: loan.amount },
                `Borrowed ${formatInteger(loan.amount)} Berries.`,
              ),
          },
          `Borrow ${formatInteger(loan.amount)}`,
        ),
      ),
      m.debt > 0
        ? h(
            'button',
            {
              class: 'button button--tiny',
              type: 'button',
              disabled: busy || m.berries <= 0,
              onclick: () =>
                void app.dispatch(
                  { type: 'life/repay', amount: Math.min(m.debt, m.berries) },
                  'Paid toward the debt.',
                ),
            },
            `Repay ${formatInteger(Math.min(m.debt, Math.max(0, m.berries)))}`,
          )
        : null,
    ),
  );
}

function healthSection(life: LifeView): HTMLElement {
  const items: Child[] = [
    ...life.injuries.map((i) =>
      h(
        'li',
        null,
        `${i.name.charAt(0).toUpperCase()}${i.name.slice(1)} (${i.severity}, ${i.area}): heals ${i.heals}.`,
      ),
    ),
    ...life.illnesses.map((i) =>
      h('li', null, `${i.name.charAt(0).toUpperCase()}${i.name.slice(1)}: over by ${i.heals}.`),
    ),
  ];
  return h(
    'section',
    { class: 'planner__section', 'aria-labelledby': 'health-title' },
    h('h2', { class: 'side-screen__title', id: 'health-title' }, 'Health'),
    h(
      'div',
      { class: 'planner__vigor' },
      h('span', null, `Health ${life.health.current} of ${life.health.max}`),
      meter(
        life.health.current,
        life.health.max,
        `Health ${life.health.current} of ${life.health.max}`,
        life.health.current < life.health.max * 0.35 ? 'bad' : 'health',
      ),
    ),
    items.length > 0
      ? h('ul', { class: 'planner__list' }, items)
      : h('p', { class: 'muted' }, 'Nothing wrong with you.'),
    life.exhausted
      ? h(
          'p',
          { class: 'side-screen__alert' },
          'Exhausted: every stat is down until a restful month.',
        )
      : null,
    life.bedRest
      ? h(
          'p',
          { class: 'side-screen__alert' },
          'On bed rest: physical activities are locked until you heal.',
        )
      : null,
    h(
      'p',
      { class: 'muted' },
      `A doctor would charge ${formatInteger(life.money.doctorCost)} Berries right now.`,
    ),
  );
}

function catalogue(life: LifeView, app: App, busy: boolean): HTMLElement {
  const open = life.activities.filter((a) => a.lock === null).length;
  return h(
    'section',
    { class: 'planner__section', 'aria-labelledby': 'catalogue-title' },
    h('h2', { class: 'side-screen__title', id: 'catalogue-title' }, 'Everything you could do'),
    h(
      'p',
      { class: 'muted' },
      `${open} of ${life.activities.length} activities are open to you here and now; the rest say what stands in the way.`,
    ),
    h(
      'button',
      {
        class: 'button',
        type: 'button',
        disabled: busy,
        onclick: () =>
          openActivityPicker({ life, slot: null, onChoose: (id) => choose(life, null, app, id) }),
      },
      'Browse them all',
    ),
  );
}

export function renderActions(state: UiState, app: App): HTMLElement {
  const life = state.snapshot?.life ?? null;
  const waiting = state.snapshot?.pending.length ?? 0;
  const busy = state.busy !== null;
  const alert =
    waiting > 0
      ? h(
          'p',
          { class: 'side-screen__alert' },
          `${plural(waiting, 'decision')} waiting in the chronicle. Time will not move until you choose.`,
        )
      : null;
  if (!life) {
    return h(
      'div',
      { class: 'side-screen' },
      h('h2', { class: 'side-screen__title' }, 'Nobody to plan for'),
      h('p', null, 'Start a life to choose how each month is spent.'),
      h('p', null, h('a', { class: 'button button--primary', href: '#/new' }, 'Start a new life')),
      alert,
    );
  }
  if (!life.alive) {
    return h(
      'div',
      { class: 'side-screen' },
      h('h2', { class: 'side-screen__title' }, 'This life has ended'),
      h(
        'p',
        null,
        `${life.name} died${life.recap?.cause ? ` of ${life.recap.cause}` : ''}, aged ${life.recap?.age ?? life.age}.`,
      ),
      h(
        'p',
        null,
        h('a', { class: 'button button--primary', href: '#/end' }, 'Read the recap and carry on'),
      ),
    );
  }
  return h(
    'div',
    { class: 'side-screen planner' },
    alert,
    life.jailed
      ? h('p', { class: 'side-screen__alert' }, `${life.jailed}. Nothing to do but wait.`)
      : null,
    routineSection(life, app, busy),
    ...travelSections(state.snapshot?.travel ?? null, app, busy),
    healthSection(life),
    workSection(life, app, busy),
    moneySection(life, app, busy),
    catalogue(life, app, busy),
  );
}
