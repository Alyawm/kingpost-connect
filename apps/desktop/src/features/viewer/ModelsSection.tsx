import type { ReactNode } from 'react';
import { ArrowUpToLine, Eye, EyeOff, Focus, Layers, Palette, X } from 'lucide-react';
import { Popover, cn } from '@kingpost/ui';
import { useFederation, type ReferenceModel } from '../../state/federation';
import { useModel } from '../../state/model';
import { useUi } from '../../state/ui';
import { PALETTE } from '../../state/view';

/**
 * The models in the view: the main model (tree, properties, schedules and review work on
 * it) and any reference models added from the Explorer.
 */
export function ModelsSection() {
  const relPath = useModel((s) => s.relPath);
  const revision = useModel((s) => s.revision);
  const fitTo = useModel((s) => s.fitTo);
  const elements = useModel((s) => s.elements);
  const refs = useFederation((s) => s.refs);
  const loading = useFederation((s) => s.loading);
  if (!revision) return null;

  return (
    <div className="border-b border-edge px-3 py-2 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1 font-semibold text-fg-muted">
          <Layers size={12} /> Models
        </span>
        <button
          type="button"
          className="text-[11px] text-fg-muted underline hover:text-fg"
          title="Add more models from the Explorer with “+ Add”"
          onClick={() => useUi.setState({ section: 'explorer', leftOpen: true })}
        >
          Add…
        </button>
      </div>
      <ul className="space-y-0.5">
        <li className="flex items-center gap-1 rounded px-1 py-0.5">
          <span className="rounded bg-accent px-1 text-[9px] font-semibold text-accent-fg">
            MAIN
          </span>
          <span className="min-w-0 flex-1 truncate" title={relPath ?? ''}>
            {relPath} <span className="text-fg-muted">· rev {revision.idx}</span>
          </span>
          <RowButton
            label="Fit main model"
            onClick={() => fitTo(elements.filter((e) => e.has_geometry).map((e) => e.express_id))}
          >
            <Focus size={12} />
          </RowButton>
        </li>
        {refs.map((ref) => (
          <ReferenceRow key={ref.key} model={ref} />
        ))}
        {loading && <li className="px-1 text-[11px] text-fg-muted">Adding {loading}…</li>}
      </ul>
      {refs.length === 0 && !loading && (
        <p className="mt-1 text-[10px] text-fg-muted">
          Use “+ Add” next to a revision in the Explorer to view other models with this one.
        </p>
      )}
    </div>
  );
}

function ReferenceRow({ model }: { model: ReferenceModel }) {
  const setVisible = useFederation((s) => s.setVisible);
  const setOpacity = useFederation((s) => s.setOpacity);
  const setColor = useFederation((s) => s.setColor);
  const fit = useFederation((s) => s.fit);
  const makeMain = useFederation((s) => s.makeMain);
  const remove = useFederation((s) => s.remove);

  return (
    <li className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-surface-2">
      <RowButton
        label={model.visible ? 'Hide this model' : 'Show this model'}
        onClick={() => setVisible(model.key, !model.visible)}
      >
        {model.visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </RowButton>
      {model.color && (
        <span
          aria-hidden
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ background: model.color }}
        />
      )}
      <span
        className={cn('min-w-0 flex-1 truncate', !model.visible && 'text-fg-muted line-through')}
        title={`${model.relPath} · revision ${model.revision.idx}`}
      >
        {model.relPath} <span className="text-fg-muted">· rev {model.revision.idx}</span>
      </span>
      <span className="hidden items-center gap-0.5 group-hover:flex">
        <Popover
          label={`Colour and transparency of ${model.relPath}`}
          triggerClassName="rounded p-0.5 text-fg-muted hover:bg-surface-3 hover:text-fg"
          trigger={<Palette size={12} />}
        >
          <div className="w-52 space-y-2">
            <div className="text-[11px] text-fg-muted">Model colour</div>
            <div className="grid grid-cols-6 gap-1">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  className={cn(
                    'h-5 w-5 rounded border border-black/20',
                    model.color === c && 'ring-2 ring-accent ring-offset-1',
                  )}
                  style={{ background: c }}
                  onClick={() => setColor(model.key, c)}
                />
              ))}
            </div>
            <button
              type="button"
              className="text-[11px] text-fg-muted underline"
              onClick={() => setColor(model.key, null)}
            >
              Original colours
            </button>
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-fg-muted">
                <span>Transparency</span>
                <span className="font-mono">{Math.round((1 - model.opacity) * 100)} %</span>
              </div>
              <input
                type="range"
                min={0}
                max={95}
                step={5}
                value={Math.round((1 - model.opacity) * 100)}
                aria-label="Model transparency"
                onChange={(e) => setOpacity(model.key, 1 - Number(e.target.value) / 100)}
                className="w-full accent-[var(--kp-accent)]"
              />
            </div>
          </div>
        </Popover>
        <RowButton label="Fit this model" onClick={() => fit(model.key)}>
          <Focus size={12} />
        </RowButton>
        <RowButton
          label="Make this the main model (tree, properties, schedules)"
          onClick={() => makeMain(model.key)}
        >
          <ArrowUpToLine size={12} />
        </RowButton>
        <RowButton label="Remove from the view" onClick={() => remove(model.key)}>
          <X size={12} />
        </RowButton>
      </span>
    </li>
  );
}

function RowButton({
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
      className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-surface-3 hover:text-fg"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
