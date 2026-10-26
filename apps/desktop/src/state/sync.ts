import { create } from 'zustand';
import {
  isTauri,
  syncNow,
  syncRetry,
  syncSetAuto,
  syncSetFolder,
  syncStatus,
  syncJoin,
  syncSharedProjects,
  type SharedProject,
  type SyncPeer,
  type SyncReport,
  type SyncStatus,
} from '../lib/ipc';
import { log } from './log';
import { useAnalysis } from './analysis';
import { useClash } from './clash';
import { useDrawings } from './drawings';
import { useNotes } from './notes';
import { useProject } from './project';
import { useReview } from './review';
import { useUi } from './ui';
import { useViews } from './views';

/** How often a project with automatic sync looks for changes. */
export const AUTO_SYNC_MS = 2 * 60 * 1000;

interface SyncState {
  status: SyncStatus | null;
  busy: boolean;
  last: SyncReport | null;
  /** Other copies seen in the last sync. */
  peers: SyncPeer[];
  error: string | null;
  refresh(): Promise<void>;
  /** Lets the user pick the shared folder (OneDrive, Dropbox, network share ...). */
  chooseFolder(): Promise<void>;
  stopSyncing(): Promise<void>;
  setAuto(on: boolean): Promise<void>;
  /** Sends and receives now. `quiet` (automatic syncs) logs only when something moved. */
  syncNow(quiet?: boolean): Promise<void>;
  /** Shared projects found in the folder picked for joining, when there is a choice. */
  joinChoices: SharedProject[] | null;
  /** Picks a shared folder and lists the projects in it. */
  startJoin(): Promise<void>;
  /** Picks a folder for the local copy, creates it and opens it; the first sync fills it. */
  join(project: SharedProject): Promise<void>;
  cancelJoin(): void;
}

const IMPORTERS: Record<string, (relPath: string) => Promise<unknown>> = {
  ifc: (p) => useProject.getState().importFile(p),
  pdf: (p) => useDrawings.getState().importFile(p),
  saf: (p) => useAnalysis.getState().importFile(p),
  e2k: (p) => useAnalysis.getState().importFile(p),
  s2k: (p) => useAnalysis.getState().importFile(p),
};

/** Reloads every panel that shows shared content. */
async function reloadShared(): Promise<void> {
  const openSheet = useDrawings.getState().open?.sheet.id ?? null;
  await Promise.allSettled([
    useReview.getState().refresh(),
    useNotes.getState().refresh(),
    useViews.getState().refresh(),
    useClash.getState().refresh(),
    useDrawings.getState().refresh(),
  ]);
  if (openSheet !== null) await useDrawings.getState().openSheet(openSheet);
}

export const useSync = create<SyncState>((set, get) => ({
  status: null,
  busy: false,
  last: null,
  peers: [],
  error: null,
  joinChoices: null,

  refresh: async () => {
    if (!isTauri() || !useProject.getState().current) {
      set({ status: null });
      return;
    }
    try {
      set({ status: await syncStatus() });
    } catch (error) {
      set({ status: null, error: String(error) });
    }
  },

  chooseFolder: async () => {
    if (!isTauri()) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const folder = await open({
      directory: true,
      multiple: false,
      title: 'Choose a shared folder (OneDrive, Dropbox, Google Drive or a network share)',
    });
    if (!folder) return;
    try {
      set({ status: await syncSetFolder(folder), error: null });
      log.info(`This project now syncs through ${folder}`);
      await get().syncNow();
    } catch (error) {
      set({ error: String(error) });
      log.error(`Could not use that folder: ${String(error)}`);
    }
  },

  stopSyncing: async () => {
    try {
      set({ status: await syncSetFolder(null), peers: [], last: null });
      log.info('This project no longer syncs. Its content stays as it is.');
    } catch (error) {
      log.error(String(error));
    }
  },

  setAuto: async (on) => {
    try {
      set({ status: await syncSetAuto(on) });
    } catch (error) {
      log.error(String(error));
    }
  },

  startJoin: async () => {
    if (!isTauri()) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const folder = await open({
      directory: true,
      multiple: false,
      title: 'Choose the shared folder your colleagues sync the project through',
    });
    if (!folder) return;
    try {
      const found = await syncSharedProjects(folder);
      if (found.length === 0) {
        log.warn(
          `No shared project in ${folder}. A colleague first opens the project and chooses this folder under Sync.`,
        );
      } else if (found.length === 1) {
        await get().join(found[0]!);
      } else {
        set({ joinChoices: found });
      }
    } catch (error) {
      log.error(`Could not read that folder: ${String(error)}`);
    }
  },

  join: async (project) => {
    set({ joinChoices: null });
    const { open } = await import('@tauri-apps/plugin-dialog');
    const target = await open({
      directory: true,
      multiple: false,
      title: `Choose an empty folder for your copy of ${project.name}`,
    });
    if (!target) return;
    try {
      const root = await syncJoin(project.path, target);
      log.info(`Joined ${project.name}. The first sync brings its content and files.`);
      await useProject.getState().openPath(root);
    } catch (error) {
      log.error(`Could not join ${project.name}: ${String(error)}`);
    }
  },

  cancelJoin: () => set({ joinChoices: null }),

  syncNow: async (quiet = false) => {
    if (get().busy || !get().status?.folder) return;
    set({ busy: true, error: null });
    try {
      const report = await syncNow(useUi.getState().author);
      for (const file of report.received_files) {
        const importer = IMPORTERS[file.kind];
        if (importer) await importer(file.rel_path);
      }
      const late = report.received_files.length ? await syncRetry() : 0;
      const received = report.applied + late;
      if (received || report.received_files.length) await reloadShared();
      for (const conflict of report.conflicts) log.warn(conflict);
      const moved = report.sent + report.files_sent + received + report.received_files.length;
      if (!quiet || moved) log.info(describeSync(report, received));
      set({ last: report, peers: report.peers });
    } catch (error) {
      set({ error: String(error) });
      log.error(`Sync failed: ${String(error)}`);
    } finally {
      set({ busy: false });
      await get().refresh();
    }
  },
}));

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** One line for the log: what a sync sent and received. */
export function describeSync(report: SyncReport, received = report.applied): string {
  const parts: string[] = [];
  if (report.sent) parts.push(`sent ${plural(report.sent, 'change')}`);
  if (report.files_sent) parts.push(`published ${plural(report.files_sent, 'file')}`);
  if (received) parts.push(`received ${plural(received, 'change')}`);
  if (report.received_files.length)
    parts.push(`received ${plural(report.received_files.length, 'file')}`);
  if (report.pending) parts.push(`${plural(report.pending, 'change')} waiting`);
  const others = report.peers.length
    ? ` with ${report.peers.map((p) => p.user || 'another computer').join(', ')}`
    : '';
  return parts.length ? `Synced${others}: ${parts.join(', ')}.` : `Synced${others}: up to date.`;
}

// Read the project's sync settings when it opens; sync then and every few minutes.
let timer: ReturnType<typeof setInterval> | null = null;
useProject.subscribe((state, previous) => {
  if (state.current?.root === previous.current?.root) return;
  if (timer) clearInterval(timer);
  timer = null;
  useSync.setState({ status: null, last: null, peers: [], error: null });
  if (!state.current) return;
  void (async () => {
    await useSync.getState().refresh();
    const status = useSync.getState().status;
    if (status?.folder && status.auto) void useSync.getState().syncNow(true);
  })();
  timer = setInterval(() => {
    const status = useSync.getState().status;
    if (status?.folder && status.auto && !document.hidden) void useSync.getState().syncNow(true);
  }, AUTO_SYNC_MS);
});
