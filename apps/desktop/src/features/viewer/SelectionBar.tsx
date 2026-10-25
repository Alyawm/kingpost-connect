import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { EyeOff, Focus, Ghost, Palette, RotateCcw, ScanSearch, X } from 'lucide-react';
import { IconButton, Popover, cn } from '@kingpost/ui';
import { commonLook, hasLook, useAppearance } from '../../state/appearance';
import { useModel } from '../../state/model';
import { useUi } from '../../state/ui';
import { lengthNumber, lengthSymbol } from '../../lib/units';
import { useProject } from '../../state/project';
import { useViewer } from '../../state/viewer';
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

  const hasModel = useModel((s) => s.model !== null);
  const loading = useModel((s) => s.loading);
  const viewerPick = useViewer((s) => s.selection);
  const busy = useProject((s) => s.busy);
  const openSample = useProject((s) => s.openSample);
  const [everSelected, setEverSelected] = useState(false);

  const ids = useMemo(() => [...selectedIds], [selectedIds]);
  const common = useMemo(() => commonLook(looks, ids), [looks, ids]);
  const model = useModel((s) => s.model);
  const units = useUi((s) => s.units);
  // Overall size of the selection, so a member or a group can be checked at a glance.
  const size = useMemo(() => {
    const box = ids.length ? model?.boundsOf(ids) : null;
    if (!box) return null;
    const x = box.max.x - box.min.x;
    const y = box.max.y - box.min.y;
    const z = box.max.z - box.min.z;
    const f = (v: number) => lengthNumber(v, units);
    // Viewer space is y-up: report plan width × plan depth × height.
    return `${f(x)} × ${f(z)} × ${f(y)} ${lengthSymbol(units)}`.trim();
  }, [ids, model, units]);
  useEffect(() => {
    if (ids.length > 0) setEverSelected(true);
  }, [ids.length]);

  if (!hasModel && !loading && viewerPick) {
    // The start-up frame is a picture, not a model: say how to get one that can be edited.
    return (
      <Hint>
        <span>
          This is a demo frame. Open a project and load an IFC model to change colours, transparency
          and visibility.
        </span>
        <button
          type="button"
          disabled={busy}
          className="shrink-0 rounded bg-accent px-2 py-0.5 font-medium text-white hover:opacity-90 disabled:opacity-50"
          onClick={() => void openSample()}
        >
          Try the sample project
        </button>
      </Hint>
    );
  }
  if (ids.length === 0) {
    return hasModel && !everSelected ? (
      <Hint muted>
        Click an element to colour, hide or isolate it · Ctrl+click adds more · groups have their
        own controls in the Model panel
      </Hint>
    ) : null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
      <div
        role="toolbar"
        aria-label="Selected elements"
        className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-edge bg-surface/95 px-1 shadow-lg"
      >
        <span className="px-2 text-[11px] text-fg-muted">
          {ids.length.toLocaleString()} selected
          {size && (
            <span className="ml-2 font-mono" title="Width × depth × height of the selection">
              {size}
            </span>
          )}
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
        <IconButton label="Show only these (I)" size="sm" onClick={() => isolate(ids)}>
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

function Hint({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
      <div
        role="status"
        className={cn(
          'pointer-events-auto flex max-w-xl items-center gap-3 rounded-md border border-edge px-3 py-1.5 text-[11px] shadow-lg',
          muted ? 'bg-surface/80 text-fg-muted' : 'bg-surface/95 text-fg',
        )}
      >
        {children}
      </div>
    </div>
  );
}
