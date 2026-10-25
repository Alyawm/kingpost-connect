import { create } from 'zustand';
import {
  Vector3,
  createLineObject,
  planeOffset,
  snapToAxis,
  withOffset,
  type ClipPlaneSpec,
  type NavigationMode,
  type PointPick,
} from '@kingpost/viewer';
import type { ElementSummary, Triple } from '../lib/ipc';
import { log } from './log';
import { useMeasure } from './measure';
import { useNotes } from './notes';
import { useModel } from './model';
import { useViewer } from './viewer';

export type SectionAxis = 'x' | 'y' | 'z';
export type ColorBy = 'none' | 'type' | 'material' | 'storey' | 'status' | 'change' | 'link';
export type Tool = 'select' | 'measure' | 'markup' | 'section' | 'note';

/** A section plane: viewer coordinates, normal pointing to the removed side. */
export type ClipPlane = ClipPlaneSpec;

/** The single-plane section stored by views saved before multiple planes existed. */
interface LegacySection {
  enabled: boolean;
  axis: SectionAxis;
  position: number;
  flip: boolean;
}

export interface LegendEntry {
  key: string;
  label: string;
  color: string;
  count: number;
  ids: number[];
}

/** A markup line in viewer coordinates (converted to IFC when it joins a viewpoint). */
export interface MarkupLine {
  start: Triple;
  end: Triple;
}

interface ViewState {
  tool: Tool;
  /** Section planes; every enabled one cuts, so several together make a section box. */
  planes: ClipPlane[];
  /** The plane being edited (highlighted, has the position slider). */
  activePlaneId: string | null;
  /** Whether plane handles are drawn in the viewport. */
  showPlaneHandles: boolean;
  /** What a left drag does in the viewport. */
  navMode: NavigationMode;
  /** Element edge lines on the model (remembered between sessions). */
  edges: boolean;
  setNavMode(mode: NavigationMode): void;
  /** Left drag draws a selection box instead of orbiting. */
  boxSelect: boolean;
  setBoxSelect(on: boolean): void;
  setEdges(on: boolean): void;
  colorBy: ColorBy;
  legend: LegendEntry[];
  /** First point of a measurement or markup in progress, if any. */
  pendingPoint: PointPick | null;
  markups: MarkupLine[];
  setTool(tool: Tool): void;
  pickPoint(pick: PointPick): void;
  clearMeasurements(): void;
  clearMarkups(): void;
  /** Draws lines (viewer coordinates) as markups, e.g. from an applied viewpoint. */
  addMarkups(lines: MarkupLine[]): void;
  /** Adds a plane through a point; the normal points to the side that is cut away. */
  addPlane(point: Triple, normal: Triple): void;
  /** Adds an axis-aligned plane through the model's centre. */
  addAxisPlane(axis: SectionAxis): void;
  /** Replaces the planes with a section box around the selection, or the whole model. */
  addSectionBox(): void;
  /** Moves a plane to a new point (from dragging its handle). */
  movePlane(id: string, point: Triple, fromViewport?: boolean): void;
  /** Moves a plane to an offset along its normal (from the slider). */
  setPlaneOffset(id: string, offset: number): void;
  flipPlane(id: string): void;
  togglePlane(id: string): void;
  removePlane(id: string): void;
  clearPlanes(): void;
  setActivePlane(id: string | null): void;
  setShowPlaneHandles(show: boolean): void;
  /** Replaces every plane at once (saved views, viewpoints). */
  replacePlanes(planes: ClipPlane[]): void;
  /** Places a plan cut just below the top of a storey and looks down on it. */
  planOfStorey(storey: string): void;
  setColorBy(mode: ColorBy): void;
  /** Re-applies the current colouring, e.g. after statuses changed. */
  refreshColors(): void;
  reset(): void;
}

/** Twelve colours that stay distinguishable on the dark and light canvases. */
export const PALETTE = [
  '#5b9dff',
  '#ff8a4c',
  '#3ccf7a',
  '#f5b941',
  '#c084fc',
  '#4dd4e0',
  '#ff6b9d',
  '#9ccc3c',
  '#f97066',
  '#7ab8ff',
  '#d4a373',
  '#8fd3b6',
];

export const STAGES = ['modelled', 'analysed', 'designed', 'checked', 'approved'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_COLORS: Record<Stage, string> = {
  modelled: '#8a94a6',
  analysed: '#c084fc',
  designed: '#5b9dff',
  checked: '#f5b941',
  approved: '#3ccf7a',
};

const NO_STATUS = '— not set —';
const UNCHANGED = 'unchanged';
let planeCounter = 0;
const newPlaneId = () => `plane-${Date.now().toString(36)}-${(planeCounter++).toString(36)}`;

function applyPlanes(state: Pick<ViewState, 'planes' | 'activePlaneId' | 'showPlaneHandles'>) {
  useViewer
    .getState()
    .handle?.setClipPlanes(state.planes, state.activePlaneId, state.showPlaneHandles);
}

/** A short name for a plane from its direction. */
export function planeLabel(plane: ClipPlane): string {
  const [x, y, z] = plane.normal.map((v) => Math.abs(v)) as Triple;
  if (y > 0.999) return 'Horizontal';
  if (x > 0.999) return 'Vertical X';
  if (z > 0.999) return 'Vertical Z';
  if (y < 0.001) return 'Vertical';
  return 'Angled';
}

/**
 * Section planes from a stored value: the current array form, or the single-plane object
 * written by earlier versions (unflipped kept the lower side, so it removed +axis).
 */
export function planesFromStored(value: unknown): ClipPlane[] {
  if (Array.isArray(value)) {
    return value.filter(
      (p): p is ClipPlane =>
        !!p && Array.isArray(p.point) && Array.isArray(p.normal) && typeof p.id === 'string',
    );
  }
  const legacy = value as Partial<LegacySection> | null;
  if (!legacy || !legacy.enabled || !legacy.axis || typeof legacy.position !== 'number') return [];
  const normal: Triple = [0, 0, 0];
  const point: Triple = [0, 0, 0];
  const index = { x: 0, y: 1, z: 2 }[legacy.axis];
  normal[index] = legacy.flip ? -1 : 1;
  point[index] = legacy.position;
  return [{ id: newPlaneId(), point, normal, enabled: true }];
}

export const CHANGE_COLORS: Record<string, string> = {
  added: '#3ccf7a',
  removed: '#ff6b6b',
  modified: '#f5b941',
  [UNCHANGED]: '#4a5260',
};

/** Supplies element statuses (GlobalId → stage) to the colouring without a store cycle. */
let statusSource: () => ReadonlyMap<string, string> = () => new Map();
export function setStatusSource(source: () => ReadonlyMap<string, string>): void {
  statusSource = source;
}

/** Supplies the current revision comparison (GlobalId → change) the same way. */
let changeSource: () => ReadonlyMap<string, string> = () => new Map();
export function setChangeSource(source: () => ReadonlyMap<string, string>): void {
  changeSource = source;
}

const NOT_COMPARED = 'not compared';
export const LINK_COLORS: Record<string, string> = {
  linked: '#3ccf7a',
  'section differs': '#f5b941',
  'material differs': '#c084fc',
  unmatched: '#ff6b6b',
  [NOT_COMPARED]: '#4a5260',
};

/** Supplies the physical ↔ analytical link status (GlobalId → status) the same way. */
let linkSource: () => ReadonlyMap<string, string> = () => new Map();
export function setLinkSource(source: () => ReadonlyMap<string, string>): void {
  linkSource = source;
}

export const useView = create<ViewState>((set, get) => ({
  tool: 'select',
  planes: [],
  activePlaneId: null,
  showPlaneHandles: true,
  navMode: 'orbit',
  boxSelect: false,
  edges: loadEdges(),
  colorBy: 'none',
  legend: [],
  pendingPoint: null,
  markups: [],

  setTool: (tool) => {
    if (tool !== 'measure') useMeasure.getState().cancel();
    set({ tool, pendingPoint: null });
    useViewer.getState().handle?.setPickMode(tool === 'select' ? 'select' : 'point');
  },

  pickPoint: (pick) => {
    const { pendingPoint, markups, tool } = get();
    if (tool === 'measure') {
      useMeasure.getState().pick(pick);
      return;
    }
    if (tool === 'note') {
      useNotes.getState().startAt(pick);
      get().setTool('select');
      return;
    }
    if (tool === 'section') {
      // A plane on the clicked face, removing what is in front of it; drag it inwards to cut.
      const normal = snapToAxis(pick.normal ?? new Vector3(0, 1, 0));
      get().addPlane(pick.point.toArray() as Triple, normal.toArray() as Triple);
      get().setTool('select');
      return;
    }
    if (!pendingPoint) {
      set({ pendingPoint: pick });
      return;
    }
    const handle = useViewer.getState().handle;
    if (tool === 'markup') {
      handle?.addOverlay(createLineObject(pendingPoint.point, pick.point));
      const line: MarkupLine = {
        start: pendingPoint.point.toArray() as Triple,
        end: pick.point.toArray() as Triple,
      };
      set({ pendingPoint: null, markups: [...markups, line] });
      return;
    }
  },

  clearMeasurements: () => {
    useMeasure.getState().clear();
  },

  clearMarkups: () => {
    const handle = useViewer.getState().handle;
    handle?.clearOverlay();
    // Measurements and notes share the overlay; draw them again.
    useMeasure.getState().redraw();
    useNotes.getState().redraw();
    set({ markups: [], pendingPoint: null });
  },

  addMarkups: (lines) => {
    const handle = useViewer.getState().handle;
    for (const line of lines) {
      handle?.addOverlay(createLineObject(vector(line.start), vector(line.end)));
    }
    set({ markups: [...get().markups, ...lines] });
  },

  setNavMode: (mode) => {
    set({ navMode: mode });
    useViewer.getState().handle?.setNavigationMode(mode);
    if (mode === 'walk') {
      log.info('Walk: drag to look around, W A S D or arrows to move, Q/E down/up, Shift faster.');
    }
  },

  setBoxSelect: (on) => {
    set({ boxSelect: on });
    if (on && get().tool !== 'select') get().setTool('select');
    useViewer.getState().handle?.setBoxSelect(on);
  },

  setEdges: (on) => {
    set({ edges: on });
    try {
      localStorage.setItem(EDGES_KEY, on ? '1' : '0');
    } catch {
      // A setting that cannot be stored simply resets next time.
    }
    void showEdges(on);
  },

  addPlane: (point, normal) => {
    const plane: ClipPlane = { id: newPlaneId(), point, normal, enabled: true };
    const next = { ...get(), planes: [...get().planes, plane], activePlaneId: plane.id };
    set({ planes: next.planes, activePlaneId: plane.id });
    applyPlanes(next);
  },

  addAxisPlane: (axis) => {
    const handle = useViewer.getState().handle;
    const center = handle?.contentBounds().getCenter(new Vector3()) ?? new Vector3();
    const normal: Triple = [axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0];
    get().addPlane(center.toArray() as Triple, normal);
  },

  addSectionBox: () => {
    const handle = useViewer.getState().handle;
    const { model, selectedIds } = useModel.getState();
    const box =
      (selectedIds.size && model?.boundsOf(selectedIds)) || handle?.contentBounds() || null;
    if (!box) return;
    const size = box.getSize(new Vector3());
    const pad = Math.max(Math.max(size.x, size.y, size.z) * 0.02, 0.05);
    const c = box.getCenter(new Vector3());
    const planes: ClipPlane[] = [];
    for (const [axis, i] of [
      ['x', 0],
      ['y', 1],
      ['z', 2],
    ] as const) {
      for (const sign of [1, -1]) {
        const normal: Triple = [0, 0, 0];
        normal[i] = sign;
        const point: Triple = [c.x, c.y, c.z];
        point[i] = sign > 0 ? box.max[axis] + pad : box.min[axis] - pad;
        planes.push({ id: newPlaneId(), point, normal, enabled: true });
      }
    }
    get().replacePlanes(planes);
    handle?.fitTo(box);
    log.info(
      selectedIds.size
        ? `Section box around ${selectedIds.size} selected element(s); drag a face arrow to resize.`
        : 'Section box around the model; drag a face arrow to resize.',
    );
  },

  movePlane: (id, point, fromViewport = false) => {
    const planes = get().planes.map((p) => (p.id === id ? { ...p, point } : p));
    set({ planes, activePlaneId: id });
    // The viewport already shows a plane it is dragging; only redraw for other callers.
    if (!fromViewport) applyPlanes({ ...get(), planes, activePlaneId: id });
  },

  setPlaneOffset: (id, offset) => {
    const plane = get().planes.find((p) => p.id === id);
    if (plane) get().movePlane(id, withOffset(plane, offset).point);
  },

  flipPlane: (id) => {
    const planes = get().planes.map((p) =>
      p.id === id ? { ...p, normal: p.normal.map((v) => (v === 0 ? 0 : -v)) as Triple } : p,
    );
    set({ planes });
    applyPlanes({ ...get(), planes });
  },

  togglePlane: (id) => {
    const planes = get().planes.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p));
    set({ planes });
    applyPlanes({ ...get(), planes });
  },

  removePlane: (id) => {
    const planes = get().planes.filter((p) => p.id !== id);
    const activePlaneId =
      get().activePlaneId === id ? (planes[planes.length - 1]?.id ?? null) : get().activePlaneId;
    set({ planes, activePlaneId });
    applyPlanes({ ...get(), planes, activePlaneId });
  },

  clearPlanes: () => get().replacePlanes([]),

  setActivePlane: (id) => {
    set({ activePlaneId: id });
    applyPlanes({ ...get(), activePlaneId: id });
  },

  setShowPlaneHandles: (show) => {
    set({ showPlaneHandles: show });
    applyPlanes({ ...get(), showPlaneHandles: show });
  },

  replacePlanes: (planes) => {
    const activePlaneId = planes[planes.length - 1]?.id ?? null;
    set({ planes, activePlaneId });
    applyPlanes({ ...get(), planes, activePlaneId });
  },

  planOfStorey: (storey) => {
    const { model, elements } = useModel.getState();
    const handle = useViewer.getState().handle;
    if (!model || !handle) return;
    const ids = elements
      .filter((e) => e.storey === storey && e.has_geometry)
      .map((e) => e.express_id);
    const box = model.boundsOf(ids);
    if (!box) return;
    const height = box.max.y - box.min.y;
    // Cut a little below the top so columns read as cut sections and beams stay visible.
    const position = box.max.y - Math.min(0.4, height * 0.15);
    const center = box.getCenter(new Vector3());
    get().replacePlanes([
      { id: newPlaneId(), point: [center.x, position, center.z], normal: [0, 1, 0], enabled: true },
    ]);
    handle.fitTo(box, 'top');
  },

  setColorBy: (mode) => {
    const { model, elements } = useModel.getState();
    const legend =
      mode === 'none'
        ? []
        : buildLegend(
            elements,
            mode,
            mode === 'change' ? changeSource() : mode === 'link' ? linkSource() : statusSource(),
          );
    set({ colorBy: mode, legend });
    if (!model) return;
    if (mode === 'none') {
      model.setTints(null);
    } else {
      const tints = new Map<number, string>();
      for (const entry of legend) for (const id of entry.ids) tints.set(id, entry.color);
      model.setTints(tints);
    }
    useViewer.getState().handle?.render();
  },

  refreshColors: () => {
    const mode = get().colorBy;
    if (mode !== 'none') get().setColorBy(mode);
  },

  reset: () => {
    const handle = useViewer.getState().handle;
    set({
      tool: 'select',
      planes: [],
      activePlaneId: null,
      colorBy: 'none',
      legend: [],
      pendingPoint: null,
      markups: [],
    });
    handle?.setClipPlanes([], null, get().showPlaneHandles);
    handle?.clearOverlay();
    handle?.setPickMode('select');
  },
}));

// A new or cleared model starts with no section, tints, measurements or markups, and
// gets its edge lines when they are switched on.
useModel.subscribe((state, previous) => {
  if (state.model !== previous.model) {
    useView.getState().reset();
    if (state.model && useView.getState().edges) void showEdges(true);
  }
});

const EDGES_KEY = 'kingpost.viewer.edges';

function loadEdges(): boolean {
  try {
    return localStorage.getItem(EDGES_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Shows or hides edges on the loaded model, logging how long a first build took. */
async function showEdges(on: boolean): Promise<void> {
  const model = useModel.getState().model;
  if (!model) return;
  const started = performance.now();
  const building = on && !model.edgesShown;
  await model.setEdgesVisible(on);
  useViewer.getState().handle?.render();
  if (building && useModel.getState().model === model) {
    log.info(`Edge lines drawn in ${Math.round(performance.now() - started)} ms`);
  }
}

function vector(t: Triple): Vector3 {
  return new Vector3(t[0], t[1], t[2]);
}

export function buildLegend(
  elements: ElementSummary[],
  mode: Exclude<ColorBy, 'none'>,
  /** GlobalId → stage for `status`, GlobalId → change for `change`. */
  lookup: ReadonlyMap<string, string> = new Map(),
): LegendEntry[] {
  const groups = new Map<string, number[]>();
  for (const element of elements) {
    if (element.is_spatial || !element.has_geometry) continue;
    const key =
      mode === 'type'
        ? element.ifc_type
        : mode === 'material'
          ? (element.material ?? '— no material —')
          : mode === 'storey'
            ? (element.storey ?? '— no storey —')
            : mode === 'change'
              ? (lookup.get(element.global_id) ?? UNCHANGED)
              : mode === 'link'
                ? (lookup.get(element.global_id) ?? NOT_COMPARED)
                : (lookup.get(element.global_id) ?? NO_STATUS);
    groups.set(key, [...(groups.get(key) ?? []), element.express_id]);
  }
  if (mode === 'change') {
    return ['added', 'modified', 'removed', UNCHANGED]
      .filter((change) => groups.has(change))
      .map((change) => ({
        key: change,
        label: change,
        color: CHANGE_COLORS[change] ?? '#888888',
        count: groups.get(change)?.length ?? 0,
        ids: groups.get(change) ?? [],
      }));
  }
  if (mode === 'link') {
    return ['linked', 'section differs', 'material differs', 'unmatched', NOT_COMPARED]
      .filter((status) => groups.has(status))
      .map((status) => ({
        key: status,
        label: status,
        color: LINK_COLORS[status] ?? '#888888',
        count: groups.get(status)?.length ?? 0,
        ids: groups.get(status) ?? [],
      }));
  }
  if (mode === 'status') {
    // Fixed order and colours: the pipeline reads left to right.
    return [...STAGES, NO_STATUS]
      .filter((stage) => groups.has(stage))
      .map((stage) => ({
        key: stage,
        label: stage,
        color: stage === NO_STATUS ? '#4a5260' : STAGE_COLORS[stage as Stage],
        count: groups.get(stage)?.length ?? 0,
        ids: groups.get(stage) ?? [],
      }));
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([key, ids], index) => ({
      key,
      label: mode === 'type' ? key.replace(/^IFC/, '') : key,
      color: PALETTE[index % PALETTE.length] ?? '#888888',
      count: ids.length,
      ids,
    }));
}

/** Extent of the loaded model along a section axis, for the slider. */
export function sectionRange(axis: SectionAxis): { min: number; max: number } {
  return useViewer.getState().handle?.extent(axis) ?? { min: 0, max: 10 };
}

export { planeOffset };
