/**
 * Typed wrappers around the Tauri commands exposed by `src-tauri/src/commands.rs`.
 * Keep the two files in step: every command here has one `#[tauri::command]` there.
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
