import { create } from 'zustand';
import { Vector3 } from '@kingpost/viewer';
import {
  bcfExport,
  bcfImport,
  commentAdd,
  isTauri,
  issueCreate,
  issueDelete,
  issueDetails,
  issuesList,
  issueUpdate,
  statusClear,
  statusList,
  statusSet,
  viewpointAdd,
  viewpointSnapshot,
  type IssueDetails,
  type IssuePatch,
  type IssueRow,
  type NewIssue,
  type NewViewpointInput,
  type StatusRow,
  type Triple,
  type ViewpointCamera,
  type ViewpointClipping,
  type ViewpointComponents,
  type ViewpointLine,
  type ViewpointRow,
} from '../lib/ipc';
import { log } from './log';
import { useModel } from './model';
import { useProject } from './project';
import { useUi } from './ui';
import { setStatusSource, useView, type Stage } from './view';
import { useViewer } from './viewer';

export interface NewIssueForm {
  title: string;
  description: string;
  priority: string;
  assignee: string;
  due: string;
  labels: string;
}

interface ReviewState {
  issues: IssueRow[];
  statuses: Map<string, StatusRow>;
  selectedIssueId: string | null;
  details: IssueDetails | null;
  /** Thumbnails by viewpoint id, fetched on demand. */
  snapshots: Map<string, string>;
  busy: boolean;
  refresh(): Promise<void>;
  openIssue(id: string | null): Promise<void>;
  createIssue(form: NewIssueForm, withViewpoint: boolean): Promise<IssueRow | null>;
  updateIssue(id: string, patch: IssuePatch): Promise<void>;
  deleteIssue(id: string): Promise<void>;
  addComment(issueId: string, text: string, withViewpoint: boolean): Promise<void>;
  addViewpoint(issueId: string): Promise<void>;
  applyViewpoint(viewpoint: ViewpointRow): void;
  loadSnapshot(viewpointId: string): Promise<void>;
  selectIssueElements(details: IssueDetails): void;
  setStageOfSelection(stage: Stage, note?: string): Promise<void>;
  clearStageOfSelection(): Promise<void>;
  exportBcf(): Promise<void>;
  importBcf(): Promise<void>;
}

const author = () => useUi.getState().author;

export const useReview = create<ReviewState>((set, get) => ({
  issues: [],
  statuses: new Map(),
  selectedIssueId: null,
  details: null,
  snapshots: new Map(),
  busy: false,

  refresh: async () => {
    if (!useProject.getState().current) {
      set({ issues: [], statuses: new Map(), selectedIssueId: null, details: null });
      return;
    }
    try {
      const [issues, statusRows] = await Promise.all([issuesList(), statusList()]);
      set({ issues, statuses: new Map(statusRows.map((s) => [s.element_global_id, s])) });
      useView.getState().refreshColors();
      const open = get().selectedIssueId;
      if (open) set({ details: await issueDetails(open) });
    } catch (error) {
      log.error(`Could not load review data: ${String(error)}`);
    }
  },

  openIssue: async (id) => {
    set({ selectedIssueId: id, details: null });
    if (!id) return;
    try {
      set({ details: await issueDetails(id) });
    } catch (error) {
      log.error(`Could not open issue: ${String(error)}`);
    }
  },

  createIssue: async (form, withViewpoint) => {
    const issue: NewIssue = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      priority: form.priority || null,
      assignee: form.assignee.trim() || null,
      due: form.due ? new Date(form.due).toISOString() : null,
      labels: form.labels
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean),
      created_by: author(),
    };
    const elements = useModel.getState().selectedGlobalIds();
    const viewpoint = withViewpoint ? captureViewpoint() : null;
    set({ busy: true });
    try {
      const created = await issueCreate(issue, elements, viewpoint);
      log.info(
        `Issue #${created.idx ?? ''} "${created.title}" created` +
          (elements.length ? ` on ${elements.length} element(s)` : ''),
      );
      await get().refresh();
      await get().openIssue(created.id);
      return created;
    } catch (error) {
      log.error(`Could not create issue: ${String(error)}`);
      return null;
    } finally {
      set({ busy: false });
    }
  },

  updateIssue: async (id, patch) => {
    try {
      await issueUpdate(id, patch, author());
      await get().refresh();
    } catch (error) {
      log.error(`Could not update issue: ${String(error)}`);
    }
  },

  deleteIssue: async (id) => {
    try {
      await issueDelete(id);
      if (get().selectedIssueId === id) set({ selectedIssueId: null, details: null });
      await get().refresh();
    } catch (error) {
      log.error(`Could not delete issue: ${String(error)}`);
    }
  },

  addComment: async (issueId, text, withViewpoint) => {
    try {
      let viewpointId: string | null = null;
      if (withViewpoint) {
        const captured = captureViewpoint();
        if (captured) viewpointId = (await viewpointAdd(issueId, captured)).id;
      }
      await commentAdd(issueId, text, author(), viewpointId);
      await get().refresh();
    } catch (error) {
      log.error(`Could not add comment: ${String(error)}`);
    }
  },

  addViewpoint: async (issueId) => {
    const captured = captureViewpoint();
    if (!captured) {
      log.warn('Load a model before adding a viewpoint.');
      return;
    }
    try {
      await viewpointAdd(issueId, captured);
      await get().refresh();
    } catch (error) {
      log.error(`Could not add viewpoint: ${String(error)}`);
    }
  },

  applyViewpoint: (viewpoint) => {
    const { frame, model, byGlobalId } = useModel.getState();
    const handle = useViewer.getState().handle;
    if (!frame || !model || !handle) {
      log.warn('Load the model this viewpoint belongs to first.');
      return;
    }
    const camera = parse<ViewpointCamera>(viewpoint.camera_json);
    const components = parse<ViewpointComponents>(viewpoint.components_json);
    const lines = parse<ViewpointLine[]>(viewpoint.lines_json) ?? [];
    const clipping = parse<ViewpointClipping[]>(viewpoint.clipping_json) ?? [];

    if (camera) {
      const position = frame.pointFromIfc(camera.view_point);
      const direction = frame.directionFromIfc(camera.direction);
      const center = handle.contentBounds().getCenter(position.clone());
      const distance = Math.max(1, center.sub(position).dot(direction));
      const target = position.clone().addScaledVector(direction, distance);
      handle.setCamera({
        position: position.toArray() as Triple,
        target: target.toArray() as Triple,
      });
    }

    const modelState = useModel.getState();
    if (components) {
      const ids = (guids: string[]) =>
        guids.map((g) => byGlobalId.get(g)).filter((id): id is number => id !== undefined);
      if (components.default_visibility) {
        modelState.showAll();
        const hidden = ids(components.exceptions);
        if (hidden.length) modelState.hide(hidden);
      } else {
        modelState.isolate(ids(components.exceptions));
      }
      void modelState.selectMany(ids(components.selection));
    }

    const view = useView.getState();
    view.clearMarkups();
    if (lines.length) {
      view.addMarkups(
        lines.map((l) => ({
          start: frame.pointFromIfc(l.start).toArray() as Triple,
          end: frame.pointFromIfc(l.end).toArray() as Triple,
        })),
      );
    }

    const plane = clipping[0];
    if (plane) {
      const normal = frame.directionFromIfc(plane.direction);
      const location = frame.pointFromIfc(plane.location);
      const axis = dominantAxis(normal);
      if (axis) {
        view.setSection({
          enabled: true,
          axis,
          position: location[axis],
          flip: normal[axis] < 0,
        });
      }
    } else {
      view.setSection({ enabled: false });
    }
  },

  loadSnapshot: async (viewpointId) => {
    if (get().snapshots.has(viewpointId)) return;
    try {
      const url = await viewpointSnapshot(viewpointId);
      if (url) set({ snapshots: new Map(get().snapshots).set(viewpointId, url) });
    } catch (error) {
      log.error(`Could not load snapshot: ${String(error)}`);
    }
  },

  selectIssueElements: (details) => {
    const { byGlobalId } = useModel.getState();
    const ids = details.elements
      .map((g) => byGlobalId.get(g))
      .filter((id): id is number => id !== undefined);
    if (!ids.length) {
      log.warn('None of this issue’s elements are in the loaded model.');
      return;
    }
    void useModel.getState().selectMany(ids);
    useModel.getState().fitTo(ids);
  },

  setStageOfSelection: async (stage, note) => {
    const globalIds = useModel.getState().selectedGlobalIds();
    if (!globalIds.length) {
      log.warn('Select elements first (click, Ctrl+click, or the tree).');
      return;
    }
    try {
      const count = await statusSet(globalIds, stage, author(), note ?? null);
      log.info(`${count} element(s) set to ${stage}`);
      await get().refresh();
    } catch (error) {
      log.error(`Could not set status: ${String(error)}`);
    }
  },

  clearStageOfSelection: async () => {
    const globalIds = useModel.getState().selectedGlobalIds();
    if (!globalIds.length) return;
    try {
      await statusClear(globalIds);
      await get().refresh();
    } catch (error) {
      log.error(`Could not clear status: ${String(error)}`);
    }
  },

  exportBcf: async () => {
    if (!isTauri()) return;
    const { save } = await import('@tauri-apps/plugin-dialog');
    const name = useProject.getState().current?.name ?? 'issues';
    const path = await save({
      title: 'Export issues as BCF',
      defaultPath: `${name}.bcf`,
      filters: [{ name: 'BCF', extensions: ['bcf', 'bcfzip'] }],
    });
    if (!path) return;
    try {
      const count = await bcfExport(path);
      log.info(`Exported ${count} issue(s) to ${path}`);
    } catch (error) {
      log.error(`BCF export failed: ${String(error)}`);
    }
  },

  importBcf: async () => {
    if (!isTauri()) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({
      title: 'Import BCF',
      multiple: false,
      filters: [{ name: 'BCF', extensions: ['bcf', 'bcfzip'] }],
    });
    if (!path) return;
    try {
      const summary = await bcfImport(path);
      log.info(
        `Imported ${summary.topics_added} topic(s), ${summary.comments_added} comment(s), ` +
          `${summary.viewpoints_added} viewpoint(s); ${summary.topics_skipped} already present`,
      );
      await get().refresh();
    } catch (error) {
      log.error(`BCF import failed: ${String(error)}`);
    }
  },
}));

/** The current camera, selection, hidden set, section and markups as a BCF viewpoint. */
export function captureViewpoint(): NewViewpointInput | null {
  const { frame, model, byId, selectedIds, hidden } = useModel.getState();
  const handle = useViewer.getState().handle;
  if (!frame || !model || !handle) return null;
  const camera = handle.getCamera();
  const position = vector(camera.position);
  const direction = vector(camera.target).sub(position).normalize();
  const canvas = document.querySelector('main canvas') as HTMLCanvasElement | null;
  const aspect = canvas && canvas.height > 0 ? canvas.width / canvas.height : 1.6;

  const view = useView.getState();
  const clipping: ViewpointClipping[] = [];
  if (view.section.enabled) {
    const center = handle.contentBounds().getCenter(position.clone());
    center[view.section.axis] = view.section.position;
    const normal = new Vector3();
    normal[view.section.axis] = view.section.flip ? -1 : 1; // points to the removed side
    clipping.push({
      location: frame.pointToIfc(center),
      direction: frame.directionToIfc(normal),
    });
  }

  return {
    camera: {
      view_point: frame.pointToIfc(position),
      direction: frame.directionToIfc(direction),
      up: frame.directionToIfc(vector([0, 1, 0])),
      field_of_view: 50,
      aspect_ratio: aspect,
    },
    components: {
      selection: [...selectedIds]
        .map((id) => byId.get(id)?.global_id)
        .filter((g): g is string => !!g),
      default_visibility: true,
      exceptions: [...hidden].map((id) => byId.get(id)?.global_id).filter((g): g is string => !!g),
      coloring: [],
    },
    lines: view.markups.map((l) => ({
      start: frame.pointToIfc(vector(l.start)),
      end: frame.pointToIfc(vector(l.end)),
    })),
    clipping,
    snapshot: handle.snapshot(640),
  };
}

type SectionAxisKey = 'x' | 'y' | 'z';

function dominantAxis(v: { x: number; y: number; z: number }): SectionAxisKey | null {
  const entries: [SectionAxisKey, number][] = [
    ['x', Math.abs(v.x)],
    ['y', Math.abs(v.y)],
    ['z', Math.abs(v.z)],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  const [best, second] = entries;
  return best && second && best[1] > 0.95 && second[1] < 0.2 ? best[0] : null;
}

function parse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function vector(t: Triple): Vector3 {
  return new Vector3(t[0], t[1], t[2]);
}

// Review data belongs to the project: reload when it changes, and feed statuses to the
// colour-by-status legend.
useProject.subscribe((state, previous) => {
  if (state.current?.id !== previous.current?.id) void useReview.getState().refresh();
});
setStatusSource(() => {
  const map = new Map<string, string>();
  for (const [guid, row] of useReview.getState().statuses) map.set(guid, row.stage);
  return map;
});
