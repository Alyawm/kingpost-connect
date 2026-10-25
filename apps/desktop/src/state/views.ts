import { create } from 'zustand';
import type { CameraState } from '@kingpost/viewer';
import {
  viewDelete,
  imageSave,
  isTauri,
  viewRename,
  viewSave,
  viewSetDefault,
  viewUpdate,
  viewsList,
  type ElementSummary,
  type SavedView,
} from '../lib/ipc';
import { useAppearance, type Look } from './appearance';
import { useFederation } from './federation';
import { log } from './log';
import { useModel } from './model';
import { useProject } from './project';
import { planesFromStored, useView, type ColorBy } from './view';
import { useViewer } from './viewer';

/** Elements sharing one colour/opacity override, by GlobalId. */
export interface LookGroup {
  color?: string;
  opacity?: number;
  ids: string[];
}

/**
 * What a saved view restores besides the camera. Stored as JSON, owned by this file.
 *
 * Version 2 records hidden elements and overrides by GlobalId, so a view also applies to
 * a later revision of the same model. `hidden` (express ids) is still written so builds
 * that only know version 1 keep working.
 */
export interface Visibility {
  revisionId: number | null;
  relPath: string | null;
  hidden: number[];
  colorBy: ColorBy;
  version?: 2;
  /** Hidden elements; or, when most of the model is hidden, `shownGlobalIds` instead. */
  hiddenGlobalIds?: string[];
  shownGlobalIds?: string[];
  looks?: LookGroup[];
  /** Reference models shown with the main model, and how. */
  references?: StoredReference[];
}

export interface StoredReference {
  revisionId: number;
  relPath: string;
  visible: boolean;
  opacity: number;
  color: string | null;
  offset?: { x: number; y: number; z: number; rotation: number };
}

interface ViewsState {
  views: SavedView[];
  busy: boolean;
  /** The view last saved or applied, highlighted in the list. */
  activeId: string | null;
  /** True while the views are being shown one after another. */
  playing: boolean;
  /** Shows every saved view in turn, like a presentation, until stopped. */
  play(): void;
  stop(): void;
  refresh(): Promise<void>;
  save(name: string): Promise<void>;
  /** Overwrites a view with what is on screen now. */
  update(id: string): Promise<void>;
  apply(view: SavedView): void;
  /** Saves the current view as a full-resolution PNG chosen in a save dialog. */
  exportImage(): Promise<void>;
  /** Everything visible, original colours, no section, whole model in view. */
  home(): void;
  /** Makes a view the project default (applied when a model opens), or clears it. */
  setDefault(id: string | null): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Captures the current visibility, colouring and overrides. */
export function encodeVisibility(input: {
  revisionId: number | null;
  relPath: string | null;
  elements: ElementSummary[];
  byId: ReadonlyMap<number, ElementSummary>;
  hidden: ReadonlySet<number>;
  looks: ReadonlyMap<number, Look>;
  colorBy: ColorBy;
}): Visibility {
  const visibility: Visibility = {
    version: 2,
    revisionId: input.revisionId,
    relPath: input.relPath,
    hidden: [...input.hidden],
    colorBy: input.colorBy,
  };
  if (input.hidden.size > 0) {
    const drawable = input.elements.filter((e) => e.has_geometry && !e.is_spatial);
    if (input.hidden.size > drawable.length / 2) {
      visibility.shownGlobalIds = drawable
        .filter((e) => !input.hidden.has(e.express_id))
        .map((e) => e.global_id);
    } else {
      visibility.hiddenGlobalIds = globalIds(input.hidden, input.byId);
    }
  }
  if (input.looks.size > 0) {
    const groups = new Map<string, LookGroup>();
    for (const [id, look] of input.looks) {
      const globalId = input.byId.get(id)?.global_id;
      if (!globalId) continue;
      const key = `${look.color ?? ''}|${look.opacity ?? ''}`;
      let group = groups.get(key);
      if (!group) {
        group = { ids: [] };
        if (look.color) group.color = look.color;
        if (look.opacity !== undefined) group.opacity = look.opacity;
        groups.set(key, group);
      }
      group.ids.push(globalId);
    }
    visibility.looks = [...groups.values()];
  }
  return visibility;
}

/**
 * Resolves a stored visibility against the loaded revision. Version 2 matches by GlobalId
 * on any revision; version 1 applies only to the revision it was saved on.
 */
export function decodeVisibility(
  visibility: Visibility,
  model: {
    revisionId: number | null;
    elements: ElementSummary[];
    byGlobalId: ReadonlyMap<string, number>;
  },
): { hidden: number[]; looks: Map<number, Look>; matched: number; missing: number } | null {
  const sameRevision = visibility.revisionId === null || visibility.revisionId === model.revisionId;
  if (visibility.version !== 2) {
    return sameRevision
      ? { hidden: visibility.hidden, looks: new Map(), matched: 0, missing: 0 }
      : null;
  }
  let matched = 0;
  let missing = 0;
  const resolve = (globalId: string): number | undefined => {
    const id = model.byGlobalId.get(globalId);
    if (id === undefined) missing++;
    else matched++;
    return id;
  };
  let hidden: number[] = [];
  if (visibility.shownGlobalIds) {
    const shown = new Set<number>();
    for (const g of visibility.shownGlobalIds) {
      const id = resolve(g);
      if (id !== undefined) shown.add(id);
    }
    hidden = model.elements
      .filter((e) => e.has_geometry && !e.is_spatial && !shown.has(e.express_id))
      .map((e) => e.express_id);
  } else if (visibility.hiddenGlobalIds) {
    for (const g of visibility.hiddenGlobalIds) {
      const id = resolve(g);
      if (id !== undefined) hidden.push(id);
    }
  }
  const looks = new Map<number, Look>();
  for (const group of visibility.looks ?? []) {
    const look: Look = {};
    if (group.color) look.color = group.color;
    if (group.opacity !== undefined) look.opacity = group.opacity;
    for (const g of group.ids) {
      const id = resolve(g);
      if (id !== undefined) looks.set(id, look);
    }
  }
  return { hidden, looks, matched, missing };
}

function globalIds(ids: Iterable<number>, byId: ReadonlyMap<number, ElementSummary>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const globalId = byId.get(id)?.global_id;
    if (globalId) out.push(globalId);
  }
  return out;
}

/** The current camera, visibility, section and a thumbnail, ready to store. */
function capture(): {
  camera: string;
  visibility: string;
  section: string;
  thumbnail: string;
} | null {
  const handle = useViewer.getState().handle;
  if (!handle) return null;
  const model = useModel.getState();
  const view = useView.getState();
  const visibility = encodeVisibility({
    revisionId: model.revision?.id ?? null,
    relPath: model.relPath,
    elements: model.elements,
    byId: model.byId,
    hidden: model.hidden,
    looks: useAppearance.getState().looks,
    colorBy: view.colorBy,
  });
  const references = useFederation.getState().refs;
  if (references.length) {
    visibility.references = references.map((r) => ({
      revisionId: r.revision.id,
      relPath: r.relPath,
      visible: r.visible,
      opacity: r.opacity,
      color: r.color,
      offset: r.offset,
    }));
  }
  return {
    camera: JSON.stringify(handle.getCamera()),
    visibility: JSON.stringify(visibility),
    section: JSON.stringify(view.planes),
    thumbnail: handle.snapshot(320),
  };
}

export const useViews = create<ViewsState>((set, get) => ({
  views: [],
  busy: false,
  activeId: null,
  playing: false,

  play: () => {
    const views = get().views;
    if (views.length === 0) return;
    get().stop();
    let index = Math.max(0, views.findIndex((v) => v.id === get().activeId) + 1) % views.length;
    const next = () => {
      const list = get().views;
      if (!list.length) return get().stop();
      const view = list[index % list.length]!;
      get().apply(view);
      index = (index + 1) % list.length;
    };
    next();
    playTimer = setInterval(next, PLAY_SECONDS * 1000);
    set({ playing: true });
  },

  stop: () => {
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    if (get().playing) set({ playing: false });
  },

  refresh: async () => {
    if (!useProject.getState().current) {
      set({ views: [] });
      return;
    }
    try {
      set({ views: await viewsList() });
    } catch (error) {
      log.error(`Could not list saved views: ${String(error)}`);
    }
  },

  save: async (name) => {
    const state = capture();
    if (!state) return;
    set({ busy: true });
    try {
      const saved = await viewSave(
        name,
        state.camera,
        state.visibility,
        state.section,
        state.thumbnail,
      );
      log.info(`Saved view "${name.trim()}"`);
      set({ activeId: saved.id });
      await get().refresh();
    } catch (error) {
      log.error(`Could not save view: ${String(error)}`);
    } finally {
      set({ busy: false });
    }
  },

  update: async (id) => {
    const state = capture();
    if (!state) return;
    set({ busy: true });
    try {
      await viewUpdate(id, state.camera, state.visibility, state.section, state.thumbnail);
      const name = get().views.find((v) => v.id === id)?.name ?? 'view';
      log.info(`Updated view "${name}" with the current view`);
      set({ activeId: id });
      await get().refresh();
    } catch (error) {
      log.error(`Could not update view: ${String(error)}`);
    } finally {
      set({ busy: false });
    }
  },

  apply: (view) => {
    const handle = useViewer.getState().handle;
    if (!handle) return;
    const camera = parse<CameraState>(view.camera_json);
    const visibility = parse<Visibility>(view.visibility_json);
    const planes = planesFromStored(parse<unknown>(view.section_planes_json));
    const model = useModel.getState();

    if (camera) handle.setCamera(camera);
    useView.getState().replacePlanes(planes);
    set({ activeId: view.id });

    if (!visibility || !model.model) return;
    const resolved = decodeVisibility(visibility, {
      revisionId: model.revision?.id ?? null,
      elements: model.elements,
      byGlobalId: model.byGlobalId,
    });
    if (!resolved) {
      log.warn(
        `View "${view.name}" was saved on another revision (${visibility.relPath ?? '?'}); applying camera and section only.`,
      );
      return;
    }
    model.showAll();
    if (resolved.hidden.length) model.hide(resolved.hidden);
    useAppearance.getState().replace(resolved.looks);
    useView.getState().setColorBy(visibility.colorBy);
    if (visibility.references) void applyReferences(visibility.references);
    if (resolved.missing > 0) {
      log.warn(
        `View "${view.name}": ${resolved.missing.toLocaleString()} element(s) it refers to are not in this revision.`,
      );
    }
  },

  exportImage: async () => {
    const handle = useViewer.getState().handle;
    if (!handle || !isTauri()) return;
    const { save } = await import('@tauri-apps/plugin-dialog');
    const model = useModel.getState().relPath?.replace(/\.[^.]+$/, '') ?? 'view';
    const path = await save({
      title: 'Export the view as an image',
      defaultPath: `${model}-${new Date().toISOString().slice(0, 10)}.png`,
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });
    if (!path) return;
    try {
      const bytes = await imageSave(path, handle.snapshot(100000, 'png'));
      log.info(`Saved the view to ${path} (${Math.round(bytes / 1024)} KB)`);
    } catch (error) {
      log.error(`Could not save the image: ${String(error)}`);
    }
  },

  home: () => {
    const handle = useViewer.getState().handle;
    const model = useModel.getState();
    model.showAll();
    useAppearance.getState().reset();
    useView.getState().setColorBy('none');
    useView.getState().clearPlanes();
    handle?.viewFrom('iso');
    set({ activeId: null });
  },

  setDefault: async (id) => {
    try {
      await viewSetDefault(id);
      const name = get().views.find((v) => v.id === id)?.name;
      log.info(name ? `"${name}" opens with every model of this project` : 'No default view');
      await get().refresh();
    } catch (error) {
      log.error(`Could not set the default view: ${String(error)}`);
    }
  },

  rename: async (id, name) => {
    try {
      await viewRename(id, name);
      await get().refresh();
    } catch (error) {
      log.error(`Could not rename view: ${String(error)}`);
    }
  },

  remove: async (id) => {
    try {
      await viewDelete(id);
      if (get().activeId === id) set({ activeId: null });
      await get().refresh();
    } catch (error) {
      log.error(`Could not delete view: ${String(error)}`);
    }
  },
}));

/**
 * Brings the reference models to what a view recorded: missing ones are added, each gets
 * its visibility, colour and fade, and loaded ones the view did not have are hidden.
 */
async function applyReferences(stored: StoredReference[]): Promise<void> {
  const federation = useFederation.getState();
  const files = useProject.getState().files;
  for (const entry of stored) {
    if (federation.refs.some((r) => r.revision.id === entry.revisionId)) continue;
    if (useModel.getState().revision?.id === entry.revisionId) continue;
    const revision = files
      .flatMap((f) => f.revisions.map((r) => ({ file: f, revision: r })))
      .find((x) => x.revision.id === entry.revisionId);
    if (revision) await useFederation.getState().add(revision.file.rel_path, revision.revision);
    else log.warn(`The view refers to ${entry.relPath}, which is no longer in the project.`);
  }
  const wanted = new Map(stored.map((e) => [e.revisionId, e]));
  for (const ref of useFederation.getState().refs) {
    const entry = wanted.get(ref.revision.id);
    const f = useFederation.getState();
    f.setVisible(ref.key, entry ? entry.visible : false);
    if (entry) {
      f.setOpacity(ref.key, entry.opacity);
      f.setColor(ref.key, entry.color);
      if (entry.offset) f.setPlacement(ref.key, entry.offset);
    }
  }
}

const PLAY_SECONDS = 3.5;
let playTimer: ReturnType<typeof setInterval> | null = null;

function parse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

// Views belong to the project: reload the list whenever the open project changes.
useProject.subscribe((state, previous) => {
  if (state.current?.id !== previous.current?.id) {
    useViews.setState({ activeId: null });
    void useViews.getState().refresh();
  }
});

// A newly loaded model opens with the project's default view, when one is set.
useModel.subscribe((state, previous) => {
  if (!state.model || state.model === previous.model) return;
  void (async () => {
    if (useViews.getState().views.length === 0) await useViews.getState().refresh();
    const view = useViews.getState().views.find((v) => v.is_default);
    if (view && useModel.getState().model === state.model) {
      useViews.getState().apply(view);
      log.info(`Applied the default view "${view.name}"`);
    }
  })();
});
