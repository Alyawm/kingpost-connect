import { useMemo } from 'react';
import { EyeOff, Focus, Ghost, Palette, RotateCcw, ScanSearch, X } from 'lucide-react';
import { IconButton, Popover } from '@kingpost/ui';
import { commonLook, hasLook, useAppearance } from '../../state/appearance';
import { useModel } from '../../state/model';
import { AppearanceEditor, LookDot } from './AppearanceEditor';

/**
 * Floating bar over the viewport while elements are selected: change their colour and
 * transparency, hide, isolate, ghost the rest, fit, or clear the selection.
 */
export function SelectionBar() {
  const selectedIds = useModel((s) => s.selectedIds);
  const hide = useModel((s) => s.hide);
  const isolate = useModel((s) => s.isolate);
  const fitTo = useModel((s) => s.fitTo);
  const select = useModel((s) => s.select);
  const looks = useAppearance((s) => s.looks);
  const ghostOthers = useAppearance((s) => s.ghostOthers);
  const reset = useAppearance((s) => s.reset);

  const ids = useMemo(() => [...selectedIds], [selectedIds]);
  const common = useMemo(() => commonLook(looks, ids), [looks, ids]);
  if (ids.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
      <div
        role="toolbar"
        aria-label="Selected elements"
        className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-edge bg-surface/95 px-1 shadow-lg"
      >
        <span className="px-2 text-[11px] text-fg-muted">
          {ids.length.toLocaleString()} selected
        </span>
        <Popover
          label="Colour and transparency"
          side="top"
          triggerClassName="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg"
          trigger={
            <>
              <Palette size={14} />
              <LookDot
                color={
                  typeof common.color === 'string' && common.color !== 'mixed' ? common.color : null
                }
                opacity={common.opacity === 'mixed' ? 1 : common.opacity}
              />
              Appearance
            </>
          }
        >
          <AppearanceEditor ids={ids} />
        </Popover>
        <IconButton label="Hide (H)" size="sm" onClick={() => hide(ids)}>
          <EyeOff size={14} />
        </IconButton>
        <IconButton label="Isolate (I)" size="sm" onClick={() => isolate(ids)}>
          <ScanSearch size={14} />
        </IconButton>
        <IconButton label="Ghost everything else (G)" size="sm" onClick={() => ghostOthers(ids)}>
          <Ghost size={14} />
        </IconButton>
        <IconButton label="Fit to selection" size="sm" onClick={() => fitTo(ids)}>
          <Focus size={14} />
        </IconButton>
        {hasLook(looks, ids) && (
          <IconButton label="Reset colour and transparency" size="sm" onClick={() => reset(ids)}>
            <RotateCcw size={14} />
          </IconButton>
        )}
        <IconButton label="Clear selection (Esc)" size="sm" onClick={() => void select(null)}>
          <X size={14} />
        </IconButton>
      </div>
    </div>
  );
}
