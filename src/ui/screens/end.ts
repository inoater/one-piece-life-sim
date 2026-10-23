import type { ContinueOption, LifeRecap, LifeView } from '../../worker/protocol';
import type { App } from '../app';
import { h } from '../dom';
import { formatInteger, formatValue, plural } from '../format';
import { navigate } from '../router';
import type { UiState } from '../store';

/**
 * The death screen (Phase 2, route #/end): a life recap (age, peak stats, fame, bounty, notable
 * deeds, news mentions, cause) and every way to carry on: an heir, a protégé, a crewmate, a
 * sibling, a newborn the same month, or a new game. Options with nobody to carry on as are shown
 * greyed out with the reason, so the list is the same every time.
 */

function recapSection(recap: LifeRecap): HTMLElement {
  const peakMax = Math.max(100, ...recap.peak.map((p) => p.value));
  return h(
    'section',
    { class: 'recap', 'aria-labelledby': 'recap-title' },
    h(
      'p',
      { class: 'recap__kicker' },
      recap.generation > 1 ? `Life ${recap.generation} in this world` : 'A life',
    ),
    h('h2', { class: 'recap__name', id: 'recap-title' }, recap.name),
    h(
      'p',
      { class: 'recap__dates' },
      `Born ${recap.born}. ${recap.died ? `Died ${recap.died}` : 'Still living'}, aged ${recap.age}${recap.cause ? `, of ${recap.cause}` : ''}.`,
    ),
    h(
      'dl',
      { class: 'facts recap__facts' },
      [
        ['Fame', formatValue(recap.fame)],
        ['Infamy', formatValue(recap.infamy)],
        ['Bounty', recap.bounty !== null ? `${formatInteger(recap.bounty)} Berries` : 'None'],
        ['Headlines that named them', String(recap.newsMentions)],
        ['Children', String(recap.children)],
        ['Last work', recap.job ?? 'None'],
        [
          'Left behind',
          `${formatInteger(recap.berries)} Berries${recap.debt > 0 ? `, and a debt of ${formatInteger(recap.debt)}` : ''}`,
        ],
      ].map(([label, value]) =>
        h('div', { class: 'facts__row' }, h('dt', null, label), h('dd', null, value)),
      ),
    ),
    h('h3', { class: 'recap__heading' }, 'At their peak'),
    h(
      'ul',
      { class: 'recap__peaks' },
      recap.peak.map((p) =>
        h(
          'li',
          { class: 'recap__peak' },
          h('span', { class: 'recap__peak-label' }, p.label),
          h(
            'span',
            { class: 'recap__peak-bar', 'aria-hidden': 'true' },
            h('span', { style: `width: ${Math.min(100, (p.value / peakMax) * 100).toFixed(1)}%` }),
          ),
          h('span', { class: 'recap__peak-value' }, formatValue(p.value)),
        ),
      ),
    ),
    h('h3', { class: 'recap__heading' }, 'Notable deeds'),
    recap.deeds.length > 0
      ? h(
          'ol',
          { class: 'recap__deeds' },
          recap.deeds.map((d) =>
            h('li', null, h('span', { class: 'recap__deed-date' }, d.date), ' ', d.text),
          ),
        )
      : h('p', { class: 'muted' }, 'A quiet life. Nothing the island will tell stories about.'),
  );
}

function optionCard(option: ContinueOption, app: App, busy: boolean): HTMLElement {
  const select =
    option.candidates.length > 1
      ? h(
          'select',
          {
            class: 'continue__select',
            'aria-label': `Who to continue as (${option.label})`,
            disabled: busy,
          },
          option.candidates.map((c) =>
            h('option', { value: c.id }, `${c.name}, ${c.relation}, ${c.age}`),
          ),
        )
      : null;
  const only = option.candidates[0];
  const go = () => {
    if (option.id === 'new') {
      navigate('new');
      return;
    }
    const targetId = select ? select.value : only?.id;
    void app
      .dispatch(
        { type: 'life/continue', mode: option.id, ...(targetId ? { targetId } : {}) },
        'The story carries on.',
      )
      .then((ok) => {
        if (ok) navigate('feed');
      });
  };
  return h(
    'li',
    { class: 'continue', dataset: { available: String(option.available) } },
    h('h3', { class: 'continue__label' }, option.label),
    h('p', { class: 'continue__text' }, option.description),
    option.available && only && !select
      ? h('p', { class: 'continue__who' }, `${only.name}, ${only.relation}, ${only.age}`)
      : null,
    select,
    option.available
      ? h(
          'button',
          {
            class: `button${option.id === 'heir' ? ' button--primary' : ''}`,
            type: 'button',
            disabled: busy,
            onclick: go,
          },
          option.id === 'new'
            ? 'Start a new game'
            : option.id === 'newborn'
              ? 'Be born'
              : 'Carry on',
        )
      : h('p', { class: 'continue__reason' }, option.reason ?? 'Not possible'),
  );
}

export function renderEnd(state: UiState, app: App): HTMLElement {
  const life: LifeView | null = state.snapshot?.life ?? null;
  const busy = state.busy !== null;
  if (!life || life.alive || !life.recap) {
    return h(
      'section',
      { class: 'end-page' },
      h('h2', { class: 'side-screen__title' }, 'Nobody has died'),
      h('p', null, 'The life recap appears here when the life you are playing ends.'),
      h('p', null, h('a', { class: 'button', href: '#/feed' }, 'Back to the chronicle')),
    );
  }
  return h(
    'section',
    { class: 'end-page', 'aria-label': 'Life recap' },
    recapSection(life.recap),
    h(
      'section',
      { class: 'end-page__continue', 'aria-labelledby': 'continue-title' },
      h('h2', { class: 'side-screen__title', id: 'continue-title' }, 'Carry on as'),
      h(
        'p',
        { class: 'muted' },
        'An heir, a protégé, a crewmate or a sibling inherits the Berries and half the fame as Legacy. Debts and bounties die with the one who earned them.',
      ),
      h(
        'ul',
        { class: 'continues' },
        life.continuation.map((o) => optionCard(o, app, busy)),
      ),
    ),
    life.lineage.length > 0
      ? h(
          'section',
          { class: 'end-page__lineage' },
          h('h2', { class: 'side-screen__title' }, 'Earlier lives in this world'),
          h(
            'ol',
            { class: 'planner__list' },
            life.lineage.map((l) =>
              h('li', null, `${l.name}, ${plural(l.age, 'year')}${l.cause ? `, ${l.cause}` : ''}`),
            ),
          ),
        )
      : null,
  );
}
