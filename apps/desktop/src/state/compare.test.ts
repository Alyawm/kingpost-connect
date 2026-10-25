import type { DiffItem, ProjectFile, RevisionRow } from '../lib/ipc';

// The stores pull in the viewer (WebGL) and Tauri; neither exists under jsdom.
vi.mock('@kingpost/viewer', () => ({
  DEFAULT_SNAP: { vertex: true, midpoint: true, edge: true, face: true },
  Vector3: class {},
  createLineObject: vi.fn(),
  createMeasurementObject: vi.fn(),
  measure: vi.fn(),
  loadIfcToGroup: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const { comparableFiles, visibleItems } = await import('./compare');
const { buildLegend } = await import('./view');

function revision(id: number, idx: number): RevisionRow {
  return {
    id,
    file_id: 1,
    idx,
    sha256: `sha${id}`,
    imported_at: '2026-10-24T10:00:00Z',
    schema: 'IFC4',
    units_json: '{}',
    element_count: 10,
    source_sha256: `src`,
    note: null,
  } as RevisionRow;
}

function file(relPath: string, kind: string, revisions: RevisionRow[]): ProjectFile {
  return { rel_path: relPath, kind, revisions } as ProjectFile;
}

function item(
  globalId: string,
  change: DiffItem['change'],
  ifcType: string,
  name: string,
): DiffItem {
  return {
    global_id: globalId,
    change,
    detail: { ifc_type: ifcType, name, storey: 'L1', type_name: null, changes: [] },
  };
}

describe('comparableFiles', () => {
  it('keeps IFC files with at least two revisions', () => {
    const files = [
      file('a.ifc', 'ifc', [revision(1, 1), revision(2, 2)]),
      file('b.ifc', 'ifc', [revision(3, 1)]),
      file('c.pdf', 'pdf', [revision(4, 1), revision(5, 2)]),
    ];
    expect(comparableFiles(files).map((f) => f.rel_path)).toEqual(['a.ifc']);
  });
});

describe('visibleItems', () => {
  const items = [
    item('A', 'added', 'IFCBEAM', 'B1'),
    item('B', 'removed', 'IFCBEAM', 'B2'),
    item('C', 'modified', 'IFCCOLUMN', 'C1'),
  ];
  const diff = {
    id: 1,
    from_revision_id: 1,
    to_revision_id: 2,
    computed_at: '',
    cached: false,
    summary: {
      from_elements: 3,
      to_elements: 3,
      added: 1,
      removed: 1,
      modified: 1,
      unchanged: 0,
      by_type: {},
      elapsed_ms: 1,
    },
    items,
  };

  it('returns nothing without a diff', () => {
    expect(visibleItems({ diff: null, filter: 'all', typeFilter: null, query: '' })).toEqual([]);
  });

  it('filters by change, type and text', () => {
    const ids = (f: Parameters<typeof visibleItems>[0]) => visibleItems(f).map((i) => i.global_id);
    expect(ids({ diff, filter: 'all', typeFilter: null, query: '' })).toEqual(['A', 'B', 'C']);
    expect(ids({ diff, filter: 'removed', typeFilter: null, query: '' })).toEqual(['B']);
    expect(ids({ diff, filter: 'all', typeFilter: 'IFCCOLUMN', query: '' })).toEqual(['C']);
    expect(ids({ diff, filter: 'all', typeFilter: null, query: 'b1' })).toEqual(['A']);
    expect(ids({ diff, filter: 'added', typeFilter: 'IFCCOLUMN', query: '' })).toEqual([]);
  });
});

describe('buildLegend by change', () => {
  it('groups elements by their change and leaves the rest as unchanged', () => {
    const elements = [
      { express_id: 1, global_id: 'A', has_geometry: true, is_spatial: false },
      { express_id: 2, global_id: 'C', has_geometry: true, is_spatial: false },
      { express_id: 3, global_id: 'Z', has_geometry: true, is_spatial: false },
      { express_id: 4, global_id: 'S', has_geometry: false, is_spatial: true },
    ] as never[];
    const changes = new Map([
      ['A', 'added'],
      ['C', 'modified'],
    ]);
    const legend = buildLegend(elements, 'change', changes);
    expect(legend.map((l) => [l.key, l.ids])).toEqual([
      ['added', [1]],
      ['modified', [2]],
      ['unchanged', [3]],
    ]);
  });
});
