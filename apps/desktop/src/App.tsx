import { useEffect } from 'react';
import { AppShell } from './shell/AppShell';
import { useShortcuts } from './shell/useShortcuts';
import { useUi } from './state/ui';
import { useApp } from './state/app';

export function App() {
  const theme = useUi((s) => s.theme);
  const loadInfo = useApp((s) => s.load);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  useShortcuts();

  return <AppShell />;
}
