import type { CanonView } from '../../worker/protocol';
import type { App } from '../app';
import { h } from '../dom';
import { errorMessage, plural } from '../format';

/**
 * The Canon page (Phase 3): the famous events of the story in order, each with what became of it
 * in this world (it happened, it never came to pass, it is still to come), and the Divergence Log:
 * every way this world has left the story, with its cause and month.
 */

export interface CanonPage {
  el: HTMLElement;
  show(): Promise<void>;
}

const STATUS_LABEL: Record<CanonView['beats'][number]['status'], string> = {
  fired: 'Happened',
  diverged: 'Never happened',
  pending: 'Still to come',
  beyond: 'Beyond what the game knows',
};

const KIND_LABEL: Record<string, string> = {
  cancelled: 'Cancelled',
  missed: 'Never came',
  player: 'Your doing',
  substituted: 'Recast',
  delayed: 'Delayed',
  'early-death': 'Died early',
  requirement: 'Fell with another',
};

export function renderCanon(view: CanonView): HTMLElement[] {
  return [
    h(
      'header',
      { class: 'canon-page__header' },
      h('h2', { class: 'canon-page__title', id: 'canon-title' }, 'The story so far'),
      h(
        'p',
        { class: 'canon-page__lead' },
        `${view.mode} mode: ${view.modeSummary} `,
        `The game knows the story up to ${view.cutoff}; after that, the world runs on chance.`,
      ),
      h(
        'p',
        { class: 'canon-page__counts' },
        `${plural(view.counts.fired, 'famous event')} happened, ${view.counts.diverged} never came to pass, ${view.counts.pending} still to come. `,
        `Of the famous cast, ${view.cast.alive} are alive and ${view.cast.dead} dead; ${plural(view.cast.diverged, 'has', 'have')} left the story.`,
      ),
    ),
    h(
      'section',
      { class: 'canon-page__section', 'aria-labelledby': 'divergence-title' },
      h('h3', { class: 'canon-page__heading', id: 'divergence-title' }, 'Divergence Log'),
      view.divergences.length === 0
        ? h('p', { class: 'muted' }, 'Nothing has left the story yet.')
        : h(
            'ol',
            { class: 'divergences' },
            view.divergences.map((d) =>
              h(
                'li',
                { class: 'divergence', dataset: { kind: d.kind } },
                h('span', { class: 'divergence__date' }, d.dateLabel),
                h('span', { class: 'divergence__kind' }, KIND_LABEL[d.kind] ?? d.kind),
                h('span', { class: 'divergence__text' }, d.text),
              ),
            ),
          ),
    ),
    h(
      'section',
      { class: 'canon-page__section', 'aria-labelledby': 'beats-title' },
      h('h3', { class: 'canon-page__heading', id: 'beats-title' }, 'The famous events'),
      h(
        'ol',
        { class: 'beats' },
        view.beats.map((b) =>
          h(
            'li',
            { class: 'beat', dataset: { status: b.status, anchor: b.anchor } },
            h('span', { class: 'beat__when' }, b.when ?? b.window),
            h('span', { class: 'beat__name' }, b.name),
            h('span', { class: 'beat__place' }, b.place),
            h('span', { class: 'beat__status' }, STATUS_LABEL[b.status]),
          ),
        ),
      ),
    ),
  ];
}

export function createCanonPage(app: App): CanonPage {
  const body = h('div', { class: 'canon-page__body' });
  const el = h('section', { class: 'canon-page', 'aria-labelledby': 'canon-title' }, body);
  return {
    el,
    async show() {
      try {
        const view = await app.host.call('world/canon', {});
        body.replaceChildren(...renderCanon(view));
      } catch (error) {
        body.replaceChildren(h('p', { class: 'muted' }, errorMessage(error)));
      }
    },
  };
}
