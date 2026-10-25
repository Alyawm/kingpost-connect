import { create } from 'zustand';
import { IfcFrame, type ElementAppearance } from '@kingpost/viewer';
import {
  elementDetails,
  revisionElements,
  type ElementDetails,
  type ElementSummary,
  type RevisionRow,
} from '../lib/ipc';
import { log } from './log';
import { loadGeometry, setKeptObjects, useModel, type LoadedModel } from './model';
import { useView } from './view';
import { useViewer } from './viewer';

/**
 * Reference models: further revisions shown with the main model, aligned in IFC world
 * coordinates. The main model keeps every feature (tree, properties, schedules, review);
 * reference models can be shown, faded, coloured, picked for their properties, removed,
 * or made the main model.
 */
export interface ReferenceModel extends LoadedModel {
  key: string;
  byId: Map<number, ElementSummary>;
  visible: boolean;
  /** 1 is solid; lower values fade the whole model. */
  opacity: number;
  /** One colour for the whole model, or null for its own colours. */
  color: string | null;
}

/** An element picked in a reference model, for the inspector. */
export interface ReferencePick {
  key: string;
  expressId: number;
  summary: ElementSummary | null;
  details: ElementDetails | null;
}

interface FederationState {
  refs: ReferenceModel[];
  loading: string | null;
  picked: ReferencePick | null;
  /** Loads a revision as a reference model next to the main one. */
  add(relPath: string, revision: RevisionRow): Promise<void>;
  remove(key: string): void;
  removeAll(): void;
  setVisible(key: string, visible: boolean): void;
  setOpacity(key: string, opacity: number): void;
  setColor(key: string, color: string | null): void;
  fit(key: string): void;
  /** Swaps a reference model with the main model. */
  makeMain(key: string): void;
  /** An element of a reference model was clicked (null clears the pick). */
  pick(key: string | null, expressId?: number): Promise<void>;
}

let counter = 0;

/** Places every reference model in the main model's viewer space. */
function realign(refs: ReferenceModel[]): void {
  const main = useModel.getState();
  if (main.model) {
    main.model.group.position.set(0, 0, 0);
    main.model.group.quaternion.identity();
    main.model.group.scale.set(1, 1, 1);
    main.model.group.updateMatrixWorld(true);
  }
  for (const ref of refs) {
    const matrix = main.frame ? IfcFrame.between(ref.frame, main.frame) : null;
    if (matrix) {
      matrix.decompose(ref.model.group.position, ref.model.group.quaternion, ref.model.group.scale);
    }
    ref.model.group.updateMatrixWorld(true);
  }
  useViewer.getState().handle?.render();
}

/** Applies a reference model's whole-model colour and fade. */
function applyLook(ref: ReferenceModel): void {
  if (ref.color === null && ref.opacity >= 1) {
    ref.model.setAppearance(null);
  } else {
    const look: ElementAppearance = {};
    if (ref.color) look.color = ref.color;
    if (ref.opacity < 1) look.opacity = ref.opacity;
    ref.model.setAppearance(new Map(ref.model.expressIds.map((id) => [id, look])));
  }
  useViewer.getState().handle?.render();
}

export const useFederation = create<FederationState>((set, get) => {
  const patch = (key: string, change: Partial<ReferenceModel>) => {
    const refs = get().refs.map((r) => (r.key === key ? { ...r, ...change } : r));
    set({ refs });
    return refs.find((r) => r.key === key);
  };

  return {
    refs: [],
    loading: null,
    picked: null,

    add: async (relPath, revision) => {
      const handle = useViewer.getState().handle;
      const main = useModel.getState();
      if (!handle) return;
      if (!main.model) {
        // Nothing to refer to yet: this becomes the main model.
        await main.load(relPath, revision);
        return;
      }
      if (
        main.revision?.id === revision.id ||
        get().refs.some((r) => r.revision.id === revision.id)
      ) {
        log.info(`${relPath} revision ${revision.idx} is already in the view.`);
        return;
      }
      set({ loading: relPath });
      try {
        const started = performance.now();
        const elements = await revisionElements(revision.id);
        const { model, frame } = await loadGeometry(relPath, revision);
        const key = `ref-${++counter}`;
        model.key = key;
        const ref: ReferenceModel = {
          key,
          relPath,
          revision,
          model,
          frame,
          elements,
          byId: new Map(elements.map((e) => [e.express_id, e])),
          visible: true,
          opacity: 1,
          color: null,
        };
        handle.add(model.group);
        if (useView.getState().edges) void model.setEdgesVisible(true).then(() => handle.render());
        const refs = [...get().refs, ref];
        set({ refs });
        realign(refs);
        log.info(
          `Added ${relPath} (revision ${revision.idx}) as a reference model: ` +
            `${elements.length.toLocaleString()} elements in ${Math.round(performance.now() - started)} ms`,
        );
      } catch (error) {
        log.error(`Could not add ${relPath}: ${String(error)}`);
      } finally {
        set({ loading: null });
      }
    },

    remove: (key) => {
      const ref = get().refs.find((r) => r.key === key);
      if (!ref) return;
      useViewer.getState().handle?.remove(ref.model.group);
      ref.model.dispose();
      set({
        refs: get().refs.filter((r) => r.key !== key),
        picked: get().picked?.key === key ? null : get().picked,
      });
    },

    removeAll: () => {
      for (const ref of get().refs) get().remove(ref.key);
    },

    setVisible: (key, visible) => {
      const ref = patch(key, { visible });
      if (ref) ref.model.group.visible = visible;
      useViewer.getState().handle?.render();
    },

    setOpacity: (key, opacity) => {
      const ref = patch(key, { opacity: Math.max(0.05, Math.min(1, opacity)) });
      if (ref) applyLook(ref);
    },

    setColor: (key, color) => {
      const ref = patch(key, { color });
      if (ref) applyLook(ref);
    },

    fit: (key) => {
      const ref = get().refs.find((r) => r.key === key);
      const box = ref?.model.boundsOf(ref.model.expressIds);
      if (box) useViewer.getState().handle?.fitTo(box);
    },

    makeMain: (key) => {
      const ref = get().refs.find((r) => r.key === key);
      if (!ref) return;
      ref.model.setAppearance(null);
      ref.model.group.visible = true;
      ref.model.key = 'main';
      // Off the reference list first: the main-model listener must not treat it as a
      // duplicate and dispose it.
      let refs = get().refs.filter((r) => r.key !== key);
      set({ refs });
      const previous = useModel.getState().takeOver(ref);
      if (previous) {
        const newKey = `ref-${++counter}`;
        previous.model.key = newKey;
        previous.model.setAppearance(null);
        refs = [
          ...refs,
          {
            ...previous,
            key: newKey,
            byId: new Map(previous.elements.map((e) => [e.express_id, e])),
            visible: true,
            opacity: 1,
            color: null,
          },
        ];
      }
      set({ refs, picked: null });
      realign(refs);
      useViewer.getState().handle?.fit();
      log.info(`${ref.relPath} (revision ${ref.revision.idx}) is now the main model.`);
    },

    pick: async (key, expressId) => {
      for (const ref of get().refs)
        ref.model.setSelected(ref.key === key ? (expressId ?? null) : null);
      useViewer.getState().handle?.render();
      const ref = key ? get().refs.find((r) => r.key === key) : undefined;
      if (!ref || expressId === undefined) {
        set({ picked: null });
        return;
      }
      const picked: ReferencePick = {
        key: ref.key,
        expressId,
        summary: ref.byId.get(expressId) ?? null,
        details: null,
      };
      set({ picked });
      try {
        const details = await elementDetails(ref.revision.id, expressId);
        if (get().picked?.expressId === expressId && get().picked?.key === key) {
          set({ picked: { ...picked, details } });
        }
      } catch (error) {
        log.error(`Could not read element #${expressId}: ${String(error)}`);
      }
    },
  };
});

// A new main model keeps the reference models in the scene and lines them up with it.
setKeptObjects(() => useFederation.getState().refs.map((r) => r.model.group));
useModel.subscribe((state, previous) => {
  if (state.model === previous.model) return;
  const refs = useFederation.getState().refs;
  if (!state.model) {
    // Main model closed (project closed or cleared): references go with it.
    if (refs.length && !useModel.getState().loading) useFederation.getState().removeAll();
    return;
  }
  // A reference that is now loaded as the main model would show twice.
  const duplicate = refs.find(
    (r) => r.revision.id === state.revision?.id && r.model !== state.model,
  );
  if (duplicate) useFederation.getState().remove(duplicate.key);
  realign(useFederation.getState().refs);
});

// Edge lines follow the viewer setting on reference models too.
useView.subscribe((state, previous) => {
  if (state.edges === previous.edges) return;
  for (const ref of useFederation.getState().refs) {
    void ref.model.setEdgesVisible(state.edges).then(() => useViewer.getState().handle?.render());
  }
});
