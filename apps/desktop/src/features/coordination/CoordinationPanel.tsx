import { useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  ClipboardPlus,
  Play,
  Square,
  Trash2,
} from 'lucide-react';
import { Button, IconButton, Panel, PanelBody, PanelHeader, cn } from '@kingpost/ui';
import {
  STATUS_COLORS,
  clashLabel,
  filterClashes,
  groupByTypes,
  useClash,
  type ClashFilter,
} from '../../state/clash';
import { useModel } from '../../state/model';
import { useProject } from '../../state/project';
import { CLASH_STATUSES, type ClashKind, type ClashRow } from '../../lib/ipc';

const subtle = 'text-[10px] text-fg-muted';
const field = 'h-6 w-full rounded border border-edge bg-canvas px-1 text-xs';

export function CoordinationPanel() {
  const project = useProject((s) => s.current);
  const tests = useClash((s) => s.tests);
  const refresh = useClash((s) => s.refresh);
  const selectedTestId = useClash((s) => s.selectedTestId);
  const selectTest = useClash((s) => s.selectTest);
  const deleteTest = useClash((s) => s.deleteTest);
  const run = useClash((s) => s.run);
  const cancel = useClash((s) => s.cancel);
  const running = useClash((s) => s.running);
  const progress = useClash((s) => s.progress);
  const hasModel = useModel((s) => s.model !== null);

  useEffect(() => {
    if (project) void refresh();
  }, [project, refresh]);

  return (
    <Panel>
      <PanelHeader title="Coordination" />
      <PanelBody className="p-0 text-xs">
        {!project ? (
          <p className="p-3 text-fg-muted">Open a project to run clash tests.</p>
        ) : (
          <>
            <NewTest />
            <div className="border-b border-edge px-3 py-2">
              <div className="mb-1 font-semibold text-fg-muted">Tests</div>
              {tests.length === 0 && <p className={subtle}>No clash tests yet.</p>}
              <ul className="space-y-1">
                {tests.map((t) => (
                  <li
                    key={t.id}
                    className={cn(
                      'flex items-center gap-1 rounded border p-1',
                      selectedTestId === t.id ? 'border-accent' : 'border-edge',
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => void selectTest(t.id)}
                    >
                      <div className="flex items-center gap-1">
                        <Boxes size={11} className="shrink-0 text-fg-muted" />
                        <span className="truncate font-semibold">{t.name}</span>
                      </div>
                      <div className={subtle}>
                        {t.kind === 'hard'
                          ? 'hard contact'
                          : `clearance ${(t.clearance * 1000).toFixed(0)} mm`}{' '}
                        · {t.set_a.length} × {t.set_b.length}
                        {t.last_run_at
                          ? ` · ${t.open_count} open of ${t.total_count}`
                          : ' · not run'}
                      </div>
                    </button>
                    {running && selectedTestId === t.id ? (
                      <IconButton label="Cancel" size="sm" onClick={cancel}>
                        <Square size={12} />
                      </IconButton>
                    ) : (
                      <IconButton
                        label={
                          hasModel ? 'Run on the loaded revision' : 'Load a model revision first'
                        }
                        size="sm"
                        disabled={!hasModel || running}
                        onClick={() => void run(t.id)}
                      >
                        <Play size={12} />
                      </IconButton>
                    )}
                    <IconButton label="Delete test" size="sm" onClick={() => void deleteTest(t.id)}>
                      <Trash2 size={12} />
                    </IconButton>
                  </li>
                ))}
              </ul>
              {progress && (
                <div className="mt-1">
                  <div className="h-1 w-full rounded bg-surface-2">
                    <div
                      className="h-1 rounded bg-accent"
                      style={{
                        width: `${progress.total ? (100 * progress.done) / progress.total : 0}%`,
                      }}
                    />
                  </div>
                  <div className={subtle}>
                    {progress.done.toLocaleString()} of {progress.total.toLocaleString()} pairs ·{' '}
                    {progress.found} found
                  </div>
                </div>
              )}
            </div>
            {selectedTestId && <Results />}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

function NewTest() {
  const setA = useClash((s) => s.setA);
  const setB = useClash((s) => s.setB);
  const captureSet = useClash((s) => s.captureSet);
  const captureRestAsB = useClash((s) => s.captureRestAsB);
  const createTest = useClash((s) => s.createTest);
  const selectedCount = useModel((s) => s.selectedIds.size);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ClashKind>('hard');
  const [clearance, setClearance] = useState('50');
  const [open, setOpen] = useState(true);

  return (
    <div className="border-b border-edge px-3 py-2">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        New test
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          <input
            className={field}
            value={name}
            placeholder="Name, e.g. Beams vs columns"
            aria-label="Test name"
            onChange={(e) => setName(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              className="rounded border border-edge px-1.5 py-0.5 text-left hover:bg-surface-2 disabled:opacity-50"
              disabled={selectedCount === 0}
              onClick={() => captureSet('a')}
              title="Use the current selection as set A"
            >
              Set A ← selection
              <div className={subtle}>{setA.length ? `${setA.length} element(s)` : 'empty'}</div>
            </button>
            <button
              type="button"
              className="rounded border border-edge px-1.5 py-0.5 text-left hover:bg-surface-2 disabled:opacity-50"
              disabled={selectedCount === 0}
              onClick={() => captureSet('b')}
              title="Use the current selection as set B"
            >
              Set B ← selection
              <div className={subtle}>{setB.length ? `${setB.length} element(s)` : 'empty'}</div>
            </button>
          </div>
          <button
            type="button"
            className={cn(subtle, 'underline')}
            disabled={setA.length === 0}
            onClick={captureRestAsB}
          >
            or set B = everything else with geometry
          </button>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
            <span className={subtle}>Rule</span>
            <div className="flex gap-1">
              {(['hard', 'clearance'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={cn(
                    'rounded border px-1.5 py-0.5 text-[10px]',
                    kind === k ? 'border-accent text-fg' : 'border-edge text-fg-muted',
                  )}
                  onClick={() => setKind(k)}
                >
                  {k === 'hard' ? 'hard contact' : 'clearance'}
                </button>
              ))}
            </div>
            {kind === 'clearance' && (
              <>
                <label className={subtle} htmlFor="kp-clearance">
                  Gap (mm)
                </label>
                <input
                  id="kp-clearance"
                  type="number"
                  min="1"
                  step="10"
                  className={field}
                  value={clearance}
                  onChange={(e) => setClearance(e.target.value)}
                />
              </>
            )}
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={!name.trim() || setA.length === 0 || setB.length === 0}
            onClick={() => {
              void createTest(name.trim(), kind, (Number(clearance) || 0) / 1000);
              setName('');
            }}
          >
            Create test
          </Button>
        </div>
      )}
    </div>
  );
}

function Results() {
  const clashes = useClash((s) => s.clashes);
  const filter = useClash((s) => s.filter);
  const setFilter = useClash((s) => s.setFilter);
  const byGlobalId = useModel((s) => s.byGlobalId);
  const byId = useModel((s) => s.byId);
  const visible = useMemo(() => filterClashes(clashes, filter), [clashes, filter]);
  const groups = useMemo(
    () => groupByTypes(visible, byGlobalId, byId),
    [visible, byGlobalId, byId],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const x of clashes) c[x.status] = (c[x.status] ?? 0) + 1;
    return c;
  }, [clashes]);

  return (
    <div>
      <div className="border-b border-edge px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {(['open', 'all', ...CLASH_STATUSES] as ClashFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={cn(
                'flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]',
                filter === f ? 'border-accent text-fg' : 'border-edge text-fg-muted',
              )}
              onClick={() => setFilter(f)}
            >
              {f !== 'open' && f !== 'all' && (
                <span className="h-2 w-2 rounded-sm" style={{ background: STATUS_COLORS[f] }} />
              )}
              {f}{' '}
              {f === 'all'
                ? clashes.length
                : f === 'open'
                  ? filterClashes(clashes, 'open').length
                  : (counts[f] ?? 0)}
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="px-3 py-2 text-fg-muted">
          {clashes.length === 0 ? 'Run the test to find clashes.' : 'No clashes match the filter.'}
        </p>
      ) : (
        groups.map(([key, list]) => <Group key={key} title={key} clashes={list} />)
      )}
    </div>
  );
}

function Group({ title, clashes }: { title: string; clashes: ClashRow[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-edge">
      <button
        type="button"
        className="flex w-full items-center gap-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title} <span className="font-normal normal-case">({clashes.length})</span>
      </button>
      {open && (
        <ul>
          {clashes.slice(0, 300).map((c) => (
            <ClashItem key={c.id} clash={c} />
          ))}
          {clashes.length > 300 && (
            <li className={cn(subtle, 'px-3 py-1')}>Showing 300 of {clashes.length}.</li>
          )}
        </ul>
      )}
    </div>
  );
}

function ClashItem({ clash }: { clash: ClashRow }) {
  const focus = useClash((s) => s.focus);
  const setStatus = useClash((s) => s.setStatus);
  const createIssue = useClash((s) => s.createIssue);
  const selectedClashId = useClash((s) => s.selectedClashId);
  const byGlobalId = useModel((s) => s.byGlobalId);
  const byId = useModel((s) => s.byId);
  const selected = selectedClashId === clash.id;
  return (
    <li className={cn('border-t border-edge px-3 py-1.5', selected && 'bg-surface-3')}>
      <div className="flex items-start gap-1.5">
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-sm"
          style={{ background: STATUS_COLORS[clash.status] }}
          title={clash.status}
        />
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => focus(clash)}
          title="Select both elements and frame the clash"
        >
          <div className="truncate">{clashLabel(clash, byGlobalId, byId)}</div>
          <div className={cn(subtle, 'truncate')}>
            {clash.kind === 'hard'
              ? 'hard contact'
              : `gap ${(clash.distance * 1000).toFixed(0)} mm`}{' '}
            · {clash.status}
            {clash.note && ` · ${clash.note}`}
          </div>
        </button>
        <IconButton
          label="Raise an issue on this clash"
          size="sm"
          onClick={() => void createIssue(clash)}
        >
          <ClipboardPlus size={12} />
        </IconButton>
      </div>
      {selected && (
        <div className="mt-1 flex flex-wrap gap-1">
          {CLASH_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={cn(
                'rounded border px-1.5 py-0.5 text-[10px]',
                clash.status === s
                  ? 'border-accent text-fg'
                  : 'border-edge text-fg-muted hover:bg-surface-2',
              )}
              onClick={() => void setStatus(clash.id, s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
