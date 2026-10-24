import { FolderOpen, X } from 'lucide-react';
import { Button, IconButton, Panel, PanelBody, PanelHeader } from '@kingpost/ui';
import { useProject } from '../../state/project';

export function ExplorerPanel() {
  const project = useProject((s) => s.current);
  const busy = useProject((s) => s.busy);
  const openFolder = useProject((s) => s.openFolder);
  const close = useProject((s) => s.close);

  return (
    <Panel>
      <PanelHeader
        title="Explorer"
        actions={
          project && (
            <IconButton label="Close project" size="sm" onClick={() => void close()}>
              <X size={14} />
            </IconButton>
          )
        }
      />
      <PanelBody>
        {project ? (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-semibold">{project.name}</div>
              <div className="break-all font-mono text-[11px] text-fg-muted">{project.root}</div>
            </div>
            <p className="text-xs text-fg-muted">
              The file browser, IFC import and model tree arrive in Phase 1. The project database
              and manifest already live in <span className="font-mono">.kingpost/</span>.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-fg-muted">
              A project is a folder on disk. Choose an empty folder to start one, or a folder that
              already holds a project to open it.
            </p>
            <Button variant="primary" onClick={() => void openFolder()} disabled={busy}>
              <FolderOpen size={14} />
              Open project folder…
            </Button>
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
