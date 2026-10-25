import { useUi } from '../state/ui';
import { useProject } from '../state/project';
import { Rail } from './Rail';
import { SidePanel } from './SidePanel';
import { Workspace } from './Workspace';
import { ViewportToolbar } from './ViewportToolbar';
import { SelectionBar } from '../features/viewer/SelectionBar';
import { Inspector } from './Inspector';
import { OutputPanel } from './OutputPanel';
import { StatusBar } from './StatusBar';
import { CommandPalette } from './CommandPalette';
import { SettingsDialog } from './SettingsDialog';
import { HelpDialog } from './HelpDialog';
import { DropZone } from './DropZone';
import { MainToolbar, TitleBar } from './Header';
import { ProjectsHome } from './ProjectsHome';

/**
 * Window layout: title bar and main toolbar across the top; then activity rail · side
 * panel · workspace (+ output below) · inspector; a status bar across the bottom. The
 * Projects page covers everything below the title bar while no project is open or when
 * asked for.
 */
export function AppShell() {
  const leftOpen = useUi((s) => s.leftOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  const bottomOpen = useUi((s) => s.bottomOpen);
  const workspace = useUi((s) => s.workspace);
  const homeOpen = useUi((s) => s.homeOpen);
  const hasProject = useProject((s) => s.current !== null);
  const showHome = homeOpen || !hasProject;

  return (
    <div className="flex h-full w-full flex-col bg-canvas text-fg">
      <TitleBar />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <MainToolbar />
        <div className="flex min-h-0 flex-1">
          <Rail />
          {leftOpen && (
            <aside
              className="w-72 shrink-0 border-r border-edge bg-surface"
              aria-label="Side panel"
            >
              <SidePanel />
            </aside>
          )}
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1">
              <Workspace />
              {workspace === 'model' && <ViewportToolbar />}
              {workspace === 'model' && <SelectionBar />}
            </div>
            {bottomOpen && (
              <section
                className="h-44 shrink-0 border-t border-edge bg-surface"
                aria-label="Output"
              >
                <OutputPanel />
              </section>
            )}
          </main>
          {rightOpen && (
            <aside className="w-80 shrink-0 border-l border-edge bg-surface" aria-label="Inspector">
              <Inspector />
            </aside>
          )}
        </div>
        {showHome && <ProjectsHome />}
      </div>
      <StatusBar />
      <CommandPalette />
      <SettingsDialog />
      <HelpDialog />
      <DropZone />
    </div>
  );
}
