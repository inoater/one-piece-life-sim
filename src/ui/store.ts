import type { Category, SerializedError, Snapshot } from '../worker/protocol';
import type { Route, SideRoute } from './router';

/** UI state: the latest snapshot from the simulation plus things only the page cares about. */

export type Theme = 'auto' | 'light' | 'dark';

export interface Status {
  kind: 'info' | 'warn' | 'error';
  text: string;
}

export interface Busy {
  label: string;
  /** Present for long advances. */
  progress?: { ticksRun: number; target: number };
  cancellable: boolean;
}

export interface UiState {
  snapshot: Snapshot | null;
  busy: Busy | null;
  status: Status | null;
  /** Shown above the feed after boot (for example "could not resume your save"). */
  notice: string | null;
  fatal: SerializedError | null;
  hostMode: 'worker' | 'inline' | null;
  omniscient: boolean;
  debugOpen: boolean;
  menuOpen: boolean;
  theme: Theme;
  route: Route;
  /** The tab shown in the side panel on a wide screen while the route is "feed". */
  sideTab: SideRoute;
  /** Which lines the chronicle shows. */
  feedFilter: 'all' | Category;
}

export class Store<T extends object> {
  private listeners = new Set<(state: T, previous: T) => void>();

  constructor(private state: T) {}

  get(): T {
    return this.state;
  }

  update(patch: Partial<T>): void {
    const previous = this.state;
    this.state = { ...previous, ...patch };
    for (const listener of [...this.listeners]) listener(this.state, previous);
  }

  subscribe(listener: (state: T, previous: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function createUiStore(route: Route, theme: Theme): Store<UiState> {
  return new Store<UiState>({
    snapshot: null,
    busy: null,
    status: null,
    notice: null,
    fatal: null,
    hostMode: null,
    omniscient: false,
    debugOpen: false,
    menuOpen: false,
    theme,
    route,
    sideTab: 'character',
    feedFilter: 'all',
  });
}
