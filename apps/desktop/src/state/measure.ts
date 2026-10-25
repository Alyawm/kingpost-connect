import { create } from 'zustand';
import {
  DEFAULT_SNAP,
  Vector3,
  angleAt,
  createAngleObject,
  createMeasurementObject,
  createPerpendicularObject,
  createPointObject,
  distanceToPlane,
  measure,
  orthoPoint,
  type PointPick,
  type SnapKind,
  type SnapOptions,
  type ViewportHandle,
} from '@kingpost/viewer';
import type { Triple } from '../lib/ipc';
import { formatAngle, formatLength, lengthNumber, lengthSymbol, type Units } from '../lib/units';
import { useUi } from './ui';
import { log } from './log';
import { useModel } from './model';
import { useViewer } from './viewer';

/** What the next clicks measure. */
export type MeasureMode = 'distance' | 'angle' | 'perpendicular' | 'edge' | 'point';

export const MEASURE_MODES: { value: MeasureMode; label: string; hint: string }[] = [
  { value: 'distance', label: 'Distance', hint: 'Click two points' },
  { value: 'angle', label: 'Angle', hint: 'Click a point, the corner, then a second point' },
  {
    value: 'perpendicular',
    label: 'Perpendicular',
    hint: 'Click a face, then a point: the distance square to that face',
  },
  { value: 'edge', label: 'Edge length', hint: 'Click an edge of an element' },
  { value: 'point', label: 'Point', hint: 'Click a point to read its coordinates and elevation' },
];

export const SNAP_LABELS: Record<SnapKind, string> = {
  vertex: 'Corner',
  midpoint: 'Midpoint',
  edge: 'On edge',
  face: 'On face',
};

/** One finished measurement, enough to list and redraw it (formatted when shown). */
export interface MeasureRecord {
  id: string;
  mode: MeasureMode;
  points: Triple[];
  /** Metres for lengths, degrees for angles, IFC elevation for points. */
  value: number;
}

const units = (): Units => useUi.getState().units;

/** The main value as shown, in the current units. */
export function recordText(record: MeasureRecord, u: Units = units()): string {
  switch (record.mode) {
    case 'angle':
      return formatAngle(record.value, u);
    case 'point': {
      const c = ifcPoint(record.points[0]!);
      return `X ${lengthNumber(c[0], u)}  Y ${lengthNumber(c[1], u)}  Z ${lengthNumber(c[2], u)} ${lengthSymbol(u)}`.trim();
    }
    default:
      return formatLength(record.value, u);
  }
}

/** The secondary line: components, the supplement of an angle, or the elevation. */
export function recordDetail(record: MeasureRecord, u: Units = units()): string {
  switch (record.mode) {
    case 'angle':
      return `${formatAngle(180 - record.value, u)} supplementary`;
    case 'perpendicular':
      return 'square to the first face';
    case 'point':
      return `elevation ${formatLength(ifcPoint(record.points[0]!)[2], u)}`;
    default:
      return components(record.points[0]!, record.points[1]!, u);
  }
}

function ifcPoint(t: Triple): Triple {
  const frame = useModel.getState().frame;
  return frame ? frame.pointToIfc(v(t)) : t;
}

interface MeasureState {
  mode: MeasureMode;
  /** Keep distances along X, Y or Z (Shift does the same while held). */
  ortho: boolean;
  snap: SnapOptions;
  records: MeasureRecord[];
  /** Points of the measurement in progress. */
  points: PointPick[];
  /** Pointer tip: what is under the cursor and the live value. */
  hover: { x: number; y: number; snap: SnapKind; text: string } | null;
  setMode(mode: MeasureMode): void;
  setOrtho(on: boolean): void;
  setSnap(patch: Partial<SnapOptions>): void;
  /** A click in measure mode. */
  pick(pick: PointPick): void;
  /** The pointer moved (snapped point or null). */
  hoverAt(pick: PointPick | null): void;
  remove(id: string): void;
  removeLast(): void;
  clear(): void;
  /** Drops the points of an unfinished measurement. */
  cancel(): void;
  /** Draws every record again (after other overlay objects were cleared). */
  redraw(): void;
}

/** Overlay objects of the records, by record id. */
const objects = new Map<string, Parameters<ViewportHandle['addOverlay']>[0]>();
let shiftHeld = false;
let counter = 0;

const v = (t: Triple) => new Vector3(t[0], t[1], t[2]);
const t = (p: { x: number; y: number; z: number }): Triple => [p.x, p.y, p.z];

/** The plan X, plan Y and height components of a distance (IFC is Z-up). */
function components(a: Triple, b: Triple, u: Units): string {
  const pa = ifcPoint(a);
  const pb = ifcPoint(b);
  const d = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]].map((x) => lengthNumber(x, u));
  return `ΔX ${d[0]} · ΔY ${d[1]} · ΔZ ${d[2]}`;
}

function objectFor(record: MeasureRecord) {
  const p = record.points.map(v);
  const text = recordText(record);
  switch (record.mode) {
    case 'angle':
      return createAngleObject(p[0]!, p[1]!, p[2]!, record.value, text);
    case 'perpendicular':
      return createPerpendicularObject(p[0]!, p[1]!, record.value, text);
    case 'point': {
      const handle = useViewer.getState().handle;
      const size = handle?.contentBounds().getSize(new Vector3()) ?? new Vector3(10, 10, 10);
      return createPointObject(p[0]!, text, Math.max(size.x, size.y, size.z));
    }
    default:
      return createMeasurementObject(measure(p[0]!, p[1]!), text);
  }
}

export const useMeasure = create<MeasureState>((set, get) => {
  const handle = () => useViewer.getState().handle;

  const finish = (record: Omit<MeasureRecord, 'id'>) => {
    const full: MeasureRecord = { ...record, id: `m${++counter}` };
    const object = objectFor(full);
    objects.set(full.id, object);
    handle()?.addOverlay(object);
    handle()?.setPreview(null);
    set({ records: [...get().records, full], points: [] });
    const detail = recordDetail(full);
    log.info(`Measured ${recordText(full)}${detail ? ` (${detail})` : ''}`);
  };

  /** The second point of a distance, with the ortho constraint when it applies. */
  const constrained = (from: Vector3, to: Vector3, shift = false) =>
    get().ortho !== (shiftHeld || shift) ? orthoPoint(from, to) : to;

  return {
    mode: 'distance',
    ortho: false,
    snap: { ...DEFAULT_SNAP },
    records: [],
    points: [],
    hover: null,

    setMode: (mode) => {
      handle()?.setPreview(null);
      set({ mode, points: [] });
    },

    setOrtho: (ortho) => set({ ortho }),

    setSnap: (patch) => {
      const snap = { ...get().snap, ...patch };
      set({ snap });
      handle()?.setSnapOptions(snap);
    },

    pick: (pick) => {
      const { mode, points } = get();
      const point = pick.point.clone();
      if (mode === 'point') {
        const frame = useModel.getState().frame;
        const c = frame ? frame.pointToIfc(point) : t(point);
        finish({
          mode,
          points: [t(point)],
          value: c[2],
        });
        return;
      }
      if (mode === 'edge') {
        if (!pick.edge) {
          log.warn('Point at an edge: the pointer shows a corner, midpoint or edge marker.');
          return;
        }
        const [a, b] = pick.edge;
        const length = a.distanceTo(b);
        finish({
          mode,
          points: [t(a), t(b)],
          value: length,
        });
        return;
      }
      if (mode === 'perpendicular' && points.length === 0 && !pick.normal) {
        log.warn('Click on a face first.');
        return;
      }
      const next = [...points, { ...pick, point }];
      if (mode === 'distance' && next.length === 2) {
        const a = next[0]!.point;
        const b = constrained(a, next[1]!.point, pick.shift);
        const length = a.distanceTo(b);
        finish({
          mode,
          points: [t(a), t(b)],
          value: length,
        });
        return;
      }
      if (mode === 'angle' && next.length === 3) {
        const [a, vertex, b] = next.map((p) => p.point) as [Vector3, Vector3, Vector3];
        const degrees = angleAt(a, vertex, b);
        finish({
          mode,
          points: [t(a), t(vertex), t(b)],
          value: degrees,
        });
        return;
      }
      if (mode === 'perpendicular' && next.length === 2) {
        const face = next[0]!;
        const { distance, foot } = distanceToPlane(next[1]!.point, face.point, face.normal!);
        finish({
          mode,
          points: [t(next[1]!.point), t(foot)],
          value: distance,
        });
        return;
      }
      set({ points: next });
    },

    hoverAt: (pick) => {
      const { mode, points } = get();
      if (!pick) {
        handle()?.setPreview(null);
        set({ hover: null });
        return;
      }
      let text = '';
      const last = points[points.length - 1]?.point;
      if (mode === 'distance' && last) {
        const b = constrained(last, pick.point, pick.shift);
        handle()?.setPreview([last, b]);
        text = formatLength(last.distanceTo(b), units());
      } else if (mode === 'angle' && points.length > 0) {
        const chain = [...points.map((p) => p.point), pick.point];
        handle()?.setPreview(chain);
        if (chain.length === 3)
          text = formatAngle(angleAt(chain[0]!, chain[1]!, chain[2]!), units());
      } else if (mode === 'perpendicular' && points.length === 1 && points[0]!.normal) {
        const { distance, foot } = distanceToPlane(pick.point, points[0]!.point, points[0]!.normal);
        handle()?.setPreview([pick.point, foot]);
        text = formatLength(distance, units());
      } else if (mode === 'edge' && pick.edge) {
        text = formatLength(pick.edge[0].distanceTo(pick.edge[1]), units());
      } else {
        handle()?.setPreview(null);
      }
      set({
        hover: {
          x: pick.screen?.x ?? 0,
          y: pick.screen?.y ?? 0,
          snap: pick.snap ?? 'face',
          text,
        },
      });
    },

    remove: (id) => {
      const object = objects.get(id);
      if (object) handle()?.removeOverlay(object);
      objects.delete(id);
      set({ records: get().records.filter((r) => r.id !== id) });
    },

    removeLast: () => {
      const last = get().records[get().records.length - 1];
      if (last) get().remove(last.id);
    },

    clear: () => {
      for (const object of objects.values()) handle()?.removeOverlay(object);
      objects.clear();
      handle()?.setPreview(null);
      set({ records: [], points: [] });
    },

    cancel: () => {
      handle()?.setPreview(null);
      set({ points: [] });
    },

    redraw: () => {
      objects.clear();
      for (const record of get().records) {
        const object = objectFor(record);
        objects.set(record.id, object);
        handle()?.addOverlay(object);
      }
    },
  };
});

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') shiftHeld = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') shiftHeld = false;
  });
  window.addEventListener('blur', () => {
    shiftHeld = false;
  });
}

// Measurements belong to the model they were taken on.
useModel.subscribe((state, previous) => {
  if (state.model !== previous.model) {
    objects.clear();
    useMeasure.setState({ records: [], points: [], hover: null });
  }
});

// Changing the units relabels the measurements already on screen.
useUi.subscribe((state, previous) => {
  if (state.units !== previous.units && useMeasure.getState().records.length) {
    const handle = useViewer.getState().handle;
    for (const object of objects.values()) handle?.removeOverlay(object);
    useMeasure.getState().redraw();
  }
});
