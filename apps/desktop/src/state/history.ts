import { create } from 'zustand';
import { useAppearance, type Look } from './appearance';
import { useModel } from './model';
import { useView, type ClipPlane } from './view';

/** What undo restores: visibility, colours and transparency, and section planes. */
export interface Snapshot {
  hidden: ReadonlySet<number>;
  looks: ReadonlyMap<number, Look>;
  planes: ClipPlane[];
}

/** Changes closer together than this become one step (slider drags, plane drags). */
const MERGE_MS = 400;
const LIMIT = 100;

interface HistoryState {
  past: Snapshot[];
  future: Snapshot[];
  undo(): void;
  redo(): void;
  clear(): void;
}

let applying = false;
let lastPush = 0;

/** The current state. The stores replace these collections on change, so no copies. */
function current(): Snapshot {
  return {
    hidden: useModel.getState().hidden,
    looks: useAppearance.getState().looks,
    planes: useView.getState().planes,
  };
}

function restore(snapshot: Snapshot): void {
  applying = true;
  try {
    const model = useModel.getState();
    model.showAll();
    if (snapshot.hidden.size) model.hide(snapshot.hidden);
    useAppearance.getState().replace(new Map(snapshot.looks));
    useView.getState().replacePlanes(snapshot.planes);
  } finally {
    applying = false;
  }
}

export const useHistory = create<HistoryState>((set, get) => ({
  past: [],
  future: [],

  undo: () => {
    const { past, future } = get();
    const previous = past[past.length - 1];
    if (!previous) return;
    const now = current();
    set({ past: past.slice(0, -1), future: [...future, now] });
    restore(previous);
    lastPush = 0;
  },

  redo: () => {
    const { past, future } = get();
    const next = future[future.length - 1];
    if (!next) return;
    const now = current();
    set({ future: future.slice(0, -1), past: [...past, now] });
    restore(next);
    lastPush = 0;
  },

  clear: () => {
    set({ past: [], future: [] });
    lastPush = 0;
  },
}));

/** Records the state before a change, merging rapid changes into one step. */
function record(before: Snapshot): void {
  if (applying || !useModel.getState().model) return;
  const now = Date.now();
  const { past } = useHistory.getState();
  if (now - lastPush < MERGE_MS && past.length > 0) {
    lastPush = now;
    useHistory.setState({ future: [] });
    return;
  }
  lastPush = now;
  useHistory.setState({ past: [...past, before].slice(-LIMIT), future: [] });
}

useModel.subscribe((state, previous) => {
  if (state.model !== previous.model) {
    useHistory.getState().clear();
    return;
  }
  if (state.hidden !== previous.hidden) {
    record({ ...current(), hidden: previous.hidden });
  }
});

useAppearance.subscribe((state, previous) => {
  if (state.looks !== previous.looks) record({ ...current(), looks: previous.looks });
});

useView.subscribe((state, previous) => {
  if (state.planes !== previous.planes) record({ ...current(), planes: previous.planes });
});
