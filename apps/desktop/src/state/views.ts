import { create } from 'zustand';
import type { CameraState } from '@kingpost/viewer';
import { viewDelete, viewRename, viewSave, viewsList, type SavedView } from '../lib/ipc';
import { log } from './log';
import { useModel } from './model';
import { useProject } from './project';
import { useView, type ColorBy, type Section } from './view';
import { useViewer } from './viewer';

/** What a saved view restores besides the camera. Stored as JSON, owned by this file. */
interface Visibility {
  revisionId: number | null;
  relPath: string | null;
  hidden: number[];
  colorBy: ColorBy;
}

interface ViewsState {
  views: SavedView[];
  busy: boolean;
  refresh(): Promise<void>;
  save(name: string): Promise<void>;
  apply(view: SavedView): void;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export const useViews = create<ViewsState>((set, get) => ({
  views: [],
  busy: false,

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
    const handle = useViewer.getState().handle;
    if (!handle) return;
    const model = useModel.getState();
    const view = useView.getState();
    const visibility: Visibility = {
      revisionId: model.revision?.id ?? null,
      relPath: model.relPath,
      hidden: [...model.hidden],
      colorBy: view.colorBy,
    };
    set({ busy: true });
    try {
      await viewSave(
        name,
        JSON.stringify(handle.getCamera()),
        JSON.stringify(visibility),
        JSON.stringify(view.section),
        handle.snapshot(320),
      );
      log.info(`Saved view "${name.trim()}"`);
      await get().refresh();
    } catch (error) {
      log.error(`Could not save view: ${String(error)}`);
    } finally {
      set({ busy: false });
    }
  },

  apply: (view) => {
    const handle = useViewer.getState().handle;
    if (!handle) return;
    const camera = parse<CameraState>(view.camera_json);
    const visibility = parse<Visibility>(view.visibility_json);
    const section = parse<Section>(view.section_planes_json);
    const model = useModel.getState();

    if (camera) handle.setCamera(camera);
    if (section) useView.getState().setSection(section);

    if (visibility && model.model) {
      if (visibility.revisionId !== null && visibility.revisionId !== model.revision?.id) {
        log.warn(
          `View "${view.name}" was saved on another revision (${visibility.relPath ?? '?'}); applying camera and section only.`,
        );
      } else {
        model.showAll();
        if (visibility.hidden.length) model.hide(visibility.hidden);
        useView.getState().setColorBy(visibility.colorBy);
      }
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
      await get().refresh();
    } catch (error) {
      log.error(`Could not delete view: ${String(error)}`);
    }
  },
}));

function parse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

// Views belong to the project: reload the list whenever the open project changes.
useProject.subscribe((state, previous) => {
  if (state.current?.id !== previous.current?.id) void useViews.getState().refresh();
});
