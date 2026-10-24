import { useEffect, useState, type FormEvent } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { Button, cn } from '@kingpost/ui';
import { useViews } from '../../state/views';
import { useProject } from '../../state/project';

/** Saved views: name, thumbnail, apply on click, delete. */
export function ViewsPanel() {
  const views = useViews((s) => s.views);
  const busy = useViews((s) => s.busy);
  const refresh = useViews((s) => s.refresh);
  const save = useViews((s) => s.save);
  const apply = useViews((s) => s.apply);
  const remove = useViews((s) => s.remove);
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
      <div className="mb-1 font-semibold text-fg-muted">Views</div>
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
          title="Save the current camera, section, colouring and hidden elements"
        >
          <Camera size={12} />
          Save
        </Button>
      </form>
      {views.length > 0 && (
        <ul className="mt-2 grid grid-cols-2 gap-1.5">
          {views.map((view) => (
            <li key={view.id} className="group relative">
              <button
                type="button"
                className={cn(
                  'w-full overflow-hidden rounded-md border border-edge bg-canvas text-left',
                  'hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                )}
                onClick={() => apply(view)}
                title={`Apply "${view.name}"`}
              >
                {view.thumbnail ? (
                  <img src={view.thumbnail} alt="" className="aspect-[16/10] w-full object-cover" />
                ) : (
                  <div className="aspect-[16/10] w-full bg-surface-2" />
                )}
                <div className="truncate px-1.5 py-1 text-[11px]">{view.name}</div>
              </button>
              <button
                type="button"
                aria-label={`Delete view ${view.name}`}
                className="absolute right-1 top-1 hidden rounded bg-surface/90 p-0.5 text-fg-muted hover:text-danger group-hover:block"
                onClick={() => void remove(view.id)}
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
