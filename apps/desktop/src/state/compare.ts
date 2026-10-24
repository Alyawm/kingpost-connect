import { create } from 'zustand';
import {
  diffExportCsv,
  diffRevisions,
  isTauri,
  type ChangeKind,
  type DiffItem,
  type DiffView,
  type ProjectFile,
  type RevisionRow,
} from '../lib/ipc';
import { log } from './log';
import { useModel } from './model';
import { useProject } from './project';
import { setChangeSource, useView } from './view';

interface CompareState {
  relPath: string | null;
  fromRevisionId: number | null;
  toRevisionId: number | null;
  diff: DiffView | null;
  busy: boolean;
  filter: ChangeKind | 'all';
  typeFilter: string | null;
  query: string;
  pick(relPath: string, fromRevisionId: number, toRevisionId: number): void;
  run(force?: boolean): Promise<void>;
  setFilter(filter: ChangeKind | 'all'): void;
  setTypeFilter(ifcType: string | null): void;
  setQuery(query: string): void;
  /** Selects the item's element in the loaded model when it is there. */
  focus(item: DiffItem): void;
  exportCsv(): Promise<void>;
  clear(): void;
}

/** Files with at least two revisions, with the last two preselected. */
export function comparableFiles(files: ProjectFile[]): ProjectFile[] {
  return files.filter((f) => f.kind === 'ifc' && f.revisions.length >= 2);
}

export function revisionLabel(revision: RevisionRow): string {
  return `rev ${revision.idx} · ${revision.element_count.toLocaleString()} el · ${new Date(revision.imported_at).toLocaleDateString()}`;
}

export const useCompare = create<CompareState>((set, get) => ({
  relPath: null,
  fromRevisionId: null,
  toRevisionId: null,
  diff: null,
  busy: false,
  filter: 'all',
  typeFilter: null,
  query: '',

  pick: (relPath, fromRevisionId, toRevisionId) =>
    set({ relPath, fromRevisionId, toRevisionId, diff: null, typeFilter: null }),

  run: async (force = false) => {
    const { fromRevisionId, toRevisionId } = get();
    if (fromRevisionId === null || toRevisionId === null || !isTauri()) return;
    set({ busy: true });
    try {
      const diff = await diffRevisions(fromRevisionId, toRevisionId, force);
      set({ diff });
      const s = diff.summary;
      log.info(
        `Compared revisions: ${s.added} added, ${s.removed} removed, ${s.modified} modified, ` +
          `${s.unchanged} unchanged${diff.cached ? ' (stored result)' : ` in ${s.elapsed_ms} ms`}`,
      );
      useView.getState().refreshColors();
    } catch (error) {
      log.error(`Comparison failed: ${String(error)}`);
    } finally {
      set({ busy: false });
    }
  },

  setFilter: (filter) => set({ filter }),
  setTypeFilter: (typeFilter) => set({ typeFilter }),
  setQuery: (query) => set({ query }),

  focus: (item) => {
    const model = useModel.getState();
    const id = model.byGlobalId.get(item.global_id);
    if (id === undefined) {
      log.warn(
        item.change === 'removed'
          ? 'Removed elements exist only in the older revision; load it to see them.'
          : 'Load the newer revision to see this element.',
      );
      return;
    }
    void model.selectMany([id]);
    model.fitTo([id]);
  },

  exportCsv: async () => {
    const { fromRevisionId, toRevisionId, relPath } = get();
    if (fromRevisionId === null || toRevisionId === null || !isTauri()) return;
    const { save } = await import('@tauri-apps/plugin-dialog');
    const base = (relPath ?? 'model').replace(/\.ifc$/i, '');
    const path = await save({
      title: 'Export comparison as CSV',
      defaultPath: `${base}-changes.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!path) return;
    try {
      const count = await diffExportCsv(fromRevisionId, toRevisionId, path);
      log.info(`Exported ${count} changed element(s) to ${path}`);
    } catch (error) {
      log.error(`CSV export failed: ${String(error)}`);
    }
  },

  clear: () => set({ relPath: null, fromRevisionId: null, toRevisionId: null, diff: null }),
}));

/** Items after the panel's filters. */
export function visibleItems(
  state: Pick<CompareState, 'diff' | 'filter' | 'typeFilter' | 'query'>,
): DiffItem[] {
  const { diff, filter, typeFilter, query } = state;
  if (!diff) return [];
  const needle = query.trim().toLowerCase();
  return diff.items.filter((item) => {
    if (filter !== 'all' && item.change !== filter) return false;
    if (typeFilter && item.detail.ifc_type !== typeFilter) return false;
    if (!needle) return true;
    return [item.global_id, item.detail.name, item.detail.type_name, item.detail.storey]
      .filter((v): v is string => !!v)
      .some((v) => v.toLowerCase().includes(needle));
  });
}

useProject.subscribe((state, previous) => {
  if (state.current?.id !== previous.current?.id) useCompare.getState().clear();
});

// Change colouring reads the current diff: added green, removed red, modified amber.
setChangeSource(() => {
  const map = new Map<string, ChangeKind>();
  for (const item of useCompare.getState().diff?.items ?? []) map.set(item.global_id, item.change);
  return map;
});
