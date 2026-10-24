import * as THREE from 'three';

/**
 * The analytical model as the viewer draws it: members as lines, nodes as points,
 * supports and loads as glyphs, surfaces as translucent outlines. The application owns the
 * data shape; the layer takes only what it draws, with coordinates already mapped to
 * viewer space through `toViewer`.
 */
export interface AnalysisDrawNode {
  name: string;
  x: number;
  y: number;
  z: number;
}
export interface AnalysisDrawMember {
  uid: string;
  kind: 'beam' | 'column' | 'brace' | 'other';
  start: string;
  end: string;
}
export interface AnalysisDrawSurface {
  uid: string;
  nodes: string[];
}
export interface AnalysisDrawSupport {
  node: string;
  fixed: boolean[];
}
export interface AnalysisDrawPointLoad {
  node: string;
  force: [number, number, number];
}
export interface AnalysisDrawLineLoad {
  member: string;
  direction: string;
  start: number;
  end: number;
  from: number;
  to: number;
}

export interface AnalysisDrawSource {
  nodes: AnalysisDrawNode[];
  members: AnalysisDrawMember[];
  surfaces: AnalysisDrawSurface[];
  supports: AnalysisDrawSupport[];
  pointLoads: AnalysisDrawPointLoad[];
  lineLoads: AnalysisDrawLineLoad[];
  /** Maps a node's coordinates (model units, Z up) to viewer space. */
  toViewer: (x: number, y: number, z: number) => THREE.Vector3;
  /** Maps a direction in the analysis frame (Z up) to viewer space. */
  directionToViewer: (x: number, y: number, z: number) => THREE.Vector3;
}

export interface AnalysisVisibility {
  members: boolean;
  nodes: boolean;
  supports: boolean;
  loads: boolean;
  surfaces: boolean;
}

export const MEMBER_KIND_COLORS: Record<AnalysisDrawMember['kind'], string> = {
  beam: '#5b9dff',
  column: '#ff8a4c',
  brace: '#c084fc',
  other: '#8a94a6',
};

const NODE_COLOR = '#cfd6e4';
const SUPPORT_COLOR = '#3ccf7a';
const LOAD_COLOR = '#ff6b9d';
const HIGHLIGHT_COLOR = '#ffffff';

export class AnalysisLayer {
  readonly group = new THREE.Group();
  private readonly members: THREE.LineSegments;
  private readonly memberColors: THREE.BufferAttribute;
  private readonly baseColors: Float32Array;
  private readonly segmentUids: string[] = [];
  private readonly segmentIndex = new Map<string, number>();
  private readonly nodes: THREE.Points;
  private readonly supports = new THREE.Group();
  private readonly loads = new THREE.Group();
  private readonly surfaces = new THREE.Group();
  private readonly highlightGroup = new THREE.Group();
  private readonly positions: Float32Array;
  private readonly nodeByName = new Map<string, THREE.Vector3>();
  private readonly disposables: { dispose(): void }[] = [];

  constructor(source: AnalysisDrawSource) {
    this.group.name = 'analysis';
    for (const n of source.nodes) this.nodeByName.set(n.name, source.toViewer(n.x, n.y, n.z));

    // Members.
    const drawn = source.members.filter(
      (m) => this.nodeByName.has(m.start) && this.nodeByName.has(m.end),
    );
    this.positions = new Float32Array(drawn.length * 6);
    this.baseColors = new Float32Array(drawn.length * 6);
    const color = new THREE.Color();
    drawn.forEach((m, i) => {
      const a = this.nodeByName.get(m.start)!;
      const b = this.nodeByName.get(m.end)!;
      this.positions.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
      color.set(MEMBER_KIND_COLORS[m.kind] ?? MEMBER_KIND_COLORS.other);
      this.baseColors.set([color.r, color.g, color.b, color.r, color.g, color.b], i * 6);
      this.segmentUids.push(m.uid);
      this.segmentIndex.set(m.uid, i);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.memberColors = new THREE.BufferAttribute(this.baseColors.slice(), 3);
    geometry.setAttribute('color', this.memberColors);
    const material = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 1 });
    this.members = new THREE.LineSegments(geometry, material);
    this.members.name = 'analysis-members';
    this.members.renderOrder = 2;
    this.disposables.push(geometry, material);
    this.group.add(this.members);

    // Nodes.
    const nodePositions = new Float32Array(source.nodes.length * 3);
    source.nodes.forEach((n, i) => {
      const p = this.nodeByName.get(n.name)!;
      nodePositions.set([p.x, p.y, p.z], i * 3);
    });
    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3));
    const nodeMaterial = new THREE.PointsMaterial({
      color: NODE_COLOR,
      size: 5,
      sizeAttenuation: false,
      depthTest: true,
    });
    this.nodes = new THREE.Points(nodeGeometry, nodeMaterial);
    this.nodes.name = 'analysis-nodes';
    this.disposables.push(nodeGeometry, nodeMaterial);
    this.group.add(this.nodes);

    // Supports: a cone under pinned nodes, a box under fixed ones, a flat disc otherwise.
    const supportMaterial = new THREE.MeshBasicMaterial({ color: SUPPORT_COLOR });
    const cone = new THREE.ConeGeometry(0.18, 0.36, 12);
    const box = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const disc = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16);
    this.disposables.push(supportMaterial, cone, box, disc);
    const down = source.directionToViewer(0, 0, -1).normalize();
    for (const s of source.supports) {
      const p = this.nodeByName.get(s.node);
      if (!p) continue;
      const allFixed = s.fixed.every(Boolean);
      const rotational = s.fixed.slice(3).some(Boolean);
      const mesh = new THREE.Mesh(allFixed ? box : rotational ? disc : cone, supportMaterial);
      mesh.position.copy(p).addScaledVector(down, allFixed ? 0.15 : 0.18);
      // Cones point up at the node.
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), down.clone().negate());
      this.supports.add(mesh);
    }
    this.group.add(this.supports);

    // Loads.
    for (const load of source.pointLoads) {
      const p = this.nodeByName.get(load.node);
      if (!p) continue;
      const [fx, fy, fz] = load.force;
      const magnitude = Math.hypot(fx, fy, fz);
      if (magnitude < 1e-9) continue;
      const dir = source.directionToViewer(fx, fy, fz).normalize();
      // The arrow points at the node, along the force.
      const length = 1.2;
      const origin = p.clone().addScaledVector(dir, -length);
      const arrow = new THREE.ArrowHelper(dir, origin, length, LOAD_COLOR, 0.3, 0.15);
      this.loads.add(arrow);
    }
    const memberByUid = new Map(drawn.map((m) => [m.uid, m]));
    for (const load of source.lineLoads) {
      const m = memberByUid.get(load.member);
      if (!m) continue;
      const a = this.nodeByName.get(m.start)!;
      const b = this.nodeByName.get(m.end)!;
      const dir = loadDirection(load.direction, Math.sign(load.start || load.end || -1), source);
      const count = 5;
      const length = 0.7;
      for (let i = 0; i < count; i++) {
        const t = load.from + ((load.to - load.from) * (i + 0.5)) / count;
        const at = a.clone().lerp(b, t);
        const origin = at.clone().addScaledVector(dir, -length);
        this.loads.add(new THREE.ArrowHelper(dir, origin, length, LOAD_COLOR, 0.18, 0.1));
      }
    }
    this.group.add(this.loads);

    // Surfaces: outline plus a translucent fan fill.
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: '#8fd3b6',
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const outlineMaterial = new THREE.LineBasicMaterial({ color: '#8fd3b6' });
    this.disposables.push(fillMaterial, outlineMaterial);
    for (const surface of source.surfaces) {
      const points = surface.nodes
        .map((n) => this.nodeByName.get(n))
        .filter((p): p is THREE.Vector3 => !!p);
      if (points.length < 3) continue;
      const outline = new THREE.BufferGeometry().setFromPoints([...points, points[0]!]);
      this.surfaces.add(new THREE.Line(outline, outlineMaterial));
      const fan: number[] = [];
      for (let i = 1; i + 1 < points.length; i++) {
        fan.push(...points[0]!.toArray(), ...points[i]!.toArray(), ...points[i + 1]!.toArray());
      }
      const fill = new THREE.BufferGeometry();
      fill.setAttribute('position', new THREE.Float32BufferAttribute(fan, 3));
      this.surfaces.add(new THREE.Mesh(fill, fillMaterial));
      this.disposables.push(outline, fill);
    }
    this.group.add(this.surfaces);
    this.group.add(this.highlightGroup);
  }

  get memberCount(): number {
    return this.segmentUids.length;
  }

  setVisibility(visibility: AnalysisVisibility): void {
    this.members.visible = visibility.members;
    this.nodes.visible = visibility.nodes;
    this.supports.visible = visibility.supports;
    this.loads.visible = visibility.loads;
    this.surfaces.visible = visibility.surfaces;
  }

  /** Colours members by uid; members absent from the map are dimmed. `null` restores kinds. */
  setMemberColors(colors: Map<string, THREE.ColorRepresentation> | null): void {
    const array = this.memberColors.array as Float32Array;
    if (!colors) {
      array.set(this.baseColors);
    } else {
      const color = new THREE.Color();
      this.segmentUids.forEach((uid, i) => {
        const c = colors.get(uid);
        color.set(c ?? '#3a4150');
        array.set([color.r, color.g, color.b, color.r, color.g, color.b], i * 6);
      });
    }
    this.memberColors.needsUpdate = true;
  }

  /** Draws the member brighter with spheres at its ends. */
  highlight(uid: string | null): void {
    for (const child of [...this.highlightGroup.children]) {
      this.highlightGroup.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
    if (!uid) return;
    const i = this.segmentIndex.get(uid);
    if (i === undefined) return;
    const a = new THREE.Vector3().fromArray(this.positions, i * 6);
    const b = new THREE.Vector3().fromArray(this.positions, i * 6 + 3);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      new THREE.LineBasicMaterial({ color: HIGHLIGHT_COLOR, depthTest: false }),
    );
    line.renderOrder = 10;
    this.highlightGroup.add(line);
    const sphere = new THREE.SphereGeometry(0.12, 12, 12);
    const material = new THREE.MeshBasicMaterial({ color: HIGHLIGHT_COLOR, depthTest: false });
    for (const p of [a, b]) {
      const mesh = new THREE.Mesh(sphere, material);
      mesh.position.copy(p);
      mesh.renderOrder = 10;
      this.highlightGroup.add(mesh);
    }
  }

  memberBounds(uid: string): THREE.Box3 | null {
    const i = this.segmentIndex.get(uid);
    if (i === undefined) return null;
    const a = new THREE.Vector3().fromArray(this.positions, i * 6);
    const b = new THREE.Vector3().fromArray(this.positions, i * 6 + 3);
    return new THREE.Box3().setFromPoints([a, b]).expandByScalar(0.5);
  }

  /** Nearest member under the ray, with its distance along the ray. */
  pick(raycaster: THREE.Raycaster): { uid: string; distance: number } | null {
    if (!this.members.visible || !this.group.visible) return null;
    const previous = raycaster.params.Line.threshold;
    raycaster.params.Line.threshold = 0.12;
    const hits = raycaster.intersectObject(this.members, false);
    raycaster.params.Line.threshold = previous;
    const hit = hits[0];
    if (!hit || hit.index === undefined) return null;
    const uid = this.segmentUids[Math.floor(hit.index / 2)];
    return uid ? { uid, distance: hit.distance } : null;
  }

  dispose(): void {
    this.highlight(null);
    for (const d of this.disposables) d.dispose();
    for (const arrow of this.loads.children) (arrow as THREE.ArrowHelper).dispose?.();
  }
}

function loadDirection(direction: string, sign: number, source: AnalysisDrawSource): THREE.Vector3 {
  const s = sign === 0 ? -1 : sign;
  switch (direction) {
    case 'x':
      return source.directionToViewer(s, 0, 0).normalize();
    case 'y':
      return source.directionToViewer(0, s, 0).normalize();
    case 'z':
      return source.directionToViewer(0, 0, s).normalize();
    default:
      // gravity: positive values act downwards
      return source.directionToViewer(0, 0, -Math.abs(s)).normalize();
  }
}
