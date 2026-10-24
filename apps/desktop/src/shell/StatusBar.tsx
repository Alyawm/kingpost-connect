import {
  CircleHelp,
  Download,
  Moon,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Settings,
  Sun,
} from 'lucide-react';
import { IconButton, Kbd } from '@kingpost/ui';
import { useApp } from '../state/app';
import { useProject } from '../state/project';
import { useUi } from '../state/ui';
import { licenceSummary, useLicence } from '../state/licence';
import { useUpdates } from '../state/updates';
import { t } from '../lib/i18n';

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
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const setHelpOpen = useUi((s) => s.setHelpOpen);
  const licence = useLicence((s) => s.status);
  const updates = useUpdates((s) => s.state);
  const install = useUpdates((s) => s.install);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-2 border-t border-edge bg-surface px-2 text-xs text-fg-muted">
      <span className="truncate">
        {project ? `${project.name} — ${project.root}` : 'No project open'}
      </span>
      <span className="hidden truncate text-[10px] md:inline" title={licenceSummary(licence)}>
        {licence && licence.state !== 'valid' ? `· ${licenceSummary(licence)}` : ''}
      </span>
      <div className="flex-1" />
      {updates.phase === 'available' && (
        <button
          type="button"
          className="flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-white"
          onClick={() => void install()}
          title={t('updates.install')}
        >
          <Download size={12} />
          {t('updates.available', { version: updates.version })}
        </button>
      )}
      {updates.phase === 'downloading' && (
        <span>
          {t('updates.downloading')}
          {updates.total ? ` ${Math.round((100 * updates.received) / updates.total)}%` : ''}
        </span>
      )}
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
      <IconButton label={t('help.title')} size="sm" onClick={() => setHelpOpen(true)}>
        <CircleHelp size={14} />
      </IconButton>
      <IconButton label={t('settings.title')} size="sm" onClick={() => setSettingsOpen(true)}>
        <Settings size={14} />
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
