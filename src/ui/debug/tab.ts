import type { UiState } from '../store';

/** One section of the debug panel. */
export interface DebugTab {
  el: HTMLElement;
  /** Called when the tab becomes visible, and when the snapshot changes while it is visible. */
  refresh(): Promise<void> | void;
  /** Cheap synchronisation with UI state (checkbox positions and the like). */
  sync(state: UiState): void;
}
