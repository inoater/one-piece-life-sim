import type { MapView, PlaceDetailView } from '../../worker/protocol';
import type { App } from '../app';
import { h } from '../dom';
import { errorMessage, formatInteger, plural } from '../format';
import type { MapPin, MapRoute, WorldMap } from '../map/world-map';
import { sailButtons } from './travel';

/**
 * The Map page: the whole world, to explore and to sail (Phase 3). Every place on the travel graph
 * is a pin: where the player is (a star), where they have been, where a lane from here leads, and
 * where the voyage is bound, with the ship drawn along its lane. The sea lanes are drawn under the
 * pins. Clicking a place opens its panel: who holds it, how it is doing, who lives there, its news,
 * and, when a lane leads there from here, every way of getting there with a button to set sail.
 * Clicking a drawn island without a pin opens the map's own notes, as before.
 */

export interface MapPage {
  el: HTMLElement;
  show(): Promise<void>;
}

const KIND_LABEL: Record<string, string> = {
  island: 'Island',
  port: 'Port',
  kingdom: 'Kingdom',
  sky_island: 'Sky island',
  undersea: 'Undersea',
  landmark: 'Landmark',
  stronghold: 'Stronghold',
  ruin: 'Ruin',
};

function pinsFor(view: MapView): MapPin[] {
  const pins: MapPin[] = view.places.map((p) => {
    const kind: MapPin['kind'] = p.here
      ? 'here'
      : p.destination
        ? 'target'
        : p.reachable
          ? 'reachable'
          : p.visited
            ? 'visited'
            : 'place';
    const notes = [
      p.regionName,
      p.controller ? `held by ${p.controller}` : null,
      p.epidemic ? 'sickness' : null,
      p.here
        ? 'you are here'
        : p.destination
          ? 'you are bound here'
          : p.reachable
            ? 'a lane leads here'
            : null,
    ].filter(Boolean);
    return {
      id: p.id,
      x: p.x,
      y: p.y,
      label: p.shortName,
      kind,
      labelled: p.here || p.destination || p.reachable,
      title: `${p.name}: ${notes.join(', ')}`,
    };
  });
  const v = view.voyage;
  if (v) {
    const from = view.places.find((p) => p.id === v.from);
    const to = view.places.find((p) => p.id === v.to);
    if (from && to) {
      let tx = to.x;
      if (Math.abs(from.x - to.x) > 1288) tx = to.x + (from.x > to.x ? 2576 : -2576);
      const x = from.x + (tx - from.x) * v.progress;
      pins.push({
        id: 'ship',
        x: ((x % 2576) + 2576) % 2576,
        y: from.y + (to.y - from.y) * v.progress,
        label: v.foot ? 'On the road' : 'At sea',
        kind: 'ship',
        labelled: true,
        title: `${v.foot ? 'On the road' : 'At sea'}, ${Math.round(v.progress * 100)}% of the way to ${to.name}`,
      });
    }
  }
  return pins;
}

function routesFor(view: MapView): MapRoute[] {
  const at = new Map(view.places.map((p) => [p.id, p]));
  const out: MapRoute[] = [];
  for (const lane of view.lanes) {
    const a = at.get(lane.from);
    const b = at.get(lane.to);
    if (!a || !b) continue;
    const kind: MapRoute['kind'] =
      view.voyage?.lane === lane.id
        ? 'voyage'
        : view.here && (lane.from === view.here || (!lane.oneWay && lane.to === view.here))
          ? 'reachable'
          : 'lane';
    out.push({
      id: lane.id,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      kind,
      danger: lane.danger,
      land: lane.land,
    });
  }
  return out;
}

function placePanel(
  p: PlaceDetailView,
  app: App,
  busy: boolean,
  close: () => void,
): (HTMLElement | null)[] {
  const row = (label: string, value: string, title?: string) =>
    h(
      'div',
      { class: 'facts__row', title: title ?? '' },
      h('dt', null, label),
      h('dd', null, value),
    );
  return [
    h(
      'button',
      { class: 'atlas-info__close', type: 'button', 'aria-label': 'Close', onclick: close },
      '×',
    ),
    h('h3', { class: 'atlas-info__name' }, p.name),
    h(
      'p',
      { class: 'atlas-info__where' },
      `${KIND_LABEL[p.kind] ?? p.kind}, ${p.regionName}. ${p.climateName}.${p.generated ? ' (Invented for the game.)' : ''}`,
    ),
    p.here ? h('p', { class: 'place-panel__here' }, 'You are here.') : null,
    h('p', { class: 'atlas-info__text' }, p.description),
    h(
      'dl',
      { class: 'facts' },
      row('Held by', p.controller?.name ?? 'Nobody in particular'),
      row(
        'People',
        `${formatInteger(p.population.residents + p.population.named)} (${p.population.named} you could name)`,
      ),
      row('Prosperity', `${p.prosperity.value} of 100`, p.prosperity.description),
      row('Danger', `${p.danger} of 5 (a ${p.safety} place to live)`),
      p.logPose !== null
        ? row(
            'Log Pose',
            p.logPose === 0 ? 'Sets at once' : `Sets in ${plural(p.logPose, 'month')}`,
          )
        : null,
      p.eternalPoses.length > 0 ? row('Eternal Poses sold', p.eternalPoses.join(', ')) : null,
      p.epidemic ? row('Sickness', 'An epidemic is here') : null,
    ),
    p.features.length > 0
      ? h(
          'p',
          { class: 'place-panel__chips' },
          p.features.map((f) => h('span', { class: 'chip' }, f)),
        )
      : null,
    p.trades.length > 0
      ? h(
          'p',
          { class: 'muted' },
          `Most work as: ${p.trades.map((t) => t.name.toLowerCase()).join(', ')}.`,
        )
      : null,
    p.notables.length > 0
      ? h(
          'div',
          null,
          h('h4', { class: 'place-panel__heading' }, 'Famous faces here now'),
          h(
            'ul',
            { class: 'place-panel__list' },
            p.notables.map((n) => h('li', null, h('strong', null, n.name), `, ${n.title}`)),
          ),
        )
      : null,
    p.news.length > 0
      ? h(
          'div',
          null,
          h('h4', { class: 'place-panel__heading' }, 'Heard from here'),
          h(
            'ul',
            { class: 'place-panel__list' },
            p.news.map((n) =>
              h('li', null, h('span', { class: 'muted' }, `${n.dateLabel}: `), n.text),
            ),
          ),
        )
      : null,
    p.route
      ? h(
          'div',
          { class: 'place-panel__route' },
          h('h4', { class: 'place-panel__heading' }, 'Getting there'),
          h(
            'p',
            { class: 'muted' },
            `${formatInteger(p.route.miles)} miles through ${p.route.zoneName}, danger ${p.route.danger} of 5.`,
          ),
          sailButtons(p.route, app, busy),
        )
      : p.here
        ? null
        : p.bound
          ? h('p', { class: 'place-panel__here' }, 'You are on your way here.')
          : h('p', { class: 'muted' }, 'No lane from where you are leads here directly.'),
  ];
}

export function createMapPage(app: App, onClose?: () => void): MapPage {
  const body = h('div', { class: 'map-page__map' });
  const closeButton = h(
    'button',
    {
      class: 'button button--tiny map-page__close',
      type: 'button',
      'aria-label': 'Close the map',
      onclick: () => onClose?.(),
    },
    'Close',
  );
  const hereButton = h(
    'button',
    { class: 'button button--tiny', type: 'button', hidden: true },
    'Where am I?',
  );
  const status = h(
    'p',
    { class: 'map-page__hint' },
    'Click a place to read about it and plan a voyage. Scroll or pinch to zoom, drag to pan, double-click to see it all.',
  );
  const panel = h('aside', { class: 'place-panel', hidden: true, 'aria-live': 'polite' });
  const el = h(
    'section',
    { class: 'map-page', 'aria-labelledby': 'map-title' },
    h(
      'header',
      { class: 'map-page__header' },
      h('h2', { class: 'map-page__title', id: 'map-title' }, 'The world'),
      status,
      hereButton,
      closeButton,
    ),
    body,
  );

  let map: WorldMap | null = null;
  let view: MapView | null = null;
  let selected: string | null = null;

  hereButton.addEventListener('click', () => {
    const here = view?.places.find((p) => p.here) ?? view?.places.find((p) => p.destination);
    if (here && map) map.focusOn(here.x, here.y, 3.2);
  });

  const close = () => {
    selected = null;
    panel.hidden = true;
  };
  // Escape closes the place panel first; with it closed, the map itself (see shell.ts).
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });

  async function openPlace(id: string): Promise<void> {
    selected = id;
    try {
      const place = await app.host.call('world/place', { id, view: app.view() });
      if (!place || selected !== id) return;
      const parts = placePanel(place, app, app.store.get().busy !== null, close);
      panel.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null));
      panel.hidden = false;
    } catch (error) {
      status.textContent = errorMessage(error);
    }
  }

  async function refresh(): Promise<void> {
    if (!map) return;
    const snapshot = app.store.get().snapshot;
    if (!snapshot?.player) {
      map.setPins([]);
      map.setRoutes([]);
      hereButton.hidden = true;
      return;
    }
    try {
      view = await app.host.call('world/map', {});
    } catch (error) {
      status.textContent = errorMessage(error);
      return;
    }
    map.setRoutes(routesFor(view));
    map.setPins(pinsFor(view));
    hereButton.hidden = false;
    const travel = snapshot.travel;
    status.textContent = travel?.voyage
      ? `${travel.voyage.mode === 'foot' ? 'On the road' : 'At sea'}, bound for ${travel.voyage.to.name}: about ${plural(travel.voyage.monthsLeft, 'month')} to go. Click a place to read about it.`
      : `You are in ${travel?.here?.name ?? snapshot.player.location}. Places a lane leads to from here are ringed; click one to plan a voyage.`;
    if (selected) await openPlace(selected);
  }

  return {
    el,
    async show() {
      if (!map) {
        body.replaceChildren(h('p', { class: 'map-page__hint' }, 'Unrolling the chart…'));
        // The map's drawing and data load the first time the page is opened.
        const { createWorldMap } = await import('../map/world-map');
        map ??= createWorldMap({
          label: 'Map of the One Piece world',
          notes: true,
          className: 'world-map--page',
          onPin: (id) => void openPlace(id),
        });
        body.replaceChildren(map.el, panel);
      }
      requestAnimationFrame(() => map?.measure());
      await refresh();
    },
  };
}
