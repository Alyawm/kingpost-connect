/**
 * Typed wrappers around the Tauri commands exposed by `src-tauri/src/commands/`.
 * Keep the two sides in step: every function here has one `#[tauri::command]` there.
 *
 * Outside the desktop shell (plain `vite` in a browser) `isTauri()` is false and the
 * wrappers return harmless defaults, so the interface can be developed without Rust.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';

export { isTauri };

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
