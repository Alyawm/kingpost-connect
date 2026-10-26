import { Cloud, CloudAlert, CloudCheck, CloudOff, FolderSync, RefreshCw } from 'lucide-react';
import { Popover, cn } from '@kingpost/ui';
import { AUTO_SYNC_MS, useSync } from '../state/sync';
import { useProject } from '../state/project';
import { ago } from '../lib/time';
import { shortPath } from '../lib/path';

const TABLE_NAMES: Record<string, string> = {
  issue: 'issue',
  issue_comment: 'comment',
  issue_element: 'issue element',
  issue_viewpoint: 'viewpoint',
  element_status: 'element status',
  saved_view: 'view',
  preset: 'preset',
  material_density: 'density',
  note: 'note',
  element_link: 'link',
  clash_test: 'clash test',
  clash: 'clash',
  sheet_link: 'drawing link',
  sheet_markup: 'drawing markup',
};

/** Title bar button: sync state at a glance, settings and "sync now" in its panel. */
export function SyncButton() {
  const project = useProject((s) => s.current);
  const status = useSync((s) => s.status);
  const busy = useSync((s) => s.busy);
  const error = useSync((s) => s.error);
  if (!project || !status) return null;

  const pending = status.counts.pending;
  const icon = busy ? (
    <RefreshCw size={18} className="animate-spin" />
  ) : !status.folder ? (
    <CloudOff size={18} />
  ) : error || pending ? (
    <CloudAlert size={18} className="text-warning" />
  ) : status.last_sync ? (
    <CloudCheck size={18} />
  ) : (
    <Cloud size={18} />
  );
  const label = busy
    ? 'Syncing…'
    : status.folder
      ? `Sync (last ${ago(status.last_sync)})`
      : 'Sync this project with other computers';

  return (
    <Popover
      label={label}
      trigger={icon}
      triggerClassName={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      <SyncPanel />
    </Popover>
  );
}

function SyncPanel() {
  const status = useSync((s) => s.status);
  const busy = useSync((s) => s.busy);
  const peers = useSync((s) => s.peers);
  const error = useSync((s) => s.error);
  const chooseFolder = useSync((s) => s.chooseFolder);
  const stopSyncing = useSync((s) => s.stopSyncing);
  const setAuto = useSync((s) => s.setAuto);
  const syncNow = useSync((s) => s.syncNow);
  if (!status) return null;

  if (!status.folder) {
    return (
      <div className="w-80 space-y-2 p-3 text-xs">
        <h3 className="text-sm font-medium">Sync</h3>
        <p className="text-fg-muted">
          Work on this project with colleagues or on another computer. Choose a folder everyone can
          reach: a OneDrive, Dropbox or Google Drive folder, or a network share. Issues, comments,
          statuses, views, notes, markups and the model and drawing files are kept in step through
          it.
        </p>
        <p className="text-fg-muted">
          Each colleague opens their own copy of the project and chooses the same shared folder.
        </p>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded bg-accent px-2.5 py-1.5 text-accent-fg hover:opacity-90"
          onClick={() => void chooseFolder()}
        >
          <FolderSync size={14} /> Choose shared folder…
        </button>
      </div>
    );
  }

  return (
    <div className="w-80 space-y-2.5 p-3 text-xs">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Sync</h3>
        <span className="text-fg-muted">Last sync {ago(status.last_sync)}</span>
      </div>
      <div
        className="truncate rounded bg-surface-2 px-2 py-1 font-mono text-[11px]"
        title={status.folder}
      >
        {shortPath(status.folder)}
      </div>
      <button
        type="button"
        disabled={busy}
        className="flex w-full items-center justify-center gap-1.5 rounded bg-accent px-2.5 py-1.5 text-accent-fg hover:opacity-90 disabled:opacity-60"
        onClick={() => void syncNow()}
      >
        <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
      <label className="flex items-center gap-1.5 text-fg-muted">
        <input
          type="checkbox"
          checked={status.auto}
          onChange={(e) => void setAuto(e.target.checked)}
          className="accent-[var(--kp-accent)]"
        />
        Sync automatically (when the project opens and every {AUTO_SYNC_MS / 60000} minutes)
      </label>
      {error && <p className="text-danger">{error}</p>}

      <section>
        <h4 className="mb-1 font-medium">Other copies</h4>
        {peers.length === 0 ? (
          <p className="text-fg-muted">
            None yet. When a colleague chooses the same folder, they appear here.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {peers.map((p) => (
              <li key={p.device} className="flex justify-between gap-2">
                <span className="truncate">
                  {p.user || 'Unknown user'}
                  {p.machine && <span className="text-fg-muted"> · {p.machine}</span>}
                </span>
                <span className="shrink-0 text-fg-muted">{ago(p.last_sync)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {status.pending.length > 0 && (
        <section>
          <h4 className="mb-1 font-medium">Waiting ({status.pending.length})</h4>
          <ul className="max-h-28 space-y-0.5 overflow-auto text-fg-muted">
            {status.pending.slice(0, 20).map((p) => (
              <li key={p.id}>
                {TABLE_NAMES[p.tbl] ?? p.tbl}: {p.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center justify-between border-t border-edge pt-2 text-fg-muted">
        <span>
          {status.counts.local} sent · {status.counts.remote} received
        </span>
        <span className="flex gap-2">
          <button
            type="button"
            className="hover:text-fg hover:underline"
            onClick={() => void chooseFolder()}
          >
            Change folder
          </button>
          <button
            type="button"
            className="hover:text-fg hover:underline"
            onClick={() => void stopSyncing()}
          >
            Stop syncing
          </button>
        </span>
      </div>
    </div>
  );
}
