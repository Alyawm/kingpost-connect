import { useEffect } from 'react';
import { Box, Download, FileText, FolderOpen, RefreshCw, Sheet, X } from 'lucide-react';
import { Button, IconButton, Panel, PanelBody, PanelHeader, cn } from '@kingpost/ui';
import { useProject } from '../../state/project';
import { useModel } from '../../state/model';
import { useUi } from '../../state/ui';
import { formatBytes, formatCount, formatIsoDate } from '../../lib/format';
import type { FileKind, ProjectFile, RevisionRow } from '../../lib/ipc';

const kindIcon: Record<FileKind, typeof Box> = {
  ifc: Box,
  pdf: FileText,
  e2k: Sheet,
  s2k: Sheet,
  saf: Sheet,
};

export function ExplorerPanel() {
  const project = useProject((s) => s.current);
  const busy = useProject((s) => s.busy);
  const files = useProject((s) => s.files);
  const openFolder = useProject((s) => s.openFolder);
  const close = useProject((s) => s.close);
  const refreshFiles = useProject((s) => s.refreshFiles);

  useEffect(() => {
    if (project) void refreshFiles();
  }, [project, refreshFiles]);

  return (
    <Panel>
      <PanelHeader
        title="Explorer"
        actions={
          project && (
            <>
              <IconButton label="Refresh files" size="sm" onClick={() => void refreshFiles()}>
                <RefreshCw size={14} />
              </IconButton>
              <IconButton label="Close project" size="sm" onClick={() => void close()}>
                <X size={14} />
              </IconButton>
            </>
          )
        }
      />
      <PanelBody className="p-0">
        {project ? (
          <div className="flex h-full flex-col">
            <div className="border-b border-edge px-3 py-2">
              <div className="text-sm font-semibold">{project.name}</div>
              <div className="break-all font-mono text-[11px] text-fg-muted">{project.root}</div>
            </div>
            {files.length === 0 ? (
              <p className="p-3 text-xs text-fg-muted">
                No models or drawings found. Copy IFC, PDF, SAF (.xlsx), ETABS (.e2k) or SAP2000
                (.s2k) files into the project folder, then refresh.
              </p>
            ) : (
              <ul className="min-h-0 flex-1 overflow-auto py-1">
                {files.map((file) => (
                  <FileRow key={file.rel_path} file={file} />
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-3 p-3">
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

function FileRow({ file }: { file: ProjectFile }) {
  const importing = useProject((s) => s.importing.has(file.rel_path));
  const importFile = useProject((s) => s.importFile);
  const loadedPath = useModel((s) => s.relPath);
  const loadedRevision = useModel((s) => s.revision?.id);
  const Icon = kindIcon[file.kind] ?? FileText;
  const latest = file.revisions[file.revisions.length - 1];
  const isIfc = file.kind === 'ifc';

  return (
    <li className={cn('px-3 py-1.5', loadedPath === file.rel_path && 'bg-surface-2')}>
      <div className="flex items-start gap-2">
        <Icon size={14} className="mt-0.5 shrink-0 text-fg-muted" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium" title={file.rel_path}>
            {file.rel_path}
          </div>
          <div className="text-[11px] text-fg-muted">
            {formatBytes(file.size)}
            {latest
              ? ` · ${file.revisions.length} revision${file.revisions.length === 1 ? '' : 's'}`
              : isIfc
                ? ' · not imported'
                : ''}
          </div>
        </div>
        {isIfc && (
          <Button
            size="sm"
            variant={latest ? 'secondary' : 'primary'}
            disabled={importing}
            onClick={() => void importFile(file.rel_path)}
            title={
              latest
                ? 'Import again as a new revision'
                : 'Read elements and properties into the project'
            }
          >
            <Download size={12} />
            {importing ? 'Importing…' : latest ? 'Re-import' : 'Import'}
          </Button>
        )}
      </div>
      {isIfc && file.revisions.length > 0 && (
        <ul className="mt-1 space-y-0.5 pl-6">
          {[...file.revisions].reverse().map((revision) => (
            <RevisionLine
              key={revision.id}
              file={file}
              revision={revision}
              active={loadedRevision === revision.id}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function RevisionLine({
  file,
  revision,
  active,
}: {
  file: ProjectFile;
  revision: RevisionRow;
  active: boolean;
}) {
  const load = useModel((s) => s.load);
  const loading = useModel((s) => s.loading);
  const setSection = useUi((s) => s.setSection);

  return (
    <li className="flex items-center gap-2 text-[11px]">
      <span className={cn('flex-1 truncate', active ? 'text-fg' : 'text-fg-muted')}>
        rev {revision.idx} · {formatCount(revision.element_count)} elements ·{' '}
        {formatIsoDate(revision.imported_at)}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-1.5 text-[11px]"
        disabled={loading || active}
        onClick={() => {
          void load(file.rel_path, revision).then(() => setSection('viewer'));
        }}
      >
        {active ? 'Loaded' : 'Load'}
      </Button>
    </li>
  );
}
