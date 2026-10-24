import { h } from '../dom';
import type { UiState } from '../store';

export function renderNews(state: UiState): HTMLElement {
  const news = state.snapshot?.news ?? [];
  if (news.length === 0) {
    return h(
      'div',
      { class: 'side-screen' },
      h('h2', { class: 'side-screen__title' }, 'No headlines yet'),
      h(
        'p',
        null,
        'News appears here when it reaches you: at once from where you are, a few months late from far away, and not at all at sea.',
      ),
    );
  }
  return h(
    'div',
    { class: 'side-screen' },
    h('h2', { class: 'side-screen__title' }, 'Headlines'),
    h(
      'ul',
      { class: 'headlines' },
      news.map((item) =>
        h(
          'li',
          { class: 'headline', dataset: { hidden: String(item.hidden) } },
          h('span', { class: 'headline__date' }, item.dateLabel),
          h('span', { class: 'headline__text' }, item.text),
          item.place || item.late > 0 || item.hidden
            ? h(
                'span',
                { class: 'headline__meta' },
                [
                  item.place ? `From ${item.place}` : null,
                  item.hidden
                    ? 'has not reached you yet'
                    : item.late > 0
                      ? `reached you ${item.late === 1 ? 'a month' : `${item.late} months`} late`
                      : null,
                ]
                  .filter(Boolean)
                  .join(', '),
              )
            : null,
        ),
      ),
    ),
  );
}
