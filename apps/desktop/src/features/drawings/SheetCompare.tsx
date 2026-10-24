import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { IconButton, cn } from '@kingpost/ui';
import { comparePixels, renderPage } from '../../lib/pdf';
import { sheetLabel, useDrawings } from '../../state/drawings';

type Mode = 'overlay' | 'from' | 'to';

/**
 * Two revisions of a sheet rendered at the same size and compared pixel by pixel: ink
 * only in the older revision shows blue, only in the newer red, shared ink dark; changed
 * areas are boxed and counted.
 */
export function SheetCompare() {
  const compare = useDrawings((s) => s.compare)!;
  const setIndex = useDrawings((s) => s.setCompareIndex);
  const stop = useDrawings((s) => s.stopCompare);
  const pair = compare.pairs[compare.index]!;
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>('overlay');
  const [changed, setChanged] = useState<{ x: number; y: number; w: number; h: number }[] | null>(
    null,
  );
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = host.current;
    const target = canvas.current;
    if (!h || !target) return;
    let cancelled = false;
    setBusy(true);
    setChanged(null);
    const aspect = pair.from.width / pair.from.height;
    const width = Math.min(h.clientWidth - 24, (h.clientHeight - 24) * aspect);
    (async () => {
      const a = document.createElement('canvas');
      const b = document.createElement('canvas');
      await Promise.all([
        renderPage(compare.fromDoc, pair.from.page, width, a, 1),
        renderPage(compare.toDoc, pair.to.page, width, b, 1),
      ]);
      if (cancelled) return;
      const context = target.getContext('2d')!;
      target.width = Math.min(a.width, b.width);
      target.height = Math.min(a.height, b.height);
      if (mode === 'from') context.drawImage(a, 0, 0);
      else if (mode === 'to') context.drawImage(b, 0, 0);
      const ia = a.getContext('2d')!.getImageData(0, 0, target.width, target.height);
      const ib = b.getContext('2d')!.getImageData(0, 0, target.width, target.height);
      const result = comparePixels(ia, ib);
      if (cancelled) return;
      if (mode === 'overlay') context.putImageData(result.image, 0, 0);
      setChanged(result.changed);
      setSize({ width: target.width, height: target.height });
      setBusy(false);
    })().catch(() => setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [compare.fromDoc, compare.toDoc, pair, mode]);

  return (
    <div className="absolute inset-0 flex flex-col bg-canvas" data-testid="sheet-compare">
      <div className="flex items-center gap-1 border-b border-edge bg-surface px-2 py-1 text-xs">
        <IconButton
          label="Previous sheet"
          size="sm"
          disabled={compare.index === 0}
          onClick={() => setIndex(compare.index - 1)}
        >
          <ChevronLeft size={14} />
        </IconButton>
        <span className="font-semibold">{sheetLabel(pair.to)}</span>
        <span className="text-fg-muted">
          · {compare.index + 1} of {compare.pairs.length} · rev {pair.from.revision_idx} → rev{' '}
          {pair.to.revision_idx}
        </span>
        <IconButton
          label="Next sheet"
          size="sm"
          disabled={compare.index >= compare.pairs.length - 1}
          onClick={() => setIndex(compare.index + 1)}
        >
          <ChevronRight size={14} />
        </IconButton>
        <span className="flex-1" />
        {(
          [
            ['overlay', 'Overlay'],
            ['from', `Rev ${pair.from.revision_idx}`],
            ['to', `Rev ${pair.to.revision_idx}`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={cn(
              'rounded border px-1.5 py-0.5 text-[10px]',
              mode === value ? 'border-accent text-fg' : 'border-edge text-fg-muted',
            )}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
        <span className="ml-2 text-[10px] text-fg-muted">
          {busy ? 'comparing…' : changed ? `${changed.length} changed area(s)` : ''}
        </span>
        <span className="ml-2 flex items-center gap-1 text-[10px] text-fg-muted">
          <span className="h-2 w-2 bg-blue-600" /> old only{' '}
          <span className="ml-1 h-2 w-2 bg-red-600" /> new only
        </span>
        <IconButton label="Back to the model" size="sm" onClick={stop}>
          <X size={14} />
        </IconButton>
      </div>
      <div
        ref={host}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-3"
      >
        <div
          className="relative shadow-lg"
          style={{ width: size.width || undefined, height: size.height || undefined }}
        >
          <canvas ref={canvas} className="block bg-white" />
          {mode === 'overlay' &&
            changed?.map((r, i) => (
              <div
                key={i}
                className="pointer-events-none absolute border-2 border-yellow-400"
                style={{
                  left: r.x * size.width,
                  top: r.y * size.height,
                  width: r.w * size.width,
                  height: r.h * size.height,
                }}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
