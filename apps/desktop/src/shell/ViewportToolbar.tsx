import { useRef } from 'react';
import {
  Eraser,
  Eye,
  Focus,
  Footprints,
  Hand,
  Maximize2,
  Minimize2,
  PenLine,
  Redo2,
  Rotate3d,
  Ruler,
  Scissors,
  SquareDashed,
  Undo2,
} from 'lucide-react';
import { ViewCube, type NavigationMode } from '@kingpost/viewer';
import { IconButton, cn } from '@kingpost/ui';
import { useViewer } from '../state/viewer';
import { useModel } from '../state/model';
import { useView } from '../state/view';
import { useHistory } from '../state/history';
import { useUi } from '../state/ui';
import { useMeasure } from '../state/measure';
import { MeasurePanel, SnapTip } from '../features/viewer/MeasurePanel';

const navModes: { value: NavigationMode; label: string; icon: typeof Hand }[] = [
  { value: 'orbit', label: 'Orbit: left drag turns around the model', icon: Rotate3d },
  { value: 'pan', label: 'Pan: left drag moves the view', icon: Hand },
  { value: 'walk', label: 'Walk: drag to look, W A S D to move', icon: Footprints },
];

/**
 * Floating controls over the viewport: navigation mode, undo and redo, tools, edges,
 * focus mode, and the orientation cube in the bottom corner.
 */
export function ViewportToolbar() {
  const handle = useViewer((s) => s.handle);
  const hasModel = useModel((s) => s.model !== null);
  const hiddenCount = useModel((s) => s.hidden.size);
  const showAll = useModel((s) => s.showAll);
  const tool = useView((s) => s.tool);
  const setTool = useView((s) => s.setTool);
  const pending = useView((s) => s.pendingPoint);
  const measureCount = useMeasure((s) => s.records.length);
  const clearMeasurements = useView((s) => s.clearMeasurements);
  const markups = useView((s) => s.markups);
  const clearMarkups = useView((s) => s.clearMarkups);
  const navMode = useView((s) => s.navMode);
  const setNavMode = useView((s) => s.setNavMode);
  const edges = useView((s) => s.edges);
  const setEdges = useView((s) => s.setEdges);
  const canUndo = useHistory((s) => s.past.length > 0);
  const canRedo = useHistory((s) => s.future.length > 0);
  const undo = useHistory((s) => s.undo);
  const redo = useHistory((s) => s.redo);
  const leftOpen = useUi((s) => s.leftOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  const bottomOpen = useUi((s) => s.bottomOpen);
  const saved = useRef<{ leftOpen: boolean; rightOpen: boolean; bottomOpen: boolean } | null>(null);
  const focused = !leftOpen && !rightOpen && !bottomOpen && saved.current !== null;

  const toggleFocus = () => {
    if (focused && saved.current) {
      useUi.setState(saved.current);
      saved.current = null;
    } else {
      saved.current = { leftOpen, rightOpen, bottomOpen };
      useUi.setState({ leftOpen: false, rightOpen: false, bottomOpen: false });
    }
  };

  return (
    <>
      <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-2">
        <div className="flex items-center gap-1">
          <div
            className="pointer-events-auto flex overflow-hidden rounded-md border border-edge bg-surface/90 shadow"
            role="radiogroup"
            aria-label="Navigation"
          >
            {navModes.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={navMode === value}
                title={label}
                disabled={!handle}
                className={cn(
                  'flex h-7 w-8 items-center justify-center border-r border-edge last:border-r-0',
                  navMode === value
                    ? 'bg-accent text-accent-fg'
                    : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                )}
                onClick={() => setNavMode(value)}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-edge bg-surface/90 shadow">
            <IconButton label="Undo (Ctrl+Z)" size="sm" disabled={!canUndo} onClick={undo}>
              <Undo2 size={14} />
            </IconButton>
            <IconButton label="Redo (Ctrl+Y)" size="sm" disabled={!canRedo} onClick={redo}>
              <Redo2 size={14} />
            </IconButton>
          </div>
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-md border border-edge bg-surface/90 shadow">
            {hiddenCount > 0 && (
              <IconButton label={`Show all (${hiddenCount} hidden)`} size="sm" onClick={showAll}>
                <Eye size={14} />
              </IconButton>
            )}
            <IconButton
              label={
                tool === 'measure'
                  ? 'Stop measuring (Esc)'
                  : 'Measure: distance, angle, perpendicular, edge, point'
              }
              size="sm"
              active={tool === 'measure'}
              disabled={!handle}
              onClick={() => setTool(tool === 'measure' ? 'select' : 'measure')}
            >
              <Ruler size={14} />
            </IconButton>
            <IconButton
              label={
                tool === 'section'
                  ? 'Stop placing a section (Esc)'
                  : 'Place a section plane on a face'
              }
              size="sm"
              active={tool === 'section'}
              disabled={!handle}
              onClick={() => setTool(tool === 'section' ? 'select' : 'section')}
            >
              <Scissors size={14} />
            </IconButton>
            <IconButton
              label={tool === 'markup' ? 'Stop drawing (Esc)' : 'Draw markup lines'}
              size="sm"
              active={tool === 'markup'}
              disabled={!handle}
              onClick={() => setTool(tool === 'markup' ? 'select' : 'markup')}
            >
              <PenLine size={14} />
            </IconButton>
            {(measureCount > 0 || markups.length > 0) && (
              <IconButton
                label="Clear measurements and markups"
                size="sm"
                onClick={() => {
                  clearMeasurements();
                  clearMarkups();
                }}
              >
                <Eraser size={14} />
              </IconButton>
            )}
            <IconButton
              label={edges ? 'Hide edge lines' : 'Show edge lines'}
              size="sm"
              active={edges}
              disabled={!hasModel}
              onClick={() => setEdges(!edges)}
            >
              <SquareDashed size={14} />
            </IconButton>
            <IconButton
              label="Fit view (F)"
              size="sm"
              disabled={!handle}
              onClick={() => handle?.fit()}
            >
              <Focus size={14} />
            </IconButton>
            <IconButton
              label={focused ? 'Show the panels again' : 'Focus on the model (hide panels)'}
              size="sm"
              active={focused}
              onClick={toggleFocus}
            >
              {focused ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </IconButton>
          </div>
        </div>
        {tool !== 'select' && tool !== 'measure' && (
          <div className="pointer-events-none rounded-md border border-edge bg-surface/90 px-2 py-1 text-[11px] text-fg-muted shadow">
            {tool === 'section'
              ? 'Click a face: the plane is placed on it, then drag its arrow to cut'
              : pending
                ? 'Click the second point'
                : `Click the first point on the model${tool === 'markup' ? ' to draw a line' : ''}`}
          </div>
        )}
        <MeasurePanel />
      </div>
      <SnapTip />
      <div className="pointer-events-none absolute bottom-14 right-3">
        <ViewCube handle={handle} />
      </div>
    </>
  );
}
