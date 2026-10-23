import { createDial } from './components/dial';
import { renderLogCard, summarizeAdvance } from './components/log-card';
import { createYearRail } from './components/year-rail';
import { openModal } from './components/modal';
import { h, clear, isTypingTarget } from './dom';
import { countTo, flash, resetCount } from './motion';
import type { App } from './app';
import { formatInteger } from './format';
import { openMenu } from './menu';
import {
  isPageRoute,
  isSideRoute,
  navigate,
  ROUTE_LABELS,
  ROUTES,
  type Route,
  type SideRoute,
} from './router';
import { renderActions } from './screens/actions';
import { renderCharacter } from './screens/character';
import { renderFeed } from './screens/feed';
import { createMapPage } from './screens/map';
import { renderEnd } from './screens/end';
import { createNewLife } from './screens/new-life';
import { renderNews } from './screens/news';
import { renderWorld } from './screens/world';
import type { UiState } from './store';

/**
 * The page layout: masthead (date, age, location, Berries), the chronicle, a side panel with
 * Character / Actions / World / News, and the footer controls.
 *
 * Wide screens show the chronicle and the side panel together. Under 700px it is one column and
 * the sections become tabs (a nav of real links, so the routes are URLs and Back works).
 */

export interface Shell {
  destroy(): void;
}

const WIDE_QUERY = '(min-width: 700px)';

/** The tab highlighted in the side panel: the route itself, or the last one used while on the feed. */
export function effectiveSide(state: Pick<UiState, 'route' | 'sideTab'>): SideRoute {
  return isSideRoute(state.route) ? state.route : state.sideTab;
}

export function mountShell(root: HTMLElement, app: App): Shell {
  const { store } = app;
  const dial = createDial();

  // ---- Masthead
  const title = h('h1', { class: 'masthead__title' }, '');
  const season = h('p', { class: 'masthead__season' }, '');
  const vital = (label: string) => {
    const value = h(
      'dd',
      { class: 'vital__value is-empty', title: 'Appears once a life has started' },
      '\u2014',
    );
    return {
      row: h('div', { class: 'vital' }, h('dt', { class: 'vital__label' }, label), value),
      value,
    };
  };
  const age = vital('Age');
  const location = vital('Location');
  const berries = vital('Berries');
  // Health and Vigor: a number and a thin bar each (Phase 2).
  const bar = (label: string) => {
    const fill = h('span', { class: 'vital-bar__fill' });
    const value = h('dd', { class: 'vital__value is-empty' }, '—');
    const meter = h('span', { class: 'vital-bar', 'aria-hidden': 'true' }, fill);
    return {
      row: h(
        'div',
        { class: 'vital vital--bar' },
        h('dt', { class: 'vital__label' }, label),
        value,
        meter,
      ),
      value,
      fill,
      meter,
    };
  };
  const health = bar('Health');
  const vigor = bar('Vigor');
  const masthead = h(
    'header',
    { class: 'masthead' },
    h(
      'div',
      { class: 'masthead__clock' },
      dial.el,
      h('div', { class: 'masthead__date' }, title, season),
    ),
    h('dl', { class: 'vitals' }, age.row, health.row, vigor.row, location.row, berries.row),
  );

  // ---- Navigation
  const links = new Map<Route, HTMLAnchorElement>();
  for (const route of ROUTES) {
    links.set(
      route,
      h('a', { class: `tab tab--${route}`, href: `#/${route}` }, ROUTE_LABELS[route]),
    );
  }
  const mapLink = h('a', { class: 'tab tab--map', href: '#/map' }, ROUTE_LABELS.map);
  const nav = h('nav', { class: 'tabs', 'aria-label': 'Sections' }, [...links.values(), mapLink]);

  // ---- Panels
  const banner = h('div', { class: 'banner-slot' });
  // The panels are direct children of the shell grid (see layout.css), which is why there is no wrapper.
  const feedPanel = h('main', {
    class: 'panel panel--feed',
    id: 'panel-feed',
    'aria-label': 'Chronicle',
  });
  const rail = createYearRail(feedPanel);
  const sidePanel = h('aside', {
    class: 'panel panel--side',
    id: 'panel-side',
    'aria-label': 'Details',
  });
  // New Life takes over the page between the masthead and the bottom edge; it is built once, so a
  // half-made character survives a trip to another screen and back.
  const newLife = createNewLife(app);
  const newLifePage = h('div', { class: 'newlife-page', hidden: true }, newLife.el);
  const mapPage = createMapPage(app);
  const mapPageEl = h('div', { class: 'map-page-slot', hidden: true }, mapPage.el);
  const endPageEl = h('div', { class: 'end-page-slot', hidden: true });

  // ---- Controls
  const nextButton = h('button', { class: 'button button--primary', type: 'button' }, 'Next month');
  const skipButton = h('button', { class: 'button', type: 'button' }, 'Skip 3 months');
  const eventButton = h('button', { class: 'button', type: 'button' }, 'Skip to next event');
  const status = h('p', { class: 'controls__status', role: 'status' });
  const progress = h('progress', { class: 'controls__bar', max: 1, value: 0 });
  const progressText = h('span', { class: 'controls__progress-text' });
  const cancelButton = h('button', { class: 'button button--quiet', type: 'button' }, 'Cancel');
  const progressWrap = h(
    'div',
    { class: 'controls__progress', hidden: true },
    progress,
    progressText,
    cancelButton,
  );
  const menuButton = h(
    'button',
    {
      class: 'button button--quiet',
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-keyshortcuts': 'M',
    },
    'Menu',
  );
  const keysButton = h(
    'button',
    {
      class: 'button button--quiet controls__keys',
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-keyshortcuts': 'Shift+?',
      title: 'Keyboard shortcuts',
    },
    'Keys',
  );
  nextButton.setAttribute('aria-keyshortcuts', 'N');
  skipButton.setAttribute('aria-keyshortcuts', 'S');
  eventButton.setAttribute('aria-keyshortcuts', 'E');
  const debugButton = __DEBUG_PANEL__
    ? h(
        'button',
        { class: 'button button--quiet', type: 'button', 'aria-pressed': 'false' },
        'Debug',
      )
    : null;
  const controls = h(
    'footer',
    { class: 'controls' },
    h(
      'div',
      { class: 'controls__time', role: 'group', 'aria-label': 'Move time' },
      nextButton,
      skipButton,
      eventButton,
    ),
    h('div', { class: 'controls__readout' }, status, progressWrap),
    h('div', { class: 'controls__meta' }, keysButton, menuButton, debugButton),
  );

  // After time moves, a short log card says what changed; the newest replaces the last.
  const toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const dismissToast = () => {
    clearTimeout(toastTimer);
    toasts.replaceChildren();
  };

  // "Back to the latest" when the chronicle has been scrolled up; it counts what arrived since.
  const jumpCount = h('span', { class: 'feed-jump__count' });
  const jumpButton = h(
    'button',
    { class: 'feed-jump', type: 'button', hidden: true },
    'Latest entries ',
    jumpCount,
  );
  let unseen = 0;

  const shell = h(
    'div',
    { class: 'shell' },
    masthead,
    banner,
    nav,
    feedPanel,
    rail.el,
    sidePanel,
    newLifePage,
    mapPageEl,
    endPageEl,
    controls,
    toasts,
  );
  root.replaceChildren(shell);

  // ---- Wiring
  nextButton.addEventListener(
    'click',
    () => void app.advance({ kind: 'months', count: 1 }, 'Advancing a month'),
  );
  skipButton.addEventListener('click', () => {
    const months = store.get().snapshot?.skip.shortMonths ?? 3;
    void app.advance({ kind: 'months', count: months }, `Advancing ${months} months`);
  });
  eventButton.addEventListener(
    'click',
    () => void app.advance({ kind: 'untilEvent' }, 'Skipping to the next event'),
  );
  cancelButton.addEventListener('click', () => app.cancel());
  menuButton.addEventListener('click', () => openMenu(app));
  keysButton.addEventListener('click', () => openShortcuts());
  jumpButton.addEventListener('click', () => {
    feedPanel.scrollTo({ top: feedPanel.scrollHeight, behavior: 'smooth' });
  });
  feedPanel.addEventListener('scroll', () => {
    rail.sync();
    if (atBottom(feedPanel)) {
      unseen = 0;
      jumpButton.hidden = true;
    } else {
      jumpButton.hidden = false;
    }
    jumpCount.textContent = unseen > 0 ? `(${unseen} new)` : '';
  });

  // ---- Keyboard: the time controls and the sections, without reaching for the mouse
  const SHORTCUTS: { keys: string; does: string }[] = [
    { keys: 'N', does: 'Next month' },
    { keys: 'S', does: 'Skip a few months' },
    { keys: 'E', does: 'Skip to the next event' },
    { keys: '1 to 6', does: 'Feed, Character, Actions, World, News, Map' },
    { keys: 'L', does: 'Start a new life' },
    { keys: 'M', does: 'Menu: saves and appearance' },
    { keys: '?', does: 'This list' },
    ...(__DEBUG_PANEL__ ? [{ keys: '`', does: 'Debug panel' }] : []),
  ];
  function openShortcuts(): void {
    if (document.querySelector('.modal-backdrop')) return;
    openModal({
      title: 'Keyboard shortcuts',
      className: 'modal--keys',
      body: h(
        'dl',
        { class: 'keys' },
        SHORTCUTS.map((s) =>
          h(
            'div',
            { class: 'keys__row' },
            h('dt', null, h('kbd', null, s.keys)),
            h('dd', null, s.does),
          ),
        ),
      ),
    });
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTypingTarget(event.target) || document.querySelector('.modal-backdrop')) return;
    const state = store.get();
    if (state.route === 'new') return;
    const press = (button: HTMLButtonElement) => {
      if (!button.disabled) button.click();
    };
    const key = event.key.toLowerCase();
    const sections: Route[] = ['feed', 'character', 'actions', 'world', 'news', 'map'];
    if (key === 'n') press(nextButton);
    else if (key === 's') press(skipButton);
    else if (key === 'e') press(eventButton);
    else if (key === 'm') menuButton.click();
    else if (key === 'l') navigate('new');
    else if (key === '?' || (key === '/' && event.shiftKey)) openShortcuts();
    else if (/^[1-6]$/.test(key)) navigate(sections[Number(key) - 1] as Route);
    else return;
    event.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  debugButton?.addEventListener('click', () => void app.setDebugOpen(!store.get().debugOpen));

  // After a decision is answered its button disappears, so keyboard focus is handed to "Next month"
  // as soon as that button is usable again (it stays disabled until the simulation is idle).
  let focusNextWhenReady = false;

  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY) : null;
  const isWide = () => mq?.matches ?? true;

  // ---- Rendering
  const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 48;

  function renderSide(state: UiState): void {
    const side = effectiveSide(state);
    const screens: Record<SideRoute, () => HTMLElement> = {
      character: () => renderCharacter(state, app),
      actions: () => renderActions(state, app),
      world: () => renderWorld(state),
      news: () => renderNews(state),
    };
    sidePanel.dataset['screen'] = side;
    sidePanel.replaceChildren(screens[side]());
  }

  function renderNav(state: UiState): void {
    // On the Map page only the Map link is current (it is set where the page is shown).
    const current: Route | null =
      state.route === 'map'
        ? null
        : isWide() && !isSideRoute(state.route)
          ? state.sideTab
          : state.route;
    for (const [route, link] of links) {
      if (route === current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const waiting = state.snapshot?.pending.length ?? 0;
    const actions = links.get('actions');
    if (actions) {
      actions.textContent = waiting > 0 ? `Actions (${waiting})` : ROUTE_LABELS.actions;
    }
  }

  function renderHeader(state: UiState): void {
    const s = state.snapshot;
    if (!s) return;
    title.textContent = `${s.date.monthName}, Year ${s.date.year}`;
    season.textContent = s.date.seasonName;
    shell.dataset['season'] = s.date.seasonId;
    dial.update({
      month: s.date.month,
      year: s.date.year,
      progress: s.progress,
      atPresent: s.atPresent,
    });
    const player = s.player;
    for (const v of [age, location, berries]) {
      v.value.classList.toggle('is-empty', !player);
      v.value.title = player ? '' : 'Appears once a life has started';
    }
    if (player) {
      const before = Number(age.value.dataset['value'] ?? player.age);
      countTo(age.value, player.age, String);
      if (player.age > before) flash(age.value);
      age.value.dataset['value'] = String(player.age);
      age.value.title = player.stage;
      location.value.textContent = player.location;
      const had = Number(berries.value.dataset['value'] ?? player.berries);
      countTo(berries.value, player.berries, formatInteger);
      if (player.berries !== had)
        flash(berries.value, player.berries > had ? 'is-gain' : 'is-loss');
      berries.value.dataset['value'] = String(player.berries);
    } else {
      for (const v of [age, berries]) {
        resetCount(v.value);
        delete v.value.dataset['value'];
        v.value.textContent = '\u2014';
      }
      location.value.textContent = '\u2014';
    }
    berries.value.classList.toggle('is-debt', (player?.berries ?? 0) < 0);

    const life = s.life;
    const bars: [typeof health, number, number, string][] = life
      ? [
          [
            health,
            life.health.current,
            life.health.max,
            life.health.current < life.health.max * 0.35 ? 'bad' : 'health',
          ],
          [
            vigor,
            life.vigor.planned,
            life.vigor.pool,
            life.vigor.planned > life.vigor.pool ? 'bad' : 'vigor',
          ],
        ]
      : [];
    for (const v of [health, vigor]) {
      const entry = bars.find(([b]) => b === v);
      v.value.classList.toggle('is-empty', !entry);
      v.meter.hidden = !entry;
      if (!entry) {
        v.value.textContent = '—';
        continue;
      }
      const [, now, max, tone] = entry;
      v.value.textContent = `${now}/${max}`;
      v.fill.style.width = `${Math.max(0, Math.min(100, max > 0 ? (now / max) * 100 : 0)).toFixed(1)}%`;
      v.meter.dataset['tone'] = tone;
    }
    health.value.title = life
      ? `${life.health.current} of ${life.health.max}${life.injuries.length > 0 ? `; hurt: ${life.injuries.map((i) => i.name).join(', ')}` : ''}${life.illnesses.length > 0 ? `; ill: ${life.illnesses.map((i) => i.name).join(', ')}` : ''}`
      : 'Appears once a life has started';
    vigor.value.title = life
      ? `Vigor planned this month: ${life.vigor.planned} of ${life.vigor.pool}${life.exhausted ? ' (exhausted)' : ''}`
      : 'Appears once a life has started';
    health.row.dataset['alert'] = String(
      Boolean(life && (life.injuries.length > 0 || life.illnesses.length > 0)),
    );
    vigor.row.dataset['alert'] = String(Boolean(life?.exhausted));
  }

  function renderBanner(state: UiState): void {
    if (!state.notice) {
      banner.replaceChildren();
      return;
    }
    banner.replaceChildren(
      h(
        'div',
        { class: 'banner banner--warn', role: 'status' },
        h('p', null, state.notice),
        h(
          'button',
          {
            class: 'button button--quiet',
            type: 'button',
            onclick: () => store.update({ notice: null }),
          },
          'Dismiss',
        ),
      ),
    );
  }

  function renderControls(state: UiState): void {
    const s = state.snapshot;
    const busy = state.busy;
    const waiting = s?.pending.length ?? 0;
    const blockedReason = !s
      ? 'The world is still loading'
      : busy
        ? 'Time is moving'
        : s.life && !s.life.alive
          ? 'This life has ended: choose who carries on'
          : s.atPresent
            ? 'The present has arrived'
            : waiting > 0
              ? 'Choose how to respond to the decision first'
              : null;

    for (const button of [nextButton, skipButton, eventButton]) {
      button.disabled = blockedReason !== null;
      if (blockedReason) button.title = blockedReason;
      else button.removeAttribute('title');
    }
    skipButton.textContent = `Skip ${s?.skip.shortMonths ?? 3} months`;

    status.textContent = state.status?.text ?? (busy && !busy.progress ? `${busy.label}...` : '');
    status.dataset['kind'] = state.status?.kind ?? 'info';

    const long = busy?.progress;
    progressWrap.hidden = !(busy && long);
    if (busy && long) {
      progress.max = Math.max(1, long.target);
      progress.value = long.ticksRun;
      progressText.textContent = `${busy.label}: ${long.ticksRun} of ${long.target} months`;
    }
    cancelButton.hidden = !(busy && busy.cancellable);

    debugButton?.setAttribute('aria-pressed', String(state.debugOpen));
    for (const choice of feedPanel.querySelectorAll<HTMLButtonElement>('.choice, .epilogue button'))
      choice.disabled = busy !== null;
  }

  function render(state: UiState, previous: UiState | null): void {
    const mapping = state.route === 'map';
    if (mapping !== !mapPageEl.hidden) mapPageEl.hidden = !mapping;
    if (
      mapping &&
      (previous?.route !== 'map' || state.snapshot?.sheet !== previous.snapshot?.sheet)
    )
      void mapPage.show();
    if (mapping) mapLink.setAttribute('aria-current', 'page');
    else mapLink.removeAttribute('aria-current');
    const ending = state.route === 'end';
    if (ending !== !endPageEl.hidden) endPageEl.hidden = !ending;
    if (
      ending &&
      (previous?.route !== 'end' ||
        state.snapshot !== previous.snapshot ||
        state.busy !== previous.busy)
    ) {
      endPageEl.replaceChildren(renderEnd(state, app));
    }
    // The moment the life being played ends, the recap opens.
    const wasAlive = previous?.snapshot?.life?.alive;
    if (wasAlive === true && state.snapshot?.life?.alive === false && state.route !== 'end') {
      navigate('end');
    }
    const creating = state.route === 'new';
    if (creating !== !newLifePage.hidden) {
      newLifePage.hidden = !creating;
      if (creating) newLife.show();
    }
    shell.dataset['route'] = state.route;
    shell.dataset['side'] = effectiveSide(state);
    shell.dataset['phase'] = state.snapshot?.atPresent ? 'present' : 'live';
    shell.dataset['tick'] = String(state.snapshot?.tick ?? '');
    shell.dataset['busy'] = String(state.busy !== null);

    renderHeader(state);
    renderNav(state);
    renderBanner(state);
    renderControls(state);

    const snapshotChanged = state.snapshot !== previous?.snapshot;
    if (
      snapshotChanged ||
      state.omniscient !== previous?.omniscient ||
      state.feedFilter !== previous?.feedFilter ||
      !previous
    ) {
      const stick = !previous || atBottom(feedPanel);
      // Lines newer than the last ones drawn ink in; a new world or a load just appears.
      const sameWorld =
        previous?.snapshot && state.snapshot && previous.snapshot.seed === state.snapshot.seed;
      const lastSeq = previous?.snapshot?.feed[previous.snapshot.feed.length - 1]?.seq;
      const seenSeq = sameWorld && lastSeq !== undefined ? lastSeq : Infinity;
      const focusedFilter = (document.activeElement as HTMLElement | null)?.dataset?.['filter'];
      feedPanel.replaceChildren(renderFeed(state, app, { seenSeq }), jumpButton);
      if (focusedFilter) {
        feedPanel.querySelector<HTMLElement>(`[data-filter="${focusedFilter}"]`)?.focus();
      }
      const arrived = state.snapshot?.feed.filter((e) => e.seq > seenSeq).length ?? 0;
      if (stick) {
        feedPanel.scrollTop = feedPanel.scrollHeight;
        unseen = 0;
        jumpButton.hidden = true;
      } else if (arrived > 0) {
        unseen += arrived;
        jumpButton.hidden = false;
      }
      jumpCount.textContent = unseen > 0 ? `(${unseen} new)` : '';
      rail.refresh({ birthTick: state.snapshot?.sheet?.born.tick ?? null });
      const summary =
        previous?.snapshot && state.snapshot && snapshotChanged && previous.busy !== null
          ? summarizeAdvance(previous.snapshot, state.snapshot)
          : null;
      if (summary) {
        clearTimeout(toastTimer);
        toasts.replaceChildren(renderLogCard(summary, dismissToast));
        toastTimer = setTimeout(dismissToast, 7000);
      } else if (state.snapshot?.seed !== previous?.snapshot?.seed) {
        dismissToast();
      }
      if (
        previous &&
        (previous.snapshot?.pending.length ?? 0) > 0 &&
        (state.snapshot?.pending.length ?? 0) === 0
      ) {
        focusNextWhenReady = true;
      }
    }
    // A phone shows one section at a time: the chronicle may just have become visible.
    if (previous && state.route !== previous.route) {
      rail.refresh({ birthTick: state.snapshot?.sheet?.born.tick ?? null });
    }
    // Coming back from New Life or the Map: the chronicle was laid out while hidden, so put it at
    // the latest line.
    if (previous && isPageRoute(previous.route) && !isPageRoute(state.route)) {
      feedPanel.scrollTop = feedPanel.scrollHeight;
      rail.refresh({ birthTick: state.snapshot?.sheet?.born.tick ?? null });
      unseen = 0;
      jumpButton.hidden = true;
    }
    if (focusNextWhenReady && !nextButton.disabled) {
      focusNextWhenReady = false;
      nextButton.focus();
    }
    if (
      snapshotChanged ||
      state.route !== previous?.route ||
      state.sideTab !== previous?.sideTab ||
      state.hostMode !== previous?.hostMode ||
      // The planner's buttons are drawn disabled while time moves; draw them again when it stops.
      (previous?.busy !== null && state.busy === null) ||
      !previous
    ) {
      renderSide(state);
    }
  }

  render(store.get(), null);
  const unsubscribe = store.subscribe(render);
  const onWidthChange = () => renderNav(store.get());
  mq?.addEventListener?.('change', onWidthChange);

  return {
    destroy() {
      unsubscribe();
      document.removeEventListener('keydown', onKey);
      rail.destroy();
      clearTimeout(toastTimer);
      mq?.removeEventListener?.('change', onWidthChange);
      clear(root);
    },
  };
}
