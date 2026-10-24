import type { AdvancePlan } from '../engine/advance';
import type { AdvanceReport, Snapshot, ViewOptions } from '../worker/protocol';
import { dateLabel, describeAdvance, errorMessage, presentYearLabel } from './format';
import type { SimHost } from './host';
import { applyTheme, saveTheme } from './theme';
import type { Status, Store, Theme, UiState } from './store';

/**
 * The page controller. Screens never call the host directly for anything that changes the world;
 * they call these methods, which keep the busy indicator, the status line and the latest snapshot
 * consistent (rule 7: the UI reads state and sends actions).
 */

export interface App {
  readonly store: Store<UiState>;
  readonly host: SimHost;
  boot(autoResume?: boolean): Promise<void>;
  advance(plan: AdvancePlan, label: string): Promise<AdvanceReport | null>;
  cancel(): void;
  resolveDecision(decisionId: number, choiceId: string): Promise<void>;
  /** Send an action. Resolves true on success; failures are shown in the status line. */
  dispatch(action: unknown, success?: string): Promise<boolean>;
  newWorld(options: { seed?: string; probe?: boolean; fixtures?: boolean }): Promise<void>;
  /** Start the life the New Life screens describe. Resolves true once the world holds it. */
  startLife(options: unknown): Promise<boolean>;
  refresh(): Promise<void>;
  setOmniscient(on: boolean): Promise<void>;
  setDebugOpen(open: boolean): Promise<void>;
  setMenuOpen(open: boolean): void;
  setTheme(theme: Theme): void;
  /** Replace the snapshot (after a load or import) and optionally say something. */
  adopt(snapshot: Snapshot, status?: Status | null): void;
  say(status: Status | null): void;
  view(): ViewOptions;
}

export function createApp(host: SimHost, store: Store<UiState>): App {
  const view = (): ViewOptions => {
    const s = store.get();
    return { omniscient: s.omniscient, hash: s.debugOpen };
  };

  const fail = (error: unknown) =>
    store.update({ status: { kind: 'error', text: errorMessage(error) } });

  /** Run something that changes the world, showing the busy state and reporting failure. */
  async function guarded<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
    if (store.get().busy) return undefined;
    store.update({ busy: { label, cancellable: false } });
    try {
      return await work();
    } catch (error) {
      fail(error);
      return undefined;
    } finally {
      store.update({ busy: null });
    }
  }

  const app: App = {
    store,
    host,
    view,

    async boot(autoResume = true) {
      try {
        const { snapshot, resumed, notice } = await host.call('boot', { autoResume, view: view() });
        let status: Status | null = null;
        if (resumed) {
          const { report } = resumed;
          status = report.hashMatches
            ? {
                kind: 'info',
                text: `Resumed your saved world (${resumed.source}, ${dateLabel(snapshot.date)}). Its state hash matches the save.`,
              }
            : {
                kind: 'warn',
                text: 'Resumed your saved world, but its state hash differs from what was saved.',
              };
          if (!report.dataHashMatches) {
            status = {
              kind: 'warn',
              text: 'Resumed your saved world. The game content has changed since it was saved, so it may not play out exactly as before.',
            };
          }
        }
        store.update({ snapshot, notice, status, hostMode: host.mode });
      } catch (error) {
        store.update({ fatal: { name: 'Error', message: errorMessage(error) } });
        throw error;
      }
    },

    async advance(plan, label) {
      const state = store.get();
      if (state.busy || !state.snapshot) return null;
      const presentYear = presentYearLabel(state.snapshot);
      store.update({ busy: { label, cancellable: true }, status: null });
      try {
        const report = await host.call(
          'advance',
          { plan, view: view() },
          {
            onProgress: (p) =>
              store.update({
                busy: {
                  label,
                  cancellable: true,
                  progress: { ticksRun: p.ticksRun, target: p.target },
                },
              }),
          },
        );
        store.update({
          snapshot: report.snapshot,
          status: { kind: 'info', text: describeAdvance(report, presentYear) },
        });
        return report;
      } catch (error) {
        fail(error);
        return null;
      } finally {
        store.update({ busy: null });
      }
    },

    cancel() {
      host.cancel();
    },

    async resolveDecision(decisionId, choiceId) {
      await guarded('Resolving', async () => {
        const { snapshot } = await host.call('dispatch', {
          action: { type: 'decision/resolve', decisionId, choiceId },
          view: view(),
        });
        store.update({ snapshot, status: { kind: 'info', text: 'Decision made.' } });
      });
    },

    async dispatch(action, success) {
      const done = await guarded('Working', async () => {
        const { snapshot } = await host.call('dispatch', { action, view: view() });
        store.update({
          snapshot,
          ...(success ? { status: { kind: 'info' as const, text: success } } : {}),
        });
        return true;
      });
      return done === true;
    },

    async newWorld(options) {
      await guarded('Creating world', async () => {
        const { snapshot } = await host.call('newWorld', { ...options, view: view() });
        store.update({
          snapshot,
          notice: null,
          status: { kind: 'info', text: `New world from seed "${snapshot.seed}".` },
        });
      });
    },

    async startLife(options) {
      const done = await guarded('Starting a new life', async () => {
        const { snapshot } = await host.call('genesis/start', { options, view: view() });
        store.update({
          snapshot,
          notice: null,
          status: {
            kind: 'info',
            text: `${snapshot.player?.name ?? 'Your'}'s story begins, ${dateLabel(snapshot.date)}.`,
          },
        });
        return true;
      });
      return done === true;
    },

    async refresh() {
      try {
        const { snapshot } = await host.call('snapshot', { view: view() });
        store.update({ snapshot });
      } catch (error) {
        fail(error);
      }
    },

    async setOmniscient(on) {
      store.update({ omniscient: on });
      await app.refresh();
    },

    async setDebugOpen(open) {
      store.update({ debugOpen: open });
      if (open) await app.refresh(); // the debug panel wants the state hash
    },

    setMenuOpen(open) {
      store.update({ menuOpen: open });
    },

    setTheme(theme) {
      applyTheme(theme);
      saveTheme(theme);
      store.update({ theme });
    },

    adopt(snapshot, status = null) {
      store.update({ snapshot, notice: null, status });
    },

    say(status) {
      store.update({ status });
    },
  };
  return app;
}
