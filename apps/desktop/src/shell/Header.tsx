import { useMemo, useRef, type ReactNode } from 'react';
import {
  Box,
  Camera,
  CircleHelp,
  ClipboardPlus,
  Eraser,
  Eye,
  EyeOff,
  Focus,
  Footprints,
  Ghost,
  Hand,
  ImageDown,
  LayoutGrid,
  Maximize,
  Maximize2,
  Minimize2,
  Moon,
  MousePointer2,
  Palette,
  PenLine,
  Redo2,
  Rotate3d,
  Ruler,
  ScanSearch,
  Scissors,
  Settings,
  SquareDashed,
  SquareDashedMousePointer,
  StickyNote,
  Sun,
  Undo2,
} from 'lucide-react';
import { IconButton, Kbd, Popover, cn } from '@kingpost/ui';
import type { NavigationMode } from '@kingpost/viewer';
import { useAppearance } from '../state/appearance';
import { useHistory } from '../state/history';
import { useMeasure } from '../state/measure';
import { useModel } from '../state/model';
import { useProject } from '../state/project';
import { useReview } from '../state/review';
import { useUi } from '../state/ui';
import { useView } from '../state/view';
import { useViewer } from '../state/viewer';
import { useViews } from '../state/views';
import { AppearanceEditor } from '../features/viewer/AppearanceEditor';

/** The brand mark: a king post truss in a rounded square. */
function Logo() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="5" fill="var(--kp-accent)" />
      <path
        d="M4 17 L12 6 L20 17 Z M12 6 L12 17"
        fill="none"
        stroke="white"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Title bar: brand and Projects on the left, the open project and model in the middle,
 * commands, help, settings and theme on the right.
 */
export function TitleBar() {
  const project = useProject((s) => s.current);
  const relPath = useModel((s) => s.relPath);
  const revision = useModel((s) => s.revision);
  const homeOpen = useUi((s) => s.homeOpen);
  const setHomeOpen = useUi((s) => s.setHomeOpen);
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  const setPalette = useUi((s) => s.setPalette);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const setHelpOpen = useUi((s) => s.setHelpOpen);

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-edge bg-surface px-3">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-[15px] font-semibold tracking-tight">
          KingPost <span className="font-normal text-fg-muted">Connect</span>
        </span>
      </div>
      <button
        type="button"
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px]',
          homeOpen ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        )}
        onClick={() => setHomeOpen(!homeOpen || !project)}
        title="All projects"
      >
        <LayoutGrid size={16} /> Projects
      </button>
      <div className="min-w-0 flex-1 truncate text-center text-[13px]">
        {project ? (
          <>
            <span className="font-medium">{project.name}</span>
            {relPath && (
              <span className="text-fg-muted">
                {' '}
                · {relPath}
                {revision ? ` · rev ${revision.idx}` : ''}
              </span>
            )}
          </>
        ) : (
          <span className="text-fg-muted">No project open</span>
        )}
      </div>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
        onClick={() => setPalette(true)}
      >
        Commands <Kbd>Ctrl+K</Kbd>
      </button>
      <IconButton label="Help and shortcuts (F1)" onClick={() => setHelpOpen(true)}>
        <CircleHelp size={18} />
      </IconButton>
      <IconButton label="Settings (Ctrl+,)" onClick={() => setSettingsOpen(true)}>
        <Settings size={18} />
      </IconButton>
      <IconButton label={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={toggleTheme}>
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </IconButton>
    </header>
  );
}

const ICON = 19;

function Group({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 border-r border-edge px-1.5 last:border-r-0">
      {children}
    </div>
  );
}

const navModes: { value: NavigationMode; label: string; icon: typeof Hand }[] = [
  { value: 'orbit', label: 'Orbit: left drag turns around the model', icon: Rotate3d },
  { value: 'pan', label: 'Pan: left drag moves the view', icon: Hand },
  { value: 'walk', label: 'Walk: drag to look, W A S D to move', icon: Footprints },
];

/** The main toolbar under the title bar: every viewer tool, grouped as in field viewers. */
export function MainToolbar() {
  const handle = useViewer((s) => s.handle);
  const hasModel = useModel((s) => s.model !== null);
  const selectedIds = useModel((s) => s.selectedIds);
  const hiddenCount = useModel((s) => s.hidden.size);
  const hide = useModel((s) => s.hide);
  const isolate = useModel((s) => s.isolate);
  const showAll = useModel((s) => s.showAll);
  const fitTo = useModel((s) => s.fitTo);
  const ghostOthers = useAppearance((s) => s.ghostOthers);
  const tool = useView((s) => s.tool);
  const setTool = useView((s) => s.setTool);
  const boxSelect = useView((s) => s.boxSelect);
  const setBoxSelect = useView((s) => s.setBoxSelect);
  const navMode = useView((s) => s.navMode);
  const setNavMode = useView((s) => s.setNavMode);
  const edges = useView((s) => s.edges);
  const setEdges = useView((s) => s.setEdges);
  const planes = useView((s) => s.planes.length);
  const clearPlanes = useView((s) => s.clearPlanes);
  const addSectionBox = useView((s) => s.addSectionBox);
  const markups = useView((s) => s.markups.length);
  const clearMarkups = useView((s) => s.clearMarkups);
  const measureCount = useMeasure((s) => s.records.length);
  const clearMeasures = useMeasure((s) => s.clear);
  const canUndo = useHistory((s) => s.past.length > 0);
  const canRedo = useHistory((s) => s.future.length > 0);
  const undo = useHistory((s) => s.undo);
  const redo = useHistory((s) => s.redo);
  const saveView = useViews((s) => s.save);
  const exportImage = useViews((s) => s.exportImage);
  const viewCount = useViews((s) => s.views.length);
  const requestNewIssue = useReview((s) => s.requestNewIssue);
  const leftOpen = useUi((s) => s.leftOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  const bottomOpen = useUi((s) => s.bottomOpen);
  const workspace = useUi((s) => s.workspace);
  const saved = useRef<{ leftOpen: boolean; rightOpen: boolean; bottomOpen: boolean } | null>(null);
  const ids = useMemo(() => [...selectedIds], [selectedIds]);
  const hasSelection = ids.length > 0;
  const focused = !leftOpen && !rightOpen && !bottomOpen && saved.current !== null;
  const disabled = !hasModel || workspace !== 'model';

  const toggleFocus = () => {
    if (focused && saved.current) {
      useUi.setState(saved.current);
      saved.current = null;
    } else {
      saved.current = { leftOpen, rightOpen, bottomOpen };
      useUi.setState({ leftOpen: false, rightOpen: false, bottomOpen: false });
    }
  };
  const pickTool = (next: typeof tool) => {
    if (boxSelect) setBoxSelect(false);
    setTool(tool === next ? 'select' : next);
  };

  return (
    <div
      role="toolbar"
      aria-label="Tools"
      className="flex h-12 shrink-0 items-center overflow-x-auto border-b border-edge bg-surface px-1"
    >
      <Group>
        <IconButton
          label="Select (click; Ctrl+click adds)"
          active={tool === 'select' && !boxSelect}
          disabled={disabled}
          onClick={() => {
            setBoxSelect(false);
            setTool('select');
          }}
        >
          <MousePointer2 size={ICON} />
        </IconButton>
        <IconButton
          label="Box select: drag a box (right to left also takes touching elements)"
          active={boxSelect}
          disabled={disabled}
          onClick={() => setBoxSelect(!boxSelect)}
        >
          <SquareDashedMousePointer size={ICON} />
        </IconButton>
      </Group>
      <Group>
        <IconButton
          label="Hide selected (H)"
          disabled={disabled || !hasSelection}
          onClick={() => hide(ids)}
        >
          <EyeOff size={ICON} />
        </IconButton>
        <IconButton
          label="Show only the selected (I)"
          disabled={disabled || !hasSelection}
          onClick={() => isolate(ids)}
        >
          <ScanSearch size={ICON} />
        </IconButton>
        <IconButton
          label="Ghost everything else (G)"
          disabled={disabled || !hasSelection}
          onClick={() => ghostOthers(ids)}
        >
          <Ghost size={ICON} />
        </IconButton>
        <IconButton
          label={hiddenCount ? `Show all (${hiddenCount} hidden) (Shift+H)` : 'Show all (Shift+H)'}
          disabled={disabled}
          onClick={showAll}
        >
          <Eye size={ICON} />
        </IconButton>
        {hasSelection && !disabled ? (
          <Popover
            label="Colour and transparency of the selection"
            triggerClassName="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
            trigger={<Palette size={ICON} />}
          >
            <AppearanceEditor ids={ids} title="Selection" />
          </Popover>
        ) : (
          <IconButton label="Colour and transparency (select elements first)" disabled>
            <Palette size={ICON} />
          </IconButton>
        )}
      </Group>
      <Group>
        <IconButton label="Fit all (F)" disabled={!handle} onClick={() => handle?.fit()}>
          <Maximize size={ICON} />
        </IconButton>
        <IconButton
          label="Fit to the selection"
          disabled={disabled || !hasSelection}
          onClick={() => fitTo(ids)}
        >
          <Focus size={ICON} />
        </IconButton>
        <IconButton
          label={edges ? 'Hide edge lines' : 'Show edge lines'}
          active={edges}
          disabled={!hasModel}
          onClick={() => setEdges(!edges)}
        >
          <SquareDashed size={ICON} />
        </IconButton>
      </Group>
      <Group>
        <IconButton
          label={
            tool === 'measure'
              ? 'Stop measuring (Esc)'
              : 'Measure: distance, angle, perpendicular, edge, point'
          }
          active={tool === 'measure'}
          disabled={disabled}
          onClick={() => pickTool('measure')}
        >
          <Ruler size={ICON} />
        </IconButton>
        <IconButton
          label={
            tool === 'section' ? 'Stop placing a section (Esc)' : 'Section plane: click a face'
          }
          active={tool === 'section'}
          disabled={disabled}
          onClick={() => pickTool('section')}
        >
          <Scissors size={ICON} />
        </IconButton>
        <IconButton
          label="Section box around the selection (or the model)"
          disabled={disabled}
          onClick={addSectionBox}
        >
          <Box size={ICON} />
        </IconButton>
        <IconButton
          label={tool === 'markup' ? 'Stop drawing (Esc)' : 'Markup lines'}
          active={tool === 'markup'}
          disabled={disabled}
          onClick={() => pickTool('markup')}
        >
          <PenLine size={ICON} />
        </IconButton>
        <IconButton
          label={`Clear measurements${planes ? ', section planes' : ''} and markups`}
          disabled={disabled || (measureCount === 0 && markups === 0 && planes === 0)}
          onClick={() => {
            clearMeasures();
            clearMarkups();
            clearPlanes();
          }}
        >
          <Eraser size={ICON} />
        </IconButton>
      </Group>
      <Group>
        <IconButton
          label={
            tool === 'note' ? 'Stop placing a note (Esc)' : 'Note: click the model to pin a note'
          }
          active={tool === 'note'}
          disabled={disabled}
          onClick={() => pickTool('note')}
        >
          <StickyNote size={ICON} />
        </IconButton>
        <IconButton
          label="New issue from the selection and current view"
          disabled={!hasModel}
          onClick={requestNewIssue}
        >
          <ClipboardPlus size={ICON} />
        </IconButton>
        <IconButton
          label="Save the current view"
          disabled={!hasModel}
          onClick={() => void saveView(`View ${viewCount + 1}`)}
        >
          <Camera size={ICON} />
        </IconButton>
        <IconButton
          label="Export the view as an image (PNG)"
          disabled={!hasModel}
          onClick={() => void exportImage()}
        >
          <ImageDown size={ICON} />
        </IconButton>
      </Group>
      <Group>
        <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <Undo2 size={ICON} />
        </IconButton>
        <IconButton label="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
          <Redo2 size={ICON} />
        </IconButton>
      </Group>
      <div className="flex-1" />
      <div
        className="mx-1.5 flex overflow-hidden rounded-md border border-edge"
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
              'flex h-9 w-10 items-center justify-center border-r border-edge last:border-r-0',
              navMode === value
                ? 'bg-accent text-accent-fg'
                : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
            )}
            onClick={() => setNavMode(value)}
          >
            <Icon size={ICON} />
          </button>
        ))}
      </div>
      <IconButton
        label={focused ? 'Show the panels again' : 'Focus on the model (hide panels)'}
        active={focused}
        onClick={toggleFocus}
      >
        {focused ? <Minimize2 size={ICON} /> : <Maximize2 size={ICON} />}
      </IconButton>
    </div>
  );
}
