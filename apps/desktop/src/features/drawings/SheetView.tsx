import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Hand,
  Link2,
  MessageSquareText,
  Square,
  X,
  ZoomIn,
  ZoomOut,
  Cloud,
  Maximize,
} from 'lucide-react';
import { IconButton, cn } from '@kingpost/ui';
import { renderPage } from '../../lib/pdf';
import type { SheetRegion } from '../../lib/ipc';
import { parseRegion, sheetLabel, useDrawings, type SheetTool } from '../../state/drawings';
import { useModel } from '../../state/model';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;

/**
 * One sheet: the page rendered by pdf.js, with links and markups drawn over it in page
 * fractions. Pan by dragging, zoom with the wheel; the link and markup tools draw a
 * rectangle on the page.
 */
export function SheetView() {
  const open = useDrawings((s) => s.open)!;
  const tool = useDrawings((s) => s.tool);
  const setTool = useDrawings((s) => s.setTool);
  const closeSheet = useDrawings((s) => s.closeSheet);
  const focusRegion = useDrawings((s) => s.focusRegion);
  const selectedLinkId = useDrawings((s) => s.selectedLinkId);
  const selectLink = useDrawings((s) => s.selectLink);
  const createLink = useDrawings((s) => s.createLink);
  const deleteLink = useDrawings((s) => s.deleteLink);
  const followLink = useDrawings((s) => s.followLink);
  const addMarkup = useDrawings((s) => s.addMarkup);
  const deleteMarkup = useDrawings((s) => s.deleteMarkup);
  const selectedCount = useModel((s) => s.selectedIds.size);

  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [page, setPage] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [draft, setDraft] = useState<SheetRegion | null>(null);
  const [note, setNote] = useState<{ region: SheetRegion; text: string } | null>(null);
  const renderToken = useRef(0);

  // Fit the page to the host once, then re-render at the current zoom (debounced).
  const fit = useCallback(() => {
    const h = host.current;
    if (!h) return;
    const pageAspect = open.sheet.width / open.sheet.height;
    const hostAspect = h.clientWidth / h.clientHeight;
    const width = pageAspect > hostAspect ? h.clientWidth - 24 : (h.clientHeight - 24) * pageAspect;
    const height = width / pageAspect;
    setPage({ width, height });
    setView({ zoom: 1, x: (h.clientWidth - width) / 2, y: (h.clientHeight - height) / 2 });
  }, [open.sheet]);

  useEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    if (!canvas.current || page.width === 0) return;
    const token = ++renderToken.current;
    const timer = setTimeout(() => {
      if (renderToken.current !== token) return;
      void renderPage(open.doc, open.sheet.page, page.width * view.zoom, canvas.current!);
    }, 120);
    return () => clearTimeout(timer);
  }, [open.doc, open.sheet.page, page.width, view.zoom]);

  // A region asked for from outside (a link, a search hit) is centred and zoomed to.
  useEffect(() => {
    const h = host.current;
    if (!focusRegion || !h || page.width === 0) return;
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(
        1,
        Math.min(
          h.clientWidth / (focusRegion.w * page.width * 2.5),
          h.clientHeight / (focusRegion.h * page.height * 2.5),
        ),
      ),
    );
    const cx = (focusRegion.x + focusRegion.w / 2) * page.width * zoom;
    const cy = (focusRegion.y + focusRegion.h / 2) * page.height * zoom;
    setView({ zoom, x: h.clientWidth / 2 - cx, y: h.clientHeight / 2 - cy });
  }, [focusRegion, page.width, page.height]);

  const toPage = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = host.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x) / (page.width * view.zoom),
      y: (clientY - rect.top - view.y) / (page.height * view.zoom),
    };
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = host.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
    const k = zoom / view.zoom;
    setView({ zoom, x: px - (px - view.x) * k, y: py - (py - view.y) * k });
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (tool === 'pan') {
      setDrag({ x: e.clientX, y: e.clientY, vx: view.x, vy: view.y });
      return;
    }
    const p = toPage(e.clientX, e.clientY);
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (drag) {
      setView({ ...view, x: drag.vx + (e.clientX - drag.x), y: drag.vy + (e.clientY - drag.y) });
      return;
    }
    if (draft) {
      const p = toPage(e.clientX, e.clientY);
      setDraft({ ...draft, w: p.x - draft.x, h: p.y - draft.y });
    }
  };

  const onPointerUp = () => {
    if (drag) {
      setDrag(null);
      return;
    }
    if (!draft) return;
    const region = normalise(draft);
    setDraft(null);
    if (region.w < 0.005 || region.h < 0.005) return;
    if (tool === 'link') void createLink(region);
    else if (tool === 'rect') void addMarkup('rect', region, null);
    else if (tool === 'cloud') void addMarkup('cloud', region, null);
    else if (tool === 'text') setNote({ region, text: '' });
  };

  const scaleX = page.width * view.zoom;
  const scaleY = page.height * view.zoom;
  const box = (r: SheetRegion) => ({
    left: view.x + r.x * scaleX,
    top: view.y + r.y * scaleY,
    width: r.w * scaleX,
    height: r.h * scaleY,
  });

  const tools: { value: SheetTool; icon: typeof Hand; label: string }[] = [
    { value: 'pan', icon: Hand, label: 'Pan and zoom' },
    {
      value: 'link',
      icon: Link2,
      label: selectedCount
        ? `Link a region to the ${selectedCount} selected element(s)`
        : 'Link a region (select elements in the model first)',
    },
    { value: 'rect', icon: Square, label: 'Markup: rectangle' },
    { value: 'cloud', icon: Cloud, label: 'Markup: revision cloud' },
    { value: 'text', icon: MessageSquareText, label: 'Markup: note' },
  ];

  return (
    <div className="absolute inset-0 flex flex-col bg-canvas" data-testid="sheet-view">
      <div className="flex items-center gap-1 border-b border-edge bg-surface px-2 py-1 text-xs">
        <span className="truncate font-semibold">{sheetLabel(open.sheet)}</span>
        <span className="truncate text-fg-muted">
          · {open.sheet.rel_path} rev {open.sheet.revision_idx} · page {open.sheet.page}
        </span>
        <span className="flex-1" />
        {tools.map((t) => (
          <IconButton
            key={t.value}
            label={t.label}
            size="sm"
            active={tool === t.value}
            onClick={() => setTool(t.value)}
          >
            <t.icon size={14} />
          </IconButton>
        ))}
        <span className="mx-1 h-4 w-px bg-edge" />
        <IconButton
          label="Zoom in"
          size="sm"
          onClick={() => setView({ ...view, zoom: Math.min(MAX_ZOOM, view.zoom * 1.25) })}
        >
          <ZoomIn size={14} />
        </IconButton>
        <IconButton
          label="Zoom out"
          size="sm"
          onClick={() => setView({ ...view, zoom: Math.max(MIN_ZOOM, view.zoom / 1.25) })}
        >
          <ZoomOut size={14} />
        </IconButton>
        <IconButton label="Fit sheet" size="sm" onClick={fit}>
          <Maximize size={14} />
        </IconButton>
        <span className="w-10 text-right font-mono text-[10px] text-fg-muted">
          {Math.round(view.zoom * 100)}%
        </span>
        <IconButton label="Back to the model" size="sm" onClick={closeSheet}>
          <X size={14} />
        </IconButton>
      </div>
      <div
        ref={host}
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden',
          tool === 'pan' ? 'cursor-grab' : 'cursor-crosshair',
          drag && 'cursor-grabbing',
        )}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <canvas
          ref={canvas}
          className="absolute bg-white shadow-lg"
          style={{
            left: view.x,
            top: view.y,
            width: page.width * view.zoom,
            height: page.height * view.zoom,
          }}
        />
        {open.links.map((link) => {
          const r = parseRegion(link.region_json);
          const selected = link.id === selectedLinkId;
          return (
            <button
              key={link.id}
              type="button"
              className={cn(
                'absolute rounded-sm border-2 border-accent/80 bg-accent/10 hover:bg-accent/25',
                selected && 'ring-2 ring-accent',
              )}
              style={box(r)}
              title={`${link.label ?? (link.view_id ? 'saved view' : link.element_global_id)} · double-click to open in the model`}
              onClick={(e) => {
                e.stopPropagation();
                selectLink(selected ? null : link.id);
              }}
              onDoubleClick={() => void followLink(link)}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span className="absolute -top-4 left-0 rounded bg-accent px-1 text-[9px] text-white">
                {link.label ?? (link.view_id ? 'view' : 'element')}
              </span>
              {selected && (
                <span className="absolute -bottom-5 left-0 flex gap-1">
                  <span
                    role="button"
                    className="rounded bg-surface px-1 text-[9px] text-fg shadow"
                    onClick={(e) => {
                      e.stopPropagation();
                      void followLink(link);
                    }}
                  >
                    open
                  </span>
                  <span
                    role="button"
                    className="rounded bg-surface px-1 text-[9px] text-fg shadow"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteLink(link.id);
                    }}
                  >
                    delete
                  </span>
                </span>
              )}
            </button>
          );
        })}
        {open.markups.map((m) => {
          const r = parseRegion(m.geometry_json);
          return (
            <div
              key={m.id}
              className={cn(
                'group absolute',
                m.kind === 'cloud'
                  ? 'rounded-xl border-2 border-dashed border-red-500'
                  : 'border-2 border-red-500',
                m.kind === 'text' && 'bg-yellow-200/80',
              )}
              style={box(r)}
              title={`${m.author} · ${m.kind}${m.text ? ` · ${m.text}` : ''}`}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {m.kind === 'text' && (
                <span className="block overflow-hidden p-0.5 text-[10px] leading-tight text-black">
                  {m.text}
                </span>
              )}
              <button
                type="button"
                className="absolute -top-4 right-0 hidden rounded bg-surface px-1 text-[9px] text-fg shadow group-hover:block"
                onClick={() => void deleteMarkup(m.id)}
              >
                delete
              </button>
            </div>
          );
        })}
        {focusRegion && (
          <div
            className="pointer-events-none absolute animate-pulse border-2 border-yellow-400"
            style={box(focusRegion)}
          />
        )}
        {draft && (
          <div
            className={cn(
              'pointer-events-none absolute border-2',
              tool === 'link' ? 'border-accent bg-accent/10' : 'border-red-500',
            )}
            style={box(normalise(draft))}
          />
        )}
        {note && (
          <div
            className="absolute rounded border border-edge bg-surface p-2 shadow-lg"
            style={{
              left: box(note.region).left,
              top: box(note.region).top + box(note.region).height + 4,
            }}
          >
            <textarea
              autoFocus
              className="h-16 w-56 rounded border border-edge bg-canvas p-1 text-xs"
              placeholder="Note text"
              value={note.text}
              onChange={(e) => setNote({ ...note, text: e.target.value })}
              onPointerDown={(e) => e.stopPropagation()}
            />
            <div className="mt-1 flex justify-end gap-1">
              <button
                type="button"
                className="rounded border border-edge px-2 py-0.5 text-[10px]"
                onClick={() => setNote(null)}
              >
                cancel
              </button>
              <button
                type="button"
                className="rounded bg-accent px-2 py-0.5 text-[10px] text-white"
                disabled={!note.text.trim()}
                onClick={() => {
                  void addMarkup('text', note.region, note.text.trim());
                  setNote(null);
                }}
              >
                add note
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function normalise(r: SheetRegion): SheetRegion {
  return {
    x: Math.min(r.x, r.x + r.w),
    y: Math.min(r.y, r.y + r.h),
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}
