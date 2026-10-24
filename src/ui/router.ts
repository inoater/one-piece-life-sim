/**
 * Hash routes (#/character, #/world, ...) so the browser's back and forward buttons work and a
 * page can be linked, with no server needed (the game is a static site).
 */

/** The sections, each a tab. */
export const ROUTES = ['feed', 'character', 'actions', 'world', 'news'] as const;
/**
 * Full-page screens that are not tabs: New Life, the Map, the life recap after a death,
 * (Phase 3) the canon timeline with its Divergence Log, and (Phase 4) the Powers and Devil Fruit
 * pages.
 */
export const PAGE_ROUTES = ['new', 'map', 'end', 'canon', 'powers', 'fruits'] as const;
export type TabRoute = (typeof ROUTES)[number];
export type Route = TabRoute | (typeof PAGE_ROUTES)[number];
/** The routes that live in the side panel on a wide screen (the feed is always visible there). */
export const SIDE_ROUTES = ['character', 'actions', 'world', 'news'] as const;
export type SideRoute = (typeof SIDE_ROUTES)[number];

export const ROUTE_LABELS: Record<Route, string> = {
  feed: 'Feed',
  character: 'Character',
  actions: 'Actions',
  world: 'World',
  news: 'News',
  new: 'New Life',
  map: 'Map',
  end: 'Life recap',
  canon: 'Canon',
  powers: 'Powers',
  fruits: 'Devil Fruits',
};

export function parseHash(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return [...ROUTES, ...PAGE_ROUTES].includes(name as Route) ? (name as Route) : 'feed';
}

export function isPageRoute(route: Route): boolean {
  return (PAGE_ROUTES as readonly string[]).includes(route);
}

export function isSideRoute(route: Route): route is SideRoute {
  return (SIDE_ROUTES as readonly string[]).includes(route);
}

export function currentRoute(): Route {
  return parseHash(window.location.hash);
}

/** Go to a route. Each call adds a history entry, so Back returns to the previous screen. */
export function navigate(route: Route): void {
  const target = `#/${route}`;
  if (window.location.hash !== target) window.location.hash = target;
}

/** Calls `listener` whenever the route changes (including Back/Forward). Returns an unsubscribe. */
export function onRouteChange(listener: (route: Route) => void): () => void {
  let last = currentRoute();
  const handler = () => {
    const next = currentRoute();
    if (next === last) return;
    last = next;
    listener(next);
  };
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
