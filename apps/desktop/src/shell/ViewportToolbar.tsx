import { Eraser, Eye, Focus, Ruler } from 'lucide-react';
import type { ViewDirection } from '@kingpost/viewer';
import { IconButton, cn } from '@kingpost/ui';
import { useViewer } from '../state/viewer';
import { useModel } from '../state/model';
import { useView } from '../state/view';

const directions: { value: ViewDirection; label: string }[] = [
  { value: 'iso', label: 'Iso' },
  { value: 'top', label: 'Top' },
  { value: 'front', label: 'Front' },
  { value: 'right', label: 'Side' },
];

/** Floating controls over the viewport: standard views, fit, measure, show hidden. */
export function ViewportToolbar() {
  const handle = useViewer((s) => s.handle);
  const hiddenCount = useModel((s) => s.hidden.size);
  const showAll = useModel((s) => s.showAll);
  const tool = useView((s) => s.tool);
  const setTool = useView((s) => s.setTool);
  const pending = useView((s) => s.pendingPoint);
  const measurements = useView((s) => s.measurements);
  const clearMeasurements = useView((s) => s.clearMeasurements);

  return (
    <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-2">
      <div className="flex items-center gap-1">
        <div className="pointer-events-auto flex overflow-hidden rounded-md border border-edge bg-surface/90 shadow">
          {directions.map((direction) => (
            <button
              key={direction.value}
              type="button"
              className={cn(
                'px-2 py-1 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg',
                'border-r border-edge last:border-r-0',
              )}
              onClick={() => handle?.viewFrom(direction.value)}
              disabled={!handle}
            >
              {direction.label}
            </button>
          ))}
        </div>
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-edge bg-surface/90 shadow">
          {hiddenCount > 0 && (
            <IconButton label={`Show all (${hiddenCount} hidden)`} size="sm" onClick={showAll}>
              <Eye size={14} />
            </IconButton>
          )}
          <IconButton
            label={tool === 'measure' ? 'Stop measuring (Esc)' : 'Measure distance'}
            size="sm"
            active={tool === 'measure'}
            disabled={!handle}
            onClick={() => setTool(tool === 'measure' ? 'select' : 'measure')}
          >
            <Ruler size={14} />
          </IconButton>
          {measurements.length > 0 && (
            <IconButton label="Clear measurements" size="sm" onClick={clearMeasurements}>
              <Eraser size={14} />
            </IconButton>
          )}
          <IconButton
            label="Fit view (F)"
            size="sm"
            disabled={!handle}
            onClick={() => handle?.fit()}
          >
            <Focus size={14} />
          </IconButton>
        </div>
      </div>
      {tool === 'measure' && (
        <div className="pointer-events-none rounded-md border border-edge bg-surface/90 px-2 py-1 text-[11px] text-fg-muted shadow">
          {pending ? 'Click the second point' : 'Click the first point on the model'}
        </div>
      )}
      {measurements.length > 0 && (
        <ul className="pointer-events-auto max-h-40 overflow-auto rounded-md border border-edge bg-surface/90 px-2 py-1 font-mono text-[11px] shadow">
          {measurements.map((m, index) => (
            <li key={index} className="flex gap-3">
              <span className="text-fg">{m.distance.toFixed(3)} m</span>
              <span className="text-fg-muted">
                Δx {m.delta.x.toFixed(2)} · Δy {m.delta.y.toFixed(2)} · Δz {m.delta.z.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
