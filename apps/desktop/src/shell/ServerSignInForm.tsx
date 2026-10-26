import { useState, type FormEvent } from 'react';
import { Button } from '@kingpost/ui';
import { syncServerInfo, type ServerInfo } from '../lib/ipc';
import { useSync, type ServerSignIn } from '../state/sync';
import { useUi } from '../state/ui';
import { unencrypted } from '../lib/path';

const LAST_SERVER = 'kingpost.sync.lastServer';

function lastServer(): string {
  try {
    return localStorage.getItem(LAST_SERVER) ?? '';
  } catch {
    return '';
  }
}

function rememberServer(url: string): void {
  try {
    localStorage.setItem(LAST_SERVER, url);
  } catch {
    // A convenience only.
  }
}

const input =
  'h-8 w-full rounded-md border border-edge bg-surface px-2 text-xs outline-none focus:border-accent';

interface Props {
  /** The server, when it is already known (signing in again). */
  url?: string;
  submitLabel?: string;
  onSubmit(details: ServerSignIn): Promise<boolean>;
}

/** Address, then sign in or create an account. */
export function ServerSignInForm({ url: fixedUrl, submitLabel, onSubmit }: Props) {
  const author = useUi((s) => s.author);
  const error = useSync((s) => s.error);
  const [url, setUrl] = useState(fixedUrl ?? lastServer());
  const [create, setCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState(author);
  const [password, setPassword] = useState('');
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    if (!url.trim()) return;
    try {
      const found = await syncServerInfo(url);
      setInfo(found);
      if (found.first_user) setCreate(true);
      useSync.setState({ error: null });
    } catch (e) {
      setInfo(null);
      useSync.setState({ error: String(e) });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    rememberServer(url.trim());
    const ok = await onSubmit({
      url: url.trim(),
      email: email.trim(),
      password,
      name: create ? name.trim() : undefined,
    });
    setBusy(false);
    if (ok) setPassword('');
  };

  return (
    <form className="space-y-2" onSubmit={(e) => void submit(e)}>
      {!fixedUrl && (
        <label className="block space-y-1">
          <span className="text-fg-muted">Server address</span>
          <input
            className={input}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => void check()}
            placeholder="sync.yourfirm.com"
            autoComplete="url"
            required
          />
        </label>
      )}
      {unencrypted(url) && (
        <p className="text-warning">
          This connection is not encrypted. Use it only on your office network.
        </p>
      )}
      {info?.first_user && (
        <p className="text-fg-muted">
          This server has no accounts yet: the first account becomes its administrator.
        </p>
      )}
      {info && !info.first_user && !info.open_signup && create && (
        <p className="text-fg-muted">
          Accounts here are for people invited to a project: use the email the invitation went to.
        </p>
      )}
      <label className="block space-y-1">
        <span className="text-fg-muted">Email</span>
        <input
          className={input}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
      </label>
      {create && (
        <label className="block space-y-1">
          <span className="text-fg-muted">Your name, as colleagues see it</span>
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
          />
        </label>
      )}
      <label className="block space-y-1">
        <span className="text-fg-muted">Password{create ? ' (at least 8 characters)' : ''}</span>
        <input
          className={input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={create ? 'new-password' : 'current-password'}
          minLength={create ? 8 : undefined}
          required
        />
      </label>
      {error && <p className="text-danger">{error}</p>}
      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          className="text-fg-muted hover:text-fg hover:underline"
          onClick={() => setCreate(!create)}
        >
          {create ? 'I have an account' : 'Create an account'}
        </button>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? 'Connecting…' : (submitLabel ?? (create ? 'Create account' : 'Sign in'))}
        </Button>
      </div>
    </form>
  );
}
