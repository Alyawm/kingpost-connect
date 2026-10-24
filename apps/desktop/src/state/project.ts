import { create } from 'zustand';
import {
  isTauri,
  projectClose,
  projectCreate,
  projectCurrent,
  projectIsProject,
  projectOpen,
  type ProjectInfo,
} from '../lib/ipc';
import { log } from './log';

interface ProjectState {
  current: ProjectInfo | null;
  busy: boolean;
  refresh(): Promise<void>;
  /** Lets the user pick a folder; opens it as a project, creating one if it is plain. */
  openFolder(): Promise<void>;
  close(): Promise<void>;
}

export const useProject = create<ProjectState>((set) => ({
  current: null,
  busy: false,

  refresh: async () => {
    if (!isTauri()) return;
    set({ current: await projectCurrent() });
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
      set({ current: info });
      log.info(`${existing ? 'Opened' : 'Created'} project "${info.name}" at ${info.root}`);
    } catch (error) {
      log.error(String(error));
    } finally {
      set({ busy: false });
    }
  },

  close: async () => {
    if (isTauri()) await projectClose();
    set({ current: null });
    log.info('Project closed');
  },
}));

export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? 'Project';
}
