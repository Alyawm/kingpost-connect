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
