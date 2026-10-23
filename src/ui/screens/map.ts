import type { GenesisSetup } from '../../worker/protocol';
import type { App } from '../app';
import { h } from '../dom';
import { errorMessage } from '../format';
import type { WorldMap } from '../map/world-map';

/**
 * The Map page: the whole world, to explore. Click an island to read about it; your home is
 * marked with a star. It is built the first time it is opened (the map takes a moment to draw) and
 * kept afterwards, with its zoom. Travel arrives in Phase 3; the same map will carry the routes.
 */

export interface MapPage {
  el: HTMLElement;
  show(): Promise<void>;
}

export function createMapPage(app: App): MapPage {
  const body = h('div', { class: 'map-page__map' });
  const homeButton = h(
    'button',
    { class: 'button button--tiny', type: 'button', hidden: true },
    'Go home',
  );
  const status = h(
    'p',
    { class: 'map-page__hint' },
    'Click an island to read about it. Scroll or pinch to zoom, drag to pan, double-click to see it all.',
  );
  const el = h(
    'section',
    { class: 'map-page', 'aria-labelledby': 'map-title' },
    h(
      'header',
      { class: 'map-page__header' },
      h('h2', { class: 'map-page__title', id: 'map-title' }, 'The world'),
      status,
      homeButton,
    ),
    body,
  );

  let map: WorldMap | null = null;
  let setup: GenesisSetup | null = null;
  let home: { x: number; y: number; name: string } | null = null;

  homeButton.addEventListener('click', () => {
    if (home && map) map.focusOn(home.x, home.y, 3.2);
  });

  async function placeHome(): Promise<void> {
    const sheet = app.store.get().snapshot?.sheet;
    if (!sheet || !map) {
      map?.setPins([]);
      home = null;
      homeButton.hidden = true;
      return;
    }
    try {
      setup ??= await app.host.call('genesis/setup', {});
    } catch (error) {
      status.textContent = errorMessage(error);
      return;
    }
    const place = setup.birthplaces.find((b) => b.id === sheet.birthplace.id);
    if (!place?.map) return;
    home = { x: place.map.x, y: place.map.y, name: place.name };
    map.setPins([
      {
        id: 'home',
        x: place.map.x,
        y: place.map.y,
        label: `Home: ${place.shortName}`,
        kind: 'home',
        labelled: true,
        title: `${sheet.name}'s home: ${place.name}`,
      },
    ]);
    homeButton.hidden = false;
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
        });
        body.replaceChildren(map.el);
      }
      requestAnimationFrame(() => map?.measure());
      void placeHome();
    },
  };
}
