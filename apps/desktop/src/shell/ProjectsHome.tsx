import { useEffect, useMemo, useState } from 'react';
import { Boxes, FolderOpen, FolderPlus, Pin, PinOff, Search, X } from 'lucide-react';
import { Button, cn } from '@kingpost/ui';
import { isTauri, projectIsProject } from '../lib/ipc';
import { useProject } from '../state/project';
import { useUi } from '../state/ui';

/** "3 hours ago", "yesterday", or a date. */
function ago(iso: string | undefined): string {
  if (!iso) return 'earlier';
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The Projects page: shown when no project is open (the first thing a new user sees) and
 * from the Projects button in the title bar. Pinned projects first, then recent ones.
 */
export function ProjectsHome() {
  const recent = useUi((s) => s.recentProjects);
  const pinned = useUi((s) => s.pinnedProjects);
  const meta = useUi((s) => s.projectMeta);
  const togglePin = useUi((s) => s.togglePin);
  const forget = useUi((s) => s.forgetProject);
  const setHomeOpen = useUi((s) => s.setHomeOpen);
  const current = useProject((s) => s.current);
  const busy = useProject((s) => s.busy);
  const openFolder = useProject((s) => s.openFolder);
  const openPath = useProject((s) => s.openPath);
  const openSample = useProject((s) => s.openSample);
  const [query, setQuery] = useState('');
  const [missing, setMissing] = useState<Set<string>>(new Set());

  // Folders that are no longer projects (moved or deleted) are marked, not hidden.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const roots = [...new Set([...pinned, ...recent])];
    void Promise.all(roots.map(async (r) => [r, await projectIsProject(r)] as const)).then(
      (results) => {
        if (!cancelled) setMissing(new Set(results.filter(([, ok]) => !ok).map(([r]) => r)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pinned, recent]);

  const needle = query.trim().toLowerCase();
  const matches = (root: string) =>
    !needle ||
    root.toLowerCase().includes(needle) ||
    (meta[root]?.name ?? '').toLowerCase().includes(needle);
  const pinnedList = useMemo(() => pinned.filter(matches), [pinned, needle, meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const recentList = useMemo(
    () => recent.filter((r) => !pinned.includes(r)).filter(matches),
    [recent, pinned, needle, meta], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const card = (root: string) => {
    const name = meta[root]?.name ?? root.split(/[\\/]/).filter(Boolean).pop() ?? root;
    const isPinned = pinned.includes(root);
    const gone = missing.has(root);
    const open = current?.root === root;
    return (
      <li key={root} className="group relative">
        <button
          type="button"
          disabled={busy || gone}
          onClick={() => (open ? setHomeOpen(false) : void openPath(root))}
          className={cn(
            'flex h-full w-full flex-col items-start gap-1 rounded-lg border bg-surface p-4 text-left transition-colors',
            open ? 'border-accent' : 'border-edge hover:border-accent hover:bg-surface-2',
            gone && 'opacity-60',
          )}
          title={root}
        >
          <div className="flex w-full items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
              <Boxes size={18} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{name}</span>
          </div>
          <span className="w-full truncate font-mono text-[11px] text-fg-muted">{root}</span>
          <span className="text-[11px] text-fg-muted">
            {gone ? 'Folder not found' : open ? 'Open now' : `Opened ${ago(meta[root]?.openedAt)}`}
          </span>
        </button>
        <div className="absolute right-2 top-2 hidden gap-0.5 group-hover:flex">
          <button
            type="button"
            className="rounded p-1 text-fg-muted hover:bg-surface-3 hover:text-fg"
            title={isPinned ? 'Unpin' : 'Pin to the top'}
            onClick={() => togglePin(root)}
          >
            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button
            type="button"
            className="rounded p-1 text-fg-muted hover:bg-surface-3 hover:text-danger"
            title="Remove from the list (the folder is not touched)"
            onClick={() => forget(root)}
          >
            <X size={14} />
          </button>
        </div>
      </li>
    );
  };

  return (
    <div className="absolute inset-0 z-30 overflow-auto bg-canvas" data-testid="projects-home">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-2xl font-semibold">Projects</h1>
            <p className="text-sm text-fg-muted">
              A project is a folder on disk; everything you import, review and link stays in it.
            </p>
          </div>
          {current && <Button onClick={() => setHomeOpen(false)}>Back to {current.name}</Button>}
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void openFolder()} disabled={busy}>
            <FolderOpen size={16} /> Open project folder…
          </Button>
          <Button
            onClick={() => void openFolder()}
            disabled={busy}
            title="Choose an empty or existing folder; it becomes a project"
          >
            <FolderPlus size={16} /> New project…
          </Button>
          <Button onClick={() => void openSample()} disabled={busy}>
            <Boxes size={16} /> Try the sample project
          </Button>
          <label className="ml-auto flex h-9 w-64 items-center gap-2 rounded-md border border-edge bg-surface px-2">
            <Search size={14} className="text-fg-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects"
              className="w-full bg-transparent text-sm outline-none placeholder:text-fg-muted"
            />
          </label>
        </div>

        {pinnedList.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Pinned
            </h2>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              {pinnedList.map(card)}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Recent
          </h2>
          {recentList.length > 0 ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              {recentList.map(card)}
            </ul>
          ) : (
            <div className="rounded-lg border border-dashed border-edge p-8 text-center text-sm text-fg-muted">
              {needle
                ? 'No project matches the search.'
                : 'No projects yet. Open a folder with your IFC models, or try the sample project.'}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
