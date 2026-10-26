import { useEffect, useState, type FormEvent } from 'react';
import {
  Cloud,
  CloudAlert,
  CloudCheck,
  CloudOff,
  FolderSync,
  RefreshCw,
  Server,
  UserPlus,
  X,
} from 'lucide-react';
import { Button, Popover, cn } from '@kingpost/ui';
import { AUTO_SYNC_MS, canSync, useSync } from '../state/sync';
import { useProject } from '../state/project';
import { ago } from '../lib/time';
import { shortPath, unencrypted } from '../lib/path';
import type { ProjectRole } from '../lib/ipc';
import { ServerSignInForm } from './ServerSignInForm';

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

const ROLE_HELP: Record<ProjectRole, string> = {
  owner: 'Owner: changes the project and manages who has access',
  editor: 'Editor: changes the project',
  viewer: 'Viewer: sees the project; changes stay on their computer',
};

/** Waiting changes with the same kind and reason, counted once. */
function groupPending(
  pending: { id: string; tbl: string; reason: string }[],
): { key: string; what: string; reason: string; count: number }[] {
  const groups = new Map<string, { key: string; what: string; reason: string; count: number }>();
  for (const p of pending) {
    const key = `${p.tbl}|${p.reason}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { key, what: TABLE_NAMES[p.tbl] ?? p.tbl, reason: p.reason, count: 1 });
  }
  return [...groups.values()].slice(0, 20);
}

/** Title bar button: sync state at a glance, settings and "sync now" in its panel. */
export function SyncButton() {
  const project = useProject((s) => s.current);
  const status = useSync((s) => s.status);
  const busy = useSync((s) => s.busy);
  const error = useSync((s) => s.error);
  if (!project || !status) return null;

  const configured = Boolean(status.folder || status.server);
  const pending = status.counts.pending;
  const icon = busy ? (
    <RefreshCw size={18} className="animate-spin" />
  ) : !configured ? (
    <CloudOff size={18} />
  ) : error || pending || !canSync(status) ? (
    <CloudAlert size={18} className="text-warning" />
  ) : status.last_sync ? (
    <CloudCheck size={18} />
  ) : (
    <Cloud size={18} />
  );
  const label = busy
    ? 'Syncing…'
    : !configured
      ? 'Sync this project with other computers'
      : !canSync(status)
        ? 'Sync: sign in to the server'
        : `Sync (last ${ago(status.last_sync)})`;

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
  if (!status) return null;
  return (
    <div className="w-96 space-y-2.5 p-3 text-xs">
      {status.folder || status.server ? <Connected /> : <Setup />}
    </div>
  );
}

/** Not syncing yet: a shared folder or a server. */
function Setup() {
  const chooseFolder = useSync((s) => s.chooseFolder);
  const connectServer = useSync((s) => s.connectServer);
  const [server, setServer] = useState(false);
  return (
    <>
      <h3 className="text-sm font-medium">Sync</h3>
      <p className="text-fg-muted">
        Work on this project with colleagues or on another computer. Issues, comments, statuses,
        views, notes, markups and the model and drawing files are kept in step; everyone works in
        their own copy.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="space-y-1 rounded-md border border-edge p-2 text-left hover:border-accent hover:bg-surface-2"
          onClick={() => void chooseFolder()}
        >
          <span className="flex items-center gap-1.5 font-medium">
            <FolderSync size={14} /> Shared folder
          </span>
          <span className="block text-fg-muted">
            OneDrive, Dropbox, Google Drive or a network share. No accounts.
          </span>
        </button>
        <button
          type="button"
          className={cn(
            'space-y-1 rounded-md border p-2 text-left hover:border-accent hover:bg-surface-2',
            server ? 'border-accent bg-surface-2' : 'border-edge',
          )}
          onClick={() => setServer(!server)}
        >
          <span className="flex items-center gap-1.5 font-medium">
            <Server size={14} /> Server
          </span>
          <span className="block text-fg-muted">
            Your firm&apos;s KingPost Connect server. Invite people by email.
          </span>
        </button>
      </div>
      {server && (
        <div className="rounded-md border border-edge p-2">
          <ServerSignInForm submitLabel="Connect" onSubmit={connectServer} />
        </div>
      )}
    </>
  );
}

function Connected() {
  const status = useSync((s) => s.status)!;
  const busy = useSync((s) => s.busy);
  const peers = useSync((s) => s.peers);
  const error = useSync((s) => s.error);
  const chooseFolder = useSync((s) => s.chooseFolder);
  const stopSyncing = useSync((s) => s.stopSyncing);
  const setAuto = useSync((s) => s.setAuto);
  const syncNow = useSync((s) => s.syncNow);
  const signIn = useSync((s) => s.signIn);
  const signOut = useSync((s) => s.signOut);
  const server = status.server;

  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Sync</h3>
        <span className="text-fg-muted">Last sync {ago(status.last_sync)}</span>
      </div>
      {server ? (
        <div className="space-y-0.5 rounded bg-surface-2 px-2 py-1.5">
          <div className="flex items-center gap-1.5 font-mono text-[11px]" title={server}>
            <Server size={12} className="shrink-0 text-fg-muted" />
            <span className="truncate">{server}</span>
          </div>
          {status.account ? (
            <div className="text-fg-muted">
              Signed in as {status.account.name} ({status.account.email})
              {status.role && <> · {status.role}</>}
            </div>
          ) : (
            <div className="text-warning">Not signed in on this computer</div>
          )}
          {unencrypted(server) && (
            <div className="text-warning">Not encrypted: office network only.</div>
          )}
        </div>
      ) : (
        <div
          className="truncate rounded bg-surface-2 px-2 py-1 font-mono text-[11px]"
          title={status.folder ?? ''}
        >
          {shortPath(status.folder ?? '')}
        </div>
      )}

      {server && !status.account ? (
        <div className="rounded-md border border-edge p-2">
          <ServerSignInForm url={server} onSubmit={signIn} />
        </div>
      ) : (
        <>
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
                None yet. When a colleague{' '}
                {server ? 'joins the project' : 'chooses the same folder'}, they appear here.
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

          {server && <Members />}

          {status.pending.length > 0 && (
            <section>
              <h4 className="mb-1 font-medium">Waiting ({status.pending.length})</h4>
              <ul className="max-h-28 space-y-0.5 overflow-auto text-fg-muted">
                {groupPending(status.pending).map((g) => (
                  <li key={g.key}>
                    {g.what}
                    {g.count > 1 && ` (${g.count})`}: {g.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <div className="flex items-center justify-between border-t border-edge pt-2 text-fg-muted">
        <span>
          {status.counts.local} sent · {status.counts.remote} received
        </span>
        <span className="flex gap-2">
          {server ? (
            status.account && (
              <button
                type="button"
                className="hover:text-fg hover:underline"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            )
          ) : (
            <button
              type="button"
              className="hover:text-fg hover:underline"
              onClick={() => void chooseFolder()}
            >
              Change folder
            </button>
          )}
          <button
            type="button"
            className="hover:text-fg hover:underline"
            onClick={() => void stopSyncing()}
          >
            Stop syncing
          </button>
        </span>
      </div>
    </>
  );
}

/** Who has access to the project on the server; owners invite and remove. */
function Members() {
  const status = useSync((s) => s.status)!;
  const members = useSync((s) => s.members);
  const loadMembers = useSync((s) => s.loadMembers);
  const invite = useSync((s) => s.invite);
  const removeMember = useSync((s) => s.removeMember);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('editor');
  const owner = status.role === 'owner';
  const owners = members?.filter((m) => m.role === 'owner' && !m.pending).length ?? 0;
  const me = status.account?.email.toLowerCase();

  const accountEmail = status.account?.email;
  useEffect(() => {
    if (accountEmail && status.role) void loadMembers();
  }, [accountEmail, status.role, loadMembers]);

  if (!status.role) {
    return <p className="text-fg-muted">Sync once to see who has access to this project.</p>;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await invite(email.trim(), role)) setEmail('');
  };

  return (
    <section>
      <h4 className="mb-1 font-medium">People</h4>
      {members === null ? (
        <p className="text-fg-muted">Loading…</p>
      ) : (
        <ul className="max-h-36 space-y-0.5 overflow-auto">
          {members.map((m) => (
            <li key={m.email} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate" title={m.email}>
                {m.name || m.email}
                {m.pending && <span className="text-fg-muted"> · invited</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-fg-muted">
                <span title={ROLE_HELP[m.role]}>{m.role}</span>
                {(owner || m.email.toLowerCase() === me) &&
                  !(m.role === 'owner' && !m.pending && owners === 1) && (
                    <button
                      type="button"
                      className="rounded p-0.5 hover:bg-surface-3 hover:text-fg"
                      aria-label={`Remove ${m.email}`}
                      title={m.email.toLowerCase() === me ? 'Leave the project' : 'Remove access'}
                      onClick={() => void removeMember(m.email)}
                    >
                      <X size={12} />
                    </button>
                  )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {owner && (
        <form className="mt-1.5 flex gap-1" onSubmit={(e) => void submit(e)}>
          <input
            className="h-7 min-w-0 flex-1 rounded-md border border-edge bg-surface px-2 outline-none focus:border-accent"
            type="email"
            placeholder="colleague@firm.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <select
            className="h-7 rounded-md border border-edge bg-surface px-1"
            value={role}
            onChange={(e) => setRole(e.target.value as ProjectRole)}
            title={ROLE_HELP[role]}
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
            <option value="owner">Owner</option>
          </select>
          <Button type="submit" size="sm" title="Invite by email">
            <UserPlus size={13} /> Invite
          </Button>
        </form>
      )}
    </section>
  );
}
