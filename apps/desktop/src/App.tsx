import { useEffect } from 'react';
import { AppShell } from './shell/AppShell';
import { useShortcuts } from './shell/useShortcuts';
import { useUi } from './state/ui';
import { useApp } from './state/app';
import { useProject } from './state/project';

export function App() {
  const theme = useUi((s) => s.theme);
  const loadInfo = useApp((s) => s.load);
  const refreshProject = useProject((s) => s.refresh);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    void loadInfo();
    // The shell may start with a project already open (see AppState::from_environment).
    void refreshProject();
  }, [loadInfo, refreshProject]);

  useShortcuts();

  return <AppShell />;
}
