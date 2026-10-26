import { create } from 'zustand';
import {
  isTauri,
  syncInvite,
  syncJoin,
  syncJoinServer,
  syncMembers,
  syncNow,
  syncRemoveMember,
  syncRetry,
  syncServerAccounts,
  syncServerLogin,
  syncServerLogout,
  syncServerProjects,
  syncServerRegister,
  syncSetAuto,
  syncSetFolder,
  syncSharedProjects,
  syncStatus,
  syncStop,
  syncUseServer,
  type ProjectMember,
  type ProjectRole,
  type ServerAccount,
  type ServerProject,
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

/** Details for signing in to a server, or creating an account there. */
export interface ServerSignIn {
  url: string;
  email: string;
  password: string;
  /** Set when creating an account. */
  name?: string;
}

interface SyncState {
  status: SyncStatus | null;
  busy: boolean;
  last: SyncReport | null;
  /** Other copies seen in the last sync. */
  peers: SyncPeer[];
  error: string | null;
  /** Servers this user is signed in to on this computer. */
  accounts: ServerAccount[];
  /** Members of the open project on its server (loaded on demand). */
  members: ProjectMember[] | null;
  refresh(): Promise<void>;
  /** Lets the user pick the shared folder (OneDrive, Dropbox, network share ...). */
  chooseFolder(): Promise<void>;
  /** Signs in (or creates an account) and makes the open project sync with that server. */
  connectServer(details: ServerSignIn): Promise<boolean>;
  /** Signs in again to the project's server after the sign-in ended. */
  signIn(details: ServerSignIn): Promise<boolean>;
  signOut(): Promise<void>;
  stopSyncing(): Promise<void>;
  setAuto(on: boolean): Promise<void>;
  /** Sends and receives now. `quiet` (automatic syncs) logs only when something moved. */
  syncNow(quiet?: boolean): Promise<void>;
  loadMembers(): Promise<void>;
  invite(email: string, role: ProjectRole): Promise<boolean>;
  removeMember(email: string): Promise<void>;
  loadAccounts(): Promise<void>;
  /** Shared projects found in the folder picked for joining, when there is a choice. */
  joinChoices: SharedProject[] | null;
  /** Picks a shared folder and lists the projects in it. */
  startJoin(): Promise<void>;
  /** Picks a folder for the local copy, creates it and opens it; the first sync fills it. */
  join(project: SharedProject): Promise<void>;
  cancelJoin(): void;
  /** Projects on a server the user may join, after signing in there. */
  serverProjects: { url: string; projects: ServerProject[] } | null;
  listServerProjects(url: string): Promise<void>;
  /** Signs in for joining, then lists the server's projects. */
  signInToJoin(details: ServerSignIn): Promise<boolean>;
  joinServer(url: string, project: ServerProject): Promise<void>;
  cancelServerJoin(): void;
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

/** Whether the project can sync now: a folder, or a server with a signed-in account. */
export function canSync(status: SyncStatus | null): boolean {
  return Boolean(status && (status.folder || (status.server && status.account)));
}

async function signInOrRegister(details: ServerSignIn): Promise<ServerAccount> {
  return details.name !== undefined
    ? syncServerRegister(details.url, details.email, details.name, details.password)
    : syncServerLogin(details.url, details.email, details.password);
}

async function pickFolder(title: string): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const folder = await open({ directory: true, multiple: false, title });
  return typeof folder === 'string' ? folder : null;
}

export const useSync = create<SyncState>((set, get) => ({
  status: null,
  busy: false,
  last: null,
  peers: [],
  error: null,
  accounts: [],
  members: null,
  joinChoices: null,
  serverProjects: null,

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

  loadAccounts: async () => {
    try {
      set({ accounts: await syncServerAccounts() });
    } catch {
      set({ accounts: [] });
    }
  },

  chooseFolder: async () => {
    if (!isTauri()) return;
    const folder = await pickFolder(
      'Choose a shared folder (OneDrive, Dropbox, Google Drive or a network share)',
    );
    if (!folder) return;
    try {
      set({ status: await syncSetFolder(folder), error: null, members: null });
      log.info(`This project now syncs through ${folder}`);
      await get().syncNow();
    } catch (error) {
      set({ error: String(error) });
      log.error(`Could not use that folder: ${String(error)}`);
    }
  },

  connectServer: async (details) => {
    try {
      const account = await signInOrRegister(details);
      set({ status: await syncUseServer(account.url), error: null, members: null });
      await get().loadAccounts();
      log.info(`This project now syncs with ${account.url} as ${account.name}.`);
      await get().syncNow();
      return true;
    } catch (error) {
      set({ error: String(error) });
      return false;
    }
  },

  signIn: async (details) => {
    try {
      await signInOrRegister(details);
      set({ error: null });
      await get().loadAccounts();
      await get().refresh();
      await get().syncNow();
      return true;
    } catch (error) {
      set({ error: String(error) });
      return false;
    }
  },

  signOut: async () => {
    const server = get().status?.server;
    if (!server) return;
    try {
      await syncServerLogout(server);
      log.info(`Signed out of ${server}. Sign in again to keep syncing this project.`);
    } catch (error) {
      log.error(String(error));
    }
    set({ members: null });
    await get().loadAccounts();
    await get().refresh();
  },

  stopSyncing: async () => {
    try {
      set({ status: await syncStop(), peers: [], last: null, members: null });
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

  loadMembers: async () => {
    if (!get().status?.server) return;
    try {
      set({ members: await syncMembers() });
    } catch (error) {
      set({ members: null, error: String(error) });
    }
  },

  invite: async (email, role) => {
    try {
      const member = await syncInvite(email, role);
      log.info(
        member.pending
          ? `${member.email} is invited as ${role}; they join when they create an account with that email.`
          : `${member.name || member.email} is now ${role === 'editor' ? 'an' : 'a'} ${role} of this project.`,
      );
      await get().loadMembers();
      return true;
    } catch (error) {
      set({ error: String(error) });
      return false;
    }
  },

  removeMember: async (email) => {
    try {
      await syncRemoveMember(email);
      log.info(`${email} no longer has access to this project on the server.`);
      await get().loadMembers();
    } catch (error) {
      set({ error: String(error) });
    }
  },

  startJoin: async () => {
    if (!isTauri()) return;
    const folder = await pickFolder(
      'Choose the shared folder your colleagues sync the project through',
    );
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
    const target = await pickFolder(`Choose an empty folder for your copy of ${project.name}`);
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

  listServerProjects: async (url) => {
    try {
      set({ serverProjects: { url, projects: await syncServerProjects(url) }, error: null });
    } catch (error) {
      set({ error: String(error) });
      await get().loadAccounts();
    }
  },

  signInToJoin: async (details) => {
    try {
      const account = await signInOrRegister(details);
      await get().loadAccounts();
      await get().listServerProjects(account.url);
      return true;
    } catch (error) {
      set({ error: String(error) });
      return false;
    }
  },

  joinServer: async (url, project) => {
    const target = await pickFolder(`Choose an empty folder for your copy of ${project.name}`);
    if (!target) return;
    try {
      const root = await syncJoinServer(url, project.id, project.name, target);
      set({ serverProjects: null });
      log.info(`Joined ${project.name}. The first sync brings its content and files.`);
      await useProject.getState().openPath(root);
    } catch (error) {
      log.error(`Could not join ${project.name}: ${String(error)}`);
    }
  },

  cancelServerJoin: () => set({ serverProjects: null, error: null }),

  syncNow: async (quiet = false) => {
    if (get().busy || !canSync(get().status)) return;
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
  useSync.setState({ status: null, last: null, peers: [], error: null, members: null });
  if (!state.current) return;
  void (async () => {
    await useSync.getState().refresh();
    const status = useSync.getState().status;
    if (canSync(status) && status?.auto) void useSync.getState().syncNow(true);
  })();
  timer = setInterval(() => {
    const status = useSync.getState().status;
    if (canSync(status) && status?.auto && !document.hidden) void useSync.getState().syncNow(true);
  }, AUTO_SYNC_MS);
});
