/**
 * Typed wrappers around the Tauri commands exposed by `src-tauri/src/commands/`.
 * Keep the two sides in step: every function here has one `#[tauri::command]` there.
 *
 * Outside the desktop shell (plain `vite` in a browser) `isTauri()` is false and the
 * wrappers return harmless defaults, so the interface can be developed without Rust.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';

export { isTauri };

/** Subscribes to a shell event; resolves to the unsubscribe function. No-op in a browser. */
export async function onShellEvent(name: string, handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen(name, handler);
}

export interface AppInfo {
  name: string;
  version: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  root: string;
  created_at: string;
}

export interface RevisionRow {
  id: number;
  file_id: number;
  idx: number;
  imported_at: string;
  source_sha256: string;
  note: string | null;
  schema: string | null;
  units_json: string;
  element_count: number;
}

export type FileKind = 'ifc' | 'pdf' | 'e2k' | 's2k' | 'saf';

export interface ProjectFile {
  rel_path: string;
  kind: FileKind;
  size: number;
  mtime: string | null;
  revisions: RevisionRow[];
}

export interface ElementSummary {
  express_id: number;
  global_id: string;
  ifc_type: string;
  name: string | null;
  tag: string | null;
  storey: string | null;
  type_name: string | null;
  material: string | null;
  parent_express_id: number | null;
  has_geometry: boolean;
  is_spatial: boolean;
}

export interface PropertyOut {
  pset: string;
  name: string;
  value_text: string | null;
  value_num: number | null;
  unit: string | null;
  kind: string;
}

export interface ElementDetails {
  element: ElementSummary;
  properties: PropertyOut[];
}

export interface Units {
  length: string | null;
  area: string | null;
  volume: string | null;
  mass: string | null;
  angle: string | null;
}

export interface ImportSummary {
  file_id: number;
  revision_id: number;
  revision_index: number;
  schema: string;
  units: Units;
  sha256: string;
  stats: {
    entities: number;
    types: number;
    elements: number;
    spatial: number;
    property_sets: number;
    quantity_sets: number;
    properties: number;
    scan_ms: number;
    extract_ms: number;
  };
  store_ms: number;
  total_ms: number;
}

export async function appInfo(): Promise<AppInfo> {
  if (!isTauri()) return { name: 'KingPost Connect', version: 'web preview' };
  return invoke<AppInfo>('app_info');
}

export function projectIsProject(root: string): Promise<boolean> {
  return invoke<boolean>('project_is_project', { root });
}

export function projectCreate(root: string, name: string): Promise<ProjectInfo> {
  return invoke<ProjectInfo>('project_create', { root, name });
}

export function projectOpen(root: string): Promise<ProjectInfo> {
  return invoke<ProjectInfo>('project_open', { root });
}

export function projectClose(): Promise<void> {
  return invoke<void>('project_close');
}

export function projectCurrent(): Promise<ProjectInfo | null> {
  return invoke<ProjectInfo | null>('project_current');
}

export function projectFiles(): Promise<ProjectFile[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<ProjectFile[]>('project_files');
}

export function importIfc(relPath: string): Promise<ImportSummary> {
  return invoke<ImportSummary>('import_ifc', { relPath });
}

/** Raw bytes of a project file; the shell answers with an ArrayBuffer. */
export async function readProjectFile(relPath: string): Promise<Uint8Array> {
  const buffer = await invoke<ArrayBuffer>('read_project_file', { relPath });
  return new Uint8Array(buffer);
}

export function revisionInfo(revisionId: number): Promise<RevisionRow> {
  return invoke<RevisionRow>('revision_info', { revisionId });
}

export function revisionElements(revisionId: number): Promise<ElementSummary[]> {
  return invoke<ElementSummary[]>('revision_elements', { revisionId });
}

export function elementDetails(
  revisionId: number,
  expressId: number,
): Promise<ElementDetails | null> {
  return invoke<ElementDetails | null>('element_details', { revisionId, expressId });
}

export function searchElements(
  revisionId: number,
  query: string,
  limit = 200,
): Promise<ElementSummary[]> {
  return invoke<ElementSummary[]>('search_elements', { revisionId, query, limit });
}

export interface SavedView {
  id: string;
  name: string;
  camera_json: string;
  visibility_json: string;
  section_planes_json: string;
  /** JPEG data URL, when a thumbnail was stored. */
  thumbnail: string | null;
  created_at: string;
}

export function viewsList(): Promise<SavedView[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<SavedView[]>('views_list');
}

export function viewSave(
  name: string,
  cameraJson: string,
  visibilityJson: string,
  sectionPlanesJson: string,
  thumbnail: string | null,
): Promise<SavedView> {
  return invoke<SavedView>('view_save', {
    name,
    cameraJson,
    visibilityJson,
    sectionPlanesJson,
    thumbnail,
  });
}

export function viewRename(id: string, name: string): Promise<boolean> {
  return invoke<boolean>('view_rename', { id, name });
}

export function viewDelete(id: string): Promise<boolean> {
  return invoke<boolean>('view_delete', { id });
}

// ---- Review: issues, comments, viewpoints, element status, BCF ----

export type Triple = [number, number, number];

export interface IssueRow {
  id: string;
  bcf_guid: string;
  title: string;
  description: string | null;
  topic_type: string;
  status: string;
  priority: string | null;
  assignee: string | null;
  due: string | null;
  labels: string[];
  stage: string | null;
  idx: number | null;
  created_by: string;
  created_at: string;
  modified_by: string | null;
  modified_at: string | null;
  comment_count: number;
  viewpoint_count: number;
  element_count: number;
}

export interface NewIssue {
  title: string;
  description?: string | null;
  topic_type?: string | null;
  status?: string | null;
  priority?: string | null;
  assignee?: string | null;
  due?: string | null;
  labels: string[];
  stage?: string | null;
  created_by: string;
}

/** Omit a field to leave it alone; send null to clear it. */
export interface IssuePatch {
  title?: string;
  description?: string | null;
  topic_type?: string;
  status?: string;
  priority?: string | null;
  assignee?: string | null;
  due?: string | null;
  labels?: string[];
  stage?: string | null;
}

export interface CommentRow {
  id: string;
  issue_id: string;
  author: string;
  text: string;
  viewpoint_id: string | null;
  created_at: string;
}

export interface ViewpointCamera {
  view_point: Triple;
  direction: Triple;
  up: Triple;
  field_of_view: number;
  aspect_ratio: number;
}

export interface ViewpointComponents {
  selection: string[];
  default_visibility: boolean;
  exceptions: string[];
  coloring: { color: string; ifc_guids: string[] }[];
}

export interface ViewpointLine {
  start: Triple;
  end: Triple;
}

export interface ViewpointClipping {
  location: Triple;
  direction: Triple;
}

export interface NewViewpointInput {
  camera: ViewpointCamera;
  components: ViewpointComponents;
  lines: ViewpointLine[];
  clipping: ViewpointClipping[];
  snapshot: string | null;
}

export interface ViewpointRow {
  id: string;
  issue_id: string;
  guid: string;
  camera_json: string;
  components_json: string;
  lines_json: string;
  clipping_json: string;
  has_snapshot: boolean;
  created_at: string;
}

export interface IssueDetails {
  issue: IssueRow;
  elements: string[];
  comments: CommentRow[];
  viewpoints: ViewpointRow[];
}

export interface StatusRow {
  element_global_id: string;
  stage: string;
  set_by: string;
  set_at: string;
  note: string | null;
}

export interface BcfImportSummary {
  topics_added: number;
  topics_skipped: number;
  comments_added: number;
  viewpoints_added: number;
}

export function issuesList(): Promise<IssueRow[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<IssueRow[]>('issues_list');
}

export function issueDetails(id: string): Promise<IssueDetails | null> {
  return invoke<IssueDetails | null>('issue_details', { id });
}

export function issueCreate(
  issue: NewIssue,
  elements: string[],
  viewpoint: NewViewpointInput | null,
): Promise<IssueRow> {
  return invoke<IssueRow>('issue_create', { issue, elements, viewpoint });
}

export function issueUpdate(
  id: string,
  patch: IssuePatch,
  author: string,
): Promise<IssueRow | null> {
  return invoke<IssueRow | null>('issue_update', { id, patch, author });
}

export function issueSetElements(id: string, elements: string[]): Promise<void> {
  return invoke<void>('issue_set_elements', { id, elements });
}

export function issueDelete(id: string): Promise<boolean> {
  return invoke<boolean>('issue_delete', { id });
}

export function commentAdd(
  issueId: string,
  text: string,
  author: string,
  viewpointId: string | null,
): Promise<CommentRow[]> {
  return invoke<CommentRow[]>('comment_add', { issueId, text, author, viewpointId });
}

export function viewpointAdd(issueId: string, viewpoint: NewViewpointInput): Promise<ViewpointRow> {
  return invoke<ViewpointRow>('viewpoint_add', { issueId, viewpoint });
}

export function viewpointSnapshot(id: string): Promise<string | null> {
  return invoke<string | null>('viewpoint_snapshot', { id });
}

export function viewpointDelete(id: string): Promise<boolean> {
  return invoke<boolean>('viewpoint_delete', { id });
}

export function statusList(): Promise<StatusRow[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<StatusRow[]>('status_list');
}

export function statusSet(
  globalIds: string[],
  stage: string,
  author: string,
  note: string | null,
): Promise<number> {
  return invoke<number>('status_set', { globalIds, stage, author, note });
}

export function statusClear(globalIds: string[]): Promise<number> {
  return invoke<number>('status_clear', { globalIds });
}

export function bcfExport(path: string): Promise<number> {
  return invoke<number>('bcf_export', { path });
}

export function bcfImport(path: string): Promise<BcfImportSummary> {
  return invoke<BcfImportSummary>('bcf_import', { path });
}

// ---- Compare: revision diffs ----

export type ChangeKind = 'added' | 'removed' | 'modified';

export interface FieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface DiffItem {
  global_id: string;
  change: ChangeKind;
  detail: {
    ifc_type: string;
    name: string | null;
    storey: string | null;
    type_name: string | null;
    changes: FieldChange[];
  };
}

export interface DiffSummary {
  from_elements: number;
  to_elements: number;
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  by_type: Record<string, [number, number, number]>;
  elapsed_ms: number;
}

export interface DiffView {
  id: number;
  from_revision_id: number;
  to_revision_id: number;
  computed_at: string;
  cached: boolean;
  summary: DiffSummary;
  items: DiffItem[];
}

export function diffRevisions(
  fromRevisionId: number,
  toRevisionId: number,
  force = false,
): Promise<DiffView> {
  return invoke<DiffView>('diff_revisions', { fromRevisionId, toRevisionId, force });
}

export function diffExportCsv(
  fromRevisionId: number,
  toRevisionId: number,
  path: string,
): Promise<number> {
  return invoke<number>('diff_export_csv', { fromRevisionId, toRevisionId, path });
}

// ---- Analysis: SAF / ETABS / SAP2000 models, the IFC structural view, and linking ----

export type MemberKind = 'beam' | 'column' | 'brace' | 'other';

export interface AnalysisUnits {
  length: string;
  force: string;
}
export interface AnalysisNode {
  name: string;
  x: number;
  y: number;
  z: number;
}
export interface AnalysisMember {
  uid: string;
  name: string;
  kind: MemberKind;
  start: string;
  end: string;
  section: string | null;
  material: string | null;
  storey: string | null;
}
export interface AnalysisSurface {
  uid: string;
  name: string;
  kind: string;
  nodes: string[];
  section: string | null;
  material: string | null;
  storey: string | null;
}
export interface AnalysisMaterial {
  name: string;
  kind: string;
  grade: string | null;
  e_modulus: number | null;
  unit_weight: number | null;
}
export interface AnalysisSection {
  name: string;
  material: string | null;
  shape: string | null;
  dimensions: { name: string; value: number }[];
  thickness: number | null;
}
export interface AnalysisSupport {
  node: string;
  fixed: boolean[];
}
export interface AnalysisLoadCase {
  name: string;
  kind: string;
}
export interface AnalysisCombination {
  name: string;
  kind: string;
  factors: { case: string; factor: number }[];
}
export interface AnalysisPointLoad {
  node: string;
  case: string;
  force: [number, number, number];
  moment: [number, number, number];
}
export interface AnalysisLineLoad {
  member: string;
  case: string;
  direction: string;
  start: number;
  end: number;
  from: number;
  to: number;
}
export interface AnalysisSurfaceLoad {
  surface: string;
  case: string;
  direction: string;
  value: number;
}
export interface MemberForce {
  member: string;
  case: string;
  station: number;
  n: number;
  vy: number;
  vz: number;
  t: number;
  my: number;
  mz: number;
}
export interface AnalysisModel {
  source: string;
  program: string | null;
  units: AnalysisUnits;
  storeys: { name: string; elevation: number }[];
  nodes: AnalysisNode[];
  members: AnalysisMember[];
  surfaces: AnalysisSurface[];
  materials: AnalysisMaterial[];
  sections: AnalysisSection[];
  supports: AnalysisSupport[];
  load_cases: AnalysisLoadCase[];
  combinations: AnalysisCombination[];
  point_loads: AnalysisPointLoad[];
  line_loads: AnalysisLineLoad[];
  surface_loads: AnalysisSurfaceLoad[];
  results: MemberForce[];
  notes: string[];
}

export interface AnalysisSummary {
  source: string;
  program: string | null;
  length_unit: string;
  force_unit: string;
  nodes: number;
  members: number;
  surfaces: number;
  supports: number;
  load_cases: number;
  combinations: number;
  loads: number;
  results: number;
  notes: string[];
}

export interface AnalysisImportSummary {
  file_id: number;
  revision_id: number;
  revision_index: number;
  summary: AnalysisSummary;
  total_ms: number;
}

export interface AnalysisModelSummary {
  revision_id: number;
  file_id: number;
  rel_path: string;
  revision_idx: number;
  imported_at: string;
  source: string;
  program: string | null;
  length_unit: string;
  force_unit: string;
  node_count: number;
  member_count: number;
  surface_count: number;
  load_count: number;
  result_count: number;
}

export interface PhysicalAxis {
  global_id: string;
  ifc_type: string;
  name: string | null;
  tag: string | null;
  type_name: string | null;
  material: string | null;
  storey: string | null;
  start: Triple;
  end: Triple;
}

export interface MatchSettings {
  tolerance: number;
  offset: Triple;
  same_kind: boolean;
}

export type LinkMethod = 'name' | 'position' | 'manual';

export interface Link {
  global_id: string;
  member_uid: string;
  method: LinkMethod;
  distance: number;
  physical_section: string | null;
  analysis_section: string | null;
  section_ok: boolean | null;
  physical_material: string | null;
  analysis_material: string | null;
  material_ok: boolean | null;
}

export interface LinkReport {
  links: Link[];
  unmatched_physical: string[];
  unmatched_members: string[];
  physical_count: number;
  member_count: number;
  section_mismatches: number;
  material_mismatches: number;
}

export interface LinkSetView {
  computed_at: string;
  settings: MatchSettings;
  report: LinkReport;
}

export function analysisImport(relPath: string): Promise<AnalysisImportSummary> {
  return invoke<AnalysisImportSummary>('analysis_import', { relPath });
}

export function analysisModels(): Promise<AnalysisModelSummary[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<AnalysisModelSummary[]>('analysis_models');
}

export async function analysisModel(revisionId: number): Promise<AnalysisModel> {
  const json = await invoke<string>('analysis_model', { revisionId });
  return JSON.parse(json) as AnalysisModel;
}

export function analysisMatch(
  physicalRevisionId: number,
  analysisRevisionId: number,
  axes: PhysicalAxis[],
  settings: MatchSettings,
): Promise<LinkSetView> {
  return invoke<LinkSetView>('analysis_match', {
    physicalRevisionId,
    analysisRevisionId,
    axes,
    settings,
  });
}

export function analysisLinkSet(
  physicalRevisionId: number,
  analysisRevisionId: number,
): Promise<LinkSetView | null> {
  if (!isTauri()) return Promise.resolve(null);
  return invoke<LinkSetView | null>('analysis_link_set', {
    physicalRevisionId,
    analysisRevisionId,
  });
}

export function analysisLinkOverride(
  physicalRevisionId: number,
  analysisRevisionId: number,
  globalId: string,
  memberUid: string | null,
  axis: PhysicalAxis | null,
): Promise<LinkReport> {
  return invoke<LinkReport>('analysis_link_override', {
    physicalRevisionId,
    analysisRevisionId,
    globalId,
    memberUid,
    axis,
  });
}

// ---- Drawings: PDF sheet sets, links to the model, markups ----

export interface SheetRow {
  id: number;
  revision_id: number;
  file_id: number;
  rel_path: string;
  revision_idx: number;
  page: number;
  number: string | null;
  title: string | null;
  scale: string | null;
  width: number;
  height: number;
  has_thumbnail: boolean;
  link_count: number;
  markup_count: number;
}

export interface SheetHit {
  sheet_id: number;
  rel_path: string;
  revision_idx: number;
  page: number;
  number: string | null;
  title: string | null;
  excerpt: string;
}

/** A rectangle in page fractions (0..1 from the top-left corner). */
export interface SheetRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetLinkRow {
  id: string;
  sheet_id: number;
  region_json: string;
  element_global_id: string | null;
  view_id: string | null;
  label: string | null;
  created_by: string;
  created_at: string;
}

export interface ElementSheetLink {
  link: SheetLinkRow;
  rel_path: string;
  revision_id: number;
  revision_idx: number;
  page: number;
  number: string | null;
  title: string | null;
}

export type SheetMarkupKind = 'rect' | 'cloud' | 'line' | 'arrow' | 'text';

export interface SheetMarkupRow {
  id: string;
  sheet_id: number;
  author: string;
  kind: SheetMarkupKind | string;
  geometry_json: string;
  text: string | null;
  created_at: string;
}

export interface SheetInput {
  page: number;
  number: string | null;
  title: string | null;
  scale: string | null;
  width: number;
  height: number;
  text: string;
  thumbnail: string | null;
}

export interface DrawingImport {
  file_id: number;
  revision_id: number;
  revision_index: number;
  previous_revision_id: number | null;
}

export function drawingImport(relPath: string): Promise<DrawingImport> {
  return invoke<DrawingImport>('drawing_import', { relPath });
}

export function sheetsRegister(
  revisionId: number,
  sheets: SheetInput[],
  carryFromRevisionId: number | null,
): Promise<number> {
  return invoke<number>('sheets_register', { revisionId, sheets, carryFromRevisionId });
}

export function sheetsList(revisionId?: number): Promise<SheetRow[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<SheetRow[]>('sheets_list', { revisionId: revisionId ?? null });
}

export function sheetThumbnail(sheetId: number): Promise<string | null> {
  return invoke<string | null>('sheet_thumbnail', { sheetId });
}

export function sheetUpdate(
  sheetId: number,
  number: string | null,
  title: string | null,
  scale: string | null,
): Promise<SheetRow> {
  return invoke<SheetRow>('sheet_update', { sheetId, number, title, scale });
}

export function sheetsSearch(query: string, limit = 50): Promise<SheetHit[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<SheetHit[]>('sheets_search', { query, limit });
}

export function sheetLinks(sheetId: number): Promise<SheetLinkRow[]> {
  return invoke<SheetLinkRow[]>('sheet_links', { sheetId });
}

export function elementSheetLinks(globalIds: string[]): Promise<ElementSheetLink[]> {
  if (!isTauri() || globalIds.length === 0) return Promise.resolve([]);
  return invoke<ElementSheetLink[]>('element_sheet_links', { globalIds });
}

export function sheetLinkCreate(
  sheetId: number,
  region: SheetRegion,
  elementGlobalId: string | null,
  viewId: string | null,
  label: string | null,
  author: string,
): Promise<SheetLinkRow[]> {
  return invoke<SheetLinkRow[]>('sheet_link_create', {
    sheetId,
    region,
    elementGlobalId,
    viewId,
    label,
    author,
  });
}

export function sheetLinkDelete(id: string): Promise<boolean> {
  return invoke<boolean>('sheet_link_delete', { id });
}

export function sheetMarkups(sheetId: number): Promise<SheetMarkupRow[]> {
  return invoke<SheetMarkupRow[]>('sheet_markups', { sheetId });
}

export function sheetMarkupAdd(
  sheetId: number,
  kind: SheetMarkupKind,
  geometry: unknown,
  text: string | null,
  author: string,
): Promise<SheetMarkupRow[]> {
  return invoke<SheetMarkupRow[]>('sheet_markup_add', { sheetId, kind, geometry, text, author });
}

export function sheetMarkupDelete(id: string): Promise<boolean> {
  return invoke<boolean>('sheet_markup_delete', { id });
}
