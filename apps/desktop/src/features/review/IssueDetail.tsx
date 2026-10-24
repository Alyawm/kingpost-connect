import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Camera, Crosshair, Trash2 } from 'lucide-react';
import { Button, IconButton, cn } from '@kingpost/ui';
import { useReview } from '../../state/review';
import { useModel } from '../../state/model';
import { formatIsoDate } from '../../lib/format';
import type { ViewpointRow } from '../../lib/ipc';
import { PriorityDot } from './ReviewPanel';
import { ISSUE_STATUSES, PRIORITIES } from './issues';

const field =
  'h-7 w-full rounded border border-edge bg-canvas px-2 outline-none placeholder:text-fg-muted focus:border-accent';

export function IssueDetail() {
  const details = useReview((s) => s.details);
  const openIssue = useReview((s) => s.openIssue);
  const updateIssue = useReview((s) => s.updateIssue);
  const deleteIssue = useReview((s) => s.deleteIssue);
  const addViewpoint = useReview((s) => s.addViewpoint);
  const selectIssueElements = useReview((s) => s.selectIssueElements);
  const hasModel = useModel((s) => !!s.model);
  const [description, setDescription] = useState('');

  useEffect(() => {
    setDescription(details?.issue.description ?? '');
  }, [details?.issue.id, details?.issue.description]);

  if (!details) {
    return (
      <div className="p-3 text-xs">
        <Button size="sm" variant="ghost" onClick={() => void openIssue(null)}>
          <ArrowLeft size={12} /> Back
        </Button>
        <p className="mt-2 text-fg-muted">Loading…</p>
      </div>
    );
  }
  const { issue } = details;
  const patch = (p: Parameters<typeof updateIssue>[1]) => void updateIssue(issue.id, p);

  return (
    <div className="text-xs">
      <div className="flex items-center gap-1 border-b border-edge px-2 py-1.5">
        <IconButton label="Back to issues" size="sm" onClick={() => void openIssue(null)}>
          <ArrowLeft size={14} />
        </IconButton>
        <span className="font-mono text-[10px] text-fg-muted">#{issue.idx ?? '·'}</span>
        <PriorityDot priority={issue.priority} />
        <span className="min-w-0 flex-1 truncate font-semibold" title={issue.title}>
          {issue.title}
        </span>
        <IconButton
          label="Delete issue"
          size="sm"
          onClick={() => {
            if (window.confirm(`Delete issue "${issue.title}"?`)) void deleteIssue(issue.id);
          }}
        >
          <Trash2 size={14} />
        </IconButton>
      </div>

      <div className="grid grid-cols-2 gap-1.5 border-b border-edge px-3 py-2">
        <label className="space-y-0.5">
          <span className="text-[10px] text-fg-muted">Status</span>
          <select
            value={issue.status}
            onChange={(e) => patch({ status: e.target.value })}
            className={field}
            aria-label="Status"
          >
            {[...new Set([issue.status, ...ISSUE_STATUSES])].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-0.5">
          <span className="text-[10px] text-fg-muted">Priority</span>
          <select
            value={issue.priority ?? ''}
            onChange={(e) => patch({ priority: e.target.value || null })}
            className={field}
            aria-label="Priority"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p || '—'}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-0.5">
          <span className="text-[10px] text-fg-muted">Assigned to</span>
          <input
            defaultValue={issue.assignee ?? ''}
            key={`${issue.id}-assignee`}
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (value !== (issue.assignee ?? '')) patch({ assignee: value || null });
            }}
            className={field}
            aria-label="Assigned to"
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-[10px] text-fg-muted">Due</span>
          <input
            type="date"
            value={issue.due ? issue.due.slice(0, 10) : ''}
            onChange={(e) =>
              patch({ due: e.target.value ? new Date(e.target.value).toISOString() : null })
            }
            className={field}
            aria-label="Due date"
          />
        </label>
      </div>

      <div className="border-b border-edge px-3 py-2">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (description.trim() !== (issue.description ?? ''))
              patch({ description: description.trim() || null });
          }}
          placeholder="Description"
          rows={3}
          className="w-full rounded border border-edge bg-canvas px-2 py-1 outline-none placeholder:text-fg-muted focus:border-accent"
        />
        {issue.labels.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {issue.labels.map((label) => (
              <span key={label} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px]">
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-fg-muted">
          {details.elements.length} linked element{details.elements.length === 1 ? '' : 's'}
        </span>
        <Button
          size="sm"
          disabled={!hasModel || !details.elements.length}
          onClick={() => selectIssueElements(details)}
        >
          <Crosshair size={12} />
          Select in 3D
        </Button>
      </div>

      <div className="border-b border-edge px-3 py-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-semibold text-fg-muted">Viewpoints</span>
          <Button size="sm" disabled={!hasModel} onClick={() => void addViewpoint(issue.id)}>
            <Camera size={12} />
            Add current view
          </Button>
        </div>
        {details.viewpoints.length === 0 ? (
          <p className="text-fg-muted">None yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-1.5">
            {details.viewpoints.map((viewpoint, index) => (
              <ViewpointCard key={viewpoint.id} viewpoint={viewpoint} index={index} />
            ))}
          </ul>
        )}
      </div>

      <Comments />

      <p className="px-3 py-2 text-[10px] text-fg-muted">
        Created by {issue.created_by} on {formatIsoDate(issue.created_at)}
        {issue.modified_at && ` · modified ${formatIsoDate(issue.modified_at)}`}
        {issue.modified_by && ` by ${issue.modified_by}`}
      </p>
    </div>
  );
}

function ViewpointCard({ viewpoint, index }: { viewpoint: ViewpointRow; index: number }) {
  const snapshot = useReview((s) => s.snapshots.get(viewpoint.id));
  const loadSnapshot = useReview((s) => s.loadSnapshot);
  const applyViewpoint = useReview((s) => s.applyViewpoint);
  const hasModel = useModel((s) => !!s.model);

  useEffect(() => {
    if (viewpoint.has_snapshot) void loadSnapshot(viewpoint.id);
  }, [viewpoint.id, viewpoint.has_snapshot, loadSnapshot]);

  return (
    <li>
      <button
        type="button"
        disabled={!hasModel}
        className={cn(
          'w-full overflow-hidden rounded-md border border-edge bg-canvas text-left',
          'hover:border-accent disabled:opacity-60',
        )}
        onClick={() => applyViewpoint(viewpoint)}
        title={hasModel ? 'Apply this viewpoint' : 'Load the model to apply viewpoints'}
      >
        {snapshot ? (
          <img src={snapshot} alt="" className="aspect-[16/10] w-full object-cover" />
        ) : (
          <div className="aspect-[16/10] w-full bg-surface-2" />
        )}
        <div className="px-1.5 py-1 text-[10px] text-fg-muted">
          Viewpoint {index + 1} · {formatIsoDate(viewpoint.created_at).split(',')[0]}
        </div>
      </button>
    </li>
  );
}

function Comments() {
  const details = useReview((s) => s.details);
  const addComment = useReview((s) => s.addComment);
  const applyViewpoint = useReview((s) => s.applyViewpoint);
  const hasModel = useModel((s) => !!s.model);
  const [text, setText] = useState('');
  const [withViewpoint, setWithViewpoint] = useState(false);
  if (!details) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    void addComment(details.issue.id, text, withViewpoint && hasModel).then(() => setText(''));
  };

  return (
    <div className="border-b border-edge px-3 py-2">
      <div className="mb-1 font-semibold text-fg-muted">Comments</div>
      {details.comments.length === 0 ? (
        <p className="text-fg-muted">No comments yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {details.comments.map((comment) => {
            const viewpoint = details.viewpoints.find((v) => v.id === comment.viewpoint_id);
            return (
              <li key={comment.id} className="rounded border border-edge bg-canvas px-2 py-1">
                <div className="text-[10px] text-fg-muted">
                  {comment.author} · {formatIsoDate(comment.created_at)}
                </div>
                <div className="whitespace-pre-wrap">{comment.text}</div>
                {viewpoint && (
                  <button
                    type="button"
                    className="mt-0.5 text-[10px] text-accent hover:underline disabled:opacity-60"
                    disabled={!hasModel}
                    onClick={() => applyViewpoint(viewpoint)}
                  >
                    Show viewpoint
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form className="mt-1.5 space-y-1" onSubmit={submit}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment"
          aria-label="New comment"
          rows={2}
          className="w-full rounded border border-edge bg-canvas px-2 py-1 outline-none placeholder:text-fg-muted focus:border-accent"
        />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-fg-muted">
            <input
              type="checkbox"
              checked={withViewpoint && hasModel}
              disabled={!hasModel}
              onChange={(e) => setWithViewpoint(e.target.checked)}
            />
            with viewpoint
          </label>
          <Button size="sm" type="submit" className="ml-auto" disabled={!text.trim()}>
            Comment
          </Button>
        </div>
      </form>
    </div>
  );
}
