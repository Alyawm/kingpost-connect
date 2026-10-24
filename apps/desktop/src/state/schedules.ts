import { create } from 'zustand';
import {
  densities as fetchDensities,
  densityRemove,
  densitySet,
  geometryQuantitiesSave,
  geometryQuantityCount,
  isTauri,
  propertyCatalogue,
  scheduleDelete,
  scheduleEvaluate,
  scheduleExport,
  schedulePresets,
  scheduleSave,
  type Aggregate,
  type CatalogueEntry,
  type ColumnKey,
  type DensityRow,
  type GeometryQuantity,
  type PresetRow,
  type ScheduleDefinition,
  type ScheduleTable,
} from '../lib/ipc';
import { log } from './log';
import { useModel } from './model';
import { useProject } from './project';
import { useUi } from './ui';

interface SchedulesState {
  builtin: ScheduleDefinition[];
  saved: PresetRow[];
  /** The definition being edited and shown. */
  definition: ScheduleDefinition | null;
  /** Id of the saved preset the definition came from, if any. */
  presetId: string | null;
  table: ScheduleTable | null;
  evaluating: boolean;
  catalogue: CatalogueEntry[];
  densities: DensityRow[];
  measuring: { done: number; total: number } | null;
  refresh(): Promise<void>;
  pick(definition: ScheduleDefinition, presetId: string | null): void;
  setDefinition(patch: Partial<ScheduleDefinition>): void;
  addColumn(key: ColumnKey, label: string, aggregate?: Aggregate): void;
  removeColumn(index: number): void;
  setAggregate(index: number, aggregate: Aggregate): void;
  toggleGroup(key: ColumnKey): void;
  run(): Promise<void>;
  save(asNew?: boolean): Promise<void>;
  remove(presetId: string): Promise<void>;
  exportTable(): Promise<void>;
  loadCatalogue(): Promise<void>;
  loadDensities(): Promise<void>;
  setDensity(material: string, density: number, note: string | null): Promise<void>;
  removeDensity(material: string): Promise<void>;
  /** Measures geometry quantities for the loaded revision when it has none stored. */
  ensureGeometryQuantities(force?: boolean): Promise<void>;
  /** Selects the elements under a row (an element, or a whole group) in the model. */
  selectRow(index: number): void;
}

export function sameKey(a: ColumnKey, b: ColumnKey): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'field' && b.kind === 'field') return a.field === b.field;
  if (a.kind === 'property' && b.kind === 'property') return a.pset === b.pset && a.name === b.name;
  if (a.kind === 'derived' && b.kind === 'derived') return a.quantity === b.quantity;
  return false;
}

export function keyLabel(key: ColumnKey): string {
  switch (key.kind) {
    case 'field':
      return key.field.replace('_', ' ');
    case 'property':
      return key.pset === '*' ? key.name : `${key.pset}/${key.name}`;
    case 'derived':
      return key.quantity;
  }
}

/** Element rows under row `index`: itself, or every element row inside its group. */
export function rowElements(table: ScheduleTable, index: number): number[] {
  const row = table.rows[index];
  if (!row) return [];
  if (row.kind === 'element') return row.express_id !== null ? [row.express_id] : [];
  if (row.kind === 'total') {
    return table.rows
      .filter((r) => r.kind === 'element' && r.express_id !== null)
      .map((r) => r.express_id!);
  }
  const out: number[] = [];
  for (let i = index + 1; i < table.rows.length; i++) {
    const r = table.rows[i]!;
    if (r.kind === 'total') break;
    if ((r.kind === 'group' || r.kind === 'subtotal') && r.depth <= row.depth) {
      if (r.kind === 'subtotal' && r.depth === row.depth) break;
      if (r.kind === 'group') break;
    }
    if (r.kind === 'element' && r.express_id !== null) out.push(r.express_id);
  }
  return out;
}

const EMPTY: ScheduleDefinition = {
  name: 'New schedule',
  columns: [
    { key: { kind: 'field', field: 'name' }, label: 'Element', aggregate: 'none' },
    { key: { kind: 'derived', quantity: 'count' }, label: 'Count', aggregate: 'count' },
  ],
  group_by: [{ kind: 'field', field: 'ifc_type' }],
  filter: { ifc_types: [], storeys: [], text: '', physical_only: true },
  sort_by: null,
  sort_desc: false,
};

export const useSchedules = create<SchedulesState>((set, get) => ({
  builtin: [],
  saved: [],
  definition: null,
  presetId: null,
  table: null,
  evaluating: false,
  catalogue: [],
  densities: [],
  measuring: null,

  refresh: async () => {
    try {
      const presets = await schedulePresets();
      set({ builtin: presets.builtin, saved: presets.saved });
    } catch (error) {
      log.error(`Could not list schedules: ${String(error)}`);
    }
  },

  pick: (definition, presetId) => {
    set({ definition: structuredClone(definition), presetId, table: null });
    useUi.getState().setWorkspace('schedule');
    void get().run();
  },

  setDefinition: (patch) => {
    const current = get().definition ?? EMPTY;
    set({ definition: { ...current, ...patch } });
  },

  addColumn: (key, label, aggregate = 'none') => {
    const current = get().definition ?? EMPTY;
    if (current.columns.some((c) => sameKey(c.key, key))) return;
    set({ definition: { ...current, columns: [...current.columns, { key, label, aggregate }] } });
  },

  removeColumn: (index) => {
    const current = get().definition ?? EMPTY;
    set({
      definition: {
        ...current,
        columns: current.columns.filter((_, i) => i !== index),
        sort_by: current.sort_by === index ? null : current.sort_by,
      },
    });
  },

  setAggregate: (index, aggregate) => {
    const current = get().definition ?? EMPTY;
    set({
      definition: {
        ...current,
        columns: current.columns.map((c, i) => (i === index ? { ...c, aggregate } : c)),
      },
    });
  },

  toggleGroup: (key) => {
    const current = get().definition ?? EMPTY;
    const has = current.group_by.some((k) => sameKey(k, key));
    set({
      definition: {
        ...current,
        group_by: has
          ? current.group_by.filter((k) => !sameKey(k, key))
          : [...current.group_by, key],
      },
    });
  },

  run: async () => {
    const { definition } = get();
    const revision = useModel.getState().revision;
    if (!definition || !revision || !isTauri()) return;
    set({ evaluating: true });
    try {
      await get().ensureGeometryQuantities();
      const started = performance.now();
      const table = await scheduleEvaluate(revision.id, definition);
      set({ table });
      log.info(
        `Schedule "${definition.name}": ${table.element_count.toLocaleString()} element(s), ` +
          `${table.rows.length.toLocaleString()} row(s) in ${Math.round(performance.now() - started)} ms` +
          (table.missing_densities.length
            ? `; no density for ${table.missing_densities.join(', ')}`
            : ''),
      );
    } catch (error) {
      log.error(`Schedule failed: ${String(error)}`);
    } finally {
      set({ evaluating: false });
    }
  },

  save: async (asNew = false) => {
    const { definition, presetId } = get();
    if (!definition) return;
    try {
      const row = await scheduleSave(asNew ? null : presetId, definition);
      set({ presetId: row.id });
      log.info(`Schedule "${row.name}" saved.`);
      await get().refresh();
    } catch (error) {
      log.error(`Could not save the schedule: ${String(error)}`);
    }
  },

  remove: async (id) => {
    try {
      await scheduleDelete(id);
      if (get().presetId === id) set({ presetId: null });
      await get().refresh();
    } catch (error) {
      log.error(`Could not delete the schedule: ${String(error)}`);
    }
  },

  exportTable: async () => {
    const { definition } = get();
    const revision = useModel.getState().revision;
    if (!definition || !revision || !isTauri()) return;
    const { save } = await import('@tauri-apps/plugin-dialog');
    const base = definition.name.replace(/[^\w.-]+/g, '-').toLowerCase();
    const path = await save({
      title: 'Export schedule',
      defaultPath: `${base}.xlsx`,
      filters: [
        { name: 'Excel workbook', extensions: ['xlsx'] },
        { name: 'CSV', extensions: ['csv'] },
      ],
    });
    if (!path) return;
    try {
      const rows = await scheduleExport(revision.id, definition, path);
      log.info(`Exported ${rows} row(s) to ${path}`);
    } catch (error) {
      log.error(`Export failed: ${String(error)}`);
    }
  },

  loadCatalogue: async () => {
    const revision = useModel.getState().revision;
    if (!revision) {
      set({ catalogue: [] });
      return;
    }
    try {
      set({ catalogue: await propertyCatalogue(revision.id) });
    } catch (error) {
      log.error(`Could not read the property catalogue: ${String(error)}`);
    }
  },

  loadDensities: async () => {
    try {
      set({ densities: await fetchDensities() });
    } catch {
      set({ densities: [] });
    }
  },

  setDensity: async (material, density, note) => {
    try {
      set({ densities: await densitySet(material, density, note) });
    } catch (error) {
      log.error(`Could not save the density: ${String(error)}`);
    }
  },

  removeDensity: async (material) => {
    try {
      set({ densities: await densityRemove(material) });
    } catch (error) {
      log.error(`Could not remove the density: ${String(error)}`);
    }
  },

  ensureGeometryQuantities: async (force = false) => {
    const { model, revision, elements } = useModel.getState();
    if (!model || !revision || !isTauri()) return;
    if (!force && (await geometryQuantityCount(revision.id)) > 0) return;
    const ids = elements.filter((e) => e.has_geometry && !e.is_spatial).map((e) => e.express_id);
    set({ measuring: { done: 0, total: ids.length } });
    const started = performance.now();
    try {
      let batch: GeometryQuantity[] = [];
      let written = 0;
      for (let i = 0; i < ids.length; i++) {
        const q = model.quantitiesOf(ids[i]!);
        if (q) {
          batch.push({
            express_id: ids[i]!,
            volume: q.volume,
            surface_area: q.surfaceArea,
            length: q.length,
            bbox_min: q.bboxMin,
            bbox_max: q.bboxMax,
          });
        }
        if (batch.length >= 500 || i === ids.length - 1) {
          written += await geometryQuantitiesSave(revision.id, batch);
          batch = [];
          set({ measuring: { done: i + 1, total: ids.length } });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      log.info(
        `Measured ${written.toLocaleString()} element(s) from the geometry in ${Math.round(performance.now() - started)} ms`,
      );
    } catch (error) {
      log.error(`Could not store geometry quantities: ${String(error)}`);
    } finally {
      set({ measuring: null });
    }
  },

  selectRow: (index) => {
    const { table } = get();
    if (!table) return;
    const ids = rowElements(table, index);
    const model = useModel.getState();
    void model.selectMany(ids);
    if (ids.length) model.fitTo(ids);
  },
}));

useProject.subscribe((state, previous) => {
  if (state.current?.id !== previous.current?.id) {
    useSchedules.setState({
      builtin: [],
      saved: [],
      definition: null,
      presetId: null,
      table: null,
      catalogue: [],
      densities: [],
    });
  }
});

useModel.subscribe((state, previous) => {
  if (state.revision?.id !== previous.revision?.id) {
    useSchedules.setState({ table: null, catalogue: [] });
  }
});

export { EMPTY as EMPTY_SCHEDULE };
