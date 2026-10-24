import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Focus } from 'lucide-react';
import { cn } from '@kingpost/ui';
import { useModel } from '../../state/model';
import type { ElementSummary } from '../../lib/ipc';
import { buildTree, label, typeLabel } from './tree';

export function ModelTree({ filter }: { filter: string }) {
  const elements = useModel((s) => s.elements);
  const hidden = useModel((s) => s.hidden);
  const selectedIds = useModel((s) => s.selectedIds);
  const select = useModel((s) => s.select);
  const toggleSelect = useModel((s) => s.toggleSelect);
  const hide = useModel((s) => s.hide);
  const isolate = useModel((s) => s.isolate);
  const showAll = useModel((s) => s.showAll);
  const fitTo = useModel((s) => s.fitTo);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const tree = useMemo(() => buildTree(elements, filter), [elements, filter]);
  const forceOpen = filter.trim().length > 0;

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const idsOf = (list: ElementSummary[]) => list.map((e) => e.express_id);
  const allHidden = (list: ElementSummary[]) => list.every((e) => hidden.has(e.express_id));
  const unhide = (list: ElementSummary[]) => {
    const keep = new Set(hidden);
    for (const e of list) keep.delete(e.express_id);
    showAll();
    if (keep.size) hide(keep);
  };

  if (tree.length === 0) {
    return <p className="px-3 py-2 text-xs text-fg-muted">No elements match.</p>;
  }

  return (
    <ul className="text-xs">
      {tree.map((storey) => {
        const storeyOpen = forceOpen || open.has(storey.key);
        const storeyElements = storey.types.flatMap((t) => t.elements);
        return (
          <li key={storey.key}>
            <Row
              depth={0}
              open={storeyOpen}
              onToggle={() => toggle(storey.key)}
              title={storey.name}
              count={storey.count}
              hiddenAll={allHidden(storeyElements)}
              onHide={() =>
                allHidden(storeyElements) ? unhide(storeyElements) : hide(idsOf(storeyElements))
              }
              onIsolate={() => isolate(idsOf(storeyElements))}
              onFit={() => fitTo(idsOf(storeyElements))}
            />
            {storeyOpen && (
              <ul>
                {storey.types.map((type) => {
                  const typeOpen = forceOpen || open.has(type.key);
                  return (
                    <li key={type.key}>
                      <Row
                        depth={1}
                        open={typeOpen}
                        onToggle={() => toggle(type.key)}
                        title={typeLabel(type.ifcType)}
                        count={type.elements.length}
                        hiddenAll={allHidden(type.elements)}
                        onHide={() =>
                          allHidden(type.elements)
                            ? unhide(type.elements)
                            : hide(idsOf(type.elements))
                        }
                        onIsolate={() => isolate(idsOf(type.elements))}
                        onFit={() => fitTo(idsOf(type.elements))}
                      />
                      {typeOpen && (
                        <ul>
                          {type.elements.map((element) => (
                            <li key={element.express_id}>
                              <button
                                type="button"
                                className={cn(
                                  'flex w-full items-center gap-1 py-0.5 pr-2 text-left hover:bg-surface-2',
                                  selectedIds.has(element.express_id) && 'bg-surface-3 text-fg',
                                  hidden.has(element.express_id) && 'text-fg-muted/60 line-through',
                                )}
                                style={{ paddingLeft: 2 * 14 + 22 }}
                                onClick={(event) =>
                                  void (event.ctrlKey || event.metaKey
                                    ? toggleSelect(element.express_id)
                                    : select(element.express_id))
                                }
                                onDoubleClick={() => fitTo([element.express_id])}
                                title={`${element.ifc_type} · ${element.global_id}`}
                              >
                                <span className="truncate">{label(element)}</span>
                                {element.type_name &&
                                  !label(element).includes(element.type_name) && (
                                    <span className="ml-auto shrink-0 truncate text-[10px] text-fg-muted">
                                      {element.type_name}
                                    </span>
                                  )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Row({
  depth,
  open,
  onToggle,
  title,
  count,
  hiddenAll,
  onHide,
  onIsolate,
  onFit,
}: {
  depth: number;
  open: boolean;
  onToggle(): void;
  title: string;
  count: number;
  hiddenAll: boolean;
  onHide(): void;
  onIsolate(): void;
  onFit(): void;
}) {
  return (
    <div
      className="group flex items-center gap-1 py-0.5 pr-1 hover:bg-surface-2"
      style={{ paddingLeft: depth * 14 + 4 }}
    >
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1" onClick={onToggle}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className={cn('truncate', hiddenAll && 'text-fg-muted/60 line-through')}>
          {title}
        </span>
        <span className="ml-1 shrink-0 text-[10px] text-fg-muted">{count.toLocaleString()}</span>
      </button>
      <span className="hidden items-center gap-0.5 group-hover:flex">
        <TreeAction label="Fit view" onClick={onFit}>
          <Focus size={12} />
        </TreeAction>
        <TreeAction label="Isolate" onClick={onIsolate}>
          <span className="px-0.5 font-mono text-[10px]">iso</span>
        </TreeAction>
        <TreeAction label={hiddenAll ? 'Show' : 'Hide'} onClick={onHide}>
          {hiddenAll ? <EyeOff size={12} /> : <Eye size={12} />}
        </TreeAction>
      </span>
    </div>
  );
}

function TreeAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="rounded p-0.5 text-fg-muted hover:bg-surface-3 hover:text-fg"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
