import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light';
export type Section =
  | 'explorer'
  | 'viewer'
  | 'review'
  | 'compare'
  | 'analysis'
  | 'drawings'
  | 'coordination'
  | 'schedules'
  | 'lab';
export type PanelSide = 'left' | 'right' | 'bottom';
/** What the workspace shows: the 3D model, or a drawing sheet over it. */
export type Workspace = 'model' | 'sheet' | 'schedule';

interface UiState {
  theme: Theme;
  /** Name recorded on issues, comments and status changes. */
  author: string;
  section: Section;
  workspace: Workspace;
  leftOpen: boolean;
  rightOpen: boolean;
  bottomOpen: boolean;
  paletteOpen: boolean;
  settingsOpen: boolean;
  helpOpen: boolean;
  /** Ask the release server for a newer version when the application starts. Off by default. */
  checkUpdatesAtStartup: boolean;
  /** Project folders opened before, newest first. */
  recentProjects: string[];
  /** Project folders kept on the Projects page regardless of how recently they were used. */
  pinnedProjects: string[];
  /** Display name and last opening of each known project folder. */
  projectMeta: Record<string, { name: string; openedAt: string }>;
  /** The Projects page is shown over the workspace. */
  homeOpen: boolean;
  setHomeOpen(open: boolean): void;
  togglePin(root: string): void;
  /** The getting-started checklist is shown until dismissed. */
  onboardingDismissed: boolean;
  setTheme(theme: Theme): void;
  toggleTheme(): void;
  setAuthor(author: string): void;
  setSection(section: Section): void;
  setWorkspace(workspace: Workspace): void;
  togglePanel(side: PanelSide): void;
  setPalette(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setHelpOpen(open: boolean): void;
  setCheckUpdatesAtStartup(on: boolean): void;
  rememberProject(root: string, name?: string): void;
  forgetProject(root: string): void;
  dismissOnboarding(): void;
}

const panelKey: Record<PanelSide, 'leftOpen' | 'rightOpen' | 'bottomOpen'> = {
  left: 'leftOpen',
  right: 'rightOpen',
  bottom: 'bottomOpen',
};

/** Window chrome state. Theme and panel layout persist between sessions; the rest does not. */
export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      author: '',
      section: 'explorer',
      workspace: 'model',
      leftOpen: true,
      rightOpen: true,
      bottomOpen: true,
      paletteOpen: false,
      settingsOpen: false,
      helpOpen: false,
      checkUpdatesAtStartup: false,
      recentProjects: [],
      pinnedProjects: [],
      projectMeta: {},
      homeOpen: false,
      onboardingDismissed: false,
      setHomeOpen: (homeOpen) => set({ homeOpen }),
      togglePin: (root) => {
        const pinned = get().pinnedProjects;
        set({
          pinnedProjects: pinned.includes(root)
            ? pinned.filter((r) => r !== root)
            : [root, ...pinned],
        });
      },
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
      setAuthor: (author) => set({ author }),
      setSection: (section) => {
        // Clicking the active rail item folds the side panel, like most editors do.
        if (get().section === section) set({ leftOpen: !get().leftOpen });
        else set({ section, leftOpen: true });
      },
      setWorkspace: (workspace) => set({ workspace }),
      togglePanel: (side) => set({ [panelKey[side]]: !get()[panelKey[side]] }),
      setPalette: (paletteOpen) => set({ paletteOpen }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setHelpOpen: (helpOpen) => set({ helpOpen }),
      setCheckUpdatesAtStartup: (checkUpdatesAtStartup) => set({ checkUpdatesAtStartup }),
      rememberProject: (root, name) =>
        set({
          recentProjects: [root, ...get().recentProjects.filter((r) => r !== root)].slice(0, 12),
          projectMeta: {
            ...get().projectMeta,
            [root]: {
              name:
                name ??
                get().projectMeta[root]?.name ??
                root.split(/[\\/]/).filter(Boolean).pop() ??
                root,
              openedAt: new Date().toISOString(),
            },
          },
          homeOpen: false,
        }),
      forgetProject: (root) =>
        set({
          recentProjects: get().recentProjects.filter((r) => r !== root),
          pinnedProjects: get().pinnedProjects.filter((r) => r !== root),
        }),
      dismissOnboarding: () => set({ onboardingDismissed: true }),
    }),
    {
      name: 'kingpost.ui',
      partialize: (s) => ({
        theme: s.theme,
        author: s.author,
        leftOpen: s.leftOpen,
        rightOpen: s.rightOpen,
        bottomOpen: s.bottomOpen,
        checkUpdatesAtStartup: s.checkUpdatesAtStartup,
        recentProjects: s.recentProjects,
        pinnedProjects: s.pinnedProjects,
        projectMeta: s.projectMeta,
        onboardingDismissed: s.onboardingDismissed,
      }),
    },
  ),
);
