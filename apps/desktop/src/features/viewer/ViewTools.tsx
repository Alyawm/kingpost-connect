import { useEffect, useMemo, useState } from 'react';
import { Scissors } from 'lucide-react';
import { Button, cn } from '@kingpost/ui';
import { useModel } from '../../state/model';
import { sectionRange, useView, type ColorBy, type SectionAxis } from '../../state/view';

const colorModes: { value: ColorBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'type', label: 'Type' },
  { value: 'material', label: 'Material' },
  { value: 'storey', label: 'Storey' },
  { value: 'status', label: 'Status' },
];

const axes: { value: SectionAxis; label: string; hint: string }[] = [
  { value: 'y', label: 'Plan', hint: 'Horizontal cut (elevation)' },
  { value: 'x', label: 'X', hint: 'Vertical cut across X' },
  { value: 'z', label: 'Z', hint: 'Vertical cut across Z' },
];

/** Section plane and colour-by controls for the loaded model. */
export function ViewTools() {
  const section = useView((s) => s.section);
  const setSection = useView((s) => s.setSection);
  const colorBy = useView((s) => s.colorBy);
  const setColorBy = useView((s) => s.setColorBy);
  const legend = useView((s) => s.legend);
  const isolate = useModel((s) => s.isolate);
  const storeys = useModel((s) => s.elements);
  const planOfStorey = useView((s) => s.planOfStorey);
  const [range, setRange] = useState({ min: 0, max: 10 });

  useEffect(() => {
    setRange(sectionRange(section.axis));
  }, [section.axis, storeys]);

  const storeyNames = useMemo(
    () =>
      [
        ...new Set(storeys.filter((e) => !e.is_spatial && e.storey).map((e) => e.storey as string)),
      ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [storeys],
  );

  const step = Math.max((range.max - range.min) / 400, 0.01);

  return (
    <div className="space-y-3 border-b border-edge px-3 py-2 text-xs">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold text-fg-muted">Section</span>
          <Button
            size="sm"
            variant={section.enabled ? 'primary' : 'ghost'}
            className="h-6 px-1.5"
            onClick={() => {
              if (!section.enabled) {
                const next = sectionRange(section.axis);
                setSection({ enabled: true, position: (next.min + next.max) / 2 });
              } else {
                setSection({ enabled: false });
              }
            }}
          >
            <Scissors size={12} />
            {section.enabled ? 'On' : 'Off'}
          </Button>
        </div>
        <div className="flex gap-1">
          {axes.map((axis) => (
            <button
              key={axis.value}
              type="button"
              title={axis.hint}
              className={cn(
                'rounded border px-1.5 py-0.5',
                section.axis === axis.value
                  ? 'border-accent text-fg'
                  : 'border-edge text-fg-muted hover:bg-surface-2',
              )}
              onClick={() => {
                const next = sectionRange(axis.value);
                setSection({ axis: axis.value, position: (next.min + next.max) / 2 });
              }}
            >
              {axis.label}
            </button>
          ))}
          <button
            type="button"
            className={cn(
              'ml-auto rounded border px-1.5 py-0.5',
              section.flip
                ? 'border-accent text-fg'
                : 'border-edge text-fg-muted hover:bg-surface-2',
            )}
            title="Keep the other side of the plane"
            onClick={() => setSection({ flip: !section.flip })}
          >
            Flip
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={step}
            value={Math.min(Math.max(section.position, range.min), range.max)}
            disabled={!section.enabled}
            onChange={(e) => setSection({ position: Number(e.target.value) })}
            className="w-full accent-[var(--kp-accent)]"
            aria-label="Section position"
          />
          <span className="w-16 shrink-0 text-right font-mono text-[11px] text-fg-muted">
            {section.position.toFixed(2)} m
          </span>
        </div>
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
