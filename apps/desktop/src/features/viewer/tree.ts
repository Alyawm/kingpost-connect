import type { ElementSummary } from '../../lib/ipc';

export interface TypeGroup {
  key: string;
  ifcType: string;
  elements: ElementSummary[];
}

export interface StoreyGroup {
  key: string;
  name: string;
  types: TypeGroup[];
  count: number;
}

export const NO_STOREY = '— no storey —';

/** Groups product elements by storey, then by IFC type; spatial elements are the groups. */
export function buildTree(elements: ElementSummary[], filter: string): StoreyGroup[] {
  const needle = filter.trim().toLowerCase();
  const storeys = new Map<string, Map<string, ElementSummary[]>>();
  for (const element of elements) {
    if (element.is_spatial) continue;
    if (needle && !matches(element, needle)) continue;
    const storey = element.storey ?? NO_STOREY;
    const types = storeys.get(storey) ?? new Map<string, ElementSummary[]>();
    types.set(element.ifc_type, [...(types.get(element.ifc_type) ?? []), element]);
    storeys.set(storey, types);
  }
  // Numeric-aware so "2.Floor" sorts before "10.Floor"; unplaced elements come last.
  return [...storeys.entries()]
    .sort(([a], [b]) =>
      a === NO_STOREY
        ? 1
        : b === NO_STOREY
          ? -1
          : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    )
    .map(([name, types]) => {
      const typeGroups = [...types.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([ifcType, list]) => ({
          key: `${name}/${ifcType}`,
          ifcType,
          elements: list.sort((a, b) =>
            label(a).localeCompare(label(b), undefined, { numeric: true }),
          ),
        }));
      return {
        key: name,
        name,
        types: typeGroups,
        count: typeGroups.reduce((n, g) => n + g.elements.length, 0),
      };
    });
}

function matches(element: ElementSummary, needle: string): boolean {
  return [element.name, element.tag, element.ifc_type, element.type_name, element.global_id]
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
