import { create } from 'zustand';
import { AnalysisLayer, IfcFrame, Vector3, type AnalysisVisibility } from '@kingpost/viewer';
import {
  analysisImport,
  analysisLinkOverride,
  analysisLinkSet,
  analysisMatch,
  analysisModel,
  analysisModels,
  isTauri,
  type AnalysisModel,
  type AnalysisModelSummary,
  type ElementSummary,
  type LinkReport,
  type LinkSetView,
  type MatchSettings,
  type PhysicalAxis,
  type ProjectFile,
  type Triple,
} from '../lib/ipc';
import { log } from './log';
import { useModel } from './model';
import { useProject } from './project';
import { setLinkSource, useView } from './view';
import { useViewer } from './viewer';

/** IFC types whose elements are compared with analysis members. */
const LINEAR_TYPES = new Set(['IFCBEAM', 'IFCCOLUMN', 'IFCMEMBER', 'IFCPILE']);

export interface ShownModel {
  revisionId: number;
  summary: AnalysisModelSummary;
  model: AnalysisModel;
  layer: AnalysisLayer;
}

interface AnalysisState {
  models: AnalysisModelSummary[];
  importing: Set<string>;
  shown: ShownModel | null;
  loading: boolean;
  visibility: AnalysisVisibility;
  physicalVisible: boolean;
  settings: MatchSettings;
  selectedMember: string | null;
  linkSet: LinkSetView | null;
  matching: boolean;
  refresh(): Promise<void>;
  importFile(relPath: string): Promise<void>;
  show(revisionId: number): Promise<void>;
  hide(): void;
  setVisibility(patch: Partial<AnalysisVisibility>): void;
  setPhysicalVisible(visible: boolean): void;
  setSettings(patch: Partial<MatchSettings>): void;
  /** Highlights a member; with `focus` the camera frames it. */
  selectMember(uid: string | null, focus?: boolean): void;
  /** Runs the matcher between the loaded physical revision and the shown model. */
  match(): Promise<void>;
  loadLinkSet(): Promise<void>;
  /** Links the single selected element to the selected member (or unlinks with null). */
  linkSelection(memberUid: string | null): Promise<void>;
  focusElement(globalId: string): void;
  /** Rebuilds the layer after settings that change where it sits. */
  rebuildLayer(): void;
}

export function analysisFiles(files: ProjectFile[]): ProjectFile[] {
  return files.filter((f) => f.kind === 'e2k' || f.kind === 's2k' || f.kind === 'saf');
}

export const SOURCE_LABELS: Record<string, string> = {
  e2k: 'ETABS',
  s2k: 'SAP2000',
  saf: 'SAF',
  ifc: 'IFC structural view',
};

function lengthToMetres(unit: string): number {
  switch (unit.trim().toLowerCase()) {
    case 'mm':
      return 0.001;
    case 'cm':
      return 0.01;
    case 'ft':
      return 0.3048;
    case 'in':
      return 0.0254;
    default:
      return 1;
  }
}

function buildLayer(model: AnalysisModel, settings: MatchSettings): AnalysisLayer {
  const frame = useModel.getState().frame ?? IfcFrame.identity();
  const scale = lengthToMetres(model.units.length);
  const [ox, oy, oz] = settings.offset;
  return new AnalysisLayer({
    nodes: model.nodes,
    members: model.members,
    surfaces: model.surfaces,
    supports: model.supports,
    pointLoads: model.point_loads.map((l) => ({ node: l.node, force: l.force })),
    lineLoads: model.line_loads,
    toViewer: (x, y, z) => frame.pointFromIfc([x * scale + ox, y * scale + oy, z * scale + oz]),
    directionToViewer: (x, y, z) => frame.directionFromIfc([x, y, z]),
  });
}

/** Axis of every linear element in the loaded model, in IFC world metres. */
export function physicalAxes(): PhysicalAxis[] {
  const { model, elements, frame } = useModel.getState();
  if (!model || !frame) return [];
  const axes: PhysicalAxis[] = [];
  for (const element of elements) {
    if (!element.has_geometry || element.is_spatial || !LINEAR_TYPES.has(element.ifc_type))
      continue;
    const box = model.boundsOf([element.express_id]);
    if (!box) continue;
    const size = new Vector3();
    box.getSize(size);
    const centre = new Vector3();
    box.getCenter(centre);
    const longest = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
    const half = new Vector3();
    half[longest] = size[longest] / 2;
    axes.push({
      global_id: element.global_id,
      ifc_type: element.ifc_type,
      name: element.name,
      tag: element.tag,
      type_name: element.type_name,
      material: element.material,
      storey: element.storey,
      start: frame.pointToIfc(centre.clone().sub(half)),
      end: frame.pointToIfc(centre.clone().add(half)),
    });
  }
  return axes;
}

function axisOf(element: ElementSummary): PhysicalAxis | null {
  return physicalAxes().find((a) => a.global_id === element.global_id) ?? null;
}

export const useAnalysis = create<AnalysisState>((set, get) => ({
  models: [],
  importing: new Set(),
  shown: null,
  loading: false,
  visibility: { members: true, nodes: true, supports: true, loads: false, surfaces: true },
  physicalVisible: true,
  settings: { tolerance: 0.5, offset: [0, 0, 0], same_kind: true },
  selectedMember: null,
  linkSet: null,
  matching: false,

  refresh: async () => {
    try {
      set({ models: await analysisModels() });
    } catch (error) {
      log.error(`Could not list analysis models: ${String(error)}`);
    }
  },

  importFile: async (relPath) => {
    if (!isTauri()) return;
    const importing = new Set(get().importing);
    importing.add(relPath);
    set({ importing });
    log.info(`Importing ${relPath}…`);
    try {
      const result = await analysisImport(relPath);
      const s = result.summary;
      log.info(
        `${relPath}: revision ${result.revision_index}, ${s.members.toLocaleString()} members, ` +
          `${s.nodes.toLocaleString()} nodes, ${s.loads} loads, ${s.results} results ` +
          `(${SOURCE_LABELS[s.source] ?? s.source}${s.program ? `, ${s.program}` : ''}, ` +
          `${s.length_unit}/${s.force_unit}) in ${result.total_ms} ms`,
      );
      for (const note of s.notes.slice(0, 5)) log.warn(`${relPath}: ${note}`);
      if (s.notes.length > 5) log.warn(`${relPath}: ${s.notes.length - 5} more note(s)`);
      await Promise.all([get().refresh(), useProject.getState().refreshFiles()]);
      await get().show(result.revision_id);
    } catch (error) {
      log.error(`Could not import ${relPath}: ${String(error)}`);
    } finally {
      const done = new Set(get().importing);
      done.delete(relPath);
      set({ importing: done });
    }
  },

  show: async (revisionId) => {
    const handle = useViewer.getState().handle;
    if (!handle) return;
    const summary = get().models.find((m) => m.revision_id === revisionId);
    if (!summary) return;
    set({ loading: true });
    try {
      const model = await analysisModel(revisionId);
      get().hide();
      const layer = buildLayer(model, get().settings);
      layer.setVisibility(get().visibility);
      handle.setAnalysisLayer(layer);
      if (!useModel.getState().model) handle.fit();
      handle.render();
      set({ shown: { revisionId, summary, model, layer }, selectedMember: null });
      log.info(
        `Showing ${summary.rel_path} (rev ${summary.revision_idx}): ${model.members.length} members`,
      );
      await get().loadLinkSet();
    } catch (error) {
      log.error(`Could not show the analysis model: ${String(error)}`);
    } finally {
      set({ loading: false });
    }
  },

  hide: () => {
    const handle = useViewer.getState().handle;
    if (get().shown) handle?.setAnalysisLayer(null);
    set({ shown: null, selectedMember: null, linkSet: null });
    useView.getState().refreshColors();
  },

  setVisibility: (patch) => {
    const visibility = { ...get().visibility, ...patch };
    set({ visibility });
    get().shown?.layer.setVisibility(visibility);
    useViewer.getState().handle?.render();
  },

  setPhysicalVisible: (visible) => {
    set({ physicalVisible: visible });
    const model = useModel.getState().model;
    if (model) model.group.visible = visible;
    useViewer.getState().handle?.render();
  },

  setSettings: (patch) => {
    const before = get().settings;
    const settings = { ...before, ...patch };
    set({ settings });
    if (settings.offset.some((v, i) => v !== before.offset[i])) get().rebuildLayer();
  },

  rebuildLayer: () => {
    const { shown, visibility, settings, selectedMember } = get();
    const handle = useViewer.getState().handle;
    if (!shown || !handle) return;
    const layer = buildLayer(shown.model, settings);
    layer.setVisibility(visibility);
    handle.setAnalysisLayer(layer);
    layer.highlight(selectedMember);
    handle.render();
    set({ shown: { ...shown, layer } });
    applyMemberColors();
  },

  selectMember: (uid, focus = false) => {
    const { shown } = get();
    set({ selectedMember: uid });
    if (!shown) return;
    shown.layer.highlight(uid);
    const handle = useViewer.getState().handle;
    if (uid && focus) {
      const box = shown.layer.memberBounds(uid);
      if (box) handle?.fitTo(box);
    }
    handle?.render();
    // A linked member brings its physical element into the selection.
    if (uid) {
      const link = get().linkSet?.report.links.find((l) => l.member_uid === uid);
      const model = useModel.getState();
      const id = link ? model.byGlobalId.get(link.global_id) : undefined;
      if (id !== undefined) void model.selectMany([id]);
    }
  },

  match: async () => {
    const { shown, settings } = get();
    const physical = useModel.getState().revision;
    if (!shown || !physical || !isTauri()) return;
    const axes = physicalAxes();
    if (axes.length === 0) {
      log.warn('The loaded model has no beams, columns or members with geometry to match.');
      return;
    }
    set({ matching: true });
    try {
      const started = performance.now();
      const linkSet = await analysisMatch(physical.id, shown.revisionId, axes, settings);
      set({ linkSet });
      const r = linkSet.report;
      log.info(
        `Matched ${r.links.length} of ${r.physical_count} elements to ${r.member_count} members: ` +
          `${r.section_mismatches} section and ${r.material_mismatches} material difference(s), ` +
          `${r.unmatched_physical.length} elements and ${r.unmatched_members.length} members ` +
          `unmatched (${Math.round(performance.now() - started)} ms)`,
      );
      applyMemberColors();
      useView.getState().refreshColors();
    } catch (error) {
      log.error(`Matching failed: ${String(error)}`);
    } finally {
      set({ matching: false });
    }
  },

  loadLinkSet: async () => {
    const { shown } = get();
    const physical = useModel.getState().revision;
    if (!shown || !physical) {
      set({ linkSet: null });
      applyMemberColors();
      return;
    }
    try {
      const linkSet = await analysisLinkSet(physical.id, shown.revisionId);
      set({ linkSet });
      if (linkSet) set({ settings: linkSet.settings });
      applyMemberColors();
      useView.getState().refreshColors();
    } catch (error) {
      log.error(`Could not load links: ${String(error)}`);
    }
  },

  linkSelection: async (memberUid) => {
    const { shown, linkSet } = get();
    const model = useModel.getState();
    const physical = model.revision;
    if (!shown || !physical || !linkSet) return;
    const selected = [...model.selectedIds];
    if (selected.length !== 1) {
      log.warn('Select exactly one element to link.');
      return;
    }
    const element = model.byId.get(selected[0]!);
    if (!element) return;
    try {
      const report: LinkReport = await analysisLinkOverride(
        physical.id,
        shown.revisionId,
        element.global_id,
        memberUid,
        axisOf(element),
      );
      set({ linkSet: { ...linkSet, report } });
      log.info(
        memberUid
          ? `Linked ${element.name ?? element.global_id} to ${memberUid}`
          : `Unlinked ${element.name ?? element.global_id}`,
      );
      applyMemberColors();
      useView.getState().refreshColors();
    } catch (error) {
      log.error(`Could not change the link: ${String(error)}`);
    }
  },

  focusElement: (globalId) => {
    const model = useModel.getState();
    const id = model.byGlobalId.get(globalId);
    if (id === undefined) return;
    void model.selectMany([id]);
    model.fitTo([id]);
  },
}));

/** Member colours from the link report: linked, differing, or unmatched. */
function applyMemberColors(): void {
  const { shown, linkSet } = useAnalysis.getState();
  if (!shown) return;
  if (!linkSet) {
    shown.layer.setMemberColors(null);
  } else {
    const colors = new Map<string, string>();
    for (const link of linkSet.report.links) {
      colors.set(
        link.member_uid,
        link.section_ok === false ? '#f5b941' : link.material_ok === false ? '#c084fc' : '#3ccf7a',
      );
    }
    for (const uid of linkSet.report.unmatched_members) colors.set(uid, '#ff6b6b');
    shown.layer.setMemberColors(colors);
  }
  useViewer.getState().handle?.render();
}

/** Link status per physical GlobalId for "colour by link". */
export function linkStatuses(report: LinkReport | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!report) return map;
  for (const link of report.links) {
    map.set(
      link.global_id,
      link.section_ok === false
        ? 'section differs'
        : link.material_ok === false
          ? 'material differs'
          : 'linked',
    );
  }
  for (const id of report.unmatched_physical) map.set(id, 'unmatched');
  return map;
}

setLinkSource(() => linkStatuses(useAnalysis.getState().linkSet?.report));

// The physical revision changed: the layer must be re-placed in the new frame and the
// links belong to another pair.
useModel.subscribe((state, previous) => {
  if (state.model !== previous.model) {
    const analysis = useAnalysis.getState();
    if (analysis.shown) {
      analysis.rebuildLayer();
      void analysis.loadLinkSet();
    }
    if (state.model) state.model.group.visible = analysis.physicalVisible;
  }
});

useProject.subscribe((state, previous) => {
  if (state.current?.root !== previous.current?.root) {
    useAnalysis.getState().hide();
    useAnalysis.setState({ models: [] });
  }
});

export type { Triple };
