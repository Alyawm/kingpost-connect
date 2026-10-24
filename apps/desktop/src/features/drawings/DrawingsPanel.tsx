import { useEffect, useMemo, useState } from 'react';
import { FileText, GitCompareArrows, Import, Search } from 'lucide-react';
import { Button, Panel, PanelBody, PanelHeader, cn } from '@kingpost/ui';
import { drawingFiles, sheetLabel, sheetSets, useDrawings } from '../../state/drawings';
import { useProject } from '../../state/project';
import type { SheetRow } from '../../lib/ipc';

const subtle = 'text-[10px] text-fg-muted';
const field = 'h-6 w-full rounded border border-edge bg-canvas px-1 text-xs';

export function DrawingsPanel() {
  const project = useProject((s) => s.current);
  const files = useProject((s) => s.files);
  const refreshFiles = useProject((s) => s.refreshFiles);
  const sheets = useDrawings((s) => s.sheets);
  const refresh = useDrawings((s) => s.refresh);
  const importFile = useDrawings((s) => s.importFile);
  const importing = useDrawings((s) => s.importing);
  const open = useDrawings((s) => s.open);
  const openSheet = useDrawings((s) => s.openSheet);
  const loading = useDrawings((s) => s.loading);
  const query = useDrawings((s) => s.query);
  const hits = useDrawings((s) => s.hits);
  const search = useDrawings((s) => s.search);
  const startCompare = useDrawings((s) => s.startCompare);
  const compare = useDrawings((s) => s.compare);
  const [compareFrom, setCompareFrom] = useState<number | null>(null);
  const [compareTo, setCompareTo] = useState<number | null>(null);

  useEffect(() => {
    if (project) void Promise.all([refreshFiles(), refresh()]);
  }, [project, refreshFiles, refresh]);

  const candidates = useMemo(() => drawingFiles(files), [files]);
  const sets = useMemo(() => sheetSets(sheets), [sheets]);

  // Default comparison: the two newest revisions of the first file that has two.
  useEffect(() => {
    if (compareFrom !== null || compareTo !== null) return;
    const byFile = new Map<string, typeof sets>();
    for (const set of sets) byFile.set(set.relPath, [...(byFile.get(set.relPath) ?? []), set]);
    for (const list of byFile.values()) {
      if (list.length >= 2) {
        setCompareTo(list[0]!.revisionId);
        setCompareFrom(list[1]!.revisionId);
        return;
      }
    }
  }, [sets, compareFrom, compareTo]);

  return (
    <Panel>
      <PanelHeader title="Drawings" />
      <PanelBody className="p-0 text-xs">
        {!project ? (
          <p className="p-3 text-fg-muted">Open a project to work with drawings.</p>
        ) : (
          <>
            <div className="border-b border-edge px-3 py-2">
              <div className="mb-1 font-semibold text-fg-muted">Drawing files</div>
              {candidates.length === 0 && (
                <p className={subtle}>Put PDF drawing sets in the project folder to import them.</p>
              )}
              <ul className="space-y-0.5">
                {candidates.map((f) => (
                  <li key={f.rel_path} className="flex items-center gap-1">
                    <FileText size={11} className="shrink-0 text-fg-muted" />
                    <span className="min-w-0 flex-1 truncate" title={f.rel_path}>
                      {f.rel_path}
                    </span>
                    <span className={subtle}>
                      {f.revisions.length ? `rev ${f.revisions.length}` : 'not imported'}
                    </span>
                    <button
                      type="button"
                      className="flex shrink-0 items-center gap-1 rounded border border-edge px-1 py-0.5 text-[10px] hover:bg-surface-2 disabled:opacity-50"
                      disabled={importing.has(f.rel_path)}
                      onClick={() => void importFile(f.rel_path)}
                      title={f.revisions.length ? 'Import again as a new revision' : 'Import'}
                    >
                      <Import size={11} />
                      {importing.has(f.rel_path) ? '…' : 'import'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {sheets.length > 0 && (
              <div className="border-b border-edge px-3 py-2">
                <div className="relative">
                  <Search size={12} className="absolute top-1.5 left-1.5 text-fg-muted" />
                  <input
                    value={query}
                    onChange={(e) => void search(e.target.value)}
                    placeholder="Search sheet text, numbers and titles…"
                    aria-label="Search sheets"
                    className={cn(field, 'pl-6 placeholder:text-fg-muted')}
                  />
                </div>
                {query.trim() && (
                  <ul className="mt-1 max-h-56 overflow-auto rounded border border-edge">
                    {hits.length === 0 && (
                      <li className={cn(subtle, 'px-2 py-1')}>No sheet matches.</li>
                    )}
                    {hits.map((h) => (
                      <li key={h.sheet_id}>
                        <button
                          type="button"
                          className="w-full px-2 py-1 text-left hover:bg-surface-2"
                          onClick={() => void openSheet(h.sheet_id)}
                        >
                          <div className="truncate">
                            {sheetLabel(h)} <span className={subtle}>rev {h.revision_idx}</span>
                          </div>
                          {h.excerpt && <div className={cn(subtle, 'truncate')}>{h.excerpt}</div>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {sets.map((set) => (
              <SheetSet
                key={set.revisionId}
                set={set}
                openId={open?.sheet.id ?? null}
                disabled={loading}
                onOpen={(id) => void openSheet(id)}
              />
            ))}

            {sets.length >= 2 && (
              <div className="border-b border-edge px-3 py-2">
                <div className="mb-1 font-semibold text-fg-muted">Compare revisions</div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                  <select
                    className={field}
                    value={compareFrom ?? ''}
                    aria-label="Older revision"
                    onChange={(e) => setCompareFrom(Number(e.target.value))}
                  >
                    {sets.map((s) => (
                      <option key={s.revisionId} value={s.revisionId}>
                        {s.relPath} rev {s.revisionIdx}
                      </option>
                    ))}
                  </select>
                  <GitCompareArrows size={14} className="text-fg-muted" />
                  <select
                    className={field}
                    value={compareTo ?? ''}
                    aria-label="Newer revision"
                    onChange={(e) => setCompareTo(Number(e.target.value))}
                  >
                    {sets.map((s) => (
                      <option key={s.revisionId} value={s.revisionId}>
                        {s.relPath} rev {s.revisionIdx}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-1"
                  disabled={
                    loading ||
                    compareFrom === null ||
                    compareTo === null ||
                    compareFrom === compareTo
                  }
                  onClick={() => void startCompare(compareFrom!, compareTo!)}
                >
                  <GitCompareArrows size={12} />
                  {compare ? 'Compare again' : 'Compare sheets'}
                </Button>
              </div>
            )}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

function SheetSet({
  set,
  openId,
  disabled,
  onOpen,
}: {
  set: { relPath: string; revisionId: number; revisionIdx: number; sheets: SheetRow[] };
  openId: number | null;
  disabled: boolean;
  onOpen: (id: number) => void;
}) {
  const thumbnails = useDrawings((s) => s.thumbnails);
  const loadThumbnail = useDrawings((s) => s.loadThumbnail);
  const updateSheet = useDrawings((s) => s.updateSheet);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ number: '', title: '' });

  useEffect(() => {
    for (const s of set.sheets) if (s.has_thumbnail) void loadThumbnail(s.id);
  }, [set.sheets, loadThumbnail]);

  return (
    <div className="border-b border-edge px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="truncate font-semibold" title={set.relPath}>
          {set.relPath}
        </span>
        <span className={subtle}>
          rev {set.revisionIdx} · {set.sheets.length} sheet(s)
        </span>
      </div>
      <ul className="space-y-1">
        {set.sheets.map((s) => (
          <li
            key={s.id}
            className={cn(
              'flex gap-2 rounded border p-1',
              openId === s.id ? 'border-accent' : 'border-edge',
            )}
          >
            <button
              type="button"
              className="shrink-0"
              disabled={disabled}
              onClick={() => onOpen(s.id)}
              title="Open sheet"
            >
              {thumbnails.get(s.id) ? (
                <img
                  src={thumbnails.get(s.id)}
                  alt=""
                  className="h-12 w-16 rounded-sm bg-white object-cover"
                />
              ) : (
                <span className="flex h-12 w-16 items-center justify-center rounded-sm bg-surface-2 text-fg-muted">
                  <FileText size={14} />
                </span>
              )}
            </button>
            <div className="min-w-0 flex-1">
              {editing === s.id ? (
                <div className="space-y-1">
                  <input
                    className={field}
                    value={draft.number}
                    placeholder="Number"
                    aria-label="Sheet number"
                    onChange={(e) => setDraft({ ...draft, number: e.target.value })}
                  />
                  <input
                    className={field}
                    value={draft.title}
                    placeholder="Title"
                    aria-label="Sheet title"
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-white"
                      onClick={() => {
                        void updateSheet(
                          s.id,
                          draft.number.trim() || null,
                          draft.title.trim() || null,
                          s.scale,
                        );
                        setEditing(null);
                      }}
                    >
                      save
                    </button>
                    <button
                      type="button"
                      className="rounded border border-edge px-1.5 py-0.5 text-[10px]"
                      onClick={() => setEditing(null)}
                    >
                      cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="w-full text-left"
                  disabled={disabled}
                  onClick={() => onOpen(s.id)}
                  onDoubleClick={() => {
                    setDraft({ number: s.number ?? '', title: s.title ?? '' });
                    setEditing(s.id);
                  }}
                  title="Click to open, double-click to edit number and title"
                >
                  <div className="truncate font-semibold">{s.number ?? `Page ${s.page}`}</div>
                  <div className="truncate">
                    {s.title ?? <span className="text-fg-muted">untitled</span>}
                  </div>
                  <div className={subtle}>
                    page {s.page}
                    {s.link_count > 0 && ` · ${s.link_count} link(s)`}
                    {s.markup_count > 0 && ` · ${s.markup_count} markup(s)`}
                  </div>
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
