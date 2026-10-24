import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light';
export type Section =
  'explorer' | 'viewer' | 'review' | 'compare' | 'analysis' | 'drawings' | 'lab';
export type PanelSide = 'left' | 'right' | 'bottom';
/** What the workspace shows: the 3D model, or a drawing sheet over it. */
export type Workspace = 'model' | 'sheet';

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
  setTheme(theme: Theme): void;
  toggleTheme(): void;
  setAuthor(author: string): void;
  setSection(section: Section): void;
  setWorkspace(workspace: Workspace): void;
  togglePanel(side: PanelSide): void;
  setPalette(open: boolean): void;
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
    }),
    {
      name: 'kingpost.ui',
      partialize: (s) => ({
        theme: s.theme,
        author: s.author,
        leftOpen: s.leftOpen,
        rightOpen: s.rightOpen,
        bottomOpen: s.bottomOpen,
      }),
    },
  ),
);
