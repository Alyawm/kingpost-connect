import { Focus, RotateCcw } from 'lucide-react';
import { createSampleFrame } from '@kingpost/viewer';
import { Button, Panel, PanelBody, PanelHeader } from '@kingpost/ui';
import { useViewer } from '../../state/viewer';

export function ViewerPanel() {
  const handle = useViewer((s) => s.handle);

  return (
    <Panel>
      <PanelHeader title="Viewer" />
      <PanelBody className="space-y-3">
        <div className="flex gap-2">
          <Button onClick={() => handle?.fit()} disabled={!handle}>
            <Focus size={14} />
            Fit view
          </Button>
          <Button
            onClick={() => {
              if (!handle) return;
              handle.clear();
              handle.add(createSampleFrame());
              handle.fit();
            }}
            disabled={!handle}
          >
            <RotateCcw size={14} />
            Reset sample
          </Button>
        </div>
        <ul className="space-y-1 text-xs text-fg-muted">
          <li>Left drag: orbit · Right drag: pan · Wheel: zoom</li>
          <li>Click: select · F: fit model</li>
        </ul>
        <p className="text-xs text-fg-muted">
          Model tree, storeys, sections and measuring arrive in Phase 1.
        </p>
      </PanelBody>
    </Panel>
  );
}
