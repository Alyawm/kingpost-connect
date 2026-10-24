import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Play,
  Plus,
  Save,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { Button, IconButton, Panel, PanelBody, PanelHeader, cn } from '@kingpost/ui';
import type { Aggregate, ColumnKey, ScheduleDefinition } from '../../lib/ipc';
import { useModel } from '../../state/model';
import { useProject } from '../../state/project';
import { EMPTY_SCHEDULE, keyLabel, sameKey, useSchedules } from '../../state/schedules';

const subtle = 'text-[10px] text-fg-muted';
const field = 'h-6 w-full rounded border border-edge bg-canvas px-1 text-xs';
const AGGREGATES: Aggregate[] = ['none', 'sum', 'count', 'avg', 'min', 'max'];
const FIELDS: [string, string][] = [
  ['name', 'Name'],
  ['tag', 'Tag'],
  ['ifc_type', 'Type'],
  ['storey', 'Storey'],
  ['type_name', 'Type name'],
  ['material', 'Material'],
  ['global_id', 'GlobalId'],
];
const DERIVED: [string, string][] = [
  ['count', 'Count'],
  ['length', 'Length (m)'],
  ['volume', 'Volume (m³)'],
  ['area', 'Area (m²)'],
  ['mass', 'Mass (kg)'],
];

export function SchedulesPanel() {
  const project = useProject((s) => s.current);
  const revision = useModel((s) => s.revision);
  const builtin = useSchedules((s) => s.builtin);
  const saved = useSchedules((s) => s.saved);
  const refresh = useSchedules((s) => s.refresh);
  const pick = useSchedules((s) => s.pick);
  const remove = useSchedules((s) => s.remove);
  const definition = useSchedules((s) => s.definition);
  const presetId = useSchedules((s) => s.presetId);

  useEffect(() => {
    if (project) void refresh();
  }, [project, refresh]);

  return (
    <Panel>
      <PanelHeader title="Schedules" />
      <PanelBody className="p-0 text-xs">
        {!project ? (
          <p className="p-3 text-fg-muted">
            Open a project and load a model revision to build schedules.
          </p>
        ) : (
          <>
            <div className="border-b border-edge px-3 py-2">
              {!revision && (
                <p className={cn(subtle, 'mb-1')}>
                  Load a model revision first; schedules read the loaded revision.
                </p>
              )}
              <div className="mb-1 font-semibold text-fg-muted">Presets</div>
              <ul className="space-y-0.5">
                {builtin.map((d) => (
                  <li key={d.name}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-surface-2',
                        definition?.name === d.name && !presetId && 'bg-surface-3',
                      )}
                      disabled={!revision}
                      onClick={() => pick(d, null)}
                    >
                      <Table2 size={11} className="shrink-0 text-fg-muted" />
                      <span className="truncate">{d.name}</span>
                      <span className={cn(subtle, 'ml-auto')}>built in</span>
                    </button>
                  </li>
                ))}
                {saved.map((p) => (
                  <li key={p.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-surface-2',
                        presetId === p.id && 'bg-surface-3',
                      )}
                      disabled={!revision}
                      onClick={() =>
                        pick(JSON.parse(p.definition_json) as ScheduleDefinition, p.id)
                      }
                    >
                      <Table2 size={11} className="shrink-0 text-fg-muted" />
                      <span className="truncate">{p.name}</span>
                    </button>
                    <IconButton label="Delete preset" size="sm" onClick={() => void remove(p.id)}>
                      <Trash2 size={12} />
                    </IconButton>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={cn(subtle, 'mt-1 underline')}
                disabled={!revision}
                onClick={() => pick(EMPTY_SCHEDULE, null)}
              >
                + new schedule
              </button>
            </div>
            {definition && <Editor />}
            <Densities />
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

function Editor() {
  const definition = useSchedules((s) => s.definition)!;
  const setDefinition = useSchedules((s) => s.setDefinition);
  const addColumn = useSchedules((s) => s.addColumn);
  const removeColumn = useSchedules((s) => s.removeColumn);
  const setAggregate = useSchedules((s) => s.setAggregate);
  const toggleGroup = useSchedules((s) => s.toggleGroup);
  const run = useSchedules((s) => s.run);
  const save = useSchedules((s) => s.save);
  const exportTable = useSchedules((s) => s.exportTable);
  const evaluating = useSchedules((s) => s.evaluating);
  const measuring = useSchedules((s) => s.measuring);
  const catalogue = useSchedules((s) => s.catalogue);
  const loadCatalogue = useSchedules((s) => s.loadCatalogue);
  const presetId = useSchedules((s) => s.presetId);
  const elements = useModel((s) => s.elements);
  const [open, setOpen] = useState<'columns' | 'filter' | null>('columns');
  const [search, setSearch] = useState('');

  useEffect(() => {
    void loadCatalogue();
  }, [loadCatalogue]);

  const types = useMemo(
    () =>
      [
        ...new Set(elements.filter((e) => e.has_geometry && !e.is_spatial).map((e) => e.ifc_type)),
      ].sort(),
    [elements],
  );
  const storeys = useMemo(
    () =>
      [...new Set(elements.map((e) => e.storey).filter((s): s is string => !!s))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
    [elements],
  );
  const catalogueHits = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return catalogue
      .filter((c) => c.name.toLowerCase().includes(needle) || c.pset.toLowerCase().includes(needle))
      .slice(0, 30);
  }, [catalogue, search]);
  const isGrouped = (key: ColumnKey) => definition.group_by.some((k) => sameKey(k, key));
  const toggleList = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <div className="border-b border-edge px-3 py-2">
      <div className="flex items-center gap-1">
        <input
          className={field}
          value={definition.name}
          aria-label="Schedule name"
          onChange={(e) => setDefinition({ name: e.target.value })}
        />
        <IconButton
          label={evaluating ? 'Running…' : 'Run'}
          size="sm"
          disabled={evaluating}
          onClick={() => void run()}
        >
          <Play size={12} />
        </IconButton>
        <IconButton
          label={presetId ? 'Save' : 'Save as preset'}
          size="sm"
          onClick={() => void save(false)}
        >
          <Save size={12} />
        </IconButton>
        <IconButton label="Export as XLSX or CSV…" size="sm" onClick={() => void exportTable()}>
          <Download size={12} />
        </IconButton>
      </div>
      {measuring && (
        <p className={cn(subtle, 'mt-1')}>
          Measuring geometry: {measuring.done.toLocaleString()} of{' '}
          {measuring.total.toLocaleString()}
        </p>
      )}

      <button
        type="button"
        className="mt-2 flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted"
        onClick={() => setOpen(open === 'columns' ? null : 'columns')}
      >
        {open === 'columns' ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Columns and grouping
      </button>
      {open === 'columns' && (
        <div className="mt-1 space-y-1">
          <ul className="space-y-0.5">
            {definition.columns.map((c, i) => (
              <li key={i} className="flex items-center gap-1">
                <button
                  type="button"
                  className={cn(
                    'shrink-0 rounded border px-1 text-[10px]',
                    isGrouped(c.key) ? 'border-accent text-fg' : 'border-edge text-fg-muted',
                  )}
                  title="Group by this column"
                  onClick={() => toggleGroup(c.key)}
                >
                  group
                </button>
                <span className="min-w-0 flex-1 truncate" title={keyLabel(c.key)}>
                  {c.label}
                </span>
                {c.key.kind !== 'field' && (
                  <select
                    className="h-5 rounded border border-edge bg-canvas text-[10px]"
                    value={c.aggregate}
                    aria-label="Aggregate"
                    onChange={(e) => setAggregate(i, e.target.value as Aggregate)}
                  >
                    {AGGREGATES.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-surface-2"
                  title="Remove column"
                  onClick={() => removeColumn(i)}
                >
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1">
            {FIELDS.map(([f, label]) => (
              <button
                key={f}
                type="button"
                className="rounded border border-edge px-1 text-[10px] hover:bg-surface-2"
                onClick={() => addColumn({ kind: 'field', field: f }, label)}
              >
                <Plus size={9} className="inline" /> {label}
              </button>
            ))}
            {DERIVED.map(([q, label]) => (
              <button
                key={q}
                type="button"
                className="rounded border border-edge px-1 text-[10px] hover:bg-surface-2"
                onClick={() =>
                  addColumn(
                    { kind: 'derived', quantity: q },
                    label,
                    q === 'count' ? 'count' : 'sum',
                  )
                }
              >
                <Plus size={9} className="inline" /> {label}
              </button>
            ))}
          </div>
          <input
            className={field}
            value={search}
            placeholder="Add a property column: search psets…"
            aria-label="Search properties"
            onChange={(e) => setSearch(e.target.value)}
          />
          {catalogueHits.length > 0 && (
            <ul className="max-h-32 overflow-auto rounded border border-edge">
              {catalogueHits.map((c) => (
                <li key={`${c.pset}/${c.name}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1 px-1 py-0.5 text-left hover:bg-surface-2"
                    onClick={() => {
                      addColumn(
                        { kind: 'property', pset: c.pset, name: c.name },
                        c.unit ? `${c.name} (${c.unit})` : c.name,
                        c.kind === 'text' ? 'none' : 'sum',
                      );
                      setSearch('');
                    }}
                  >
                    <span className="truncate">{c.name}</span>
                    <span className={cn(subtle, 'ml-auto truncate')}>
                      {c.pset} · {c.count}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        className="mt-2 flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted"
        onClick={() => setOpen(open === 'filter' ? null : 'filter')}
      >
        {open === 'filter' ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Filter
        <span className="font-normal normal-case">
          ({definition.filter.ifc_types.length || 'all'} types ·{' '}
          {definition.filter.storeys.length || 'all'} storeys)
        </span>
      </button>
      {open === 'filter' && (
        <div className="mt-1 space-y-1">
          <input
            className={field}
            value={definition.filter.text}
            placeholder="Name, type name or material contains…"
            aria-label="Filter text"
            onChange={(e) =>
              setDefinition({ filter: { ...definition.filter, text: e.target.value } })
            }
          />
          <div className="flex flex-wrap gap-1">
            {types.map((t) => (
              <button
                key={t}
                type="button"
                className={cn(
                  'rounded border px-1 text-[10px]',
                  definition.filter.ifc_types.includes(t)
                    ? 'border-accent text-fg'
                    : 'border-edge text-fg-muted',
                )}
                onClick={() =>
                  setDefinition({
                    filter: {
                      ...definition.filter,
                      ifc_types: toggleList(definition.filter.ifc_types, t),
                    },
                  })
                }
              >
                {t.replace(/^IFC/, '')}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {storeys.map((s) => (
              <button
                key={s}
                type="button"
                className={cn(
                  'rounded border px-1 text-[10px]',
                  definition.filter.storeys.includes(s)
                    ? 'border-accent text-fg'
                    : 'border-edge text-fg-muted',
                )}
                onClick={() =>
                  setDefinition({
                    filter: {
                      ...definition.filter,
                      storeys: toggleList(definition.filter.storeys, s),
                    },
                  })
                }
              >
                {s}
              </button>
            ))}
          </div>
          <Button size="sm" variant="primary" disabled={evaluating} onClick={() => void run()}>
            <Play size={12} /> Run
          </Button>
        </div>
      )}
    </div>
  );
}

function Densities() {
  const densities = useSchedules((s) => s.densities);
  const load = useSchedules((s) => s.loadDensities);
  const setDensity = useSchedules((s) => s.setDensity);
  const removeDensity = useSchedules((s) => s.removeDensity);
  const table = useSchedules((s) => s.table);
  const [open, setOpen] = useState(false);
  const [material, setMaterial] = useState('');
  const [value, setValue] = useState('');

  useEffect(() => {
    void load();
  }, [load]);

  const missing = table?.missing_densities ?? [];

  return (
    <div className="border-b border-edge px-3 py-2">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Material densities
        {missing.length > 0 && (
          <span className="font-normal normal-case text-warning">({missing.length} missing)</span>
        )}
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          <p className={subtle}>
            Mass = volume × density (kg/m³). Steel, concrete, timber, aluminium and masonry have
            defaults; add a row to override or to cover another material name.
          </p>
          {missing.length > 0 && (
            <p className={cn(subtle, 'text-warning')}>
              No density for: {missing.join(', ')}. Add one below (click a name).
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            {missing.map((m) => (
              <button
                key={m}
                type="button"
                className="rounded border border-edge px-1 text-[10px]"
                onClick={() => setMaterial(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <ul className="space-y-0.5">
            {densities.map((d) => (
              <li key={d.material} className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate">{d.material}</span>
                <span className="font-mono">{d.density}</span>
                <button
                  type="button"
                  className="rounded p-0.5 text-fg-muted hover:bg-surface-2"
                  title="Remove"
                  onClick={() => void removeDensity(d.material)}
                >
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-[1fr_80px_auto] gap-1">
            <input
              className={field}
              value={material}
              placeholder="Material name"
              aria-label="Material"
              onChange={(e) => setMaterial(e.target.value)}
            />
            <input
              className={field}
              type="number"
              value={value}
              placeholder="kg/m³"
              aria-label="Density"
              onChange={(e) => setValue(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!material.trim() || !(Number(value) > 0)}
              onClick={() => {
                void setDensity(material.trim(), Number(value), null);
                setMaterial('');
                setValue('');
              }}
            >
              add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
