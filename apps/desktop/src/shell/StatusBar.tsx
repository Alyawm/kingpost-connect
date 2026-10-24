import { Moon, PanelBottom, PanelLeft, PanelRight, Sun } from 'lucide-react';
import { IconButton, Kbd } from '@kingpost/ui';
import { useApp } from '../state/app';
import { useProject } from '../state/project';
import { useUi } from '../state/ui';

export function StatusBar() {
  const info = useApp((s) => s.info);
  const project = useProject((s) => s.current);
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  const togglePanel = useUi((s) => s.togglePanel);
  const leftOpen = useUi((s) => s.leftOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  const bottomOpen = useUi((s) => s.bottomOpen);
  const setPalette = useUi((s) => s.setPalette);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-2 border-t border-edge bg-surface px-2 text-xs text-fg-muted">
      <span className="truncate">
        {project ? `${project.name} — ${project.root}` : 'No project open'}
      </span>
      <div className="flex-1" />
      <button
        type="button"
        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-fg"
        onClick={() => setPalette(true)}
      >
        Commands <Kbd>Ctrl+K</Kbd>
      </button>
      <IconButton
        label="Toggle side panel"
        size="sm"
        active={leftOpen}
        onClick={() => togglePanel('left')}
      >
        <PanelLeft size={14} />
      </IconButton>
      <IconButton
        label="Toggle output panel"
        size="sm"
        active={bottomOpen}
        onClick={() => togglePanel('bottom')}
      >
        <PanelBottom size={14} />
      </IconButton>
      <IconButton
        label="Toggle inspector"
        size="sm"
        active={rightOpen}
        onClick={() => togglePanel('right')}
      >
        <PanelRight size={14} />
      </IconButton>
      <IconButton
        label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        size="sm"
        onClick={toggleTheme}
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </IconButton>
      <span className="pl-1 font-mono">{info ? `${info.name} ${info.version}` : '…'}</span>
    </footer>
  );
}
