import { h } from '../dom';
import type { UiState } from '../store';

export function renderNews(state: UiState): HTMLElement {
  const news = state.snapshot?.news ?? [];
  if (news.length === 0) {
    return h(
      'div',
      { class: 'side-screen' },
      h('h2', { class: 'side-screen__title' }, 'No headlines yet'),
      h('p', null, 'News appears here the month it breaks.'),
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
          { class: 'headline' },
          h('span', { class: 'headline__date' }, item.dateLabel),
          h('span', { class: 'headline__text' }, item.text),
        ),
      ),
    ),
  );
}
