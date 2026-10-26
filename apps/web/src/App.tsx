import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Boxes,
  CircleDot,
  Eye,
  FolderOpen,
  LogOut,
  MessageSquare,
  RefreshCw,
} from 'lucide-react';
import { Button, cn } from '@kingpost/ui';
import { Viewport } from '@kingpost/viewer';
import { useWeb } from './store';
import { ISSUE_STATUSES, isOpen, snapshotUrl, type Issue } from './project';

const field =
  'h-9 w-full rounded-md border border-edge bg-surface px-2.5 text-sm outline-none focus:border-accent';

export function App() {
  const phase = useWeb((s) => s.phase);
  const start = useWeb((s) => s.start);

  useEffect(() => {
    const light = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      document.documentElement.dataset.theme = light.matches ? 'light' : 'dark';
    };
    apply();
    light.addEventListener('change', apply);
    void start();
    return () => light.removeEventListener('change', apply);
  }, [start]);

  if (phase === 'starting') return <Centered>Connecting…</Centered>;
  if (phase === 'signed-out') return <SignIn />;
  if (phase === 'projects') return <Projects />;
  return <ProjectView />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-4 text-fg-muted">{children}</div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-2 font-semibold">
      <Boxes size={18} className="text-accent" />
      <span className={compact ? 'hidden md:inline' : undefined}>KingPost Connect</span>
    </span>
  );
}

function SignIn() {
  const server = useWeb((s) => s.server);
  const error = useWeb((s) => s.error);
  const signIn = useWeb((s) => s.signIn);
  const register = useWeb((s) => s.register);
  const [create, setCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (server?.first_user) setCreate(true);
  }, [server]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    if (create) await register(email.trim(), name.trim(), password);
    else await signIn(email.trim(), password);
    setBusy(false);
  };

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form
        className="w-full max-w-sm space-y-3 rounded-lg border border-edge bg-surface p-6 shadow-lg"
        onSubmit={(e) => void submit(e)}
      >
        <Brand />
        <p className="text-fg-muted">
          {create
            ? 'Create your account. Use the email address your invitation went to.'
            : 'Sign in to see the projects you have been invited to.'}
        </p>
        {server?.first_user && (
          <p className="text-fg-muted">
            This server has no accounts yet: the first account becomes its administrator.
          </p>
        )}
        <label className="block space-y-1">
          <span className="text-fg-muted">Email</span>
          <input
            className={field}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        {create && (
          <label className="block space-y-1">
            <span className="text-fg-muted">Your name, as colleagues see it</span>
            <input
              className={field}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-fg-muted">Password{create ? ' (at least 8 characters)' : ''}</span>
          <input
            className={field}
            type="password"
            autoComplete={create ? 'new-password' : 'current-password'}
            minLength={create ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="text-danger">{error}</p>}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            className="text-fg-muted hover:text-fg hover:underline"
            onClick={() => setCreate(!create)}
          >
            {create ? 'I have an account' : 'Create an account'}
          </button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Signing in…' : create ? 'Create account' : 'Sign in'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  const user = useWeb((s) => s.user);
  const signOut = useWeb((s) => s.signOut);
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge bg-surface px-3 md:gap-3 md:px-4">
      <Brand compact={Boolean(children)} />
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden md:gap-3">
        {children}
      </div>
      {user && (
        <>
          <span className="hidden shrink-0 text-fg-muted lg:inline">{user.name}</span>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => void signOut()}
            title="Sign out"
          >
            <LogOut size={14} /> <span className="hidden sm:inline">Sign out</span>
          </Button>
        </>
      )}
    </header>
  );
}

function Projects() {
  const projects = useWeb((s) => s.projects);
  const openProject = useWeb((s) => s.openProject);
  return (
    <div className="flex h-full flex-col">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 overflow-auto p-6">
        <h1 className="mb-1 text-xl font-semibold">Projects</h1>
        <p className="mb-4 text-fg-muted">
          Projects shared with you on this server. Open one to see its model, issues and comments.
        </p>
        {projects.length === 0 ? (
          <p className="text-fg-muted">
            None yet. Ask a project&apos;s owner to invite the email address you signed in with.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg border border-edge bg-surface p-3 text-left hover:border-accent"
                  onClick={() => void openProject(p)}
                >
                  <FolderOpen size={20} className="shrink-0 text-accent" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="text-xs text-fg-muted">{p.role}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function ProjectView() {
  const project = useWeb((s) => s.project)!;
  const models = useWeb((s) => s.models);
  const modelPath = useWeb((s) => s.modelPath);
  const loadModel = useWeb((s) => s.loadModel);
  const closeProject = useWeb((s) => s.closeProject);
  const refresh = useWeb((s) => s.refresh);
  const setHandle = useWeb((s) => s.setHandle);
  const progress = useWeb((s) => s.progress);
  const error = useWeb((s) => s.error);
  const selectedIssueId = useWeb((s) => s.selectedIssueId);

  return (
    <div className="flex h-full flex-col">
      <Header>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={closeProject}
          title="All projects"
        >
          <ArrowLeft size={14} /> <span className="hidden sm:inline">Projects</span>
        </Button>
        <span className="truncate font-medium">{project.name}</span>
        {models.length > 1 && (
          <select
            className="h-7 max-w-56 rounded-md border border-edge bg-surface px-1 text-xs"
            value={modelPath ?? ''}
            onChange={(e) => void loadModel(e.target.value)}
            title="Model"
          >
            {models.map((m) => (
              <option key={m.rel_path} value={m.rel_path}>
                {m.rel_path}
              </option>
            ))}
          </select>
        )}
        <Button variant="ghost" size="sm" onClick={() => void refresh()} title="Look for changes">
          <RefreshCw size={14} />
        </Button>
      </Header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          className={cn(
            'order-2 flex shrink-0 flex-col border-t border-edge bg-surface md:order-1 md:h-auto md:w-80 md:border-r md:border-t-0',
            selectedIssueId ? 'h-[62%]' : 'h-[45%]',
          )}
        >
          {selectedIssueId ? <IssueDetail id={selectedIssueId} /> : <IssueList />}
        </aside>
        <main className="relative order-1 min-h-0 min-w-0 flex-1 md:order-2">
          <Viewport className="absolute inset-0" onReady={setHandle} />
          {progress && (
            <div className="absolute inset-x-4 top-4 mx-auto max-w-80 rounded-md border border-edge bg-surface p-3 shadow-lg">
              <div className="mb-2 truncate">{progress.label}…</div>
              <div className="h-1.5 overflow-hidden rounded bg-surface-3">
                <div
                  className={cn('h-full bg-accent', progress.fraction === null && 'animate-pulse')}
                  style={{ width: `${Math.round((progress.fraction ?? 1) * 100)}%` }}
                />
              </div>
            </div>
          )}
          {!progress && models.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-fg-muted">
              No model has been shared in this project yet.
            </div>
          )}
          {error && (
            <div className="absolute bottom-4 left-4 right-4 mx-auto max-w-lg rounded-md border border-edge bg-surface p-2 text-danger shadow-lg">
              {error}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-accent/15 text-accent',
  resolved: 'bg-success/15 text-success',
  closed: 'bg-success/15 text-success',
};

function IssueList() {
  const data = useWeb((s) => s.data);
  const version = useWeb((s) => s.version);
  const selectIssue = useWeb((s) => s.selectIssue);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const issues = useMemo(() => {
    void version;
    return data.issues();
  }, [data, version]);
  const shown = filter === 'open' ? issues.filter(isOpen) : issues;
  const comments = useMemo(() => {
    void version;
    const counts = new Map<string, number>();
    for (const c of data.rows<{ issue_id: string }>('issue_comment'))
      counts.set(c.issue_id, (counts.get(c.issue_id) ?? 0) + 1);
    return counts;
  }, [data, version]);

  return (
    <>
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <h2 className="font-medium">Issues</h2>
        <div className="flex gap-1 text-xs">
          {(['open', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={cn(
                'rounded px-2 py-0.5',
                filter === f ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg',
              )}
              onClick={() => setFilter(f)}
            >
              {f === 'open' ? `Open (${issues.filter(isOpen).length})` : `All (${issues.length})`}
            </button>
          ))}
        </div>
      </div>
      <ul className="flex-1 overflow-auto">
        {shown.length === 0 && (
          <li className="p-3 text-fg-muted">
            {issues.length ? 'No open issues.' : 'No issues in this project yet.'}
          </li>
        )}
        {shown.map((issue) => (
          <li key={issue.id}>
            <button
              type="button"
              className="block w-full border-b border-edge px-3 py-2 text-left hover:bg-surface-2"
              onClick={() => selectIssue(issue.id)}
            >
              <span className="line-clamp-2">{issue.title}</span>
              <span className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
                <span
                  className={cn('rounded px-1.5', STATUS_STYLE[issue.status] ?? 'bg-surface-3')}
                >
                  {issue.status}
                </span>
                {issue.priority && <span>{issue.priority}</span>}
                {issue.assignee && <span className="truncate">{issue.assignee}</span>}
                {comments.get(issue.id) ? (
                  <span className="ml-auto flex items-center gap-0.5">
                    <MessageSquare size={11} /> {comments.get(issue.id)}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function IssueDetail({ id }: { id: string }) {
  const data = useWeb((s) => s.data);
  const version = useWeb((s) => s.version);
  const project = useWeb((s) => s.project)!;
  const selectIssue = useWeb((s) => s.selectIssue);
  const showElements = useWeb((s) => s.showElements);
  const showViewpoint = useWeb((s) => s.showViewpoint);
  const addComment = useWeb((s) => s.addComment);
  const setStatus = useWeb((s) => s.setStatus);
  const model = useWeb((s) => s.model);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit = project.role !== 'viewer';

  const { issue, comments, viewpoints, elements } = useMemo(() => {
    void version;
    return {
      issue: data.issues().find((i) => i.id === id) as Issue | undefined,
      comments: data.comments(id),
      viewpoints: data.viewpoints(id),
      elements: data.issueElements(id),
    };
  }, [data, version, id]);

  if (!issue) {
    return (
      <div className="p-3">
        <Button variant="ghost" size="sm" onClick={() => selectIssue(null)}>
          <ArrowLeft size={14} /> Issues
        </Button>
        <p className="mt-2 text-fg-muted">This issue was removed.</p>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    if (await addComment(text)) setText('');
    setBusy(false);
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-edge px-2 py-2">
        <Button variant="ghost" size="sm" onClick={() => selectIssue(null)}>
          <ArrowLeft size={14} /> Issues
        </Button>
      </div>
      <div className="flex-1 space-y-3 overflow-auto p-3">
        <h2 className="text-base font-medium">{issue.title}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-fg-muted">Status</dt>
          <dd>
            {canEdit ? (
              <select
                className="rounded border border-edge bg-surface px-1"
                value={issue.status}
                onChange={(e) => void setStatus(issue, e.target.value)}
              >
                {ISSUE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                {!ISSUE_STATUSES.includes(issue.status) && (
                  <option value={issue.status}>{issue.status}</option>
                )}
              </select>
            ) : (
              issue.status
            )}
          </dd>
          {issue.priority && (
            <>
              <dt className="text-fg-muted">Priority</dt>
              <dd>{issue.priority}</dd>
            </>
          )}
          {issue.assignee && (
            <>
              <dt className="text-fg-muted">Assigned to</dt>
              <dd>{issue.assignee}</dd>
            </>
          )}
          {issue.due && (
            <>
              <dt className="text-fg-muted">Due</dt>
              <dd>{issue.due.slice(0, 10)}</dd>
            </>
          )}
          <dt className="text-fg-muted">Raised by</dt>
          <dd>
            {issue.created_by}, {new Date(issue.created_at).toLocaleDateString()}
          </dd>
        </dl>
        {issue.description && <p className="whitespace-pre-wrap">{issue.description}</p>}

        {elements.length > 0 && (
          <Button size="sm" disabled={!model} onClick={() => showElements(elements)}>
            <CircleDot size={13} /> Show {elements.length} element{elements.length === 1 ? '' : 's'}
          </Button>
        )}

        {viewpoints.length > 0 && (
          <section>
            <h3 className="mb-1 text-xs font-medium text-fg-muted">Viewpoints</h3>
            <div className="grid grid-cols-2 gap-2">
              {viewpoints.map((v) => {
                const src = snapshotUrl(v.snapshot);
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={!model}
                    className="overflow-hidden rounded border border-edge hover:border-accent disabled:opacity-60"
                    onClick={() => showViewpoint(v)}
                    title="Go to this view"
                  >
                    {src ? (
                      <img src={src} alt="Viewpoint" className="aspect-video w-full object-cover" />
                    ) : (
                      <span className="flex aspect-video items-center justify-center text-fg-muted">
                        <Eye size={16} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section>
          <h3 className="mb-1 text-xs font-medium text-fg-muted">Comments ({comments.length})</h3>
          <ul className="space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="rounded bg-surface-2 p-2">
                <div className="mb-0.5 flex justify-between gap-2 text-xs text-fg-muted">
                  <span className="truncate font-medium text-fg">{c.author}</span>
                  <span className="shrink-0">{new Date(c.created_at).toLocaleString()}</span>
                </div>
                <p className="whitespace-pre-wrap">{c.text}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {canEdit ? (
        <form
          className="flex items-end gap-2 border-t border-edge p-2 md:block md:space-y-2 md:p-3"
          onSubmit={(e) => void submit(e)}
        >
          {/* One line on phones, growing while typing; a full box on wider screens. */}
          <textarea
            className="h-9 min-w-0 flex-1 resize-none overflow-hidden rounded-md border border-edge bg-surface p-2 outline-none transition-[height] focus:h-20 focus:overflow-auto focus:border-accent md:h-20 md:w-full md:overflow-auto"
            placeholder="Add a comment"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex shrink-0 justify-end">
            <Button type="submit" variant="primary" size="sm" disabled={busy || !text.trim()}>
              {busy ? 'Sending…' : 'Comment'}
            </Button>
          </div>
        </form>
      ) : (
        <p className="border-t border-edge p-3 text-xs text-fg-muted">
          You can view this project. Ask its owner to make you an editor to comment.
        </p>
      )}
    </>
  );
}
