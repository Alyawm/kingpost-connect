import type { SheetRow } from '../lib/ipc';

// The store pulls in the viewer (WebGL) and Tauri; neither exists under jsdom.
vi.mock('@kingpost/viewer', () => ({
  AnalysisLayer: class {},
  IfcFrame: { identity: () => ({}) },
  Vector3: class {},
  createLineObject: vi.fn(),
  createMeasurementObject: vi.fn(),
  measure: vi.fn(),
  loadIfcToGroup: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const { pairSheets, parseRegion, sheetLabel, sheetSets } = await import('./drawings');

function sheet(
  id: number,
  revisionId: number,
  revisionIdx: number,
  page: number,
  number: string | null,
): SheetRow {
  return {
    id,
    revision_id: revisionId,
    file_id: 1,
    rel_path: 'GA.pdf',
    revision_idx: revisionIdx,
    page,
    number,
    title: null,
    scale: null,
    width: 100,
    height: 50,
    has_thumbnail: false,
    link_count: 0,
    markup_count: 0,
  };
}

describe('sheetSets', () => {
  it('groups by revision, newest first', () => {
    const sets = sheetSets([
      sheet(1, 10, 1, 1, 'S-1'),
      sheet(2, 11, 2, 1, 'S-1'),
      sheet(3, 10, 1, 2, 'S-2'),
    ]);
    expect(sets.map((s) => [s.revisionIdx, s.sheets.length])).toEqual([
      [2, 1],
      [1, 2],
    ]);
  });
});

describe('pairSheets', () => {
  it('pairs by number first, then by page for unnumbered sheets, one to one', () => {
    const from = [sheet(1, 10, 1, 1, 'S-1'), sheet(2, 10, 1, 2, null), sheet(3, 10, 1, 3, 'S-3')];
    const to = [sheet(4, 11, 2, 1, 'S-3'), sheet(5, 11, 2, 2, null), sheet(6, 11, 2, 3, 'S-9')];
    const pairs = pairSheets(from, to);
    expect(pairs.map((p) => [p.from.id, p.to.id])).toEqual([
      [2, 5],
      [3, 4],
    ]);
  });
});

describe('labels and regions', () => {
  it('labels a sheet by number and title, falling back to the page', () => {
    expect(sheetLabel({ number: 'S-101', title: 'PLAN', page: 2 })).toBe('S-101 · PLAN');
    expect(sheetLabel({ number: null, title: null, page: 2 })).toBe('Page 2');
  });
  it('parses regions defensively', () => {
    expect(parseRegion('{"x":0.1,"y":0.2,"w":0.3,"h":0.4}')).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
    });
    expect(parseRegion('nonsense')).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
