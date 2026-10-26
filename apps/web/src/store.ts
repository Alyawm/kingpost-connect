import { create } from 'zustand';
import {
  loadIfcToGroup,
  type IfcFrame,
  type IfcModel,
  type Triple,
  type ViewportHandle,
} from '@kingpost/viewer';
import {
  ApiError,
  api,
  hasToken,
  setToken,
  type FileNotice,
  type ProjectSummary,
  type ServerInfo,
  type UserInfo,
} from './api';
import {
  Clock,
  ProjectData,
  commentChange,
  latestModels,
  randomHex,
  readGlobalIds,
  statusChange,
  type Issue,
  type Viewpoint,
} from './project';

/** How often an open project looks for new comments and changes. */
const REFRESH_MS = 30_000;
const DEVICE_KEY = 'kingpost.web.device';

function deviceId(): string {
  try {
    const known = localStorage.getItem(DEVICE_KEY);
    if (known) return known;
    const fresh = `web-${randomHex(12)}`;
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return `web-${randomHex(12)}`;
  }
}

interface Progress {
  label: string;
  fraction: number | null;
}

interface WebState {
  phase: 'starting' | 'signed-out' | 'projects' | 'project';
  server: ServerInfo | null;
  user: UserInfo | null;
  projects: ProjectSummary[];
  project: ProjectSummary | null;
  data: ProjectData;
  /** Bumped whenever `data` changes, so views re-render. */
  version: number;
  models: FileNotice[];
  modelPath: string | null;
  progress: Progress | null;
  model: IfcModel | null;
  frame: IfcFrame | null;
  byGlobalId: Map<string, number>;
  handle: ViewportHandle | null;
  selectedIssueId: string | null;
  error: string | null;
  start(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  register(email: string, name: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  openProject(project: ProjectSummary): Promise<void>;
  closeProject(): void;
  refresh(): Promise<void>;
  loadModel(relPath: string): Promise<void>;
  setHandle(handle: ViewportHandle | null): void;
  selectIssue(id: string | null): void;
  showElements(globalIds: string[]): void;
  showViewpoint(viewpoint: Viewpoint): void;
  addComment(text: string): Promise<boolean>;
  setStatus(issue: Issue, status: string): Promise<void>;
}

let cursor = 0;
let clock = new Clock(deviceId());
let timer: ReturnType<typeof setInterval> | null = null;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parse<T>(json: string | null | undefined): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export const useWeb = create<WebState>((set, get) => ({
  phase: 'starting',
  server: null,
  user: null,
  projects: [],
  project: null,
  data: new ProjectData(),
  version: 0,
  models: [],
  modelPath: null,
  progress: null,
  model: null,
  frame: null,
  byGlobalId: new Map(),
  handle: null,
  selectedIssueId: null,
  error: null,

  start: async () => {
    try {
      set({ server: await api.info() });
    } catch (error) {
      set({ error: message(error) });
    }
    if (!hasToken()) {
      set({ phase: 'signed-out' });
      return;
    }
    try {
      const user = await api.me();
      set({ user, projects: await api.projects(), phase: 'projects' });
    } catch {
      set({ phase: 'signed-out' });
    }
  },

  signIn: async (email, password) => {
    try {
      const session = await api.login(email, password);
      setToken(session.token);
      set({ user: session.user, projects: await api.projects(), phase: 'projects', error: null });
    } catch (error) {
      set({ error: message(error) });
    }
  },

  register: async (email, name, password) => {
    try {
      const session = await api.register(email, name, password);
      setToken(session.token);
      set({ user: session.user, projects: await api.projects(), phase: 'projects', error: null });
    } catch (error) {
      set({ error: message(error) });
    }
  },

  signOut: async () => {
    get().closeProject();
    try {
      await api.logout();
    } catch {
      // Signed out here either way.
    }
    setToken(null);
    set({ user: null, projects: [], phase: 'signed-out' });
  },

  openProject: async (project) => {
    get().closeProject();
    cursor = 0;
    clock = new Clock(clock.device);
    set({
      project,
      phase: 'project',
      data: new ProjectData(),
      version: 0,
      selectedIssueId: null,
      error: null,
    });
    try {
      await api.hello(project.id, clock.device, 'Web browser');
    } catch {
      // Being listed among the copies is a courtesy.
    }
    await get().refresh();
    const models = get().models;
    if (models[0]) void get().loadModel(models[0].rel_path);
    timer = setInterval(() => {
      if (!document.hidden) void get().refresh();
    }, REFRESH_MS);
  },

  closeProject: () => {
    if (timer) clearInterval(timer);
    timer = null;
    const { model, handle } = get();
    if (model) {
      handle?.remove(model.group);
      model.dispose();
    }
    set({
      project: null,
      model: null,
      frame: null,
      byGlobalId: new Map(),
      models: [],
      modelPath: null,
      progress: null,
      phase: get().user ? 'projects' : 'signed-out',
    });
  },

  refresh: async () => {
    const project = get().project;
    if (!project) return;
    try {
      let more = true;
      let changed = false;
      while (more) {
        const page = await api.changes(project.id, cursor);
        if (page.changes.length) {
          get().data.apply(page.changes.map((c) => c.change));
          cursor = page.changes[page.changes.length - 1]!.seq;
          changed = true;
        }
        more = page.more;
      }
      clock.observe(get().data.newest);
      const models = latestModels(await api.files(project.id));
      set({ models, error: null, ...(changed ? { version: get().version + 1 } : {}) });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        set({ phase: 'signed-out', user: null, error: 'Please sign in again.' });
        get().closeProject();
        return;
      }
      set({ error: message(error) });
    }
  },

  loadModel: async (relPath) => {
    const { project, models, handle } = get();
    const notice = models.find((m) => m.rel_path === relPath);
    if (!project || !notice || !handle) return;
    set({ modelPath: relPath, progress: { label: `Downloading ${relPath}`, fraction: 0 } });
    try {
      const bytes = await api.blob(project.id, notice.sha256, (fraction) =>
        set({ progress: { label: `Downloading ${relPath}`, fraction } }),
      );
      set({ progress: { label: 'Reading the model', fraction: null } });
      // Give the progress text a frame to appear before the parse holds the thread.
      await new Promise((resolve) => setTimeout(resolve, 30));
      const byGlobalId = readGlobalIds(new TextDecoder().decode(bytes));
      const { model, frame } = await loadIfcToGroup(bytes);
      const previous = get().model;
      if (previous) {
        handle.remove(previous.group);
        previous.dispose();
      }
      handle.add(model.group);
      handle.fit();
      set({ model, frame, byGlobalId, progress: null });
    } catch (error) {
      set({ progress: null, error: `Could not open ${relPath}: ${message(error)}` });
    }
  },

  setHandle: (handle) => set({ handle }),

  selectIssue: (id) => {
    set({ selectedIssueId: id });
    if (!id) return;
    const data = get().data;
    const viewpoint = data.viewpoints(id)[0];
    if (viewpoint) get().showViewpoint(viewpoint);
    else get().showElements(data.issueElements(id));
  },

  showElements: (globalIds) => {
    const { model, byGlobalId, handle } = get();
    if (!model || !handle) return;
    const ids = globalIds
      .map((g) => byGlobalId.get(g))
      .filter((id): id is number => id !== undefined);
    model.setSelected(ids);
    const box = ids.length ? model.boundsOf(ids) : null;
    if (box) handle.fitTo(box);
    handle.render();
  },

  showViewpoint: (viewpoint) => {
    const { model, frame, handle, byGlobalId } = get();
    if (!model || !frame || !handle) return;
    const camera = parse<{ view_point: Triple; direction: Triple }>(viewpoint.camera_json);
    if (camera) {
      const position = frame.pointFromIfc(camera.view_point);
      const direction = frame.directionFromIfc(camera.direction);
      const center = handle.contentBounds().getCenter(position.clone());
      const distance = Math.max(1, center.sub(position).dot(direction));
      const target = position.clone().addScaledVector(direction, distance);
      handle.setCamera({
        position: position.toArray() as Triple,
        target: target.toArray() as Triple,
      });
    }
    const ids = (guids: string[] = []) =>
      guids.map((g) => byGlobalId.get(g)).filter((id): id is number => id !== undefined);
    const components = parse<{
      selection?: string[];
      default_visibility?: boolean;
      exceptions?: string[];
    }>(viewpoint.components_json);
    model.showAll();
    if (components) {
      if (components.default_visibility === false) model.isolate(ids(components.exceptions));
      else if (components.exceptions?.length) model.setHidden(ids(components.exceptions));
      model.setSelected(ids(components.selection));
    }
    const clipping =
      parse<{ location: Triple; direction: Triple }[]>(viewpoint.clipping_json) ?? [];
    handle.setClipPlanes(
      clipping.map((plane, index) => ({
        id: `vp-${index}`,
        point: frame.pointFromIfc(plane.location).toArray() as Triple,
        normal: frame.directionFromIfc(plane.direction).normalize().toArray() as Triple,
        enabled: true,
      })),
      null,
      false,
    );
    handle.render();
  },

  addComment: async (text) => {
    const { project, user, selectedIssueId, data } = get();
    if (!project || !user || !selectedIssueId || !text.trim()) return false;
    const change = commentChange(clock, selectedIssueId, user.name, text.trim());
    try {
      await api.push(project.id, clock.device, [change]);
      data.apply([change]);
      set({ version: get().version + 1, error: null });
      return true;
    } catch (error) {
      set({ error: message(error) });
      return false;
    }
  },

  setStatus: async (issue, status) => {
    const { project, user, data } = get();
    if (!project || !user) return;
    const change = statusChange(clock, issue, status, user.name);
    try {
      await api.push(project.id, clock.device, [change]);
      data.apply([change]);
      set({ version: get().version + 1, error: null });
    } catch (error) {
      set({ error: message(error) });
    }
  },
}));
