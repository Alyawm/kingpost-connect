import { Panel, PanelBody, PanelHeader } from '@kingpost/ui';
import { useViewer } from '../state/viewer';

export function Inspector() {
  const selection = useViewer((s) => s.selection);

  return (
    <Panel>
      <PanelHeader title="Properties" />
      <PanelBody>
        {selection ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-fg-muted">Name</dt>
            <dd className="font-medium">{selection.name}</dd>
            <dt className="text-fg-muted">Type</dt>
            <dd className="font-mono">{selection.type}</dd>
            {selection.expressId !== undefined && (
              <>
                <dt className="text-fg-muted">Express ID</dt>
                <dd className="font-mono">{selection.expressId}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-xs text-fg-muted">
            Click an element in the viewport to see its properties. Property sets and quantities
            arrive with the IFC import in Phase 1.
          </p>
        )}
      </PanelBody>
    </Panel>
  );
}
