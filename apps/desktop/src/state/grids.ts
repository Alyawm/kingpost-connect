import { create } from 'zustand';
import { Vector3, createGridObject, type ViewportHandle } from '@kingpost/viewer';
import { ifcGrids, type GridRow } from '../lib/ipc';
import { log } from './log';
import { useModel } from './model';
import { useViewer } from './viewer';

interface GridsState {
  /** Grids of the main model's file, once read (null: not read yet). */
  grids: GridRow[] | null;
  /** The file they were read from. */
  relPath: string | null;
  visible: boolean;
  loading: boolean;
  toggle(): Promise<void>;
  /** Draws the grid lines again (after the overlay was cleared or the model changed). */
  redraw(): void;
}

let object: Parameters<ViewportHandle['addOverlay']>[0] | null = null;

export const useGrids = create<GridsState>((set, get) => ({
  grids: null,
  relPath: null,
  visible: false,
  loading: false,

  toggle: async () => {
    const relPath = useModel.getState().relPath;
    if (!relPath) return;
    if (get().visible) {
      set({ visible: false });
      get().redraw();
      return;
    }
    if (get().relPath !== relPath || get().grids === null) {
      set({ loading: true });
      try {
        const started = performance.now();
        const grids = await ifcGrids(relPath);
        const axes = grids.reduce((n, g) => n + g.axes.length, 0);
        set({ grids, relPath });
        log.info(
          axes
            ? `${grids.length} grid(s) with ${axes} axes read in ${Math.round(performance.now() - started)} ms`
            : 'This model has no grids. In Revit, include grids in the IFC export settings.',
        );
      } catch (error) {
        log.error(`Could not read the grids: ${String(error)}`);
        set({ loading: false });
        return;
      } finally {
        set({ loading: false });
      }
    }
    set({ visible: true });
    get().redraw();
  },

  redraw: () => {
    const handle = useViewer.getState().handle;
    if (object) handle?.removeOverlay(object);
    object = null;
    const { grids, visible, relPath } = get();
    const model = useModel.getState();
    if (!handle || !visible || !grids || !model.frame || model.relPath !== relPath) return;
    const axes = grids.flatMap((g) =>
      g.axes.map((a) => ({
        tag: a.tag,
        start: model.frame!.pointFromIfc(a.start),
        end: model.frame!.pointFromIfc(a.end),
      })),
    );
    if (!axes.length) return;
    const size = handle.contentBounds().getSize(new Vector3());
    object = createGridObject(axes, Math.max(size.x, size.y, size.z));
    handle.addOverlay(object);
  },
}));

// A different main model has its own grids; read them again when asked.
useModel.subscribe((state, previous) => {
  if (state.model !== previous.model) {
    object = null;
    if (state.relPath !== useGrids.getState().relPath) {
      useGrids.setState({ grids: null, relPath: null, visible: false });
    } else {
      setTimeout(() => useGrids.getState().redraw(), 0);
    }
  }
});
