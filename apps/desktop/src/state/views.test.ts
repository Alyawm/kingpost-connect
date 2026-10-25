import type { ElementSummary } from '../lib/ipc';
import type { Look } from './appearance';

// The stores pull in the viewer (WebGL) and Tauri; neither exists under jsdom.
vi.mock('@kingpost/viewer', () => ({
  Vector3: class {},
  createLineObject: vi.fn(),
  createMeasurementObject: vi.fn(),
  measure: vi.fn(),
  loadIfcToGroup: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const { decodeVisibility, encodeVisibility } = await import('./views');
const { commonLook } = await import('./appearance');

function element(id: number, globalId: string, partial: Partial<ElementSummary> = {}) {
  return {
    express_id: id,
    global_id: globalId,
    ifc_type: 'IFCBEAM',
    name: null,
    tag: null,
    storey: null,
    type_name: null,
    material: null,
    parent_express_id: null,
    has_geometry: true,
    is_spatial: false,
    ...partial,
  } satisfies ElementSummary;
}

const elements = [
  element(1, 'A'),
  element(2, 'B'),
  element(3, 'C'),
  element(4, 'D'),
  element(9, 'S', { is_spatial: true, has_geometry: false }),
];
const byId = new Map(elements.map((e) => [e.express_id, e]));

function encode(hidden: number[], looks: [number, Look][] = []) {
  return encodeVisibility({
    revisionId: 10,
    relPath: 'model.ifc',
    elements,
    byId,
    hidden: new Set(hidden),
    looks: new Map(looks),
    colorBy: 'none',
  });
}

describe('saved view visibility', () => {
  it('records hidden elements and overrides by GlobalId, grouped by look', () => {
    const v = encode(
      [2],
      [
        [1, { color: '#ff0000' }],
        [3, { color: '#ff0000' }],
        [4, { opacity: 0.5 }],
      ],
    );
    expect(v.version).toBe(2);
    expect(v.hidden).toEqual([2]);
    expect(v.hiddenGlobalIds).toEqual(['B']);
    expect(v.looks).toEqual([
      { color: '#ff0000', ids: ['A', 'C'] },
      { opacity: 0.5, ids: ['D'] },
    ]);
  });

  it('stores the visible elements instead when most are hidden (isolate)', () => {
    const v = encode([1, 2, 3]);
    expect(v.shownGlobalIds).toEqual(['D']);
    expect(v.hiddenGlobalIds).toBeUndefined();
  });

  it('applies to a later revision by GlobalId and counts what is missing', () => {
    const v = encode(
      [2],
      [
        [1, { color: '#00ff00' }],
        [4, { opacity: 0.3 }],
      ],
    );
    // In the new revision the express ids changed and D was deleted.
    const later = [element(21, 'A'), element(22, 'B'), element(23, 'C')];
    const resolved = decodeVisibility(v, {
      revisionId: 11,
      elements: later,
      byGlobalId: new Map(later.map((e) => [e.global_id, e.express_id])),
    })!;
    expect(resolved.hidden).toEqual([22]);
    expect([...resolved.looks]).toEqual([[21, { color: '#00ff00' }]]);
    expect(resolved.missing).toBe(1);
  });

  it('expands an isolate back to hidden ids, skipping spatial elements', () => {
    const resolved = decodeVisibility(encode([1, 2, 3]), {
      revisionId: 10,
      elements,
      byGlobalId: new Map(elements.map((e) => [e.global_id, e.express_id])),
    })!;
    expect(resolved.hidden).toEqual([1, 2, 3]);
  });

  it('keeps version 1 views to the revision they were saved on', () => {
    const old = { revisionId: 10, relPath: 'm.ifc', hidden: [3], colorBy: 'type' as const };
    const model = { revisionId: 10, elements, byGlobalId: new Map<string, number>() };
    expect(decodeVisibility(old, model)?.hidden).toEqual([3]);
    expect(decodeVisibility(old, { ...model, revisionId: 11 })).toBeNull();
  });
});

describe('commonLook', () => {
  it('reports a shared colour and opacity, or mixed', () => {
    const looks = new Map<number, Look>([
      [1, { color: '#ff0000', opacity: 0.5 }],
      [2, { color: '#ff0000', opacity: 0.5 }],
      [3, { color: '#0000ff' }],
    ]);
    expect(commonLook(looks, [1, 2])).toEqual({ color: '#ff0000', opacity: 0.5 });
    expect(commonLook(looks, [1, 3])).toEqual({ color: 'mixed', opacity: 'mixed' });
    expect(commonLook(looks, [4])).toEqual({ color: null, opacity: 1 });
  });
});
