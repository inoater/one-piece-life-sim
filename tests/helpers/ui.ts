import { MemorySaveStore } from '../../src/engine/saves/store';
import { createApp, type App } from '../../src/ui/app';
import { InlineSimHost } from '../../src/ui/host';
import { currentRoute, isSideRoute, onRouteChange } from '../../src/ui/router';
import { mountShell, type Shell } from '../../src/ui/shell';
import { createUiStore } from '../../src/ui/store';
import { SimCore, type SimCoreDeps } from '../../src/worker/sim-core';
import { data, dataHash } from './data';

export interface Mounted {
  root: HTMLElement;
  app: App;
  core: SimCore;
  store: MemorySaveStore;
  shell: Shell;
  unroute: () => void;
}

/** Give pending promises and timers a chance to finish (click handlers do not return their promise). */
export async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Mount the real shell over the real engine, in the happy-dom document. */
export async function mountUi(
  options: {
    core?: Partial<SimCoreDeps>;
    boot?: boolean;
    autoResume?: boolean;
    store?: MemorySaveStore;
  } = {},
): Promise<Mounted> {
  document.body.innerHTML = '<div id="app"></div>';
  window.location.hash = '';
  document.documentElement.removeAttribute('data-theme');
  const root = document.getElementById('app') as HTMLElement;
  const store = options.store ?? new MemorySaveStore();
  const core = new SimCore({
    data,
    dataHash,
    store,
    debug: true,
    newSeed: () => 'ui-seed',
    yieldToHost: async () => {},
    // A world without its Tier 2 crowd (Phase 3): the page's tests need small, quick saves.
    population: 'none',
    ...options.core,
  });
  const host = new InlineSimHost(core);
  const ui = createUiStore(currentRoute(), 'auto');
  const app = createApp(host, ui);
  ui.update({ hostMode: 'inline' });
  const unroute = onRouteChange((route) =>
    ui.update({ route, ...(isSideRoute(route) ? { sideTab: route } : {}) }),
  );
  const shell = mountShell(root, app);
  if (options.boot !== false) await app.boot(options.autoResume ?? false);
  return { root, app, core, store, shell, unroute };
}

export function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function button(root: ParentNode, label: string | RegExp): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) =>
    typeof label === 'string' ? text(b) === label : label.test(text(b)),
  );
  if (!found)
    throw new Error(
      `No button "${String(label)}". Buttons: ${[...root.querySelectorAll('button')].map((b) => text(b)).join(' | ')}`,
    );
  return found;
}

export function link(root: ParentNode, label: string | RegExp): HTMLAnchorElement {
  const found = [...root.querySelectorAll('a')].find((a) =>
    typeof label === 'string' ? text(a) === label : label.test(text(a)),
  );
  if (!found) throw new Error(`No link "${String(label)}"`);
  return found;
}
