import { useMemo } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { cn } from '@kingpost/ui';
import { commonLook, useAppearance } from '../../state/appearance';
import { PALETTE } from '../../state/view';

/** The view palette plus neutrals, for quick picks. */
const SWATCHES = [...PALETTE, '#ffffff', '#bfbfbf', '#808080', '#404040'];
const TRANSPARENCY_STEPS = [0, 25, 50, 75, 90];

/**
 * Colour and transparency for a set of elements: swatches, a custom colour, a
 * transparency slider and a reset. Changes apply as they are made.
 */
export function AppearanceEditor({ ids, title }: { ids: readonly number[]; title?: string }) {
  const looks = useAppearance((s) => s.looks);
  const setColor = useAppearance((s) => s.setColor);
  const setOpacity = useAppearance((s) => s.setOpacity);
  const reset = useAppearance((s) => s.reset);
  const common = useMemo(() => commonLook(looks, ids), [looks, ids]);

  const transparency = common.opacity === 'mixed' ? null : Math.round((1 - common.opacity) * 100);
  const current =
    typeof common.color === 'string' && common.color !== 'mixed' ? common.color : null;
  const empty = ids.length === 0;

  return (
    <div className="w-56 space-y-2">
      {title && (
        <div className="truncate font-semibold" title={title}>
          {title}
          <span className="ml-1 font-normal text-fg-muted">
            {ids.length.toLocaleString()} element{ids.length === 1 ? '' : 's'}
          </span>
        </div>
      )}
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-fg-muted">
          <span>Colour{common.color === 'mixed' && ' (mixed)'}</span>
          {common.color !== null && (
            <button
              type="button"
              className="underline hover:text-fg"
              disabled={empty}
              onClick={() => setColor(ids, null)}
            >
              original
            </button>
          )}
        </div>
        <div className="grid grid-cols-8 gap-1">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Colour ${swatch}`}
              title={swatch}
              disabled={empty}
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded border border-black/20',
                current?.toLowerCase() === swatch && 'ring-2 ring-accent ring-offset-1',
              )}
              style={{ background: swatch }}
              onClick={() => setColor(ids, swatch)}
            >
              {current?.toLowerCase() === swatch && (
                <Check size={11} className={swatch === '#ffffff' ? 'text-black' : 'text-white'} />
              )}
            </button>
          ))}
        </div>
        <label className="mt-1.5 flex items-center gap-2 text-[11px] text-fg-muted">
          <input
            type="color"
            aria-label="Custom colour"
            disabled={empty}
            value={current ?? '#5b9dff'}
            onChange={(e) => setColor(ids, e.target.value)}
            className="h-6 w-8 cursor-pointer rounded border border-edge bg-transparent p-0"
          />
          Custom colour
        </label>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-fg-muted">
          <span>Transparency</span>
          <span className="font-mono">{transparency === null ? 'mixed' : `${transparency} %`}</span>
        </div>
        <input
          type="range"
          min={0}
          max={95}
          step={5}
          disabled={empty}
          value={transparency ?? 0}
          aria-label="Transparency"
          onChange={(e) => setOpacity(ids, 1 - Number(e.target.value) / 100)}
          className="w-full accent-[var(--kp-accent)]"
        />
        <div className="mt-1 flex gap-1">
          {TRANSPARENCY_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              disabled={empty}
              className={cn(
                'flex-1 rounded border px-1 py-0.5 text-[10px]',
                transparency === step
                  ? 'border-accent text-fg'
                  : 'border-edge text-fg-muted hover:bg-surface-2',
              )}
              onClick={() => setOpacity(ids, 1 - step / 100)}
            >
              {step}%
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        disabled={empty || (common.color === null && common.opacity === 1)}
        className="flex w-full items-center justify-center gap-1 rounded border border-edge py-1 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
        onClick={() => reset(ids)}
      >
        <RotateCcw size={11} />
        Reset colour and transparency
      </button>
    </div>
  );
}

/** A small swatch showing a group's override colour, or nothing when it has none. */
export function LookDot({ color, opacity }: { color: string | null; opacity: number }) {
  if (color === null && opacity >= 1) return null;
  return (
    <span
      aria-hidden
      className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/20"
      style={{
        background: color ?? 'transparent',
        opacity: color ? Math.max(opacity, 0.35) : 1,
        backgroundImage: color
          ? undefined
          : 'linear-gradient(135deg, transparent 45%, currentColor 45%, currentColor 55%, transparent 55%)',
      }}
    />
  );
}
