import { useEffect } from 'react';
import { AppShell } from './shell/AppShell';
import { useShortcuts } from './shell/useShortcuts';
import { useUi } from './state/ui';
import { useApp } from './state/app';
import { useProject } from './state/project';
import { useLicence } from './state/licence';
import { checkAtStartupIfEnabled } from './state/updates';

export function App() {
  const theme = useUi((s) => s.theme);
  const loadInfo = useApp((s) => s.load);
  const refreshProject = useProject((s) => s.refresh);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    void loadInfo();
    void useLicence.getState().refresh();
    checkAtStartupIfEnabled();
    // The shell may start with a project already open (see AppState::from_environment).
    void refreshProject();
  }, [loadInfo, refreshProject]);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void useProject
      .getState()
      .watchFiles()
      .then((unsubscribe) => {
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  useShortcuts();

  return <AppShell />;
}
