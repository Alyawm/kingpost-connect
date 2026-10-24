import { create } from 'zustand';
import {
  drawingImport,
  elementSheetLinks,
  isTauri,
  readProjectFile,
  sheetLinkCreate,
  sheetLinkDelete,
  sheetLinks,
  sheetMarkupAdd,
  sheetMarkupDelete,
  sheetMarkups,
  sheetThumbnail,
  sheetUpdate,
  sheetsList,
  sheetsRegister,
  sheetsSearch,
  type ElementSheetLink,
  type ProjectFile,
  type SheetHit,
  type SheetInput,
  type SheetLinkRow,
  type SheetMarkupKind,
  type SheetMarkupRow,
  type SheetRegion,
  type SheetRow,
} from '../lib/ipc';
import {
  guessSheetFields,
  loadPdf,
  pageSize,
  pageText,
  thumbnail,
  type PdfDocument,
} from '../lib/pdf';
import { log } from './log';
import { useModel } from './model';
import { useProject } from './project';
import { useUi } from './ui';
import { useViews } from './views';

export type SheetTool = 'pan' | 'link' | 'rect' | 'cloud' | 'text';

/** A markup's geometry: a rectangle in page fractions, with text for notes. */
export interface MarkupGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OpenSheet {
  sheet: SheetRow;
  doc: PdfDocument;
  links: SheetLinkRow[];
  markups: SheetMarkupRow[];
}

export interface CompareTarget {
  /** Sheets of the older and newer revision, paired by number (or page). */
  pairs: { from: SheetRow; to: SheetRow }[];
  index: number;
  fromDoc: PdfDocument;
  toDoc: PdfDocument;
}

interface DrawingsState {
  sheets: SheetRow[];
  thumbnails: Map<number, string>;
  importing: Set<string>;
  open: OpenSheet | null;
  loading: boolean;
  tool: SheetTool;
  /** Region the user wants to highlight (from a link or a search), in page fractions. */
  focusRegion: SheetRegion | null;
  selectedLinkId: string | null;
  query: string;
  hits: SheetHit[];
  elementLinks: ElementSheetLink[];
  compare: CompareTarget | null;
  refresh(): Promise<void>;
  importFile(relPath: string): Promise<void>;
  openSheet(sheetId: number, region?: SheetRegion | null): Promise<void>;
  closeSheet(): void;
  loadThumbnail(sheetId: number): Promise<void>;
  updateSheet(
    sheetId: number,
    number: string | null,
    title: string | null,
    scale: string | null,
  ): Promise<void>;
  setTool(tool: SheetTool): void;
  search(query: string): Promise<void>;
  /** Links the region to the current 3D selection (or the given view). */
  createLink(region: SheetRegion, viewId?: string | null): Promise<void>;
  deleteLink(id: string): Promise<void>;
  selectLink(id: string | null): void;
  /** Follows a link: selects its elements in 3D and switches the workspace to the model. */
  followLink(link: SheetLinkRow): Promise<void>;
  addMarkup(kind: SheetMarkupKind, geometry: MarkupGeometry, text: string | null): Promise<void>;
  deleteMarkup(id: string): Promise<void>;
  /** Links of the current 3D selection, for "where is this on the drawings". */
  refreshElementLinks(): Promise<void>;
  startCompare(fromRevisionId: number, toRevisionId: number): Promise<void>;
  setCompareIndex(index: number): void;
  stopCompare(): void;
}

export function drawingFiles(files: ProjectFile[]): ProjectFile[] {
  return files.filter((f) => f.kind === 'pdf');
}

/** Sheets grouped by file and revision, newest revision first. */
export function sheetSets(
  sheets: SheetRow[],
): { relPath: string; revisionId: number; revisionIdx: number; sheets: SheetRow[] }[] {
  const map = new Map<
    number,
    { relPath: string; revisionId: number; revisionIdx: number; sheets: SheetRow[] }
  >();
  for (const s of sheets) {
    const set = map.get(s.revision_id) ?? {
      relPath: s.rel_path,
      revisionId: s.revision_id,
      revisionIdx: s.revision_idx,
      sheets: [],
    };
    set.sheets.push(s);
    map.set(s.revision_id, set);
  }
  return [...map.values()].sort(
    (a, b) => a.relPath.localeCompare(b.relPath) || b.revisionIdx - a.revisionIdx,
  );
}

export function sheetLabel(sheet: {
  number: string | null;
  title: string | null;
  page: number;
}): string {
  return [sheet.number, sheet.title].filter(Boolean).join(' · ') || `Page ${sheet.page}`;
}

export function parseRegion(json: string): SheetRegion {
  try {
    const r = JSON.parse(json) as Partial<SheetRegion>;
    return { x: r.x ?? 0, y: r.y ?? 0, w: r.w ?? 0, h: r.h ?? 0 };
  } catch {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
}

/** Pairs sheets of two revisions by number, falling back to page. */
export function pairSheets(from: SheetRow[], to: SheetRow[]): { from: SheetRow; to: SheetRow }[] {
  const pairs: { from: SheetRow; to: SheetRow }[] = [];
  const used = new Set<number>();
  for (const a of from) {
    const b =
      to.find((t) => !used.has(t.id) && a.number && t.number === a.number) ??
      to.find((t) => !used.has(t.id) && !a.number && !t.number && t.page === a.page);
    if (b) {
      used.add(b.id);
      pairs.push({ from: a, to: b });
    }
  }
  return pairs;
}

const docs = new Map<number, PdfDocument>();

async function documentFor(relPath: string, revisionId: number): Promise<PdfDocument> {
  const cached = docs.get(revisionId);
  if (cached) return cached;
  const bytes = await readProjectFile(relPath);
  const doc = await loadPdf(bytes);
  docs.set(revisionId, doc);
  return doc;
}

export const useDrawings = create<DrawingsState>((set, get) => ({
  sheets: [],
  thumbnails: new Map(),
  importing: new Set(),
  open: null,
  loading: false,
  tool: 'pan',
  focusRegion: null,
  selectedLinkId: null,
  query: '',
  hits: [],
  elementLinks: [],
  compare: null,

  refresh: async () => {
    try {
      set({ sheets: await sheetsList() });
    } catch (error) {
      log.error(`Could not list sheets: ${String(error)}`);
    }
  },

  importFile: async (relPath) => {
    if (!isTauri()) return;
    const importing = new Set(get().importing);
    importing.add(relPath);
    set({ importing });
    log.info(`Importing ${relPath}…`);
    const started = performance.now();
    try {
      const imported = await drawingImport(relPath);
      const bytes = await readProjectFile(relPath);
      const doc = await loadPdf(bytes);
      docs.set(imported.revision_id, doc);
      const pages: SheetInput[] = [];
      for (let page = 1; page <= doc.numPages; page++) {
        const [size, content, thumb] = await Promise.all([
          pageSize(doc, page),
          pageText(doc, page),
          thumbnail(doc, page),
        ]);
        const guess = guessSheetFields(content.runs);
        pages.push({
          page,
          number: guess.number,
          title: guess.title,
          scale: null,
          width: size.width,
          height: size.height,
          text: content.text,
          thumbnail: thumb,
        });
      }
      const carried = await sheetsRegister(
        imported.revision_id,
        pages,
        imported.previous_revision_id,
      );
      log.info(
        `${relPath}: revision ${imported.revision_index}, ${pages.length} sheet(s) ` +
          `(${pages.filter((p) => p.number).length} with a number read from the title block)` +
          (carried ? `, ${carried} link(s) carried from the previous revision` : '') +
          ` in ${Math.round(performance.now() - started)} ms`,
      );
      await Promise.all([get().refresh(), useProject.getState().refreshFiles()]);
    } catch (error) {
      log.error(`Could not import ${relPath}: ${String(error)}`);
    } finally {
      const done = new Set(get().importing);
      done.delete(relPath);
      set({ importing: done });
    }
  },

  openSheet: async (sheetId, region = null) => {
    const sheet = get().sheets.find((s) => s.id === sheetId);
    if (!sheet) return;
    set({ loading: true, focusRegion: region, selectedLinkId: null, compare: null });
    try {
      const [doc, links, markups] = await Promise.all([
        documentFor(sheet.rel_path, sheet.revision_id),
        sheetLinks(sheetId),
        sheetMarkups(sheetId),
      ]);
      set({ open: { sheet, doc, links, markups } });
      useUi.getState().setWorkspace('sheet');
    } catch (error) {
      log.error(`Could not open ${sheetLabel(sheet)}: ${String(error)}`);
    } finally {
      set({ loading: false });
    }
  },

  closeSheet: () => {
    set({ open: null, focusRegion: null, selectedLinkId: null, compare: null });
    useUi.getState().setWorkspace('model');
  },

  loadThumbnail: async (sheetId) => {
    if (get().thumbnails.has(sheetId)) return;
    try {
      const data = await sheetThumbnail(sheetId);
      if (!data) return;
      const thumbnails = new Map(get().thumbnails);
      thumbnails.set(sheetId, data);
      set({ thumbnails });
    } catch {
      // A missing thumbnail only means a blank card.
    }
  },

  updateSheet: async (sheetId, number, title, scale) => {
    try {
      const updated = await sheetUpdate(sheetId, number, title, scale);
      set({
        sheets: get().sheets.map((s) => (s.id === sheetId ? updated : s)),
        open: get().open?.sheet.id === sheetId ? { ...get().open!, sheet: updated } : get().open,
      });
    } catch (error) {
      log.error(`Could not update the sheet: ${String(error)}`);
    }
  },

  setTool: (tool) => set({ tool }),

  search: async (query) => {
    set({ query });
    if (!query.trim()) {
      set({ hits: [] });
      return;
    }
    try {
      set({ hits: await sheetsSearch(query) });
    } catch (error) {
      log.error(`Search failed: ${String(error)}`);
    }
  },

  createLink: async (region, viewId = null) => {
    const { open } = get();
    if (!open) return;
    const globalIds = viewId ? [] : useModel.getState().selectedGlobalIds();
    if (!viewId && globalIds.length === 0) {
      log.warn('Select the element(s) in the model first, then draw the region on the sheet.');
      return;
    }
    const author = useUi.getState().author;
    try {
      let links: SheetLinkRow[] = open.links;
      if (viewId) {
        const view = useViews.getState().views.find((v) => v.id === viewId);
        links = await sheetLinkCreate(
          open.sheet.id,
          region,
          null,
          viewId,
          view?.name ?? null,
          author,
        );
      } else {
        const byId = useModel.getState().byId;
        const byGlobalId = useModel.getState().byGlobalId;
        for (const globalId of globalIds) {
          const element = byId.get(byGlobalId.get(globalId) ?? -1);
          links = await sheetLinkCreate(
            open.sheet.id,
            region,
            globalId,
            null,
            element?.name ?? element?.tag ?? null,
            author,
          );
        }
      }
      set({ open: { ...open, links }, tool: 'pan' });
      log.info(
        viewId
          ? `Linked a region of ${sheetLabel(open.sheet)} to a saved view`
          : `Linked a region of ${sheetLabel(open.sheet)} to ${globalIds.length} element(s)`,
      );
      await Promise.all([get().refresh(), get().refreshElementLinks()]);
    } catch (error) {
      log.error(`Could not create the link: ${String(error)}`);
    }
  },

  deleteLink: async (id) => {
    const { open } = get();
    if (!open) return;
    try {
      await sheetLinkDelete(id);
      set({
        open: { ...open, links: open.links.filter((l) => l.id !== id) },
        selectedLinkId: null,
      });
      await Promise.all([get().refresh(), get().refreshElementLinks()]);
    } catch (error) {
      log.error(`Could not delete the link: ${String(error)}`);
    }
  },

  selectLink: (id) => set({ selectedLinkId: id }),

  followLink: async (link) => {
    if (link.view_id) {
      const view = useViews.getState().views.find((v) => v.id === link.view_id);
      if (view) {
        useUi.getState().setWorkspace('model');
        useViews.getState().apply(view);
      } else {
        log.warn('The saved view this link points at no longer exists.');
      }
      return;
    }
    if (link.element_global_id) {
      const model = useModel.getState();
      const id = model.byGlobalId.get(link.element_global_id);
      if (id === undefined) {
        log.warn('Load the model revision that contains this element to jump to it.');
        return;
      }
      useUi.getState().setWorkspace('model');
      await model.selectMany([id]);
      model.fitTo([id]);
    }
  },

  addMarkup: async (kind, geometry, text) => {
    const { open } = get();
    if (!open) return;
    try {
      const markups = await sheetMarkupAdd(
        open.sheet.id,
        kind,
        geometry,
        text,
        useUi.getState().author,
      );
      set({ open: { ...open, markups }, tool: 'pan' });
      await get().refresh();
    } catch (error) {
      log.error(`Could not add the markup: ${String(error)}`);
    }
  },

  deleteMarkup: async (id) => {
    const { open } = get();
    if (!open) return;
    try {
      await sheetMarkupDelete(id);
      set({ open: { ...open, markups: open.markups.filter((m) => m.id !== id) } });
      await get().refresh();
    } catch (error) {
      log.error(`Could not delete the markup: ${String(error)}`);
    }
  },

  refreshElementLinks: async () => {
    const ids = useModel.getState().selectedGlobalIds();
    if (ids.length === 0) {
      set({ elementLinks: [] });
      return;
    }
    try {
      set({ elementLinks: await elementSheetLinks(ids.slice(0, 50)) });
    } catch {
      set({ elementLinks: [] });
    }
  },

  startCompare: async (fromRevisionId, toRevisionId) => {
    const { sheets } = get();
    const from = sheets.filter((s) => s.revision_id === fromRevisionId);
    const to = sheets.filter((s) => s.revision_id === toRevisionId);
    const pairs = pairSheets(from, to);
    if (pairs.length === 0) {
      log.warn('The two revisions have no sheets in common (by number or page).');
      return;
    }
    set({ loading: true });
    try {
      const [fromDoc, toDoc] = await Promise.all([
        documentFor(from[0]!.rel_path, fromRevisionId),
        documentFor(to[0]!.rel_path, toRevisionId),
      ]);
      set({ compare: { pairs, index: 0, fromDoc, toDoc }, open: null, focusRegion: null });
      useUi.getState().setWorkspace('sheet');
    } catch (error) {
      log.error(`Could not open the revisions: ${String(error)}`);
    } finally {
      set({ loading: false });
    }
  },

  setCompareIndex: (index) => {
    const { compare } = get();
    if (compare && index >= 0 && index < compare.pairs.length)
      set({ compare: { ...compare, index } });
  },

  stopCompare: () => {
    set({ compare: null });
    useUi.getState().setWorkspace('model');
  },
}));

useProject.subscribe((state, previous) => {
  if (state.current?.id !== previous.current?.id) {
    docs.clear();
    useDrawings.setState({
      sheets: [],
      thumbnails: new Map(),
      open: null,
      compare: null,
      hits: [],
      query: '',
      elementLinks: [],
    });
    useUi.getState().setWorkspace('model');
  }
});

// The 3D selection changed: refresh "on drawings" for the inspector.
let lastSelectionKey = '';
useModel.subscribe((state) => {
  const key = [...state.selectedIds].sort((a, b) => a - b).join(',');
  if (key === lastSelectionKey) return;
  lastSelectionKey = key;
  void useDrawings.getState().refreshElementLinks();
});
