import { create } from 'zustand';
import {
  createMeasurementObject,
  measure,
  type Measurement,
  type PointPick,
} from '@kingpost/viewer';
import type { ElementSummary } from '../lib/ipc';
import { log } from './log';
import { useModel } from './model';
import { useViewer } from './viewer';

export type SectionAxis = 'x' | 'y' | 'z';
export type ColorBy = 'none' | 'type' | 'material' | 'storey';
export type Tool = 'select' | 'measure';

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

interface ViewState {
  tool: Tool;
  section: Section;
  colorBy: ColorBy;
  legend: LegendEntry[];
  /** First point of a measurement in progress, if any. */
  pendingPoint: PointPick | null;
  measurements: Measurement[];
  setTool(tool: Tool): void;
  pickPoint(pick: PointPick): void;
  clearMeasurements(): void;
  setSection(patch: Partial<Section>): void;
  /** Places a plan cut just below the top of a storey and looks down on it. */
  planOfStorey(storey: string): void;
  setColorBy(mode: ColorBy): void;
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

const defaultSection: Section = { enabled: false, axis: 'y', position: 0, flip: false };

export const useView = create<ViewState>((set, get) => ({
  tool: 'select',
  section: defaultSection,
  colorBy: 'none',
  legend: [],
  pendingPoint: null,
  measurements: [],

  setTool: (tool) => {
    set({ tool, pendingPoint: null });
    useViewer.getState().handle?.setPickMode(tool === 'measure' ? 'point' : 'select');
  },

  pickPoint: (pick) => {
    const { pendingPoint, measurements } = get();
    if (!pendingPoint) {
      set({ pendingPoint: pick });
      return;
    }
    const result = measure(pendingPoint.point, pick.point);
    useViewer.getState().handle?.addOverlay(createMeasurementObject(result));
    set({ pendingPoint: null, measurements: [...measurements, result] });
    const d = result.delta;
    log.info(
      `Measured ${result.distance.toFixed(3)} m (Δx ${d.x.toFixed(3)}, Δy ${d.y.toFixed(3)}, Δz ${d.z.toFixed(3)})`,
    );
  },

  clearMeasurements: () => {
    useViewer.getState().handle?.clearOverlay();
    set({ measurements: [], pendingPoint: null });
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
    const legend = mode === 'none' ? [] : buildLegend(elements, mode);
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

  reset: () => {
    const handle = useViewer.getState().handle;
    set({
      tool: 'select',
      section: defaultSection,
      colorBy: 'none',
      legend: [],
      pendingPoint: null,
      measurements: [],
    });
    handle?.setSection(null);
    handle?.clearOverlay();
    handle?.setPickMode('select');
  },
}));

// A new or cleared model starts with no section, tints or measurements.
useModel.subscribe((state, previous) => {
  if (state.model !== previous.model) useView.getState().reset();
});

export function buildLegend(
  elements: ElementSummary[],
  mode: Exclude<ColorBy, 'none'>,
): LegendEntry[] {
  const groups = new Map<string, number[]>();
  for (const element of elements) {
    if (element.is_spatial || !element.has_geometry) continue;
    const key =
      mode === 'type'
        ? element.ifc_type
        : mode === 'material'
          ? (element.material ?? '— no material —')
          : (element.storey ?? '— no storey —');
    groups.set(key, [...(groups.get(key) ?? []), element.express_id]);
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
