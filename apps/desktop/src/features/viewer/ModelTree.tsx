import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Focus, Palette, ScanSearch } from 'lucide-react';
import { Popover, cn } from '@kingpost/ui';
import { useModel } from '../../state/model';
import { commonLook, useAppearance, type CommonLook } from '../../state/appearance';
import type { ElementSummary } from '../../lib/ipc';
import { buildTree, label, type GroupBy } from './tree';
import { AppearanceEditor, LookDot } from './AppearanceEditor';

const ids = (list: ElementSummary[]) => list.map((e) => e.express_id);

export function ModelTree({ filter, groupBy }: { filter: string; groupBy: GroupBy }) {
  const elements = useModel((s) => s.elements);
  const hidden = useModel((s) => s.hidden);
  const selectedIds = useModel((s) => s.selectedIds);
  const select = useModel((s) => s.select);
  const toggleSelect = useModel((s) => s.toggleSelect);
  const selectMany = useModel((s) => s.selectMany);
  const hide = useModel((s) => s.hide);
  const isolate = useModel((s) => s.isolate);
  const showAll = useModel((s) => s.showAll);
  const fitTo = useModel((s) => s.fitTo);
  const looks = useAppearance((s) => s.looks);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const tree = useMemo(() => buildTree(elements, filter, groupBy), [elements, filter, groupBy]);
  const forceOpen = filter.trim().length > 0;

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allHidden = (list: ElementSummary[]) => list.every((e) => hidden.has(e.express_id));
  const unhide = (list: ElementSummary[]) => {
    const keep = new Set(hidden);
    for (const e of list) keep.delete(e.express_id);
    showAll();
    if (keep.size) hide(keep);
  };
  const toggleHidden = (list: ElementSummary[]) =>
    allHidden(list) ? unhide(list) : hide(ids(list));

  if (tree.length === 0) {
    return <p className="px-3 py-2 text-xs text-fg-muted">No elements match.</p>;
  }

  return (
    <ul className="text-xs">
      {tree.map((group) => {
        const groupOpen = forceOpen || open.has(group.key);
        const groupElements = group.types.flatMap((t) => t.elements);
        const groupIds = ids(groupElements);
        return (
          <li key={group.key}>
            <Row
              depth={0}
              open={groupOpen}
              onToggle={() => toggle(group.key)}
              title={group.name}
              count={group.count}
              ids={groupIds}
              look={commonLook(looks, groupIds)}
              hiddenAll={allHidden(groupElements)}
              onHide={() => toggleHidden(groupElements)}
              onIsolate={() => isolate(groupIds)}
              onFit={() => fitTo(groupIds)}
              onSelect={() => void selectMany(groupIds)}
            />
            {groupOpen && (
              <ul>
                {group.types.map((type) => {
                  const typeOpen = forceOpen || open.has(type.key);
                  const typeIds = ids(type.elements);
                  return (
                    <li key={type.key}>
                      <Row
                        depth={1}
                        open={typeOpen}
                        onToggle={() => toggle(type.key)}
                        title={type.label}
                        count={type.elements.length}
                        ids={typeIds}
                        look={commonLook(looks, typeIds)}
                        hiddenAll={allHidden(type.elements)}
                        onHide={() => toggleHidden(type.elements)}
                        onIsolate={() => isolate(typeIds)}
                        onFit={() => fitTo(typeIds)}
                        onSelect={() => void selectMany(typeIds)}
                      />
                      {typeOpen && (
                        <ul>
                          {type.elements.map((element) => {
                            const id = element.express_id;
                            const isHidden = hidden.has(id);
                            const look = looks.get(id);
                            return (
                              <li
                                key={id}
                                className={cn(
                                  'group flex items-center gap-1 pr-1 hover:bg-surface-2',
                                  selectedIds.has(id) && 'bg-surface-3 text-fg',
                                )}
                                style={{ paddingLeft: 2 * 14 + 22 }}
                              >
                                <button
                                  type="button"
                                  className={cn(
                                    'flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left',
                                    isHidden && 'text-fg-muted/60 line-through',
                                  )}
                                  onClick={(event) =>
                                    void (event.ctrlKey || event.metaKey
                                      ? toggleSelect(id)
                                      : select(id))
                                  }
                                  onDoubleClick={() => fitTo([id])}
                                  title={`${element.ifc_type} · ${element.global_id}`}
                                >
                                  <LookDot
                                    color={look?.color ?? null}
                                    opacity={look?.opacity ?? 1}
                                  />
                                  <span className="truncate">{label(element)}</span>
                                  {element.type_name &&
                                    !label(element).includes(element.type_name) && (
                                      <span className="ml-auto shrink-0 truncate text-[10px] text-fg-muted">
                                        {element.type_name}
                                      </span>
                                    )}
                                </button>
                                <span className="hidden items-center gap-0.5 group-hover:flex">
                                  <AppearanceButton ids={[id]} title={label(element)} />
                                </span>
                                <HideToggle
                                  hidden={isHidden}
                                  onClick={() => toggleHidden([element])}
                                />
                              </li>
                            );
                          })}
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
  ids,
  look,
  hiddenAll,
  onHide,
  onIsolate,
  onFit,
  onSelect,
}: {
  depth: number;
  open: boolean;
  onToggle(): void;
  title: string;
  count: number;
  ids: number[];
  look: CommonLook;
  hiddenAll: boolean;
  onHide(): void;
  onIsolate(): void;
  onFit(): void;
  onSelect(): void;
}) {
  return (
    <div
      className="group flex items-center gap-1 py-0.5 pr-1 hover:bg-surface-2"
      style={{ paddingLeft: depth * 14 + 4 }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1"
        onClick={onToggle}
        onDoubleClick={onSelect}
        title="Click to expand · double-click to select the group"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <LookDot
          color={typeof look.color === 'string' && look.color !== 'mixed' ? look.color : null}
          opacity={look.opacity === 'mixed' ? 0.5 : look.opacity}
        />
        {look.color === 'mixed' && (
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ background: 'conic-gradient(#5b9dff, #ff8a4c, #3ccf7a, #5b9dff)' }}
            title="Mixed colours"
          />
        )}
        <span className={cn('truncate', hiddenAll && 'text-fg-muted/60 line-through')}>
          {title}
        </span>
        <span className="ml-1 shrink-0 text-[10px] text-fg-muted">{count.toLocaleString()}</span>
      </button>
      <span className="hidden items-center gap-0.5 group-hover:flex">
        <TreeAction label="Select group" onClick={onSelect}>
          <span className="px-0.5 font-mono text-[10px]">sel</span>
        </TreeAction>
        <TreeAction label="Fit view" onClick={onFit}>
          <Focus size={12} />
        </TreeAction>
        <TreeAction label="Isolate" onClick={onIsolate}>
          <ScanSearch size={12} />
        </TreeAction>
        <AppearanceButton ids={ids} title={title} />
      </span>
      <HideToggle hidden={hiddenAll} onClick={onHide} />
    </div>
  );
}

/** Opens the colour and transparency editor for a group or an element. */
function AppearanceButton({ ids, title }: { ids: number[]; title: string }) {
  return (
    <Popover
      label={`Colour and transparency of ${title}`}
      triggerClassName="rounded p-0.5 text-fg-muted hover:bg-surface-3 hover:text-fg"
      trigger={<Palette size={12} />}
    >
      <AppearanceEditor ids={ids} title={title} />
    </Popover>
  );
}

/** Eye toggle: shown on hover, and always while the row is hidden so it can be shown again. */
function HideToggle({ hidden, onClick }: { hidden: boolean; onClick(): void }) {
  return (
    <span className={cn(hidden ? 'flex' : 'hidden group-hover:flex')}>
      <TreeAction label={hidden ? 'Show' : 'Hide'} onClick={onClick}>
        {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
      </TreeAction>
    </span>
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
