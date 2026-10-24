import { create } from 'zustand';
import type { Update } from '@tauri-apps/plugin-updater';
import { isTauri } from '../lib/ipc';
import { log } from './log';
import { useUi } from './ui';

export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'none'; current: string }
  | { phase: 'available'; version: string; notes: string | null; date: string | null }
  | { phase: 'downloading'; received: number; total: number | null }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string };

interface UpdatesState {
  state: UpdateState;
  /** Asks the release server once; only on the user's request or the start-up setting. */
  check(quiet?: boolean): Promise<void>;
  /** Downloads and installs the available update, then restarts. */
  install(): Promise<void>;
}

let pending: Update | null = null;

export const useUpdates = create<UpdatesState>((set) => ({
  state: { phase: 'idle' },

  check: async (quiet = false) => {
    if (!isTauri()) {
      if (!quiet) log.info('Update checks need the desktop application.');
      return;
    }
    set({ state: { phase: 'checking' } });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        pending = update;
        set({
          state: {
            phase: 'available',
            version: update.version,
            notes: update.body ?? null,
            date: update.date ?? null,
          },
        });
        log.info(`Version ${update.version} is available.`);
      } else {
        pending = null;
        const { getVersion } = await import('@tauri-apps/api/app');
        const current = await getVersion();
        set({ state: { phase: 'none', current } });
        if (!quiet) log.info(`KingPost Connect ${current} is up to date.`);
      }
    } catch (error) {
      pending = null;
      const message = String(error);
      set({ state: { phase: 'error', message } });
      if (!quiet) log.warn(`Update check failed: ${message}`);
    }
  },

  install: async () => {
    const update = pending;
    if (!update) return;
    let received = 0;
    let total: number | null = null;
    set({ state: { phase: 'downloading', received, total } });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? null;
        else if (event.event === 'Progress') received += event.data.chunkLength;
        set({ state: { phase: 'downloading', received, total } });
      });
      set({ state: { phase: 'ready', version: update.version } });
      log.info(`Version ${update.version} installed; restarting.`);
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (error) {
      set({ state: { phase: 'error', message: String(error) } });
      log.error(`Update failed: ${String(error)}`);
    }
  },
}));

/** Runs the start-up check once when the user has turned it on. */
export function checkAtStartupIfEnabled(): void {
  if (useUi.getState().checkUpdatesAtStartup) void useUpdates.getState().check(true);
}
