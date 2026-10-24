import type { FightSelfView, PowersView } from '../../worker/protocol';
import { h } from '../dom';
import { formatInteger } from '../format';

/**
 * Your powers at a glance: your rung on the ladder, then everything you have, each with the stage
 * reached and its level as pips out of six (Novice to Grandmaster), the haki still asleep in you,
 * and a nudge when you carry a Devil Fruit you have not eaten.
 */

const LEVELS = 6;

function pips(index: number, label: string): HTMLElement {
  const out = h('span', {
    class: 'level-pips',
    role: 'img',
    'aria-label': `${label}, level ${index + 1} of ${LEVELS}`,
  });
  for (let i = 0; i < LEVELS; i++)
    out.append(h('span', { class: 'level-pip', dataset: { on: String(i <= index) } }));
  return out;
}

export function renderPowerSummary(
  powers: PowersView | null,
  fight: FightSelfView | null,
  options: { link?: boolean } = {},
): HTMLElement | null {
  if (!powers) return null;
  const s = powers.summary;
  return h(
    'section',
    { class: 'power-summary', 'aria-label': 'Your powers at a glance' },
    h(
      'div',
      { class: 'power-summary__head' },
      h('h3', { class: 'power-summary__title' }, 'Your powers'),
      fight
        ? h(
            'span',
            { title: fight.ladder.map((l) => `${l.name}: ${formatInteger(l.min)}+`).join('\n') },
            h('span', { class: 'power-summary__tier' }, fight.tier),
            h('span', { class: 'muted' }, ` · Combat Power ${formatInteger(fight.cp)}`),
          )
        : null,
    ),
    s.rows.length > 0
      ? h(
          'ul',
          { class: 'power-summary__list' },
          s.rows.map((r) =>
            h(
              'li',
              { class: 'power-row', dataset: { track: r.id } },
              h(
                'span',
                { class: 'power-row__name' },
                r.name,
                h('span', { class: 'power-row__group' }, ` ${r.group}`),
              ),
              pips(r.levelIndex, r.name),
              h(
                'span',
                { class: 'power-row__stage' },
                `${r.stage} (${r.level})${r.detail ? `, ${r.detail}` : ''}`,
              ),
            ),
          ),
        )
      : h(
          'p',
          { class: 'power-summary__note' },
          'No powers yet: learn a style, wake your haki, or find a Devil Fruit.',
        ),
    s.asleep.length > 0
      ? h('p', { class: 'power-summary__note' }, `Asleep in you: ${s.asleep.join(', ')}.`)
      : null,
    s.carriedFruit
      ? h(
          'p',
          { class: 'power-summary__note' },
          'You carry a Devil Fruit you have not eaten. ',
          h('a', { href: '#/fruits' }, 'Eat it, or find out what it is'),
          '.',
        )
      : null,
    options.link
      ? h(
          'p',
          { class: 'power-summary__note' },
          h('a', { href: '#/powers' }, 'Everything about your powers'),
        )
      : null,
  );
}
