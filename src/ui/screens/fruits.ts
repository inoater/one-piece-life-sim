import type { FruitsView } from '../../worker/protocol';
import type { App } from '../app';
import { confirmButton } from '../components/confirm-button';
import { h } from '../dom';
import { errorMessage, formatInteger, plural } from '../format';
import type { UiState } from '../store';

/**
 * The Devil Fruit page (Phase 4): the fruits the player knows of (who has it, where it was last
 * seen, what the encyclopedia says), the rumours they have heard, which may be wrong, the fruits
 * they carry uneaten, and any for sale on the black market here. Rule 4: only what the player
 * knows; omniscient mode shows every fruit in the world, marked as such.
 */

export function renderFruits(view: FruitsView, app: App, busy: boolean): (HTMLElement | null)[] {
  return [
    h(
      'header',
      { class: 'powers-page__header' },
      h('h2', { class: 'powers-page__title', id: 'fruits-title' }, 'Devil Fruits'),
      h(
        'p',
        { class: 'powers-page__lead' },
        `One fruit, one power, one world: when a user dies, their fruit grows again somewhere, and nobody knows where. You know of ${plural(view.known.filter((k) => !k.hidden).length, 'fruit')}.`,
      ),
    ),
    view.carried.length > 0
      ? h(
          'section',
          { class: 'powers-page__section' },
          h('h3', { class: 'powers-page__heading' }, 'Carried'),
          h(
            'ul',
            { class: 'power-learns' },
            view.carried.map((c) =>
              h(
                'li',
                { class: 'power-learn' },
                h('span', { class: 'power-learn__name' }, c.name ?? 'A swirled fruit'),
                h(
                  'span',
                  { class: 'power-learn__desc' },
                  c.look.charAt(0).toUpperCase() + c.look.slice(1) + '.',
                ),
                c.warning ? h('span', { class: 'power-learn__lock' }, c.warning) : null,
                h(
                  'span',
                  { class: 'power-learn__buttons' },
                  confirmButton({
                    label: 'Eat it',
                    className: 'button',
                    disabled: busy || !c.canEat,
                    onConfirm: () =>
                      void app.dispatch({ type: 'powers/eat', fruit: c.id }, 'You ate the fruit.'),
                  }),
                  c.canIdentify.encyclopedia
                    ? h(
                        'button',
                        {
                          class: 'button',
                          type: 'button',
                          disabled: busy,
                          onclick: () =>
                            void app.dispatch(
                              { type: 'powers/identify', fruit: c.id, how: 'encyclopedia' },
                              'You looked it up.',
                            ),
                        },
                        'Look it up',
                      )
                    : null,
                  c.canIdentify.scholar === null
                    ? h(
                        'button',
                        {
                          class: 'button',
                          type: 'button',
                          disabled: busy,
                          onclick: () =>
                            void app.dispatch(
                              { type: 'powers/identify', fruit: c.id, how: 'scholar' },
                              'A scholar named it.',
                            ),
                        },
                        'Ask a scholar',
                      )
                    : null,
                ),
              ),
            ),
          ),
        )
      : null,
    view.market.length > 0
      ? h(
          'section',
          { class: 'powers-page__section' },
          h('h3', { class: 'powers-page__heading' }, 'For sale on the black market here'),
          h(
            'ul',
            { class: 'power-learns' },
            view.market.map((m) =>
              h(
                'li',
                { class: 'power-learn' },
                h('span', { class: 'power-learn__name' }, `${formatInteger(m.price)} Berries`),
                h(
                  'span',
                  { class: 'power-learn__desc' },
                  m.look.charAt(0).toUpperCase() +
                    m.look.slice(1) +
                    '. Nobody will say which fruit it is.',
                ),
                m.lock
                  ? h('span', { class: 'power-learn__lock' }, m.lock)
                  : confirmButton({
                      label: 'Buy it',
                      className: 'button',
                      disabled: busy,
                      onConfirm: () =>
                        void app.dispatch(
                          { type: 'powers/buyFruit', fruit: m.id },
                          'You bought a Devil Fruit.',
                        ),
                    }),
              ),
            ),
          ),
        )
      : null,
    h(
      'section',
      { class: 'powers-page__section' },
      h('h3', { class: 'powers-page__heading' }, 'Known fruits'),
      view.known.length === 0
        ? h('p', { class: 'muted' }, 'You have not heard of any Devil Fruit by name yet.')
        : h(
            'ul',
            { class: 'fruit-list' },
            view.known.map((k) =>
              h(
                'li',
                {
                  class: 'fruit-entry',
                  dataset: { hidden: String(k.hidden), type: k.type ?? 'unknown' },
                },
                h(
                  'span',
                  { class: 'fruit-entry__name' },
                  k.name,
                  k.japanese ? h('span', { class: 'muted' }, ` (${k.japanese})`) : null,
                ),
                h(
                  'span',
                  { class: 'fruit-entry__meta' },
                  [k.type, k.rarity].filter(Boolean).join(' · '),
                ),
                h(
                  'span',
                  { class: 'fruit-entry__user' },
                  k.user
                    ? `${k.status}: ${k.user}`
                    : k.place
                      ? `${k.status}, ${k.place}`
                      : k.status,
                ),
                k.description ? h('span', { class: 'fruit-entry__desc' }, k.description) : null,
                k.techniques.length > 0
                  ? h('span', { class: 'fruit-entry__techs' }, k.techniques.join(', '))
                  : null,
                k.hidden
                  ? h('span', { class: 'fruit-entry__hidden' }, 'Known to nobody (omniscient view)')
                  : null,
              ),
            ),
          ),
    ),
    h(
      'section',
      { class: 'powers-page__section' },
      h('h3', { class: 'powers-page__heading' }, 'Rumours'),
      view.rumours.length === 0
        ? h('p', { class: 'muted' }, 'No rumours yet. Chase them in port: some are true.')
        : h(
            'ul',
            { class: 'fruit-list' },
            view.rumours.map((r) =>
              h(
                'li',
                { class: 'fruit-entry' },
                h('span', { class: 'fruit-entry__name' }, r.name),
                h('span', { class: 'fruit-entry__user' }, `said to be on ${r.place}`),
                h('span', { class: 'fruit-entry__meta' }, r.date),
              ),
            ),
          ),
    ),
  ];
}

export interface FruitsPage {
  el: HTMLElement;
  show(state: UiState): Promise<void>;
}

export function createFruitsPage(app: App): FruitsPage {
  const body = h('div', { class: 'powers-page__body' });
  const el = h('section', { class: 'powers-page', 'aria-labelledby': 'fruits-title' }, body);
  return {
    el,
    async show(state) {
      try {
        const view = await app.host.call('powers/fruits', {
          view: { omniscient: state.omniscient, hash: false },
        });
        body.replaceChildren(
          ...(view
            ? renderFruits(view, app, state.busy !== null).filter(
                (e): e is HTMLElement => e !== null,
              )
            : [h('p', { class: 'muted' }, 'Nobody alive is being played.')]),
        );
      } catch (error) {
        body.replaceChildren(h('p', { class: 'muted' }, errorMessage(error)));
      }
    },
  };
}
