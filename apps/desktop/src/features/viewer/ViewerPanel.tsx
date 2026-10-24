import { useState } from 'react';
import { Eye, Focus, RotateCcw, Search } from 'lucide-react';
import { createSampleFrame } from '@kingpost/viewer';
import { Button, IconButton, Panel, PanelBody, PanelHeader } from '@kingpost/ui';
import { useViewer } from '../../state/viewer';
import { useModel } from '../../state/model';
import { ModelTree } from './ModelTree';

export function ViewerPanel() {
  const handle = useViewer((s) => s.handle);
  const revision = useModel((s) => s.revision);
  const relPath = useModel((s) => s.relPath);
  const loading = useModel((s) => s.loading);
  const hiddenCount = useModel((s) => s.hidden.size);
  const showAll = useModel((s) => s.showAll);
  const [filter, setFilter] = useState('');

  return (
    <Panel>
      <PanelHeader
        title={revision ? 'Model' : 'Viewer'}
        actions={
          <>
            {hiddenCount > 0 && (
              <IconButton label={`Show all (${hiddenCount} hidden)`} size="sm" onClick={showAll}>
                <Eye size={14} />
              </IconButton>
            )}
            <IconButton label="Fit view" size="sm" disabled={!handle} onClick={() => handle?.fit()}>
              <Focus size={14} />
            </IconButton>
          </>
        }
      />
      {revision ? (
        <>
          <div className="border-b border-edge px-3 py-2">
            <div className="truncate text-xs font-medium" title={relPath ?? ''}>
              {relPath}
            </div>
            <div className="text-[11px] text-fg-muted">
              revision {revision.idx} · {revision.schema ?? 'IFC'} ·{' '}
              {revision.element_count.toLocaleString()} elements
            </div>
            <label className="mt-2 flex items-center gap-1.5 rounded-md border border-edge bg-canvas px-2">
              <Search size={12} className="text-fg-muted" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by name, tag, type…"
                className="h-7 w-full bg-transparent text-xs outline-none placeholder:text-fg-muted"
              />
            </label>
          </div>
          <PanelBody className="p-0 py-1">
            {loading ? (
              <p className="px-3 py-2 text-xs text-fg-muted">Loading…</p>
            ) : (
              <ModelTree filter={filter} />
            )}
          </PanelBody>
        </>
      ) : (
        <PanelBody className="space-y-3">
          <p className="text-xs text-fg-muted">
            {loading
              ? 'Loading model…'
              : 'No model loaded. Open a project in the Explorer, import an IFC file and load a revision.'}
          </p>
          <Button
            onClick={() => {
              if (!handle) return;
              handle.clear();
              handle.add(createSampleFrame());
              handle.fit();
            }}
            disabled={!handle || loading}
          >
            <RotateCcw size={14} />
            Show sample frame
          </Button>
          <ul className="space-y-1 text-xs text-fg-muted">
            <li>Left drag: orbit · Right drag: pan · Wheel: zoom</li>
            <li>Click: select · Double-click in tree: fit · F: fit model</li>
          </ul>
        </PanelBody>
      )}
    </Panel>
  );
}
