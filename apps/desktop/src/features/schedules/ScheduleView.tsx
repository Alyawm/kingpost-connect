import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, X } from 'lucide-react';
import { IconButton, cn } from '@kingpost/ui';
import type { ScheduleRow } from '../../lib/ipc';
import { useSchedules } from '../../state/schedules';
import { useUi } from '../../state/ui';

const ROW_HEIGHT = 26;

/**
 * The evaluated schedule in the workspace: a virtualised grid with collapsible group rows,
 * subtotals and a total row; clicking a row selects its elements in the model.
 */
export function ScheduleView() {
  const table = useSchedules((s) => s.table);
  const definition = useSchedules((s) => s.definition);
  const evaluating = useSchedules((s) => s.evaluating);
  const setDefinition = useSchedules((s) => s.setDefinition);
  const run = useSchedules((s) => s.run);
  const selectRow = useSchedules((s) => s.selectRow);
  const exportTable = useSchedules((s) => s.exportTable);
  const setWorkspace = useUi((s) => s.setWorkspace);
  const host = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  // Rows hidden under a collapsed group are dropped from the visible list.
  const visible = useMemo(() => {
    if (!table) return [];
    const out: { index: number; row: ScheduleRow }[] = [];
    let hideDepth: number | null = null;
    table.rows.forEach((row, index) => {
      if (hideDepth !== null) {
        const leaves = (row.kind === 'group' && row.depth <= hideDepth) || row.kind === 'total';
        if (!leaves) return;
        hideDepth = null;
      }
      out.push({ index, row });
      if (row.kind === 'group' && collapsed.has(index)) hideDepth = row.depth;
    });
    return out;
  }, [table, collapsed]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => host.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  if (!table || !definition) {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center bg-canvas text-xs text-fg-muted"
        data-testid="schedule-view"
      >
        {evaluating ? 'Evaluating…' : 'Pick a schedule to run it on the loaded revision.'}
      </div>
    );
  }

  const columns = table.columns;
  const grid = `minmax(220px, 1.4fr) 64px ${columns.map(() => 'minmax(90px, 1fr)').join(' ')}`;
  const toggle = (index: number) => {
    const next = new Set(collapsed);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setCollapsed(next);
  };
  const sort = (i: number) => {
    if (definition.sort_by === i) setDefinition({ sort_desc: !definition.sort_desc });
    else setDefinition({ sort_by: i, sort_desc: false });
    void run();
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-canvas" data-testid="schedule-view">
      <div className="flex items-center gap-2 border-b border-edge bg-surface px-2 py-1 text-xs">
        <span className="font-semibold">{definition.name}</span>
        <span className="text-fg-muted">
          · {table.element_count.toLocaleString()} element(s) · {table.rows.length.toLocaleString()}{' '}
          row(s)
          {evaluating && ' · evaluating…'}
        </span>
        {table.missing_densities.length > 0 && (
          <span className="text-warning">
            · no density for {table.missing_densities.length} material(s)
          </span>
        )}
        <span className="flex-1" />
        <IconButton label="Export as XLSX or CSV…" size="sm" onClick={() => void exportTable()}>
          <Download size={14} />
        </IconButton>
        <IconButton label="Back to the model" size="sm" onClick={() => setWorkspace('model')}>
          <X size={14} />
        </IconButton>
      </div>
      <div
        className="grid border-b border-edge bg-surface px-2 text-[11px] font-semibold text-fg-muted"
        style={{ gridTemplateColumns: grid }}
      >
        <div className="py-1">Element</div>
        <div className="py-1 text-right">Count</div>
        {columns.map((c, i) => (
          <button
            key={i}
            type="button"
            className="flex items-center justify-end gap-1 py-1 text-right hover:text-fg"
            onClick={() => sort(i)}
            title="Sort by this column"
          >
            {c}
            {definition.sort_by === i &&
              (definition.sort_desc ? <ArrowDown size={10} /> : <ArrowUp size={10} />)}
          </button>
        ))}
      </div>
      <div ref={host} className="min-h-0 flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const { index, row } = visible[item.index]!;
            const isGroup = row.kind === 'group';
            const emphasis = row.kind !== 'element';
            return (
              <div
                key={item.key}
                className={cn(
                  'absolute left-0 grid w-full items-center border-b border-edge/60 px-2 text-xs',
                  row.kind === 'group' && 'bg-surface-2/60 font-semibold',
                  row.kind === 'subtotal' && 'text-fg-muted italic',
                  row.kind === 'total' && 'bg-surface-3 font-semibold',
                  row.kind === 'element' && 'hover:bg-surface-2',
                )}
                style={{
                  gridTemplateColumns: grid,
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <div
                  className="flex min-w-0 items-center gap-1"
                  style={{ paddingLeft: row.depth * 14 }}
                >
                  {isGroup ? (
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 hover:bg-surface-3"
                      onClick={() => toggle(index)}
                      aria-label="Collapse group"
                    >
                      {collapsed.has(index) ? (
                        <ChevronRight size={12} />
                      ) : (
                        <ChevronDown size={12} />
                      )}
                    </button>
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() => selectRow(index)}
                    title="Select in the model"
                  >
                    {row.label}
                  </button>
                </div>
                <div className="text-right font-mono text-[11px] text-fg-muted">
                  {emphasis ? row.count.toLocaleString() : ''}
                </div>
                {row.cells.map((cell, i) => (
                  <div
                    key={i}
                    className={cn(
                      'truncate',
                      cell.num !== null ? 'text-right font-mono' : 'text-left',
                    )}
                    title={cell.text}
                  >
                    {cell.num !== null && emphasis
                      ? Number(cell.num).toLocaleString(undefined, { maximumFractionDigits: 3 })
                      : cell.text}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
