import { useProject } from '../state/project';
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
    ...sections,
  ];
}
