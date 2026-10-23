// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  currentRoute,
  isSideRoute,
  navigate,
  onRouteChange,
  parseHash,
  ROUTES,
  SIDE_ROUTES,
} from '../../src/ui/router';
import { settle } from '../helpers/ui';

afterEach(() => {
  window.location.hash = '';
});

describe('hash routes', () => {
  it('parses every route, with or without the slash', () => {
    for (const route of ROUTES) {
      expect(parseHash(`#/${route}`)).toBe(route);
      expect(parseHash(`#${route}`)).toBe(route);
    }
  });

  it('falls back to the feed for nothing, nonsense, or extra path parts', () => {
    expect(parseHash('')).toBe('feed');
    expect(parseHash('#')).toBe('feed');
    expect(parseHash('#/nowhere')).toBe('feed');
    expect(parseHash('#/world/extra')).toBe('world');
    expect(parseHash('#/world?x=1')).toBe('world');
  });

  it('knows which routes live in the side panel', () => {
    expect([...SIDE_ROUTES]).toEqual(['character', 'actions', 'world', 'news']);
    expect(isSideRoute('world')).toBe(true);
    expect(isSideRoute('feed')).toBe(false);
  });

  it('navigates by changing the hash, so Back and Forward work', () => {
    navigate('world');
    expect(window.location.hash).toBe('#/world');
    expect(currentRoute()).toBe('world');
    navigate('news');
    expect(currentRoute()).toBe('news');
  });

  it('tells listeners when the route changes, once per change, and stops after unsubscribing', async () => {
    const seen: string[] = [];
    const stop = onRouteChange((route) => seen.push(route));
    navigate('world');
    await settle();
    navigate('world'); // no change
    await settle();
    navigate('news');
    await settle();
    expect(seen).toEqual(['world', 'news']);
    stop();
    navigate('actions');
    await settle();
    expect(seen).toEqual(['world', 'news']);
  });

  it('follows the browser Back button (a hashchange nobody here triggered)', async () => {
    const seen: string[] = [];
    const stop = onRouteChange((route) => seen.push(route));
    window.location.hash = '#/character';
    await settle();
    window.location.hash = '#/feed';
    await settle();
    stop();
    expect(seen).toEqual(['character', 'feed']);
  });
});
