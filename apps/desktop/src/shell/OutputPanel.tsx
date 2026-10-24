import { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { IconButton, Panel, PanelBody, PanelHeader, cn } from '@kingpost/ui';
import { useLog, type LogLevel } from '../state/log';

const levelClass: Record<LogLevel, string> = {
  info: 'text-fg-muted',
  warn: 'text-warning',
  error: 'text-danger',
};

export function OutputPanel() {
  const entries = useLog((s) => s.entries);
  const clear = useLog((s) => s.clear);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [entries.length]);

  return (
    <Panel>
      <PanelHeader
        title="Output"
        actions={
          <IconButton label="Clear output" size="sm" onClick={clear}>
            <Trash2 size={14} />
          </IconButton>
        }
      />
      <PanelBody className="font-mono text-xs leading-5">
        {entries.length === 0 ? (
          <span className="text-fg-muted">Nothing yet.</span>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="flex gap-3">
              <span className="shrink-0 text-fg-muted/70">{entry.time.toLocaleTimeString()}</span>
              <span className={cn('shrink-0 w-10 uppercase', levelClass[entry.level])}>
                {entry.level}
              </span>
              <span className="whitespace-pre-wrap break-all">{entry.message}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </PanelBody>
    </Panel>
  );
}
