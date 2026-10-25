import { create } from 'zustand';
import {
  Box3,
  Vector3,
  createNoteObject,
  type PointPick,
  type ViewportHandle,
} from '@kingpost/viewer';
import { noteAdd, noteDelete, noteUpdate, notesList, type NoteRow, type Triple } from '../lib/ipc';
import { log } from './log';
import { useModel } from './model';
import { useProject } from './project';
import { useUi } from './ui';
import { useViewer } from './viewer';

/** A note being written: where it goes and where the editor appears. */
export interface NoteDraft {
  /** Viewer coordinates of the point. */
  point: Vector3;
  globalId: string | null;
  screen: { x: number; y: number };
}

interface NotesState {
  notes: NoteRow[];
  visible: boolean;
  draft: NoteDraft | null;
  refresh(): Promise<void>;
  /** A click with the note tool: opens the editor there. */
  startAt(pick: PointPick): void;
  save(text: string): Promise<void>;
  cancel(): void;
  update(id: string, text: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Looks at a note. */
  focus(id: string): void;
  setVisible(visible: boolean): void;
  /** Draws the pins again (after the overlay was cleared or the model changed). */
  redraw(): void;
}

const objects = new Map<string, Parameters<ViewportHandle['addOverlay']>[0]>();

/** Viewer coordinates of a stored note, through the main model's frame. */
export function notePoint(note: NoteRow): Vector3 | null {
  const frame = useModel.getState().frame;
  try {
    const p = JSON.parse(note.point_json) as Triple;
    return frame ? frame.pointFromIfc(p) : new Vector3(p[0], p[1], p[2]);
  } catch {
    return null;
  }
}

export const useNotes = create<NotesState>((set, get) => ({
  notes: [],
  visible: true,
  draft: null,

  refresh: async () => {
    if (!useProject.getState().current) {
      set({ notes: [] });
      get().redraw();
      return;
    }
    try {
      set({ notes: await notesList() });
      get().redraw();
    } catch (error) {
      log.error(`Could not load notes: ${String(error)}`);
    }
  },

  startAt: (pick) => {
    const { byId } = useModel.getState();
    const globalId =
      pick.expressId !== undefined && (pick.modelKey ?? 'main') === 'main'
        ? (byId.get(pick.expressId)?.global_id ?? null)
        : null;
    set({
      draft: { point: pick.point.clone(), globalId, screen: pick.screen ?? { x: 100, y: 100 } },
    });
  },

  save: async (text) => {
    const draft = get().draft;
    if (!draft || !text.trim()) return;
    const frame = useModel.getState().frame;
    const point = (frame ? frame.pointToIfc(draft.point) : draft.point.toArray()) as Triple;
    try {
      const notes = await noteAdd(draft.globalId, point, text, useUi.getState().author);
      set({ notes, draft: null });
      get().redraw();
      log.info(`Note added: ${text.trim().slice(0, 60)}`);
    } catch (error) {
      log.error(`Could not save the note: ${String(error)}`);
    }
  },

  cancel: () => set({ draft: null }),

  update: async (id, text) => {
    try {
      set({ notes: await noteUpdate(id, text) });
      get().redraw();
    } catch (error) {
      log.error(`Could not change the note: ${String(error)}`);
    }
  },

  remove: async (id) => {
    try {
      set({ notes: await noteDelete(id) });
      get().redraw();
    } catch (error) {
      log.error(`Could not delete the note: ${String(error)}`);
    }
  },

  focus: (id) => {
    const note = get().notes.find((n) => n.id === id);
    const point = note && notePoint(note);
    const handle = useViewer.getState().handle;
    if (!point || !handle) return;
    const size = handle.contentBounds().getSize(new Vector3());
    const r = Math.max(Math.max(size.x, size.y, size.z) * 0.06, 2);
    handle.fitTo(new Box3(point.clone().subScalar(r), point.clone().addScalar(r)));
  },

  setVisible: (visible) => {
    set({ visible });
    get().redraw();
  },

  redraw: () => {
    const handle = useViewer.getState().handle;
    for (const object of objects.values()) handle?.removeOverlay(object);
    objects.clear();
    if (!handle || !get().visible || !useModel.getState().model) return;
    const size = handle.contentBounds().getSize(new Vector3());
    const span = Math.max(size.x, size.y, size.z);
    get().notes.forEach((note, index) => {
      const point = notePoint(note);
      if (!point) return;
      const object = createNoteObject(point, `${index + 1} · ${note.text}`, span);
      objects.set(note.id, object);
      handle.addOverlay(object);
    });
  },
}));

// Notes belong to the project; pins follow the main model's coordinates.
useProject.subscribe((state, previous) => {
  if (state.current?.id !== previous.current?.id) void useNotes.getState().refresh();
});
useModel.subscribe((state, previous) => {
  if (state.model !== previous.model) {
    // After the view store has cleared the overlay for the new model.
    setTimeout(() => {
      objects.clear();
      if (useNotes.getState().notes.length === 0) void useNotes.getState().refresh();
      else useNotes.getState().redraw();
    }, 0);
  }
});
