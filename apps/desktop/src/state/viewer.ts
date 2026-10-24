import { create } from 'zustand';
import type { PickResult, ViewportHandle } from '@kingpost/viewer';

interface ViewerState {
  /** Set by the mounted Viewport; null while there is no scene. */
  handle: ViewportHandle | null;
  selection: PickResult | null;
  setHandle(handle: ViewportHandle | null): void;
  setSelection(selection: PickResult | null): void;
}

/**
 * The single viewport is mounted once in the workspace and shared by every panel
 * through this store, so panels can load content into it without owning it.
 */
export const useViewer = create<ViewerState>((set) => ({
  handle: null,
  selection: null,
  setHandle: (handle) => set({ handle }),
  setSelection: (selection) => set({ selection }),
}));
