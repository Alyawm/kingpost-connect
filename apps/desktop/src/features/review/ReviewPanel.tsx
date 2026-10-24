import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Download, Palette, Plus, Upload } from 'lucide-react';
import { Button, IconButton, Panel, PanelBody, PanelHeader, cn } from '@kingpost/ui';
import { useReview, type NewIssueForm } from '../../state/review';
import { useModel } from '../../state/model';
import { useProject } from '../../state/project';
import { useUi } from '../../state/ui';
import { STAGES, STAGE_COLORS, useView, type Stage } from '../../state/view';
import { formatIsoDate } from '../../lib/format';
import { IssueDetail } from './IssueDetail';
import { PRIORITIES, isOpen, isOverdue } from './issues';

const emptyForm: NewIssueForm = {
  title: '',
  description: '',
  priority: '',
  assignee: '',
  due: '',
  labels: '',
};

export function ReviewPanel() {
  const project = useProject((s) => s.current);
  const selectedIssueId = useReview((s) => s.selectedIssueId);
  const refresh = useReview((s) => s.refresh);
  const exportBcf = useReview((s) => s.exportBcf);
  const importBcf = useReview((s) => s.importBcf);

  useEffect(() => {
    void refresh();
  }, [refresh, project]);

  return (
    <Panel>
      <PanelHeader
        title="Review"
        actions={
          project && (
            <>
              <IconButton label="Import BCF…" size="sm" onClick={() => void importBcf()}>
                <Upload size={14} />
              </IconButton>
              <IconButton label="Export issues as BCF…" size="sm" onClick={() => void exportBcf()}>
                <Download size={14} />
              </IconButton>
            </>
          )
        }
      />
      <PanelBody className="p-0">
        {!project ? (
          <p className="p-3 text-xs text-fg-muted">Open a project to review it.</p>
        ) : selectedIssueId ? (
          <IssueDetail />
        ) : (
          <Overview />
        )}
      </PanelBody>
    </Panel>
  );
}

function Overview() {
  const author = useUi((s) => s.author);
  const setAuthor = useUi((s) => s.setAuthor);
  return (
    <div className="text-xs">
      <label className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <span className="shrink-0 text-fg-muted">Your name</span>
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="recorded on issues and statuses"
          className="h-7 min-w-0 flex-1 rounded border border-edge bg-canvas px-2 outline-none placeholder:text-fg-muted focus:border-accent"
        />
      </label>
      <Dashboard />
      <StatusPipeline />
      <NewIssue />
      <IssueList />
    </div>
  );
}

function Dashboard() {
  const issues = useReview((s) => s.issues);
  const statuses = useReview((s) => s.statuses);
  const elements = useModel((s) => s.elements);
  const setColorBy = useView((s) => s.setColorBy);
  const colorBy = useView((s) => s.colorBy);

  const summary = useMemo(() => {
    const open = issues.filter(isOpen).length;
    const overdue = issues.filter((i) => isOverdue(i)).length;
    const counts = new Map<string, number>();
    const products = elements.filter((e) => !e.is_spatial && e.has_geometry);
    for (const e of products) {
      const stage = statuses.get(e.global_id)?.stage ?? 'none';
      counts.set(stage, (counts.get(stage) ?? 0) + 1);
    }
    return { open, closed: issues.length - open, overdue, counts, total: products.length };
  }, [issues, statuses, elements]);

  return (
    <div className="space-y-2 border-b border-edge px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-fg-muted">Dashboard</span>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 rounded border px-1.5 py-0.5',
            colorBy === 'status'
              ? 'border-accent text-fg'
              : 'border-edge text-fg-muted hover:bg-surface-2',
          )}
          onClick={() => setColorBy(colorBy === 'status' ? 'none' : 'status')}
          title="Colour the model by design status"
        >
          <Palette size={12} />
          by status
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        <Stat label="Open" value={summary.open} />
        <Stat label="Closed" value={summary.closed} />
        <Stat
          label="Overdue"
          value={summary.overdue}
          tone={summary.overdue ? 'danger' : undefined}
        />
      </div>
      {summary.total > 0 && (
        <div>
          <div
            className="mb-1 flex h-2 overflow-hidden rounded bg-surface-3"
            title="Design status coverage"
          >
            {STAGES.map((stage) => {
              const n = summary.counts.get(stage) ?? 0;
              return n ? (
                <div
                  key={stage}
                  style={{
                    width: `${(n / summary.total) * 100}%`,
                    background: STAGE_COLORS[stage],
                  }}
                  title={`${stage}: ${n}`}
                />
              ) : null;
            })}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-fg-muted">
            {STAGES.map((stage) => (
              <span key={stage} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm" style={{ background: STAGE_COLORS[stage] }} />
                {stage} {summary.counts.get(stage) ?? 0}
              </span>
            ))}
            <span>not set {summary.counts.get('none') ?? 0}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className="rounded border border-edge bg-canvas px-2 py-1">
      <div className={cn('font-mono text-sm', tone === 'danger' && 'text-danger')}>{value}</div>
      <div className="text-[10px] text-fg-muted">{label}</div>
    </div>
  );
}

function StatusPipeline() {
  const count = useModel((s) => s.selectedIds.size);
  const setStage = useReview((s) => s.setStageOfSelection);
  const clearStage = useReview((s) => s.clearStageOfSelection);
  return (
    <div className="border-b border-edge px-3 py-2">
      <div className="mb-1 font-semibold text-fg-muted">
        Design status{count ? ` · ${count} selected` : ''}
      </div>
      <div className="flex flex-wrap gap-1">
        {STAGES.map((stage) => (
          <button
            key={stage}
            type="button"
            disabled={!count}
            className="flex items-center gap-1 rounded border border-edge px-1.5 py-0.5 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
            onClick={() => void setStage(stage as Stage)}
            title={`Set the selected elements to ${stage}`}
          >
            <span className="h-2 w-2 rounded-sm" style={{ background: STAGE_COLORS[stage] }} />
            {stage}
          </button>
        ))}
        <button
          type="button"
          disabled={!count}
          className="rounded border border-edge px-1.5 py-0.5 text-fg-muted hover:bg-surface-2 disabled:opacity-40"
          onClick={() => void clearStage()}
        >
          clear
        </button>
      </div>
      {!count && (
        <p className="mt-1 text-[11px] text-fg-muted">
          Select elements (click, Ctrl+click, or the model tree) to set their status.
        </p>
      )}
    </div>
  );
}

function NewIssue() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<NewIssueForm>(emptyForm);
  const [withViewpoint, setWithViewpoint] = useState(true);
  const busy = useReview((s) => s.busy);
  const createIssue = useReview((s) => s.createIssue);
  const selected = useModel((s) => s.selectedIds.size);
  const hasModel = useModel((s) => !!s.model);

  const update = (patch: Partial<NewIssueForm>) => setForm((f) => ({ ...f, ...patch }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    void createIssue(form, withViewpoint && hasModel).then((created) => {
      if (created) {
        setForm(emptyForm);
        setOpen(false);
      }
    });
  };

  if (!open) {
    return (
      <div className="border-b border-edge px-3 py-2">
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          <Plus size={12} />
          New issue{selected ? ` on ${selected} element${selected === 1 ? '' : 's'}` : ''}
        </Button>
      </div>
    );
  }

  const field =
    'h-7 w-full rounded border border-edge bg-canvas px-2 outline-none placeholder:text-fg-muted focus:border-accent';
  return (
    <form className="space-y-1.5 border-b border-edge px-3 py-2" onSubmit={submit}>
      <input
        autoFocus
        value={form.title}
        onChange={(e) => update({ title: e.target.value })}
        placeholder="Title"
        aria-label="Issue title"
        className={field}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <select
          value={form.priority}
          onChange={(e) => update({ priority: e.target.value })}
          aria-label="Priority"
          className={field}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p || 'priority…'}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={form.due}
          onChange={(e) => update({ due: e.target.value })}
          aria-label="Due date"
          className={field}
        />
      </div>
      <input
        value={form.assignee}
        onChange={(e) => update({ assignee: e.target.value })}
        placeholder="Assigned to"
        aria-label="Assigned to"
        className={field}
      />
      <input
        value={form.labels}
        onChange={(e) => update({ labels: e.target.value })}
        placeholder="Labels, comma separated"
        aria-label="Labels"
        className={field}
      />
      <textarea
        value={form.description}
        onChange={(e) => update({ description: e.target.value })}
        placeholder="Description"
        aria-label="Description"
        rows={3}
        className="w-full rounded border border-edge bg-canvas px-2 py-1 outline-none placeholder:text-fg-muted focus:border-accent"
      />
      <label className="flex items-center gap-1.5 text-fg-muted">
        <input
          type="checkbox"
          checked={withViewpoint && hasModel}
          disabled={!hasModel}
          onChange={(e) => setWithViewpoint(e.target.checked)}
        />
        Attach current view as viewpoint
        {selected ? ` and link ${selected} selected element(s)` : ''}
      </label>
      <div className="flex gap-1.5">
        <Button variant="primary" size="sm" type="submit" disabled={busy || !form.title.trim()}>
          Create
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function IssueList() {
  const issues = useReview((s) => s.issues);
  const openIssue = useReview((s) => s.openIssue);
  const [filter, setFilter] = useState<'open' | 'all' | 'closed'>('open');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return issues.filter((issue) => {
      if (filter === 'open' && !isOpen(issue)) return false;
      if (filter === 'closed' && isOpen(issue)) return false;
      if (!needle) return true;
      return [issue.title, issue.assignee, issue.description, ...issue.labels]
        .filter((v): v is string => !!v)
        .some((v) => v.toLowerCase().includes(needle));
    });
  }, [issues, filter, query]);

  return (
    <div>
      <div className="flex items-center gap-1 px-3 py-2">
        {(['open', 'all', 'closed'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={cn(
              'rounded border px-1.5 py-0.5',
              filter === f
                ? 'border-accent text-fg'
                : 'border-edge text-fg-muted hover:bg-surface-2',
            )}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          aria-label="Search issues"
          className="ml-auto h-6 w-28 rounded border border-edge bg-canvas px-1.5 outline-none placeholder:text-fg-muted focus:border-accent"
        />
      </div>
      {visible.length === 0 ? (
        <p className="px-3 pb-3 text-fg-muted">
          No issues{filter !== 'all' ? ` (${filter})` : ''}.
        </p>
      ) : (
        <ul>
          {visible.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                className="flex w-full flex-col gap-0.5 border-t border-edge px-3 py-1.5 text-left hover:bg-surface-2"
                onClick={() => void openIssue(issue.id)}
              >
                <span className="flex items-center gap-1.5">
                  <PriorityDot priority={issue.priority} />
                  <span className="font-mono text-[10px] text-fg-muted">#{issue.idx ?? '·'}</span>
                  <span className={cn('truncate', !isOpen(issue) && 'text-fg-muted line-through')}>
                    {issue.title}
                  </span>
                </span>
                <span className="flex gap-2 text-[10px] text-fg-muted">
                  <span>{issue.status}</span>
                  {issue.assignee && <span>→ {issue.assignee}</span>}
                  {issue.due && (
                    <span className={cn(isOverdue(issue) && 'text-danger')}>
                      due {formatIsoDate(issue.due).split(',')[0]}
                    </span>
                  )}
                  <span className="ml-auto">
                    {issue.element_count ? `${issue.element_count} el · ` : ''}
                    {issue.comment_count} c · {issue.viewpoint_count} vp
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PriorityDot({ priority }: { priority: string | null }) {
  const color =
    priority === 'critical'
      ? 'var(--kp-danger)'
      : priority === 'high'
        ? 'var(--kp-warning)'
        : priority === 'low'
          ? 'var(--kp-fg-muted)'
          : 'var(--kp-accent)';
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ background: color }}
      title={priority ?? 'normal'}
    />
  );
}
