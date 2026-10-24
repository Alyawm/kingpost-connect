import { useEffect } from 'react';
import { X } from 'lucide-react';
import { IconButton, Kbd } from '@kingpost/ui';
import { t } from '../lib/i18n';
import { useUi } from '../state/ui';
import { listCommands } from './commands';

/** Keyboard shortcuts (read from the command list, so they cannot drift) and where the guide is. */
export function HelpDialog() {
  const open = useUi((s) => s.helpOpen);
  const close = () => useUi.getState().setHelpOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  const shortcuts = listCommands().filter((c) => c.shortcut);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 pt-16"
      onClick={close}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kp-help-title"
        className="w-[480px] max-w-[calc(100vw-2rem)] rounded-lg border border-edge bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-edge px-4 py-2">
          <h2 id="kp-help-title" className="text-sm font-semibold">
            {t('help.title')}
          </h2>
          <IconButton label={t('settings.close')} size="sm" onClick={close}>
            <X size={14} />
          </IconButton>
        </div>
        <div className="space-y-3 px-4 py-3 text-xs">
          <div>
            <div className="mb-1 text-[11px] font-semibold text-fg-muted">
              {t('help.shortcuts')}
            </div>
            <ul className="space-y-0.5">
              <li className="flex items-center justify-between">
                <span>Command palette</span>
                <Kbd>Ctrl+K</Kbd>
              </li>
              {shortcuts.map((c) => (
                <li key={c.id} className="flex items-center justify-between">
                  <span>{c.title}</span>
                  <Kbd>{c.shortcut}</Kbd>
                </li>
              ))}
              <li className="flex items-center justify-between">
                <span>Add to selection (viewport and tree)</span>
                <Kbd>Ctrl+click</Kbd>
              </li>
              <li className="flex items-center justify-between">
                <span>Leave the measure or markup tool</span>
                <Kbd>Esc</Kbd>
              </li>
            </ul>
          </div>
          <p className="text-[10px] text-fg-muted">{t('help.guide')}</p>
        </div>
      </div>
    </div>
  );
}
