import type { LinkReport, ProjectFile } from '../lib/ipc';

// The store pulls in the viewer (WebGL) and Tauri; neither exists under jsdom.
vi.mock('@kingpost/viewer', () => ({
  DEFAULT_SNAP: { vertex: true, midpoint: true, edge: true, face: true },
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

const { analysisFiles, linkStatuses } = await import('./analysis');

function file(relPath: string, kind: string): ProjectFile {
  return { rel_path: relPath, kind, revisions: [] } as unknown as ProjectFile;
}

describe('analysisFiles', () => {
  it('keeps the analysis formats and leaves models and drawings out', () => {
    const files = [
      file('tower.e2k', 'e2k'),
      file('tower.s2k', 's2k'),
      file('tower.xlsx', 'saf'),
      file('tower.ifc', 'ifc'),
      file('GA-01.pdf', 'pdf'),
    ];
    expect(analysisFiles(files).map((f) => f.rel_path)).toEqual([
      'tower.e2k',
      'tower.s2k',
      'tower.xlsx',
    ]);
  });
});

describe('linkStatuses', () => {
  it('turns a report into one status per element', () => {
    const report: LinkReport = {
      links: [
        link('A', 'M1', true, true),
        link('B', 'M2', false, true),
        link('C', 'M3', null, false),
        link('D', 'M4', null, null),
      ],
      unmatched_physical: ['E'],
      unmatched_members: ['M5'],
      physical_count: 5,
      member_count: 5,
      section_mismatches: 1,
      material_mismatches: 1,
    };
    const statuses = linkStatuses(report);
    expect([...statuses.entries()]).toEqual([
      ['A', 'linked'],
      ['B', 'section differs'],
      ['C', 'material differs'],
      ['D', 'linked'],
      ['E', 'unmatched'],
    ]);
    expect(linkStatuses(null).size).toBe(0);
  });
});

function link(
  globalId: string,
  member: string,
  sectionOk: boolean | null,
  materialOk: boolean | null,
) {
  return {
    global_id: globalId,
    member_uid: member,
    method: 'position' as const,
    distance: 0.01,
    physical_section: null,
    analysis_section: null,
    section_ok: sectionOk,
    physical_material: null,
    analysis_material: null,
    material_ok: materialOk,
  };
}
