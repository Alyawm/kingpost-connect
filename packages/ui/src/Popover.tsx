import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

export interface PopoverProps {
  /** Accessible name of the trigger button. */
  label: string;
  /** Content of the trigger button. */
  trigger: ReactNode;
  /** Panel content; a function receives `close`. */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Preferred side of the trigger; flips when there is no room. */
  side?: 'top' | 'bottom';
  triggerClassName?: string;
  className?: string;
}

const GAP = 4;
const MARGIN = 8;

/**
 * A click-to-open panel anchored to a button. Rendered in a portal with fixed positioning
 * so scrolling lists and clipped toolbars never cut it off; closes on Escape or a click
 * outside.
 */
export function Popover({
  label,
  trigger,
  children,
  side = 'bottom',
  triggerClassName,
  className,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const anchor = triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const below = anchor.bottom + GAP;
    const above = anchor.top - GAP - height;
    const fitsBelow = below + height <= window.innerHeight - MARGIN;
    const fitsAbove = above >= MARGIN;
    const top =
      side === 'top'
        ? fitsAbove || !fitsBelow
          ? Math.max(MARGIN, above)
          : below
        : fitsBelow || !fitsAbove
          ? Math.min(below, window.innerHeight - MARGIN - height)
          : above;
    const left = Math.min(
      Math.max(MARGIN, anchor.left),
      Math.max(MARGIN, window.innerWidth - MARGIN - width),
    );
    setPosition({ top, left });
  }, [open, side]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={triggerClassName}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            className={cn(
              'fixed z-50 rounded-md border border-edge bg-surface p-2 text-xs shadow-2xl',
              className,
            )}
            style={
              position
                ? { top: position.top, left: position.left }
                : { top: 0, left: 0, visibility: 'hidden' }
            }
            onClick={(event) => event.stopPropagation()}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body,
        )}
    </>
  );
}
