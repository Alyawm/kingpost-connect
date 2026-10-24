import { create } from 'zustand';
import { appInfo, type AppInfo } from '../lib/ipc';
import { log } from './log';

interface AppState {
  info: AppInfo | null;
  load(): Promise<void>;
}

let loading: Promise<void> | null = null;

export const useApp = create<AppState>((set, get) => ({
  info: null,
  // Idempotent: React may run the mounting effect twice in development.
  load: () => {
    if (get().info) return Promise.resolve();
    loading ??= appInfo()
      .then((info) => {
        set({ info });
        log.info(`${info.name} ${info.version} ready`);
      })
      .catch((error: unknown) => {
        log.error(`Could not read application info: ${String(error)}`);
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  },
}));
