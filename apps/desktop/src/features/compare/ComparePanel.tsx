import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  GitCompareArrows,
  Palette,
  RefreshCw,
} from 'lucide-react';
import { Button, IconButton, Panel, PanelBody, PanelHeader, cn } from '@kingpost/ui';
import { comparableFiles, revisionLabel, useCompare, visibleItems } from '../../state/compare';
import { useProject } from '../../state/project';
import { useModel } from '../../state/model';
import { useReview } from '../../state/review';
import { useUi } from '../../state/ui';
import { CHANGE_COLORS, useView } from '../../state/view';
import type { ChangeKind, DiffItem } from '../../lib/ipc';

export function ComparePanel() {
  const project = useProject((s) => s.current);
  const files = useProject((s) => s.files);
  const refreshFiles = useProject((s) => s.refreshFiles);
  const diff = useCompare((s) => s.diff);
  const busy = useCompare((s) => s.busy);
  const run = useCompare((s) => s.run);
  const exportCsv = useCompare((s) => s.exportCsv);
  const pick = useCompare((s) => s.pick);
  const relPath = useCompare((s) => s.relPath);
  const fromId = useCompare((s) => s.fromRevisionId);
  const toId = useCompare((s) => s.toRevisionId);

  useEffect(() => {
    if (project) void refreshFiles();
  }, [project, refreshFiles]);

  const candidates = useMemo(() => comparableFiles(files), [files]);
  const file = candidates.find((f) => f.rel_path === relPath) ?? null;

  // Default to the last two revisions of the first comparable file.
  useEffect(() => {
    if (relPath || candidates.length === 0) return;
    const first = candidates[0];
    if (!first) return;
    const revisions = first.revisions;
    const to = revisions[revisions.length - 1];
    const from = revisions[revisions.length - 2];
    if (from && to) pick(first.rel_path, from.id, to.id);
  }, [candidates, relPath, pick]);

  const field = 'h-7 w-full rounded border border-edge bg-canvas px-1 text-xs';

  return (
    <Panel>
      <PanelHeader
        title="Compare"
        actions={
          diff && (
            <>
              <IconButton
                label="Recompute"
                size="sm"
                disabled={busy}
                onClick={() => void run(true)}
              >
                <RefreshCw size={14} />
              </IconButton>
              <IconButton label="Export changes as CSV…" size="sm" onClick={() => void exportCsv()}>
                <Download size={14} />
              </IconButton>
            </>
          )
        }
      />
      <PanelBody className="p-0 text-xs">
        {!project ? (
          <p className="p-3 text-fg-muted">Open a project to compare revisions.</p>
        ) : candidates.length === 0 ? (
          <p className="p-3 text-fg-muted">
            Comparison needs a file with two or more revisions. Import an IFC file, then re-import
            it after it changes.
          </p>
        ) : (
          <>
            <div className="space-y-1.5 border-b border-edge px-3 py-2">
              <select
                className={field}
                value={relPath ?? ''}
                aria-label="File"
                onChange={(e) => {
                  const next = candidates.find((f) => f.rel_path === e.target.value);
                  if (!next) return;
                  const r = next.revisions;
                  const to = r[r.length - 1];
                  const from = r[r.length - 2];
                  if (from && to) pick(next.rel_path, from.id, to.id);
                }}
              >
                {candidates.map((f) => (
                  <option key={f.rel_path} value={f.rel_path}>
                    {f.rel_path}
                  </option>
                ))}
              </select>
              {file && (
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                  <select
                    className={field}
                    value={fromId ?? ''}
                    aria-label="From revision"
                    onChange={(e) => pick(file.rel_path, Number(e.target.value), toId ?? 0)}
                  >
                    {file.revisions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {revisionLabel(r)}
                      </option>
                    ))}
                  </select>
                  <GitCompareArrows size={14} className="text-fg-muted" />
                  <select
                    className={field}
                    value={toId ?? ''}
                    aria-label="To revision"
                    onChange={(e) => pick(file.rel_path, fromId ?? 0, Number(e.target.value))}
                  >
                    {file.revisions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {revisionLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Button
                variant="primary"
                size="sm"
                disabled={busy || fromId === null || toId === null || fromId === toId}
                onClick={() => void run()}
              >
                <GitCompareArrows size={12} />
                {busy ? 'Comparing…' : 'Compare'}
              </Button>
            </div>
            {diff && <Results />}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

function Results() {
  const diff = useCompare((s) => s.diff)!;
  const filter = useCompare((s) => s.filter);
  const setFilter = useCompare((s) => s.setFilter);
  const typeFilter = useCompare((s) => s.typeFilter);
  const setTypeFilter = useCompare((s) => s.setTypeFilter);
  const query = useCompare((s) => s.query);
  const setQuery = useCompare((s) => s.setQuery);
  const items = useMemo(
    () => visibleItems({ diff, filter, typeFilter, query }),
    [diff, filter, typeFilter, query],
  );
  const colorBy = useView((s) => s.colorBy);
  const setColorBy = useView((s) => s.setColorBy);
  const loadedRevision = useModel((s) => s.revision?.id ?? null);
  const s = diff.summary;

  const loadedHint =
    loadedRevision === diff.to_revision_id
      ? 'newer revision loaded: added and modified elements can be shown'
      : loadedRevision === diff.from_revision_id
        ? 'older revision loaded: removed elements can be shown'
        : 'load one of the two revisions to see changes in 3D';

  return (
    <div>
      <div className="border-b border-edge px-3 py-2">
        <div className="grid grid-cols-4 gap-1">
          {(
            [
              ['all', 'Changed', s.added + s.removed + s.modified],
              ['added', 'Added', s.added],
              ['removed', 'Removed', s.removed],
              ['modified', 'Modified', s.modified],
            ] as const
          ).map(([key, label, value]) => (
            <button
              key={key}
              type="button"
              className={cn(
                'rounded border px-1.5 py-1 text-left',
                filter === key ? 'border-accent' : 'border-edge hover:bg-surface-2',
              )}
              onClick={() => setFilter(key)}
            >
              <div className="flex items-center gap-1 font-mono text-sm">
                {key !== 'all' && (
                  <span className="h-2 w-2 rounded-sm" style={{ background: CHANGE_COLORS[key] }} />
                )}
                {value.toLocaleString()}
              </div>
              <div className="text-[10px] text-fg-muted">{label}</div>
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-fg-muted">
          <span>
            {s.unchanged.toLocaleString()} unchanged · {s.from_elements.toLocaleString()} →{' '}
            {s.to_elements.toLocaleString()} elements
            {diff.cached ? '' : ` · ${s.elapsed_ms} ms`}
          </span>
          <button
            type="button"
            className={cn(
              'flex items-center gap-1 rounded border px-1.5 py-0.5',
              colorBy === 'change' ? 'border-accent text-fg' : 'border-edge hover:bg-surface-2',
            )}
            onClick={() => setColorBy(colorBy === 'change' ? 'none' : 'change')}
            title="Colour the loaded model by change"
          >
            <Palette size={11} />
            by change
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-fg-muted">
          <span>{loadedHint}</span>
          <LoadButtons />
        </div>
      </div>

      <ByType />

      <div className="flex items-center gap-1 px-3 py-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name, type, storey, GlobalId…"
          aria-label="Filter changes"
          className="h-6 w-full rounded border border-edge bg-canvas px-1.5 text-xs outline-none placeholder:text-fg-muted focus:border-accent"
        />
        {typeFilter && (
          <button
            type="button"
            className="shrink-0 rounded border border-accent px-1.5 py-0.5 text-[10px]"
            onClick={() => setTypeFilter(null)}
            title="Clear type filter"
          >
            {typeFilter.replace(/^IFC/, '')} ×
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="px-3 pb-3 text-fg-muted">No changes match.</p>
      ) : (
        <ul>
          {items.slice(0, 500).map((item) => (
            <ItemRow key={`${item.change}-${item.global_id}`} item={item} />
          ))}
          {items.length > 500 && (
            <li className="px-3 py-2 text-[10px] text-fg-muted">
              Showing 500 of {items.length.toLocaleString()}; narrow the filter or export CSV.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Loads the older or newer revision into the viewer so its changes can be shown. */
function LoadButtons() {
  const diff = useCompare((s) => s.diff)!;
  const relPath = useCompare((s) => s.relPath);
  const files = useProject((s) => s.files);
  const load = useModel((s) => s.load);
  const loading = useModel((s) => s.loading);
  const loadedRevision = useModel((s) => s.revision?.id ?? null);
  const file = files.find((f) => f.rel_path === relPath);
  if (!file) return null;
  const from = file.revisions.find((r) => r.id === diff.from_revision_id);
  const to = file.revisions.find((r) => r.id === diff.to_revision_id);
  return (
    <span className="flex shrink-0 gap-1">
      {[from, to].map(
        (revision) =>
          revision && (
            <button
              key={revision.id}
              type="button"
              disabled={loading || loadedRevision === revision.id}
              className="rounded border border-edge px-1.5 py-0.5 hover:bg-surface-2 disabled:opacity-50"
              onClick={() => void load(file.rel_path, revision)}
              title={`Load revision  in the viewer`}
            >
              load rev {revision.idx}
            </button>
          ),
      )}
    </span>
  );
}

function ByType() {
  const diff = useCompare((s) => s.diff)!;
  const typeFilter = useCompare((s) => s.typeFilter);
  const setTypeFilter = useCompare((s) => s.setTypeFilter);
  const [open, setOpen] = useState(false);
  const rows = Object.entries(diff.summary.by_type).sort(
    ([, a], [, b]) => b[0] + b[1] + b[2] - (a[0] + a[1] + a[2]),
  );
  if (rows.length === 0) return null;
  return (
    <div className="border-b border-edge px-3 py-1.5">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        By type
      </button>
      {open && (
        <table className="mt-1 w-full text-[11px]">
          <thead className="text-[10px] text-fg-muted">
            <tr>
              <th className="text-left font-normal">Type</th>
              <th className="text-right font-normal">+</th>
              <th className="text-right font-normal">−</th>
              <th className="text-right font-normal">~</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([type, [added, removed, modified]]) => (
              <tr
                key={type}
                className={cn(
                  'cursor-pointer hover:bg-surface-2',
                  typeFilter === type && 'bg-surface-3',
                )}
                onClick={() => setTypeFilter(typeFilter === type ? null : type)}
              >
                <td className="truncate py-0.5">{type.replace(/^IFC/, '')}</td>
                <td className="text-right font-mono" style={{ color: CHANGE_COLORS.added }}>
                  {added || ''}
                </td>
                <td className="text-right font-mono" style={{ color: CHANGE_COLORS.removed }}>
                  {removed || ''}
                </td>
                <td className="text-right font-mono" style={{ color: CHANGE_COLORS.modified }}>
                  {modified || ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ItemRow({ item }: { item: DiffItem }) {
  const [open, setOpen] = useState(false);
  const focus = useCompare((s) => s.focus);
  const createIssue = useReview((s) => s.createIssue);
  const setSection = useUi((s) => s.setSection);
  const inModel = useModel((s) => s.byGlobalId.has(item.global_id));
  const label = item.detail.name || item.global_id;

  const raiseIssue = () => {
    focus(item);
    const summary =
      item.change === 'modified'
        ? item.detail.changes
            .slice(0, 3)
            .map((c) => `${c.field}: ${c.from ?? '—'} → ${c.to ?? '—'}`)
            .join('; ')
        : `${item.change} in the new revision`;
    void createIssue(
      {
        title: `${label} ${item.change}`,
        description: summary,
        priority: '',
        assignee: '',
        due: '',
        labels: 'revision change',
      },
      inModel,
    ).then((created) => {
      if (created) setSection('review');
    });
  };

  return (
    <li className="border-t border-edge">
      <div className="flex items-start gap-1.5 px-3 py-1.5">
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-sm"
          style={{ background: CHANGE_COLORS[item.change] }}
          title={item.change}
        />
        <button
          type="button"
          className="min-w-0 flex-1 text-left hover:text-fg"
          onClick={() => (item.change === 'modified' ? setOpen(!open) : focus(item))}
          onDoubleClick={() => focus(item)}
          title={`${item.detail.ifc_type} · ${item.global_id}`}
        >
          <div className="truncate">{label}</div>
          <div className="truncate text-[10px] text-fg-muted">
            {item.detail.ifc_type.replace(/^IFC/, '')}
            {item.detail.storey && ` · ${item.detail.storey}`}
            {item.change === 'modified' && ` · ${item.detail.changes.length} change(s)`}
          </div>
        </button>
        <button
          type="button"
          className="shrink-0 rounded border border-edge px-1 py-0.5 text-[10px] text-fg-muted hover:bg-surface-2 hover:text-fg"
          onClick={raiseIssue}
          title="Create an issue for this change"
        >
          issue
        </button>
      </div>
      {open && item.detail.changes.length > 0 && (
        <ul className="mb-1.5 ml-7 mr-3 space-y-0.5 rounded border border-edge bg-canvas px-2 py-1 text-[10px]">
          {item.detail.changes.map((change) => (
            <li key={change.field} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2">
              <span className="truncate text-fg-muted" title={change.field}>
                {change.field}
              </span>
              <span className="font-mono">
                <span className="text-fg-muted line-through">{change.from ?? '—'}</span>{' '}
                <span>{change.to ?? '—'}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export type { ChangeKind };
