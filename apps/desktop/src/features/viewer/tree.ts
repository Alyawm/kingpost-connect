import type { ElementSummary } from '../../lib/ipc';

export interface TypeGroup {
  key: string;
  /** The second-level value: an IFC type, or a type name when grouping by type. */
  ifcType: string;
  /** Readable name of the second level. */
  label: string;
  elements: ElementSummary[];
}

export interface StoreyGroup {
  key: string;
  /** Readable name of the first level (a storey, type or material). */
  name: string;
  types: TypeGroup[];
  count: number;
}

/** How the explorer groups elements: first level › second level. */
export type GroupBy = 'storey' | 'type' | 'material';

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  storey: 'Storey › Type',
  type: 'Type › Type name',
  material: 'Material › Type',
};

export const NO_STOREY = '— no storey —';
export const NO_MATERIAL = '— no material —';
export const NO_TYPE_NAME = '— no type name —';

function levels(element: ElementSummary, groupBy: GroupBy): [string, string] {
  switch (groupBy) {
    case 'type':
      return [element.ifc_type, element.type_name ?? NO_TYPE_NAME];
    case 'material':
      return [element.material ?? NO_MATERIAL, element.ifc_type];
    default:
      return [element.storey ?? NO_STOREY, element.ifc_type];
  }
}

const isPlaceholder = (value: string) =>
  value === NO_STOREY || value === NO_MATERIAL || value === NO_TYPE_NAME;

/** Numeric-aware so "2.Floor" sorts before "10.Floor"; placeholders come last. */
function compareKeys(a: string, b: string): number {
  if (isPlaceholder(a) !== isPlaceholder(b)) return isPlaceholder(a) ? 1 : -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Groups product elements in two levels (by default storey, then IFC type); spatial
 * elements are the groups, not members.
 */
export function buildTree(
  elements: ElementSummary[],
  filter: string,
  groupBy: GroupBy = 'storey',
): StoreyGroup[] {
  const needle = filter.trim().toLowerCase();
  const groups = new Map<string, Map<string, ElementSummary[]>>();
  for (const element of elements) {
    if (element.is_spatial) continue;
    if (needle && !matches(element, needle)) continue;
    const [first, second] = levels(element, groupBy);
    const inner = groups.get(first) ?? new Map<string, ElementSummary[]>();
    const list = inner.get(second);
    if (list) list.push(element);
    else inner.set(second, [element]);
    groups.set(first, inner);
  }
  return [...groups.entries()]
    .sort(([a], [b]) =>
      groupBy === 'type' ? compareKeys(typeLabel(a), typeLabel(b)) : compareKeys(a, b),
    )
    .map(([name, inner]) => {
      const typeGroups = [...inner.entries()]
        .sort(([a], [b]) => compareKeys(a, b))
        .map(([second, list]) => ({
          key: `${groupBy}/${name}/${second}`,
          ifcType: second,
          label: groupBy === 'type' ? second : typeLabel(second),
          elements: list.sort((a, b) =>
            label(a).localeCompare(label(b), undefined, { numeric: true }),
          ),
        }));
      return {
        key: `${groupBy}/${name}`,
        name: groupBy === 'type' ? typeLabel(name) : name,
        types: typeGroups,
        count: typeGroups.reduce((n, g) => n + g.elements.length, 0),
      };
    });
}

function matches(element: ElementSummary, needle: string): boolean {
  return [
    element.name,
    element.tag,
    element.ifc_type,
    element.type_name,
    element.material,
    element.global_id,
  ]
    .filter((v): v is string => !!v)
    .some((v) => v.toLowerCase().includes(needle));
}

export function label(element: ElementSummary): string {
  return element.name || element.tag || `#${element.express_id}`;
}

/** `IFCBUILDINGELEMENTPROXY` → `Building Element Proxy`-ish, readable in a narrow column. */
export function typeLabel(ifcType: string): string {
  const words: Record<string, string> = {
    IFCBEAM: 'Beams',
    IFCCOLUMN: 'Columns',
    IFCSLAB: 'Slabs',
    IFCWALL: 'Walls',
    IFCWALLSTANDARDCASE: 'Walls',
    IFCFOOTING: 'Footings',
    IFCPILE: 'Piles',
    IFCMEMBER: 'Members',
    IFCPLATE: 'Plates',
    IFCREINFORCINGBAR: 'Reinforcing bars',
    IFCREINFORCINGMESH: 'Reinforcing meshes',
    IFCBUILDINGELEMENTPROXY: 'Proxies',
    IFCOPENINGELEMENT: 'Openings',
    IFCSTAIR: 'Stairs',
    IFCSTAIRFLIGHT: 'Stair flights',
    IFCRAILING: 'Railings',
    IFCDOOR: 'Doors',
    IFCWINDOW: 'Windows',
    IFCROOF: 'Roofs',
    IFCCOVERING: 'Coverings',
    IFCCURTAINWALL: 'Curtain walls',
    IFCELEMENTASSEMBLY: 'Assemblies',
    IFCMECHANICALFASTENER: 'Fasteners',
    IFCFASTENER: 'Fasteners',
    IFCDISCRETEACCESSORY: 'Accessories',
    IFCGRID: 'Grids',
    IFCANNOTATION: 'Annotations',
  };
  return words[ifcType] ?? ifcType.replace(/^IFC/, '');
}
