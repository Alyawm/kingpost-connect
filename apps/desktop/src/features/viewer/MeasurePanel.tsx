import { Axis3d, Trash2, X } from 'lucide-react';
import { cn } from '@kingpost/ui';
import type { SnapKind } from '@kingpost/viewer';
import {
  MEASURE_MODES,
  SNAP_LABELS,
  recordDetail,
  recordText,
  useMeasure,
} from '../../state/measure';
import { useUi } from '../../state/ui';
import { useView } from '../../state/view';

const SNAPS: SnapKind[] = ['vertex', 'midpoint', 'edge', 'face'];

/**
 * Measuring options and results, beside the viewport toolbar while the measure tool is on
 * or measurements are shown: mode, snaps, ortho, the list with delete, and clear all.
 */
export function MeasurePanel() {
  const tool = useView((s) => s.tool);
  const mode = useMeasure((s) => s.mode);
  const setMode = useMeasure((s) => s.setMode);
  const ortho = useMeasure((s) => s.ortho);
  const setOrtho = useMeasure((s) => s.setOrtho);
  const snap = useMeasure((s) => s.snap);
  const setSnap = useMeasure((s) => s.setSnap);
  const records = useMeasure((s) => s.records);
  const points = useMeasure((s) => s.points);
  const remove = useMeasure((s) => s.remove);
  const clear = useMeasure((s) => s.clear);
  const units = useUi((s) => s.units);
  const active = tool === 'measure';
  if (!active && records.length === 0) return null;
  const current = MEASURE_MODES.find((m) => m.value === mode)!;

  return (
    <div className="pointer-events-auto w-72 rounded-md border border-edge bg-surface/95 text-[11px] shadow-lg">
      {active && (
        <div className="space-y-1.5 border-b border-edge p-2">
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Measure">
            {MEASURE_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={mode === m.value}
                title={m.hint}
                className={cn(
                  'rounded border px-1.5 py-0.5',
                  mode === m.value
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-edge text-fg-muted hover:bg-surface-2 hover:text-fg',
                )}
                onClick={() => setMode(m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-fg-muted">Snap</span>
            {SNAPS.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={snap[kind]}
                className={cn(
                  'rounded border px-1 py-0.5 text-[10px]',
                  snap[kind] ? 'border-accent text-fg' : 'border-edge text-fg-muted line-through',
                )}
                onClick={() => setSnap({ [kind]: !snap[kind] })}
              >
                {SNAP_LABELS[kind]}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={ortho}
              title="Keep distances along X, Y or Z — or hold Shift"
              className={cn(
                'ml-auto flex items-center gap-1 rounded border px-1 py-0.5 text-[10px]',
                ortho ? 'border-accent bg-accent text-accent-fg' : 'border-edge text-fg-muted',
              )}
              onClick={() => setOrtho(!ortho)}
            >
              <Axis3d size={11} /> Ortho
            </button>
          </div>
          <p className="text-fg-muted">
            {current.hint}
            {mode === 'angle' && points.length > 0 && ` · ${points.length} of 3`}
            {mode === 'distance' && ' · Shift for ortho'} · Esc cancels
          </p>
        </div>
      )}
      {records.length > 0 && (
        <>
          <ul className="max-h-48 overflow-auto py-1">
            {records.map((r) => (
              <li
                key={r.id}
                className="group flex items-start gap-2 px-2 py-0.5 hover:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-fg">{recordText(r, units)}</div>
                  <div className="truncate text-[10px] text-fg-muted">{recordDetail(r, units)}</div>
                </div>
                <span className="shrink-0 text-[10px] text-fg-muted">
                  {MEASURE_MODES.find((m) => m.value === r.mode)?.label}
                </span>
                <button
                  type="button"
                  aria-label="Delete this measurement"
                  title="Delete this measurement"
                  className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-surface-3 hover:text-danger"
                  onClick={() => remove(r.id)}
                >
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1 border-t border-edge py-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
            onClick={clear}
          >
            <Trash2 size={11} /> Clear all measurements ({records.length})
          </button>
        </>
      )}
    </div>
  );
}

/** What is under the cursor while measuring, and the live value. */
export function SnapTip() {
  const tool = useView((s) => s.tool);
  const hover = useMeasure((s) => s.hover);
  if (tool !== 'measure' || !hover) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded border border-edge bg-surface/95 px-1.5 py-0.5 text-[10px] shadow"
      style={{ left: hover.x + 14, top: hover.y + 14 }}
    >
      <span className="text-fg-muted">{SNAP_LABELS[hover.snap]}</span>
      {hover.text && <span className="ml-1.5 font-mono text-fg">{hover.text}</span>}
    </div>
  );
}
