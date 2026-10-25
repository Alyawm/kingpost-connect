import { useAppearance } from '../state/appearance';
import { useModel } from '../state/model';
import { useProject } from '../state/project';
import { useUpdates } from '../state/updates';
import { useUi, type Section } from '../state/ui';
import { useViewer } from '../state/viewer';

export interface Command {
  id: string;
  title: string;
  group: string;
  shortcut?: string;
  run(): void;
}

export const sectionTitles: Record<Section, string> = {
  explorer: 'Explorer',
  viewer: 'Viewer',
  review: 'Review',
  compare: 'Compare',
  analysis: 'Analysis',
  drawings: 'Drawings',
  coordination: 'Coordination',
  schedules: 'Schedules',
  lab: 'Lab',
};

/**
 * Every action reachable from the command palette and the keyboard, in one place.
 * Shortcuts are documented here and bound in `useShortcuts`.
 */
export function listCommands(): Command[] {
  const ui = useUi.getState();
  const viewer = useViewer.getState();
  const project = useProject.getState();
  const model = useModel.getState();
  const selected = [...model.selectedIds];

  const sections = (Object.keys(sectionTitles) as Section[]).map<Command>((section) => ({
    id: `go.${section}`,
    title: `Go to ${sectionTitles[section]}`,
    group: 'Navigate',
    run: () => useUi.setState({ section, leftOpen: true }),
  }));

  return [
    {
      id: 'project.open',
      title: project.current ? 'Open another project folder…' : 'Open project folder…',
      group: 'Project',
      shortcut: 'Ctrl+O',
      run: () => void project.openFolder(),
    },
    ...(project.current
      ? [
          {
            id: 'project.close',
            title: 'Close project',
            group: 'Project',
            run: () => void project.close(),
          },
        ]
      : []),
    {
      id: 'app.settings',
      title: 'Settings…',
      group: 'Application',
      shortcut: 'Ctrl+,',
      run: () => ui.setSettingsOpen(true),
    },
    {
      id: 'app.help',
      title: 'Help and shortcuts',
      group: 'Application',
      shortcut: 'F1',
      run: () => ui.setHelpOpen(true),
    },
    {
      id: 'app.updates',
      title: 'Check for updates',
      group: 'Application',
      run: () => void useUpdates.getState().check(),
    },
    {
      id: 'view.fit',
      title: 'Fit model in view',
      group: 'View',
      shortcut: 'F',
      run: () => viewer.handle?.fit(),
    },
    {
      id: 'view.theme',
      title: `Switch to ${ui.theme === 'dark' ? 'light' : 'dark'} theme`,
      group: 'View',
      run: () => ui.toggleTheme(),
    },
    {
      id: 'view.left',
      title: 'Toggle side panel',
      group: 'View',
      shortcut: 'Ctrl+B',
      run: () => ui.togglePanel('left'),
    },
    {
      id: 'view.right',
      title: 'Toggle inspector',
      group: 'View',
      shortcut: 'Ctrl+Alt+B',
      run: () => ui.togglePanel('right'),
    },
    {
      id: 'view.bottom',
      title: 'Toggle output panel',
      group: 'View',
      shortcut: 'Ctrl+J',
      run: () => ui.togglePanel('bottom'),
    },
    ...(model.model
      ? [
          ...(selected.length
            ? [
                {
                  id: 'selection.hide',
                  title: 'Hide selected elements',
                  group: 'Model',
                  shortcut: 'H',
                  run: () => model.hide(selected),
                },
                {
                  id: 'selection.isolate',
                  title: 'Isolate selected elements',
                  group: 'Model',
                  shortcut: 'I',
                  run: () => model.isolate(selected),
                },
                {
                  id: 'selection.ghost',
                  title: 'Ghost everything except the selection',
                  group: 'Model',
                  shortcut: 'G',
                  run: () => useAppearance.getState().ghostOthers(selected),
                },
              ]
            : []),
          {
            id: 'model.showAll',
            title: 'Show all elements',
            group: 'Model',
            shortcut: 'Shift+H',
            run: () => model.showAll(),
          },
          {
            id: 'model.resetLooks',
            title: 'Reset all colours and transparency',
            group: 'Model',
            run: () => useAppearance.getState().reset(),
          },
        ]
      : []),
    ...sections,
  ];
}
