import { create } from 'zustand';
import {
  Vector3,
  createLineObject,
  createMeasurementObject,
  measure,
  type Measurement,
  type PointPick,
} from '@kingpost/viewer';
import type { ElementSummary, Triple } from '../lib/ipc';
import { log } from './log';
import { useModel } from './model';
import { useViewer } from './viewer';

export type SectionAxis = 'x' | 'y' | 'z';
export type ColorBy = 'none' | 'type' | 'material' | 'storey' | 'status' | 'change' | 'link';
export type Tool = 'select' | 'measure' | 'markup';

export interface Section {
  enabled: boolean;
  axis: SectionAxis;
  /** Position along the axis in world metres. */
  position: number;
  /** false keeps the side below/behind the plane; true keeps the other side. */
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
  section: Section;
  colorBy: ColorBy;
  legend: LegendEntry[];
  /** First point of a measurement or markup in progress, if any. */
  pendingPoint: PointPick | null;
  measurements: Measurement[];
  markups: MarkupLine[];
  setTool(tool: Tool): void;
  pickPoint(pick: PointPick): void;
  clearMeasurements(): void;
  clearMarkups(): void;
  /** Draws lines (viewer coordinates) as markups, e.g. from an applied viewpoint. */
  addMarkups(lines: MarkupLine[]): void;
  setSection(patch: Partial<Section>): void;
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
const defaultSection: Section = { enabled: false, axis: 'y', position: 0, flip: false };

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
  section: defaultSection,
  colorBy: 'none',
  legend: [],
  pendingPoint: null,
  measurements: [],
  markups: [],

  setTool: (tool) => {
    set({ tool, pendingPoint: null });
    useViewer.getState().handle?.setPickMode(tool === 'select' ? 'select' : 'point');
  },

  pickPoint: (pick) => {
    const { pendingPoint, measurements, markups, tool } = get();
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
    const result = measure(pendingPoint.point, pick.point);
    handle?.addOverlay(createMeasurementObject(result));
    set({ pendingPoint: null, measurements: [...measurements, result] });
    const d = result.delta;
    log.info(
      `Measured ${result.distance.toFixed(3)} m (Δx ${d.x.toFixed(3)}, Δy ${d.y.toFixed(3)}, Δz ${d.z.toFixed(3)})`,
    );
  },

  clearMeasurements: () => {
    const handle = useViewer.getState().handle;
    handle?.clearOverlay();
    // Markups live in the same overlay; redraw the ones that stay.
    for (const line of get().markups) {
      handle?.addOverlay(createLineObject(vector(line.start), vector(line.end)));
    }
    set({ measurements: [], pendingPoint: null });
  },

  clearMarkups: () => {
    const handle = useViewer.getState().handle;
    handle?.clearOverlay();
    for (const m of get().measurements) handle?.addOverlay(createMeasurementObject(m));
    set({ markups: [], pendingPoint: null });
  },

  addMarkups: (lines) => {
    const handle = useViewer.getState().handle;
    for (const line of lines) {
      handle?.addOverlay(createLineObject(vector(line.start), vector(line.end)));
    }
    set({ markups: [...get().markups, ...lines] });
  },

  setSection: (patch) => {
    const section = { ...get().section, ...patch };
    set({ section });
    const handle = useViewer.getState().handle;
    handle?.setSection(
      section.enabled
        ? { axis: section.axis, position: section.position, flip: section.flip }
        : null,
    );
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
    get().setSection({ enabled: true, axis: 'y', position, flip: false });
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
      section: defaultSection,
      colorBy: 'none',
      legend: [],
      pendingPoint: null,
      measurements: [],
      markups: [],
    });
    handle?.setSection(null);
    handle?.clearOverlay();
    handle?.setPickMode('select');
  },
}));

// A new or cleared model starts with no section, tints, measurements or markups.
useModel.subscribe((state, previous) => {
  if (state.model !== previous.model) useView.getState().reset();
});

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
