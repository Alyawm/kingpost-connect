import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, FileText, Link2, Plus, X } from 'lucide-react';
import {
  elementLinkAdd,
  elementLinkDelete,
  elementLinks,
  isTauri,
  linkOpen,
  type ElementLinkRow,
} from '../../lib/ipc';
import { log } from '../../state/log';

/**
 * Links of the selected element: web pages (specifications, product sheets) or files
 * (drawings, calculations). Open them with the system, add, remove.
 */
export function LinksSection({ globalId }: { globalId: string }) {
  const [links, setLinks] = useState<ElementLinkRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');

  useEffect(() => {
    let cancelled = false;
    void elementLinks(globalId)
      .then((rows) => {
        if (!cancelled) setLinks(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [globalId]);

  const add = async (kind: 'url' | 'file', target: string) => {
    try {
      setLinks(await elementLinkAdd(globalId, kind, target, label));
      setUrl('');
      setLabel('');
      setAdding(false);
    } catch (error) {
      log.error(`Could not add the link: ${String(error)}`);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (url.trim()) void add('url', url.trim());
  };

  const pickFile = async () => {
    if (!isTauri()) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({ multiple: false, title: 'Link a file to this element' });
    if (typeof path === 'string') void add('file', path);
  };

  const remove = async (id: string) => {
    try {
      await elementLinkDelete(id);
      setLinks(links.filter((l) => l.id !== id));
    } catch (error) {
      log.error(`Could not remove the link: ${String(error)}`);
    }
  };

  if (links.length === 0 && !adding) {
    return (
      <div className="border-b border-edge px-3 py-1.5">
        <button
          type="button"
          className="flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg"
          onClick={() => setAdding(true)}
        >
          <Link2 size={12} /> Link a web page or file…
        </button>
      </div>
    );
  }

  return (
    <section className="border-b border-edge px-3 py-2 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-[11px] font-semibold text-fg-muted">
          <Link2 size={12} /> Links
        </h3>
        {!adding && (
          <button
            type="button"
            className="flex items-center gap-0.5 text-[11px] text-fg-muted hover:text-fg"
            onClick={() => setAdding(true)}
          >
            <Plus size={11} /> Add
          </button>
        )}
      </div>
      <ul className="space-y-0.5">
        {links.map((link) => (
          <li key={link.id} className="group flex items-center gap-1">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1 text-left text-accent hover:underline"
              title={link.target}
              onClick={() =>
                void linkOpen(link.kind, link.target).catch((e) => log.error(String(e)))
              }
            >
              {link.kind === 'url' ? <ExternalLink size={11} /> : <FileText size={11} />}
              <span className="truncate">{link.label || link.target}</span>
            </button>
            <button
              type="button"
              aria-label="Remove link"
              className="hidden rounded p-0.5 text-fg-muted hover:text-danger group-hover:block"
              onClick={() => void remove(link.id)}
            >
              <X size={11} />
            </button>
          </li>
        ))}
      </ul>
      {adding && (
        <form className="mt-1.5 space-y-1" onSubmit={submit}>
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            aria-label="Link address"
            className="h-7 w-full rounded border border-edge bg-canvas px-2 outline-none focus:border-accent"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            aria-label="Link label"
            className="h-7 w-full rounded border border-edge bg-canvas px-2 outline-none focus:border-accent"
          />
          <div className="flex gap-1">
            <button
              type="submit"
              disabled={!url.trim()}
              className="rounded bg-accent px-2 py-0.5 text-[11px] text-accent-fg disabled:opacity-50"
            >
              Add link
            </button>
            <button
              type="button"
              className="rounded border border-edge px-2 py-0.5 text-[11px] text-fg-muted hover:bg-surface-2"
              onClick={() => void pickFile()}
            >
              Link a file…
            </button>
            <button
              type="button"
              className="ml-auto rounded px-2 py-0.5 text-[11px] text-fg-muted hover:bg-surface-2"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
