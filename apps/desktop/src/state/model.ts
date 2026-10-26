import { create } from 'zustand';
import {
  loadIfcToGroup,
  IfcFrame,
  type IfcModel,
  type PickModifiers,
  type PickResult,
  deserializeBuckets,
  modelFromCache,
  serializeBuckets,
} from '@kingpost/viewer';
import {
  elementDetails,
  readProjectFile,
  revisionElements,
  type ElementDetails,
  type ElementSummary,
  type RevisionRow,
  geometryCacheRead,
  geometryCacheWrite,
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
  byGlobalId: Map<string, number>;
  /** The viewer-side model (meshes and ranges); not serialisable, never persisted. */
  model: IfcModel | null;
  /** Viewer ↔ IFC world coordinate mapping for the loaded model. */
  frame: IfcFrame | null;
  /** Every selected element; `selectedId` is the one the inspector shows. */
  selectedIds: Set<number>;
  selectedId: number | null;
  details: ElementDetails | null;
  hidden: Set<number>;

  load(relPath: string, revision: RevisionRow): Promise<void>;
  clear(): void;
  onPick(hit: PickResult | null, modifiers?: PickModifiers): void;
  select(expressId: number | null): Promise<void>;
  toggleSelect(expressId: number): Promise<void>;
  selectMany(expressIds: Iterable<number>): Promise<void>;
  hide(ids: Iterable<number>): void;
  isolate(ids: Iterable<number>): void;
  showAll(): void;
  fitTo(ids: Iterable<number>): void;
  /** GlobalIds of the selected elements, in selection order. */
  selectedGlobalIds(): string[];
  /**
   * Makes an already loaded model the main one without reloading it, and returns the
   * previous main model (still in the scene, not disposed) for the caller to keep.
   */
  takeOver(next: LoadedModel): LoadedModel | null;
}

/** A model that is loaded in the viewer, main or reference. */
export interface LoadedModel {
  relPath: string;
  revision: RevisionRow;
  model: IfcModel;
  frame: IfcFrame;
  elements: ElementSummary[];
}

/** Scene objects that a new main model must not remove (reference models). */
let keptObjects: () => IfcModel['group'][] = () => [];
export function setKeptObjects(source: typeof keptObjects): void {
  keptObjects = source;
}

/**
 * Geometry for a revision: from the project's cache when it has been opened before, else
 * from web-ifc, in which case the result is cached for next time. The cache is keyed by
 * the file digest the revision was imported from, so a changed file never matches.
 */
export async function loadGeometry(
  relPath: string,
  revision: RevisionRow,
): Promise<{ model: IfcModel; frame: IfcFrame; triangles: number; source: string }> {
  const sha = revision.source_sha256;
  try {
    const cached = sha ? deserializeBuckets(await geometryCacheRead(sha)) : null;
    if (cached) {
      return {
        model: modelFromCache(cached),
        frame: new IfcFrame(cached.coordination),
        triangles: cached.triangles,
        source: 'cache',
      };
    }
  } catch {
    // A damaged cache file is not an error: the file is simply read again.
  }
  const bytes = await readProjectFile(relPath);
  const { model, stats, frame, coordination } = await loadIfcToGroup(bytes);
  if (sha) {
    // Written after the model is shown; a failure only means the next open is slower.
    setTimeout(() => {
      try {
        void geometryCacheWrite(sha, serializeBuckets(model.buckets, coordination)).catch(
          () => undefined,
        );
      } catch {
        // ignore
      }
    }, 0);
  }
  return { model, frame, triangles: stats.triangles, source: 'web-ifc' };
}

export const useModel = create<ModelState>((set, get) => ({
  revision: null,
  relPath: null,
  loading: false,
  elements: [],
  byId: new Map(),
  byGlobalId: new Map(),
  model: null,
  frame: null,
  selectedIds: new Set(),
  selectedId: null,
  details: null,
  hidden: new Set(),

  load: async (relPath, revision) => {
    const handle = useViewer.getState().handle;
    if (!handle) {
      log.error('The viewport is not ready');
      return;
    }
    // Loading first, so listeners can tell a model switch from a close.
    set({ loading: true });
    get().clear();
    // A pick on the start-up frame or a previous model must not linger in the inspector.
    useViewer.getState().setSelection(null);
    set({ loading: true, relPath, revision });
    log.info(`Loading ${relPath} (revision ${revision.idx})…`);
    try {
      const started = performance.now();
      const elements = await revisionElements(revision.id);
      const { model, frame, triangles, source } = await loadGeometry(relPath, revision);
      handle.clear(keptObjects());
      handle.add(model.group);
      handle.fit();
      const byId = new Map(elements.map((e) => [e.express_id, e]));
      const byGlobalId = new Map(elements.map((e) => [e.global_id, e.express_id]));
      set({ model, frame, elements, byId, byGlobalId, loading: false });
      log.info(
        `${relPath}: ${elements.length.toLocaleString()} elements, ` +
          `${triangles.toLocaleString()} triangles in ${Math.round(performance.now() - started)} ms (${source})`,
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
      byGlobalId: new Map(),
      model: null,
      frame: null,
      selectedIds: new Set(),
      selectedId: null,
      details: null,
      hidden: new Set(),
    });
  },

  onPick: (hit, modifiers) => {
    if (!get().model) return;
    const id = hit?.expressId ?? null;
    if (modifiers?.ctrl && id !== null) void get().toggleSelect(id);
    else void get().select(id);
  },

  select: (expressId) => get().selectMany(expressId === null ? [] : [expressId]),

  toggleSelect: (expressId) => {
    const next = new Set(get().selectedIds);
    if (next.has(expressId)) next.delete(expressId);
    else next.add(expressId);
    return get().selectMany(next);
  },

  selectMany: async (expressIds) => {
    const { model, revision } = get();
    if (!model || !revision) return;
    const selectedIds = new Set(expressIds);
    const primary = [...selectedIds].pop() ?? null;
    model.setSelected(selectedIds);
    useViewer.getState().handle?.render();
    set({ selectedIds, selectedId: primary, details: null });
    if (primary === null) return;
    try {
      const details = await elementDetails(revision.id, primary);
      // Ignore a late answer for a selection that has since changed.
      if (get().selectedId === primary) set({ details });
    } catch (error) {
      log.error(`Could not read element #${primary}: ${String(error)}`);
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

  takeOver: (next) => {
    const { model, frame, relPath, revision, elements } = get();
    const previous =
      model && frame && relPath && revision ? { model, frame, relPath, revision, elements } : null;
    previous?.model.setSelected(null);
    useViewer.getState().setSelection(null);
    set({
      model: next.model,
      frame: next.frame,
      relPath: next.relPath,
      revision: next.revision,
      elements: next.elements,
      byId: new Map(next.elements.map((e) => [e.express_id, e])),
      byGlobalId: new Map(next.elements.map((e) => [e.global_id, e.express_id])),
      selectedIds: new Set(),
      selectedId: null,
      details: null,
      hidden: new Set(next.model.hiddenIds),
    });
    return previous;
  },

  selectedGlobalIds: () => {
    const { selectedIds, byId } = get();
    return [...selectedIds].map((id) => byId.get(id)?.global_id).filter((g): g is string => !!g);
  },
}));
