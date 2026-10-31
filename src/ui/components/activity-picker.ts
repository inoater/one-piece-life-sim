import type { ActivityView, LifeView } from '../../worker/protocol';
import { h } from '../dom';
import { openModal, type ModalHandle } from './modal';

/**
 * The activity picker: a popup with everything there is to do this month, as cards, filterable by
 * kind and by a word, each saying what it trains, earns, costs and risks, and why it is locked if
 * it is. Choosing a card fills the routine slot it was opened for (or the first free one).
 */

const RISK_LABEL: Record<ActivityView['risk'], string> = {
  none: '',
  low: 'small risk',
  some: 'some risk',
  high: 'dangerous',
};

/** The short facts about an activity, as chips. */
export function activityFacts(a: ActivityView, life: LifeView): string[] {
  const normal = life.efforts.find((e) => e.id === 'normal')?.vigor ?? 0;
  return [
    a.restful ? 'restful' : `${normal + a.extraVigor} Vigor`,
    a.trains.length > 0 ? `trains ${a.trains.join(', ')}` : '',
    a.practice ? `practises ${a.practice}` : '',
    a.earns ? `earns ${a.earns}` : '',
    a.costs ? `costs ${a.costs}` : '',
    a.oneOff ? 'once, then off the routine' : '',
    RISK_LABEL[a.risk],
    a.usesMentor ? 'better with a mentor' : '',
  ].filter((t) => t !== '');
}

export interface PickerOptions {
  life: LifeView;
  /** The slot being filled (null: browsing; a choice fills the first free slot). */
  slot: number | null;
  onChoose: (activityId: string) => void;
}

export function openActivityPicker(options: PickerOptions): ModalHandle {
  const { life, slot } = options;
  // Phase 6: overtime slots count too.
  const slots = life.slots + (life.slots > 0 ? life.drive.overtime : 0);
  const planned = new Set(life.routine.slice(0, slots).map((s) => s.activity));
  const chosen = slot !== null ? (life.routine[slot]?.activity ?? null) : null;
  const free = slot !== null || life.routine.length < slots;
  let category = 'all';
  let query = '';
  let showLocked = false;

  const search = h('input', {
    class: 'picker__search',
    type: 'search',
    placeholder: 'Search: "spar", "money", "Strength"...',
    'aria-label': 'Search activities',
  });
  const chips = h('div', {
    class: 'picker__chips',
    role: 'group',
    'aria-label': 'Kinds of activity',
  });
  const lockedToggle = h('input', { type: 'checkbox', class: 'picker__toggle' });
  const grid = h('ul', { class: 'picker__grid', 'aria-live': 'polite' });
  const empty = h('p', { class: 'muted', hidden: true }, 'Nothing matches.');

  const matches = (a: ActivityView) => {
    if (category !== 'all' && a.category !== category) return false;
    if (!showLocked && a.lock !== null && a.id !== chosen) return false;
    if (!query) return true;
    const hay = [a.name, a.description, ...activityFacts(a, life)].join(' ').toLowerCase();
    return query.split(/\s+/).every((w) => hay.includes(w));
  };

  const card = (a: ActivityView): HTMLElement => {
    // A month scaled by Vigor: the same activity may fill more than one slot (more of it).
    const taken = planned.has(a.id) && a.id !== chosen;
    const reason = a.lock;
    const isChosen = a.id === chosen;
    return h(
      'li',
      { class: 'picker__item' },
      h(
        'button',
        {
          class: `activity-card${isChosen ? ' activity-card--chosen' : ''}`,
          type: 'button',
          'aria-label': `${a.name}${reason ? `: ${reason}` : taken ? ' (planned already: again)' : ''}`,
          disabled: reason !== null || !free,
          dataset: { activity: a.id, category: a.category, locked: String(a.lock !== null) },
          onclick: () => {
            options.onChoose(a.id);
            handle.close();
          },
        },
        h(
          'span',
          { class: 'activity-card__head' },
          h('span', { class: 'activity-card__name' }, a.name),
          isChosen ? h('span', { class: 'activity-card__tag' }, 'Chosen') : null,
          taken ? h('span', { class: 'activity-card__tag' }, 'Planned: again') : null,
        ),
        h('span', { class: 'activity-card__text' }, a.description),
        h(
          'span',
          { class: 'activity-card__facts' },
          activityFacts(a, life).map((f) => h('span', { class: 'chip-fact' }, f)),
        ),
        reason ? h('span', { class: 'activity-card__lock' }, reason) : null,
      ),
    );
  };

  const draw = () => {
    const list = life.activities.filter(matches);
    grid.replaceChildren(...list.map(card));
    empty.hidden = list.length > 0;
    for (const chip of chips.querySelectorAll<HTMLButtonElement>('button')) {
      chip.setAttribute('aria-pressed', String(chip.dataset['category'] === category));
    }
  };

  const chip = (id: string, label: string, open: number, total: number) =>
    h(
      'button',
      {
        class: 'chip picker__chip',
        type: 'button',
        dataset: { category: id },
        onclick: () => {
          category = id;
          draw();
        },
      },
      `${label} `,
      h('span', { class: 'muted' }, total > 0 ? `${open}` : ''),
    );
  const openCount = (acts: ActivityView[]) => acts.filter((a) => a.lock === null).length;
  chips.append(chip('all', 'All', openCount(life.activities), life.activities.length));
  for (const c of life.categories) {
    const acts = life.activities.filter((a) => a.category === c.id);
    if (acts.length > 0) chips.append(chip(c.id, c.label, openCount(acts), acts.length));
  }
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    draw();
  });
  lockedToggle.addEventListener('change', () => {
    showLocked = lockedToggle.checked;
    draw();
  });

  const body = h(
    'div',
    { class: 'picker' },
    h(
      'p',
      { class: 'picker__lead' },
      slot !== null
        ? `For slot ${slot + 1} of your month. It repeats every month until you change it.`
        : free
          ? 'Choosing one puts it in the first free slot of your month.'
          : 'Every slot is taken: change one in your routine to make room.',
    ),
    search,
    chips,
    h('label', { class: 'picker__locked' }, lockedToggle, ' Show what is out of reach, and why'),
    grid,
    empty,
  );
  const handle = openModal({
    title: slot !== null ? 'Choose an activity' : 'Everything you could do',
    body,
    className: 'modal--wide',
  });
  draw();
  search.focus();
  return handle;
}
