import { useEffect } from 'react';
import { listCommands } from './commands';
import { useUi } from '../state/ui';
import { useView } from '../state/view';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/** Binds the shortcuts declared on commands, plus the palette toggle itself. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
      const ctrl = event.ctrlKey || event.metaKey;

      if (ctrl && (key === 'K' || (event.shiftKey && key === 'P'))) {
        event.preventDefault();
        useUi.getState().setPalette(!useUi.getState().paletteOpen);
        return;
      }
      if (isTyping(event.target) || useUi.getState().paletteOpen) return;

      if (event.key === 'Escape' && useView.getState().tool !== 'select') {
        useView.getState().setTool('select');
        return;
      }

      const pressed = [ctrl && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', key]
        .filter(Boolean)
        .join('+');
      const command = listCommands().find((c) => c.shortcut === pressed);
      if (command) {
        event.preventDefault();
        command.run();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
