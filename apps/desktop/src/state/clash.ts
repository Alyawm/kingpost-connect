import { create } from 'zustand';
import { Vector3, createMarkerObject, findClashes, type ClashHit } from '@kingpost/viewer';
import {
  clashList,
  clashRunRecord,
  clashSetStatus,
  clashTestCreate,
  clashTestDelete,
  clashTests,
  isTauri,
  type ClashFound,
  type ClashKind,
  type ClashRow,
  type ClashStatus,
  type ClashTestRow,
  type ElementSummary,
} from '../lib/ipc';
import { useFederation } from './federation';
import { log } from './log';
import { useModel } from './model';
import { useProject } from './project';
import { useReview } from './review';
import { useUi } from './ui';
import { useViewer } from './viewer';

export type ClashFilter = ClashStatus | 'open' | 'all';

export const STATUS_COLORS: Record<ClashStatus, string> = {
  new: '#ff6b6b',
  active: '#ff8a4c',
  reviewed: '#f5b941',
  approved: '#5b9dff',
  resolved: '#3ccf7a',
};

interface ClashState {
  tests: ClashTestRow[];
  selectedTestId: string | null;
  clashes: ClashRow[];
  /** GlobalIds captured from the selection for the next test. */
  setA: string[];
  setB: string[];
  running: boolean;
  progress: { done: number; total: number; found: number } | null;
  filter: ClashFilter;
  selectedClashId: string | null;
  refresh(): Promise<void>;
  captureSet(which: 'a' | 'b'): void;
  /** Captures every element with geometry that is not in set A. */
  captureRestAsB(): void;
  /** Set B: every element with geometry in a reference model (clash between models). */
  captureReferenceAsB(key: string): void;
  createTest(name: string, kind: ClashKind, clearance: number): Promise<void>;
  deleteTest(id: string): Promise<void>;
  selectTest(id: string | null): Promise<void>;
  run(testId: string): Promise<void>;
  cancel(): void;
  setFilter(filter: ClashFilter): void;
  /** Selects both elements, frames them and marks the clash point. */
  focus(clash: ClashRow): void;
  setStatus(id: string, status: ClashStatus, note?: string | null): Promise<void>;
  /** Raises a review issue on the clash's two elements with the current view. */
  createIssue(clash: ClashRow): Promise<void>;
}

let abort: AbortController | null = null;

export function clashLabel(
  clash: ClashRow,
  byGlobalId: Map<string, number>,
  byId: Map<number, ElementSummary>,
): string {
  const name = (globalId: string) => {
    const id = byGlobalId.get(globalId);
    const element = id === undefined ? undefined : byId.get(id);
    return element?.name ?? element?.tag ?? globalId;
  };
  return `${name(clash.a_global_id)} ↔ ${name(clash.b_global_id)}`;
}

export function filterClashes(clashes: ClashRow[], filter: ClashFilter): ClashRow[] {
  if (filter === 'all') return clashes;
  if (filter === 'open')
    return clashes.filter((c) => c.status !== 'approved' && c.status !== 'resolved');
  return clashes.filter((c) => c.status === filter);
}

/** Clashes grouped by the IFC types of their pair, largest group first. */
export function groupByTypes(
  clashes: ClashRow[],
  byGlobalId: Map<string, number>,
  byId: Map<number, ElementSummary>,
) {
  const groups = new Map<string, ClashRow[]>();
  for (const c of clashes) {
    const type = (g: string) =>
      byId.get(byGlobalId.get(g) ?? -1)?.ifc_type.replace(/^IFC/, '') ?? '?';
    const key = [type(c.a_global_id), type(c.b_global_id)].sort().join(' ↔ ');
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.entries()].sort((x, y) => y[1].length - x[1].length);
}

export const useClash = create<ClashState>((set, get) => ({
  tests: [],
  selectedTestId: null,
  clashes: [],
  setA: [],
  setB: [],
  running: false,
  progress: null,
  filter: 'open',
  selectedClashId: null,

  refresh: async () => {
    try {
      const tests = await clashTests();
      set({ tests });
      const selected = get().selectedTestId;
      if (selected && !tests.some((t) => t.id === selected))
        set({ selectedTestId: null, clashes: [] });
    } catch (error) {
      log.error(`Could not list clash tests: ${String(error)}`);
    }
  },

  captureSet: (which) => {
    const ids = useModel.getState().selectedGlobalIds();
    if (ids.length === 0) {
      log.warn('Select elements in the model first.');
      return;
    }
    set(which === 'a' ? { setA: ids } : { setB: ids });
    log.info(`Set ${which.toUpperCase()}: ${ids.length} element(s)`);
  },

  captureRestAsB: () => {
    const a = new Set(get().setA);
    const rest = useModel
      .getState()
      .elements.filter((e) => e.has_geometry && !e.is_spatial && !a.has(e.global_id))
      .map((e) => e.global_id);
    set({ setB: rest });
    log.info(`Set B: the other ${rest.length} element(s) with geometry`);
  },

  captureReferenceAsB: (key) => {
    const ref = useFederation.getState().refs.find((r) => r.key === key);
    if (!ref) return;
    const ids = ref.elements.filter((e) => e.has_geometry && !e.is_spatial).map((e) => e.global_id);
    set({ setB: ids });
    log.info(`Set B: all ${ids.length} element(s) of ${ref.relPath}`);
  },

  createTest: async (name, kind, clearance) => {
    const { setA, setB } = get();
    if (!isTauri()) return;
    try {
      const test = await clashTestCreate(name, kind, clearance, setA, setB);
      await get().refresh();
      await get().selectTest(test.id);
      log.info(`Clash test "${test.name}" created: ${setA.length} × ${setB.length} elements`);
    } catch (error) {
      log.error(`Could not create the test: ${String(error)}`);
    }
  },

  deleteTest: async (id) => {
    try {
      await clashTestDelete(id);
      if (get().selectedTestId === id) set({ selectedTestId: null, clashes: [] });
      await get().refresh();
    } catch (error) {
      log.error(`Could not delete the test: ${String(error)}`);
    }
  },

  selectTest: async (id) => {
    set({ selectedTestId: id, selectedClashId: null });
    if (!id) {
      set({ clashes: [] });
      return;
    }
    try {
      set({ clashes: await clashList(id) });
    } catch (error) {
      log.error(`Could not load clashes: ${String(error)}`);
    }
  },

  run: async (testId) => {
    const test = get().tests.find((t) => t.id === testId);
    const model = useModel.getState();
    if (!test || !model.model || !model.revision) {
      log.warn('Load a model revision before running a clash test.');
      return;
    }
    // Elements are looked up in the main model first, then in each reference model, and
    // addressed by one combined key: model slot × 2³² + express id.
    const sources = [
      { model: model.model, byGlobalId: model.byGlobalId, byId: model.byId },
      ...useFederation.getState().refs.map((r) => ({
        model: r.model,
        byGlobalId: new Map(r.elements.map((e) => [e.global_id, e.express_id])),
        byId: r.byId,
      })),
    ];
    const SLOT = 2 ** 32;
    const keyOf = (globalId: string): number | undefined => {
      for (let slot = 0; slot < sources.length; slot++) {
        const id = sources[slot]!.byGlobalId.get(globalId);
        if (id !== undefined) return slot * SLOT + id;
      }
      return undefined;
    };
    const resolve = (ids: string[]) =>
      ids.map(keyOf).filter((id): id is number => id !== undefined);
    const combined = {
      trianglesOf: (key: number) => sources[Math.floor(key / SLOT)]!.model.trianglesOf(key % SLOT),
    };
    const globalIdOf = (key: number) =>
      sources[Math.floor(key / SLOT)]!.byId.get(key % SLOT)?.global_id ?? '';
    const a = resolve(test.set_a);
    const b = resolve(test.set_b);
    const missing = test.set_a.length + test.set_b.length - a.length - b.length;
    if (a.length === 0 || b.length === 0) {
      log.warn('None of the test’s elements are in the loaded revision.');
      return;
    }
    abort?.abort();
    abort = new AbortController();
    set({ running: true, progress: { done: 0, total: 0, found: 0 } });
    const started = performance.now();
    try {
      const hits: ClashHit[] = await findClashes(
        combined,
        a,
        b,
        { clearance: test.kind === 'clearance' ? test.clearance : 0, signal: abort.signal },
        (progress) => set({ progress }),
      );
      if (abort.signal.aborted) {
        log.warn('Clash test cancelled.');
        return;
      }
      const found: ClashFound[] = hits.map((h) => ({
        a_global_id: globalIdOf(h.a),
        b_global_id: globalIdOf(h.b),
        kind: h.kind,
        distance: h.distance,
        point: h.point,
      }));
      const summary = await clashRunRecord(testId, model.revision.id, found);
      log.info(
        `"${test.name}": ${summary.found} clash(es) in ${Math.round(performance.now() - started)} ms ` +
          `(${summary.new} new, ${summary.still} still there, ${summary.reopened} back, ${summary.resolved} resolved)` +
          (missing ? `; ${missing} element(s) of the sets are not in this revision` : ''),
      );
      await get().refresh();
      await get().selectTest(testId);
    } catch (error) {
      log.error(`Clash test failed: ${String(error)}`);
    } finally {
      set({ running: false, progress: null });
    }
  },

  cancel: () => abort?.abort(),

  setFilter: (filter) => set({ filter }),

  focus: (clash) => {
    const model = useModel.getState();
    const ids = [clash.a_global_id, clash.b_global_id]
      .map((g) => model.byGlobalId.get(g))
      .filter((id): id is number => id !== undefined);
    set({ selectedClashId: clash.id });
    if (ids.length === 0) {
      log.warn('Load the revision that contains these elements to see them.');
      return;
    }
    void model.selectMany(ids);
    const handle = useViewer.getState().handle;
    if (handle) {
      handle.clearOverlay();
      handle.addOverlay(
        createMarkerObject(
          new Vector3(...clash.point),
          clash.kind === 'hard' ? '#ff4d4d' : '#f5b941',
        ),
      );
      const box = model.model?.boundsOf(ids);
      if (box) handle.fitTo(box);
      handle.render();
    }
  },

  setStatus: async (id, status, note = null) => {
    try {
      await clashSetStatus(id, status, note);
      set({
        clashes: get().clashes.map((c) =>
          c.id === id ? { ...c, status, note: note ?? c.note } : c,
        ),
      });
      await get().refresh();
    } catch (error) {
      log.error(`Could not update the clash: ${String(error)}`);
    }
  },

  createIssue: async (clash) => {
    get().focus(clash);
    const model = useModel.getState();
    const label = clashLabel(clash, model.byGlobalId, model.byId);
    const test = get().tests.find((t) => t.id === clash.test_id);
    const created = await useReview.getState().createIssue(
      {
        title: `Clash: ${label}`,
        description:
          clash.kind === 'hard'
            ? `Elements intersect (${test?.name ?? 'clash test'}).`
            : `Clearance ${(clash.distance * 1000).toFixed(0)} mm, below ${((test?.clearance ?? 0) * 1000).toFixed(0)} mm (${test?.name ?? 'clash test'}).`,
        priority: clash.kind === 'hard' ? 'High' : 'Normal',
        assignee: '',
        due: '',
        labels: 'clash',
      },
      model.selectedIds.size > 0,
    );
    if (created) {
      await get().setStatus(clash.id, 'reviewed', null);
      useUi.getState().setSection('review');
    }
  },
}));

useProject.subscribe((state, previous) => {
  if (state.current?.id !== previous.current?.id) {
    abort?.abort();
    useClash.setState({
      tests: [],
      selectedTestId: null,
      clashes: [],
      setA: [],
      setB: [],
      selectedClashId: null,
    });
  }
});
