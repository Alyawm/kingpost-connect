import { useMemo } from 'react';
import {
  BoxSelect,
  Eye,
  EyeOff,
  FlipVertical2,
  MousePointerClick,
  Plus,
  Scissors,
  Trash2,
} from 'lucide-react';
import { extentAlong } from '@kingpost/viewer';
import { Button, cn } from '@kingpost/ui';
import { useModel } from '../../state/model';
import { useViewer } from '../../state/viewer';
import { useUi } from '../../state/ui';
import { formatLength } from '../../lib/units';
import { planeLabel, planeOffset, useView, type ColorBy } from '../../state/view';

const colorModes: { value: ColorBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'type', label: 'Type' },
  { value: 'material', label: 'Material' },
  { value: 'storey', label: 'Storey' },
  { value: 'status', label: 'Status' },
];

/** Section planes and colour-by controls for the loaded model. */
export function ViewTools() {
  const colorBy = useView((s) => s.colorBy);
  const setColorBy = useView((s) => s.setColorBy);
  const legend = useView((s) => s.legend);
  const isolate = useModel((s) => s.isolate);

  return (
    <div className="space-y-3 border-b border-edge px-3 py-2 text-xs">
      <SectionPlanes />
      <div>
        <div className="mb-1 font-semibold text-fg-muted">Colour by</div>
        <div className="flex gap-1">
          {colorModes.map((mode) => (
            <button
              key={mode.value}
              type="button"
              className={cn(
                'rounded border px-1.5 py-0.5',
                colorBy === mode.value
                  ? 'border-accent text-fg'
                  : 'border-edge text-fg-muted hover:bg-surface-2',
              )}
              onClick={() => setColorBy(mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        {legend.length > 0 && (
          <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-auto">
            {legend.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-surface-2"
                  title="Isolate these elements"
                  onClick={() => isolate(entry.ids)}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: entry.color }}
                  />
                  <span className="truncate">{entry.label}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-muted">
                    {entry.count.toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Section planes: place one on any face, add axis planes, then drag a plane's arrow in the
 * viewport or use the slider. Every enabled plane cuts, so several make a section box.
 */
function SectionPlanes() {
  const tool = useView((s) => s.tool);
  const setTool = useView((s) => s.setTool);
  const planes = useView((s) => s.planes);
  const activeId = useView((s) => s.activePlaneId);
  const showHandles = useView((s) => s.showPlaneHandles);
  const addAxisPlane = useView((s) => s.addAxisPlane);
  const addSectionBox = useView((s) => s.addSectionBox);
  const setActive = useView((s) => s.setActivePlane);
  const setOffset = useView((s) => s.setPlaneOffset);
  const flip = useView((s) => s.flipPlane);
  const toggle = useView((s) => s.togglePlane);
  const remove = useView((s) => s.removePlane);
  const clear = useView((s) => s.clearPlanes);
  const setShowHandles = useView((s) => s.setShowPlaneHandles);
  const sectionFill = useView((s) => s.sectionFill);
  const setSectionFill = useView((s) => s.setSectionFill);
  const planOfStorey = useView((s) => s.planOfStorey);
  const elements = useModel((s) => s.elements);
  const handle = useViewer((s) => s.handle);
  const units = useUi((s) => s.units);

  const storeyNames = useMemo(
    () =>
      [
        ...new Set(
          elements.filter((e) => !e.is_spatial && e.storey).map((e) => e.storey as string),
        ),
      ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [elements],
  );

  const active = planes.find((p) => p.id === activeId) ?? null;
  const range = useMemo(() => {
    if (!active || !handle) return { min: 0, max: 10 };
    const r = extentAlong(handle.contentBounds(), active.normal);
    const pad = (r.max - r.min) * 0.02;
    return { min: r.min - pad, max: r.max + pad };
    // The range depends on the plane's direction, not on where it sits along it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.normal.join(','), handle, elements]);
  const placing = tool === 'section';

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold text-fg-muted">Section planes</span>
        <div className="flex items-center gap-0.5">
          {planes.length > 0 && (
            <>
              <button
                type="button"
                className="rounded p-0.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
                title={showHandles ? 'Hide plane handles' : 'Show plane handles'}
                onClick={() => setShowHandles(!showHandles)}
              >
                {showHandles ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button
                type="button"
                className="rounded px-1 py-0.5 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg"
                onClick={clear}
              >
                Remove all
              </button>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant={placing ? 'primary' : 'ghost'}
          className="h-6 px-1.5"
          title="Click a face in the model to place a plane on it (Esc cancels)"
          onClick={() => setTool(placing ? 'select' : 'section')}
        >
          <MousePointerClick size={12} />
          {placing ? 'Click a face…' : 'Place on face'}
        </Button>
        <button
          type="button"
          className="flex items-center gap-0.5 rounded border border-edge px-1.5 py-0.5 text-fg-muted hover:bg-surface-2"
          title="Six planes around the selection (or the whole model); drag a face to resize"
          onClick={addSectionBox}
        >
          <BoxSelect size={11} /> Box
        </button>
        {(['y', 'x', 'z'] as const).map((axis) => (
          <button
            key={axis}
            type="button"
            className="flex items-center gap-0.5 rounded border border-edge px-1.5 py-0.5 text-fg-muted hover:bg-surface-2"
            title={
              axis === 'y'
                ? 'Horizontal plane through the model centre'
                : `Vertical plane across ${axis.toUpperCase()}`
            }
            onClick={() => addAxisPlane(axis)}
          >
            <Plus size={10} />
            {axis === 'y' ? 'Plan' : axis.toUpperCase()}
          </button>
        ))}
      </div>

      {planes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {planes.map((plane, index) => (
            <li
              key={plane.id}
              className={cn(
                'flex items-center gap-1 rounded px-1 py-0.5',
                plane.id === activeId ? 'bg-surface-3' : 'hover:bg-surface-2',
              )}
            >
              <input
                type="checkbox"
                checked={plane.enabled}
                onChange={() => toggle(plane.id)}
                aria-label={`Plane ${index + 1} on`}
                className="accent-[var(--kp-accent)]"
              />
              <button
                type="button"
                className={cn(
                  'min-w-0 flex-1 truncate text-left',
                  !plane.enabled && 'text-fg-muted',
                )}
                onClick={() => setActive(plane.id)}
                title="Edit this plane"
              >
                <Scissors size={10} className="mr-1 inline" />
                {index + 1} · {planeLabel(plane)}
              </button>
              <button
                type="button"
                className="rounded p-0.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
                title="Keep the other side"
                onClick={() => flip(plane.id)}
              >
                <FlipVertical2 size={12} />
              </button>
              <button
                type="button"
                className="rounded p-0.5 text-fg-muted hover:bg-surface-2 hover:text-danger"
                title="Remove plane"
                onClick={() => remove(plane.id)}
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {active && (
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={Math.max((range.max - range.min) / 500, 0.005)}
            value={Math.min(Math.max(planeOffset(active), range.min), range.max)}
            onChange={(e) => setOffset(active.id, Number(e.target.value))}
            className="w-full accent-[var(--kp-accent)]"
            aria-label="Plane position"
          />
          <span className="w-16 shrink-0 text-right font-mono text-[11px] text-fg-muted">
            {formatLength(planeOffset(active), units)}
          </span>
        </div>
      )}
      {planes.length > 0 && (
        <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-fg-muted">
          <input
            type="checkbox"
            checked={sectionFill}
            onChange={(e) => setSectionFill(e.target.checked)}
            className="accent-[var(--kp-accent)]"
          />
          Fill cut faces
        </label>
      )}
      {planes.length > 0 && (
        <p className="mt-1 text-[10px] text-fg-muted">
          Drag a plane&apos;s arrow in the view to move it. Planes together cut like a box.
        </p>
      )}

      {storeyNames.length > 0 && (
        <select
          className="mt-1.5 h-7 w-full rounded border border-edge bg-canvas px-1 text-xs"
          value=""
          onChange={(e) => {
            if (e.target.value) planOfStorey(e.target.value);
          }}
          aria-label="Plan view of storey"
        >
          <option value="">Plan view of storey…</option>
          {storeyNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
