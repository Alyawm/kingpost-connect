import { create } from 'zustand';
import { loadIfcToGroup, type IfcModel, type PickResult } from '@kingpost/viewer';
import {
  elementDetails,
  readProjectFile,
  revisionElements,
  type ElementDetails,
  type ElementSummary,
  type RevisionRow,
} from '../lib/ipc';
import { log } from './log';
import { useViewer } from './viewer';

interface ModelState {
  /** The revision whose elements are shown, and the file its geometry came from. */
  revision: RevisionRow | null;
  relPath: string | null;
  loading: boolean;
  elements: ElementSummary[];
  byId: Map<number, ElementSummary>;
  /** The viewer-side model (meshes and ranges); not serialisable, never persisted. */
  model: IfcModel | null;
  selectedId: number | null;
  details: ElementDetails | null;
  hidden: Set<number>;

  load(relPath: string, revision: RevisionRow): Promise<void>;
  clear(): void;
  onPick(hit: PickResult | null): void;
  select(expressId: number | null): Promise<void>;
  hide(ids: Iterable<number>): void;
  isolate(ids: Iterable<number>): void;
  showAll(): void;
  fitTo(ids: Iterable<number>): void;
}

export const useModel = create<ModelState>((set, get) => ({
  revision: null,
  relPath: null,
  loading: false,
  elements: [],
  byId: new Map(),
  model: null,
  selectedId: null,
  details: null,
  hidden: new Set(),

  load: async (relPath, revision) => {
    const handle = useViewer.getState().handle;
    if (!handle) {
      log.error('The viewport is not ready');
      return;
    }
    get().clear();
    set({ loading: true, relPath, revision });
    log.info(`Loading ${relPath} (revision ${revision.idx})…`);
    try {
      const started = performance.now();
      const [bytes, elements] = await Promise.all([
        readProjectFile(relPath),
        revisionElements(revision.id),
      ]);
      const { model, stats } = await loadIfcToGroup(bytes);
      handle.clear();
      handle.add(model.group);
      handle.fit();
      const byId = new Map(elements.map((e) => [e.express_id, e]));
      set({ model, elements, byId, loading: false });
      log.info(
        `${relPath}: ${elements.length.toLocaleString()} elements, ` +
          `${stats.triangles.toLocaleString()} triangles in ${Math.round(performance.now() - started)} ms`,
      );
    } catch (error) {
      set({ loading: false });
      log.error(`Could not load ${relPath}: ${String(error)}`);
    }
  },

  clear: () => {
    const { model } = get();
    if (model) {
      useViewer.getState().handle?.remove(model.group);
      model.dispose();
    }
    set({
      revision: null,
      relPath: null,
      elements: [],
      byId: new Map(),
      model: null,
      selectedId: null,
      details: null,
      hidden: new Set(),
    });
  },

  onPick: (hit) => {
    if (!get().model) return;
    void get().select(hit?.expressId ?? null);
  },

  select: async (expressId) => {
    const { model, revision } = get();
    if (!model || !revision) return;
    model.setSelected(expressId);
    useViewer.getState().handle?.render();
    set({ selectedId: expressId, details: null });
    if (expressId === null) return;
    try {
      const details = await elementDetails(revision.id, expressId);
      // Ignore a late answer for a selection that has since changed.
      if (get().selectedId === expressId) set({ details });
    } catch (error) {
      log.error(`Could not read element #${expressId}: ${String(error)}`);
    }
  },

  hide: (ids) => {
    const hidden = new Set(get().hidden);
    for (const id of ids) hidden.add(id);
    get().model?.setHidden(hidden);
    useViewer.getState().handle?.render();
    set({ hidden });
  },

  isolate: (ids) => {
    const { model } = get();
    if (!model) return;
    model.isolate(ids);
    useViewer.getState().handle?.render();
    set({ hidden: new Set(model.hiddenIds) });
  },

  showAll: () => {
    get().model?.showAll();
    useViewer.getState().handle?.render();
    set({ hidden: new Set() });
  },

  fitTo: (ids) => {
    const box = get().model?.boundsOf(ids);
    if (box) useViewer.getState().handle?.fitTo(box);
  },
}));

/** Express ids of the elements that have geometry, for whole-model operations. */
export function geometryIds(elements: ElementSummary[]): number[] {
  return elements.filter((e) => e.has_geometry).map((e) => e.express_id);
}
