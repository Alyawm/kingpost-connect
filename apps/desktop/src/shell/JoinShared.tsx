import { useEffect, useState } from 'react';
import { FolderSync, Server, X } from 'lucide-react';
import { Button, cn } from '@kingpost/ui';
import { useSync } from '../state/sync';
import { ServerSignInForm } from './ServerSignInForm';

/** Projects page: get your own copy of a project shared through a folder or a server. */
export function JoinShared({ onClose }: { onClose(): void }) {
  const startJoin = useSync((s) => s.startJoin);
  const joinChoices = useSync((s) => s.joinChoices);
  const join = useSync((s) => s.join);
  const cancelJoin = useSync((s) => s.cancelJoin);
  const accounts = useSync((s) => s.accounts);
  const loadAccounts = useSync((s) => s.loadAccounts);
  const serverProjects = useSync((s) => s.serverProjects);
  const listServerProjects = useSync((s) => s.listServerProjects);
  const signInToJoin = useSync((s) => s.signInToJoin);
  const joinServer = useSync((s) => s.joinServer);
  const cancelServerJoin = useSync((s) => s.cancelServerJoin);
  const error = useSync((s) => s.error);
  const [mode, setMode] = useState<'folder' | 'server' | null>(null);
  const [another, setAnother] = useState(false);

  useEffect(() => {
    void loadAccounts();
    return () => {
      cancelJoin();
      cancelServerJoin();
    };
  }, [loadAccounts, cancelJoin, cancelServerJoin]);

  const showForm = mode === 'server' && (accounts.length === 0 || another) && !serverProjects;

  return (
    <section className="mb-6 rounded-md border border-edge bg-surface p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-medium">Join a shared project</h2>
        <button
          type="button"
          className="text-fg-muted hover:text-fg"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setMode('folder');
            void startJoin();
          }}
        >
          <FolderSync size={16} /> From a shared folder…
        </Button>
        <Button
          className={cn(mode === 'server' && 'border-accent')}
          onClick={() => setMode('server')}
        >
          <Server size={16} /> From a server
        </Button>
      </div>

      {joinChoices && (
        <div className="mt-3">
          <p className="mb-1 text-xs text-fg-muted">This folder holds several projects:</p>
          <ul className="space-y-1">
            {joinChoices.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{p.name}</span>
                <Button size="sm" onClick={() => void join(p)}>
                  Join
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mode === 'server' && accounts.length > 0 && !another && !serverProjects && (
        <div className="mt-3 space-y-1 text-xs">
          <p className="text-fg-muted">Signed in on this computer:</p>
          {accounts.map((a) => (
            <div key={a.url} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {a.url} <span className="text-fg-muted">· {a.name}</span>
              </span>
              <Button size="sm" onClick={() => void listServerProjects(a.url)}>
                Show projects
              </Button>
            </div>
          ))}
          <button
            type="button"
            className="text-fg-muted hover:text-fg hover:underline"
            onClick={() => setAnother(true)}
          >
            Another server or account
          </button>
          {error && <p className="text-danger">{error}</p>}
        </div>
      )}

      {showForm && (
        <div className="mt-3 max-w-sm text-xs">
          <ServerSignInForm submitLabel="Show projects" onSubmit={signInToJoin} />
        </div>
      )}

      {serverProjects && (
        <div className="mt-3 text-xs">
          <p className="mb-1 text-fg-muted">
            Projects on {serverProjects.url} you have been given access to:
          </p>
          {serverProjects.projects.length === 0 ? (
            <p className="text-fg-muted">
              None yet. Ask the project&apos;s owner to invite the email you signed in with.
            </p>
          ) : (
            <ul className="space-y-1">
              {serverProjects.projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">
                    {p.name} <span className="text-xs text-fg-muted">· {p.role}</span>
                  </span>
                  <Button size="sm" onClick={() => void joinServer(serverProjects.url, p)}>
                    Join
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="mt-1 text-fg-muted hover:text-fg hover:underline"
            onClick={() => {
              cancelServerJoin();
              setAnother(false);
            }}
          >
            Back
          </button>
        </div>
      )}
    </section>
  );
}
