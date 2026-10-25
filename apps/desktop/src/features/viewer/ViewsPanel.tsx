import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Camera,
  EyeOff,
  Home,
  Palette,
  Pencil,
  RefreshCw,
  Scissors,
  Star,
  Trash2,
} from 'lucide-react';
import { Button, cn } from '@kingpost/ui';
import { useViews, type Visibility } from '../../state/views';
import { useProject } from '../../state/project';
import type { SavedView } from '../../lib/ipc';

/** Saved views: name, thumbnail, apply on click, update, rename, delete. */
export function ViewsPanel() {
  const views = useViews((s) => s.views);
  const busy = useViews((s) => s.busy);
  const activeId = useViews((s) => s.activeId);
  const refresh = useViews((s) => s.refresh);
  const save = useViews((s) => s.save);
  const home = useViews((s) => s.home);
  const project = useProject((s) => s.current);
  const [name, setName] = useState('');

  useEffect(() => {
    void refresh();
  }, [refresh, project]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim() || `View ${views.length + 1}`;
    void save(trimmed).then(() => setName(''));
  };

  return (
    <div className="border-b border-edge px-3 py-2 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold text-fg-muted">Views</span>
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg"
          title="Show everything in its original colours, without a section"
          onClick={home}
        >
          <Home size={11} />
          Default view
        </button>
      </div>
      <form className="flex gap-1" onSubmit={onSubmit}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`View ${views.length + 1}`}
          aria-label="View name"
          className="h-7 min-w-0 flex-1 rounded border border-edge bg-canvas px-2 text-xs outline-none placeholder:text-fg-muted focus:border-accent"
        />
        <Button
          size="sm"
          type="submit"
          disabled={busy}
          title="Save the camera, section, colouring, colours, transparency and hidden elements"
        >
          <Camera size={12} />
          Save
        </Button>
      </form>
      {views.length > 0 && (
        <ul className="mt-2 grid grid-cols-2 gap-1.5">
          {views.map((view) => (
            <ViewCard key={view.id} view={view} active={view.id === activeId} busy={busy} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ViewCard({ view, active, busy }: { view: SavedView; active: boolean; busy: boolean }) {
  const apply = useViews((s) => s.apply);
  const update = useViews((s) => s.update);
  const rename = useViews((s) => s.rename);
  const remove = useViews((s) => s.remove);
  const setDefault = useViews((s) => s.setDefault);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(view.name);
  const contents = describe(view);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== view.name) void rename(view.id, trimmed);
    else setDraft(view.name);
  };

  return (
    <li className="group relative">
      <button
        type="button"
        className={cn(
          'w-full overflow-hidden rounded-md border bg-canvas text-left',
          active ? 'border-accent ring-1 ring-accent' : 'border-edge hover:border-accent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        )}
        onClick={() => apply(view)}
        title={`Apply "${view.name}"`}
      >
        {view.thumbnail ? (
          <img src={view.thumbnail} alt="" className="aspect-[16/10] w-full object-cover" />
        ) : (
          <div className="aspect-[16/10] w-full bg-surface-2" />
        )}
        {!editing && (
          <div className="flex items-center gap-1 px-1.5 py-1 text-[11px]">
            {view.is_default && (
              <Star size={10} className="shrink-0 fill-current text-accent" aria-label="Default" />
            )}
            <span className="min-w-0 flex-1 truncate">{view.name}</span>
            {contents.looks && <Palette size={10} className="shrink-0 text-fg-muted" />}
            {contents.hidden && <EyeOff size={10} className="shrink-0 text-fg-muted" />}
            {contents.section && <Scissors size={10} className="shrink-0 text-fg-muted" />}
          </div>
        )}
      </button>
      {editing && (
        <input
          autoFocus
          value={draft}
          aria-label="New view name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(view.name);
              setEditing(false);
            }
          }}
          className="absolute inset-x-0 bottom-0 h-6 rounded-b-md border border-accent bg-canvas px-1.5 text-[11px] outline-none"
        />
      )}
      <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
        <CardAction
          label={`Update "${view.name}" with the current view`}
          disabled={busy}
          onClick={() => void update(view.id)}
        >
          <RefreshCw size={12} />
        </CardAction>
        <CardAction
          label={
            view.is_default
              ? 'Stop opening models with this view'
              : 'Open every model of this project with this view'
          }
          onClick={() => void setDefault(view.is_default ? null : view.id)}
        >
          <Star size={12} className={view.is_default ? 'fill-current text-accent' : ''} />
        </CardAction>
        <CardAction label={`Rename "${view.name}"`} onClick={() => setEditing(true)}>
          <Pencil size={12} />
        </CardAction>
        <CardAction label={`Delete view ${view.name}`} danger onClick={() => void remove(view.id)}>
          <Trash2 size={12} />
        </CardAction>
      </div>
    </li>
  );
}

function CardAction({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick(): void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        'rounded bg-surface/90 p-0.5 text-fg-muted disabled:opacity-50',
        danger ? 'hover:text-danger' : 'hover:text-fg',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** What a view changes, for the small icons on its card. */
function describe(view: SavedView): { looks: boolean; hidden: boolean; section: boolean } {
  let visibility: Partial<Visibility> = {};
  let section: unknown = null;
  try {
    visibility = JSON.parse(view.visibility_json) as Partial<Visibility>;
    section = JSON.parse(view.section_planes_json);
  } catch {
    // An unreadable payload shows no icons.
  }
  return {
    looks: (visibility.looks?.length ?? 0) > 0,
    hidden: (visibility.hidden?.length ?? 0) > 0,
    section: Array.isArray(section)
      ? section.length > 0
      : (section as { enabled?: boolean } | null)?.enabled === true,
  };
}
