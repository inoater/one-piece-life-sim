import { createDial } from './components/dial';
import { h, clear } from './dom';
import type { App } from './app';
import { formatInteger } from './format';
import { openMenu } from './menu';
import { isSideRoute, ROUTE_LABELS, ROUTES, type Route, type SideRoute } from './router';
import { renderActions } from './screens/actions';
import { renderCharacter } from './screens/character';
import { renderFeed } from './screens/feed';
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
  const masthead = h(
    'header',
    { class: 'masthead' },
    h(
      'div',
      { class: 'masthead__clock' },
      dial.el,
      h('div', { class: 'masthead__date' }, title, season),
    ),
    h('dl', { class: 'vitals' }, age.row, location.row, berries.row),
  );

  // ---- Navigation
  const links = new Map<Route, HTMLAnchorElement>();
  for (const route of ROUTES) {
    links.set(
      route,
      h('a', { class: `tab tab--${route}`, href: `#/${route}` }, ROUTE_LABELS[route]),
    );
  }
  const nav = h('nav', { class: 'tabs', 'aria-label': 'Sections' }, [...links.values()]);

  // ---- Panels
  const banner = h('div', { class: 'banner-slot' });
  // The panels are direct children of the shell grid (see layout.css), which is why there is no wrapper.
  const feedPanel = h('main', {
    class: 'panel panel--feed',
    id: 'panel-feed',
    'aria-label': 'Chronicle',
  });
  const sidePanel = h('aside', {
    class: 'panel panel--side',
    id: 'panel-side',
    'aria-label': 'Details',
  });
  // New Life takes over the page between the masthead and the bottom edge; it is built once, so a
  // half-made character survives a trip to another screen and back.
  const newLife = createNewLife(app);
  const newLifePage = h('div', { class: 'newlife-page', hidden: true }, newLife.el);

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
    { class: 'button button--quiet', type: 'button', 'aria-haspopup': 'dialog' },
    'Menu',
  );
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
    h('div', { class: 'controls__meta' }, menuButton, debugButton),
  );

  const shell = h(
    'div',
    { class: 'shell' },
    masthead,
    banner,
    nav,
    feedPanel,
    sidePanel,
    newLifePage,
    controls,
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
      actions: () => renderActions(state),
      world: () => renderWorld(state),
      news: () => renderNews(state),
    };
    sidePanel.dataset['screen'] = side;
    sidePanel.replaceChildren(screens[side]());
  }

  function renderNav(state: UiState): void {
    const current: Route = isWide() && !isSideRoute(state.route) ? state.sideTab : state.route;
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
    age.value.textContent = player ? String(player.age) : '\u2014';
    if (player) age.value.title = player.stage;
    location.value.textContent = player ? player.location : '\u2014';
    berries.value.textContent = player ? formatInteger(player.berries) : '\u2014';
    berries.value.classList.toggle('is-debt', (player?.berries ?? 0) < 0);
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
    for (const choice of feedPanel.querySelectorAll<HTMLButtonElement>('.choice'))
      choice.disabled = busy !== null;
  }

  function render(state: UiState, previous: UiState | null): void {
    const creating = state.route === 'new';
    if (creating !== !newLifePage.hidden) {
      newLifePage.hidden = !creating;
      if (creating) newLife.show();
    }
    shell.dataset['route'] = state.route;
    shell.dataset['side'] = effectiveSide(state);
    shell.dataset['phase'] = state.snapshot?.atPresent ? 'present' : 'live';
    shell.dataset['tick'] = String(state.snapshot?.tick ?? '');

    renderHeader(state);
    renderNav(state);
    renderBanner(state);
    renderControls(state);

    const snapshotChanged = state.snapshot !== previous?.snapshot;
    if (snapshotChanged || state.omniscient !== previous?.omniscient || !previous) {
      const stick = !previous || atBottom(feedPanel);
      feedPanel.replaceChildren(renderFeed(state, app));
      if (stick) feedPanel.scrollTop = feedPanel.scrollHeight;
      if (
        previous &&
        (previous.snapshot?.pending.length ?? 0) > 0 &&
        (state.snapshot?.pending.length ?? 0) === 0
      ) {
        focusNextWhenReady = true;
      }
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
      mq?.removeEventListener?.('change', onWidthChange);
      clear(root);
    },
  };
}
