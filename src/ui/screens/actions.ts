import type { ActivityView, LifeView } from '../../worker/protocol';
import type { App } from '../app';
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

const RISK_LABEL: Record<ActivityView['risk'], string> = {
  none: '',
  low: 'small risk',
  some: 'some risk',
  high: 'dangerous',
};

function sendRoutine(
  app: App,
  life: LifeView,
  routine: { activity: string; effort: Effort }[],
  note: string,
) {
  void app.dispatch({ type: 'life/routine', routine: routine.slice(0, life.slots) }, note);
}

function current(life: LifeView): { activity: string; effort: Effort }[] {
  return life.routine.slice(0, life.slots).map((s) => ({ activity: s.activity, effort: s.effort }));
}

function activitySelect(life: LifeView, index: number, app: App, busy: boolean): HTMLSelectElement {
  const chosen = life.routine[index]?.activity ?? '';
  const select = h('select', {
    class: 'routine__select',
    'aria-label': `Activity ${index + 1}`,
    disabled: busy,
  });
  select.append(h('option', { value: '', selected: chosen === '' }, 'Nothing planned'));
  for (const category of life.categories) {
    const acts = life.activities.filter((a) => a.category === category.id);
    if (acts.length === 0) continue;
    const group = h('optgroup', { label: category.label });
    for (const a of acts) {
      const taken =
        a.id !== chosen && life.routine.slice(0, life.slots).some((s) => s.activity === a.id);
      const reason = a.lock ?? (taken ? 'Already planned' : null);
      group.append(
        h(
          'option',
          { value: a.id, disabled: reason !== null && a.id !== chosen, selected: a.id === chosen },
          reason ? `${a.name} (${reason.charAt(0).toLowerCase()}${reason.slice(1)})` : a.name,
        ),
      );
    }
    select.append(group);
  }
  select.value = chosen;
  select.addEventListener('change', () => {
    const routine = current(life);
    if (select.value === '') routine.splice(index, 1);
    else if (index < routine.length)
      routine[index] = { activity: select.value, effort: routine[index]?.effort ?? 'normal' };
    else routine.push({ activity: select.value, effort: 'normal' });
    const name = life.activities.find((a) => a.id === select.value)?.name;
    sendRoutine(app, life, routine, name ? `Planned: ${name}.` : 'Slot cleared.');
  });
  return select;
}

function effortPicker(life: LifeView, index: number, app: App, busy: boolean): HTMLElement {
  const slot = life.routine[index];
  const restful = life.activities.find((a) => a.id === slot?.activity)?.restful ?? false;
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
          title: restful ? 'Rest costs no Vigor' : `${e.name}: ${e.vigor} Vigor`,
          onclick: () => {
            const routine = current(life);
            const at = routine[index];
            if (!at) return;
            at.effort = e.id;
            sendRoutine(app, life, routine, `${e.name} effort.`);
          },
        },
        e.name,
      ),
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
  for (let i = 0; i < life.slots; i++) {
    const slot = life.routine[i];
    slots.push(
      h(
        'li',
        { class: 'routine__slot', dataset: { locked: String(Boolean(slot?.lock)) } },
        h('span', { class: 'routine__number', 'aria-hidden': 'true' }, String(i + 1)),
        h(
          'div',
          { class: 'routine__body' },
          activitySelect(life, i, app, busy),
          effortPicker(life, i, app, busy),
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
  const free = life.routine.length < life.slots;
  return h(
    'section',
    { class: 'planner__section', 'aria-labelledby': 'catalogue-title' },
    h('h2', { class: 'side-screen__title', id: 'catalogue-title' }, 'Everything you could do'),
    life.categories.map((category) => {
      const acts = life.activities.filter((a) => a.category === category.id);
      if (acts.length === 0) return null;
      const open = acts.filter((a) => a.lock === null).length;
      return h(
        'details',
        { class: 'planner__more' },
        h('summary', null, `${category.label} (${open} of ${acts.length} open)`),
        h(
          'ul',
          { class: 'options' },
          acts.map((a) => {
            const facts = [
              a.trains.length > 0 ? `Trains ${a.trains.join(', ')}` : '',
              a.earns ? `earns ${a.earns}` : '',
              a.costs ? `costs ${a.costs}` : '',
              a.restful ? 'restful' : '',
              a.oneOff ? 'once, then off the routine' : '',
              RISK_LABEL[a.risk],
              a.usesMentor ? 'better with a mentor' : '',
            ].filter((t) => t !== '');
            const planned = life.routine.some((s) => s.activity === a.id);
            return h(
              'li',
              { class: 'option', dataset: { locked: String(a.lock !== null) } },
              h(
                'div',
                { class: 'option__main' },
                h('span', { class: 'option__name' }, a.name),
                facts.length > 0
                  ? h('span', { class: 'option__meta' }, `${facts.join('; ')}.`)
                  : null,
                h('span', { class: 'option__text' }, a.description),
                a.lock ? h('span', { class: 'option__lock' }, a.lock) : null,
              ),
              a.lock === null && !planned && free
                ? h(
                    'button',
                    {
                      class: 'button button--tiny',
                      type: 'button',
                      disabled: busy,
                      onclick: () =>
                        sendRoutine(
                          app,
                          life,
                          [...current(life), { activity: a.id, effort: 'normal' }],
                          `Planned: ${a.name}.`,
                        ),
                    },
                    'Add',
                  )
                : planned
                  ? h('span', { class: 'option__tag' }, 'Planned')
                  : null,
            );
          }),
        ),
      );
    }),
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
