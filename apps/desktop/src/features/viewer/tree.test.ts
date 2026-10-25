import { NO_MATERIAL, NO_STOREY, NO_TYPE_NAME, buildTree, label, typeLabel } from './tree';
import type { ElementSummary } from '../../lib/ipc';

function element(partial: Partial<ElementSummary> & { express_id: number }): ElementSummary {
  return {
    global_id: `g${partial.express_id}`,
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
  };
}

const sample: ElementSummary[] = [
  element({ express_id: 1, name: 'B10', storey: 'Level 2' }),
  element({ express_id: 2, name: 'B2', storey: 'Level 2' }),
  element({ express_id: 3, name: 'C1', ifc_type: 'IFCCOLUMN', storey: 'Level 1' }),
  element({ express_id: 4, tag: 'P7', ifc_type: 'IFCPLATE' }),
  element({ express_id: 5, name: 'Level 1', ifc_type: 'IFCBUILDINGSTOREY', is_spatial: true }),
];

describe('buildTree', () => {
  it('groups by storey then type, with unplaced elements last', () => {
    const tree = buildTree(sample, '');
    expect(tree.map((s) => s.name)).toEqual(['Level 1', 'Level 2', NO_STOREY]);
    expect(tree[1]?.types.map((t) => t.ifcType)).toEqual(['IFCBEAM']);
    expect(tree[1]?.count).toBe(2);
  });

  it('skips spatial elements and sorts names numerically', () => {
    const tree = buildTree(sample, '');
    const all = tree.flatMap((s) => s.types.flatMap((t) => t.elements));
    expect(all.some((e) => e.is_spatial)).toBe(false);
    expect(tree[1]?.types[0]?.elements.map(label)).toEqual(['B2', 'B10']);
  });

  it('filters across name, tag and type', () => {
    expect(
      buildTree(sample, 'p7')
        .flatMap((s) => s.types)
        .flatMap((t) => t.elements),
    ).toHaveLength(1);
    expect(buildTree(sample, 'column').flatMap((s) => s.types)[0]?.ifcType).toBe('IFCCOLUMN');
    expect(buildTree(sample, 'nothing here')).toHaveLength(0);
  });
});

describe('buildTree grouping modes', () => {
  const typed: ElementSummary[] = [
    element({ express_id: 1, type_name: 'UB 406x178x54', material: 'S355' }),
    element({ express_id: 2, type_name: 'UB 203x133x25', material: 'S355' }),
    element({ express_id: 3, ifc_type: 'IFCCOLUMN', material: 'C40/50' }),
    element({ express_id: 4, ifc_type: 'IFCSLAB' }),
  ];

  it('groups by IFC type, then type name', () => {
    const tree = buildTree(typed, '', 'type');
    expect(tree.map((g) => g.name)).toEqual(['Beams', 'Columns', 'Slabs']);
    expect(tree[0]?.types.map((t) => t.label)).toEqual(['UB 203x133x25', 'UB 406x178x54']);
    expect(tree[1]?.types[0]?.label).toBe(NO_TYPE_NAME);
  });

  it('groups by material, then type, with no material last', () => {
    const tree = buildTree(typed, '', 'material');
    expect(tree.map((g) => g.name)).toEqual(['C40/50', 'S355', NO_MATERIAL]);
    expect(tree[1]?.types[0]?.label).toBe('Beams');
    expect(tree[1]?.count).toBe(2);
  });

  it('keeps group keys distinct between modes', () => {
    const keys = (g: 'storey' | 'type' | 'material') => buildTree(typed, '', g).map((x) => x.key);
    expect(new Set([...keys('storey'), ...keys('type'), ...keys('material')]).size).toBe(
      keys('storey').length + keys('type').length + keys('material').length,
    );
  });

  it('filters by material too', () => {
    expect(buildTree(typed, 'c40').flatMap((g) => g.types)).toHaveLength(1);
  });
});

describe('labels', () => {
  it('falls back from name to tag to express id', () => {
    expect(label(element({ express_id: 9, name: 'N' }))).toBe('N');
    expect(label(element({ express_id: 9, tag: 'T' }))).toBe('T');
    expect(label(element({ express_id: 9 }))).toBe('#9');
  });

  it('names common structural types in plain words', () => {
    expect(typeLabel('IFCBEAM')).toBe('Beams');
    expect(typeLabel('IFCSOMETHINGNEW')).toBe('SOMETHINGNEW');
  });
});
