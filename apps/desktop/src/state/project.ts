import { create } from 'zustand';
import {
  importIfc,
  isTauri,
  onShellEvent,
  projectClose,
  projectCreate,
  projectCurrent,
  projectFiles,
  projectIsProject,
  projectOpen,
  projectSample,
  type ImportSummary,
  type ProjectFile,
  type ProjectInfo,
} from '../lib/ipc';
import { log } from './log';
import { useUi } from './ui';
import { useModel } from './model';

interface ProjectState {
  current: ProjectInfo | null;
  busy: boolean;
  files: ProjectFile[];
  /** Relative paths of files currently being imported. */
  importing: Set<string>;
  refresh(): Promise<void>;
  refreshFiles(): Promise<void>;
  /** Lets the user pick a folder; opens it as a project, creating one if it is plain. */
  openFolder(): Promise<void>;
  /** Opens a known folder without the picker (recent projects). */
  openPath(root: string): Promise<void>;
  /** Opens the bundled sample project, imports its model once and shows it. */
  openSample(): Promise<void>;
  close(): Promise<void>;
  importFile(relPath: string): Promise<ImportSummary | null>;
  /** Refreshes the file list when the shell reports changes in the project folder. */
  watchFiles(): Promise<() => void>;
}

export const useProject = create<ProjectState>((set, get) => ({
  current: null,
  busy: false,
  files: [],
  importing: new Set(),

  refresh: async () => {
    if (!isTauri()) return;
    set({ current: await projectCurrent() });
    await get().refreshFiles();
  },

  refreshFiles: async () => {
    if (!get().current) {
      set({ files: [] });
      return;
    }
    try {
      set({ files: await projectFiles() });
    } catch (error) {
      log.error(`Could not list project files: ${String(error)}`);
    }
  },

  openFolder: async () => {
    if (!isTauri()) {
      log.warn(
        'Opening a project needs the desktop application; the browser preview has no file access.',
      );
      return;
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const root = await open({
      directory: true,
      multiple: false,
      title: 'Choose a project folder',
    });
    if (!root) return;

    set({ busy: true });
    try {
      const existing = await projectIsProject(root);
      const info = existing ? await projectOpen(root) : await projectCreate(root, folderName(root));
      useModel.getState().clear();
      set({ current: info });
      useUi.getState().rememberProject(info.root);
      log.info(`${existing ? 'Opened' : 'Created'} project "${info.name}" at ${info.root}`);
      await get().refreshFiles();
    } catch (error) {
      log.error(String(error));
    } finally {
      set({ busy: false });
    }
  },

  openPath: async (root) => {
    if (!isTauri()) return;
    set({ busy: true });
    try {
      const existing = await projectIsProject(root);
      if (!existing) {
        log.warn(`${root} is no longer a project folder.`);
        useUi.getState().forgetProject(root);
        return;
      }
      const info = await projectOpen(root);
      useModel.getState().clear();
      set({ current: info });
      useUi.getState().rememberProject(info.root);
      log.info(`Opened project "${info.name}" at ${info.root}`);
      await get().refreshFiles();
    } catch (error) {
      log.error(String(error));
    } finally {
      set({ busy: false });
    }
  },

  openSample: async () => {
    if (!isTauri()) return;
    set({ busy: true });
    let info: ProjectInfo;
    try {
      info = await projectSample();
      useModel.getState().clear();
      set({ current: info });
      useUi.getState().rememberProject(info.root);
      log.info(`Opened the sample project at ${info.root}`);
      await get().refreshFiles();
    } catch (error) {
      log.error(`Could not open the sample project: ${String(error)}`);
      return;
    } finally {
      set({ busy: false });
    }
    let file = get().files.find((f) => f.kind === 'ifc');
    if (!file) return;
    if (file.revisions.length === 0) {
      await get().importFile(file.rel_path);
      file = get().files.find((f) => f.rel_path === file?.rel_path);
    }
    const revision = file?.revisions[file.revisions.length - 1];
    if (!file || !revision) return;
    await useModel.getState().load(file.rel_path, revision);
    useUi.setState({ section: 'viewer', leftOpen: true });
    log.info('Select elements in the model to change their colour and transparency.');
  },

  close: async () => {
    useModel.getState().clear();
    if (isTauri()) await projectClose();
    set({ current: null, files: [] });
    log.info('Project closed');
  },

  watchFiles: async () => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unlisten = await onShellEvent('files:changed', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void get().refreshFiles(), 300);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unlisten();
    };
  },

  importFile: async (relPath) => {
    const importing = new Set(get().importing);
    importing.add(relPath);
    set({ importing });
    log.info(`Importing ${relPath}…`);
    try {
      const summary = await importIfc(relPath);
      const s = summary.stats;
      log.info(
        `${relPath}: revision ${summary.revision_index}, ${s.elements.toLocaleString()} elements, ` +
          `${s.properties.toLocaleString()} properties (${summary.schema}) in ${summary.total_ms} ms`,
      );
      await get().refreshFiles();
      return summary;
    } catch (error) {
      log.error(`Import of ${relPath} failed: ${String(error)}`);
      return null;
    } finally {
      const done = new Set(get().importing);
      done.delete(relPath);
      set({ importing: done });
    }
  },
}));

export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? 'Project';
}
