import '../styles/index.css';
import { createApp } from './app';
import { createSimHost } from './host';
import { currentRoute, isSideRoute, onRouteChange } from './router';
import { renderFatal, renderLoading } from './screens/boot';
import { mountShell } from './shell';
import { createUiStore } from './store';
import { applyTheme, loadTheme } from './theme';
import { SimError } from '../worker/sim-error';

/**
 * Entry point. Order matters: show something immediately, start the simulation (worker first,
 * main thread as a fallback), mount the shell, then ask the simulation to resume the latest save
 * or start a new world.
 */
async function start(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('index.html has no #app element');

  const theme = loadTheme();
  applyTheme(theme);
  root.replaceChildren(renderLoading());

  try {
    const host = await createSimHost({ debug: __DEBUG_PANEL__ });
    const store = createUiStore(currentRoute(), theme);
    const app = createApp(host, store);

    // Keep the route in the store; remember the last side tab for wide screens showing the feed.
    store.update({ hostMode: host.mode });
    onRouteChange((route) =>
      store.update({ route, ...(isSideRoute(route) ? { sideTab: route } : {}) }),
    );
    const initial = store.get().route;
    if (isSideRoute(initial)) store.update({ sideTab: initial });

    mountShell(root, app);
    await app.boot(true);

    if (__DEBUG_PANEL__) {
      const { mountDebug } = await import('./debug/panel');
      mountDebug(root, app);
    }
  } catch (error) {
    const issues = error instanceof SimError ? error.issues : undefined;
    root.replaceChildren(
      renderFatal({ message: error instanceof Error ? error.message : String(error), issues }),
    );
    console.error(error);
  }
}

void start();
