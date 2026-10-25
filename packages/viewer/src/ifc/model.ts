import * as THREE from 'three';
import type { PickResult } from '../scene';
import { extractEdges } from './edges';

/** One element's slice of a merged mesh. */
export interface ElementRange {
  expressId: number;
  indexStart: number;
  indexCount: number;
  vertexStart: number;
  vertexCount: number;
}

/** A merged mesh and the element ranges inside it, in index order. */
export interface MeshBucket {
  mesh: THREE.Mesh;
  baseColor: THREE.Color;
  ranges: ElementRange[];
}

const SELECTION = new THREE.Color(0xffb020);
/** Below this an element is not drawn at all (it stays in the model and can be shown again). */
const INVISIBLE = 0.01;

/** A per-element appearance override: a colour, an opacity (0-1), or both. */
export interface ElementAppearance {
  color?: THREE.ColorRepresentation;
  opacity?: number;
}

/**
 * A loaded IFC model: few draw calls (one mesh per material) but per-element identity.
 *
 * Elements are addressed by express id. Selection and tints are painted into a per-vertex
 * colour attribute; hiding rewrites the index buffer without the hidden ranges, which also
 * removes hidden elements from picking. Both are cheap enough to run on every click.
 */
export class IfcModel {
  readonly group: THREE.Group;
  /** Which loaded model this is, reported with every pick ('main' unless federated). */
  key = 'main';
  readonly buckets: MeshBucket[];
  private readonly partsOf = new Map<number, { bucket: MeshBucket; range: ElementRange }[]>();
  private readonly fullIndex = new Map<THREE.Mesh, Uint32Array>();
  private readonly hidden = new Set<number>();
  private readonly tints = new Map<number, THREE.Color>();
  private readonly selected = new Set<number>();
  private readonly overrideColors = new Map<number, THREE.Color>();
  private readonly overrideOpacity = new Map<number, number>();
  /** Companion meshes that draw a bucket's see-through elements, created on first use. */
  private readonly translucent = new Map<MeshBucket, THREE.Mesh>();
  /** Edge lines per bucket, built on first request. */
  private readonly edgeLines = new Map<
    MeshBucket,
    {
      lines: THREE.LineSegments;
      full: Uint32Array;
      ranges: { expressId: number; start: number; count: number }[];
    }
  >();
  private edgesState: 'none' | 'building' | 'ready' = 'none';
  private edgesVisible = false;
  private disposed = false;

  constructor(group: THREE.Group, buckets: MeshBucket[]) {
    this.group = group;
    this.buckets = buckets;
    for (const bucket of buckets) {
      const index = bucket.mesh.geometry.getIndex();
      if (index) {
        const full = new Uint32Array(index.array as ArrayLike<number>);
        this.fullIndex.set(bucket.mesh, full);
        // The geometry cache must store every element, whatever is hidden when it is written.
        bucket.mesh.userData = { ...bucket.mesh.userData, fullIndex: full };
      }
      for (const range of bucket.ranges) {
        const parts = this.partsOf.get(range.expressId) ?? [];
        parts.push({ bucket, range });
        this.partsOf.set(range.expressId, parts);
      }
      bucket.mesh.userData = {
        ...bucket.mesh.userData,
        managedSelection: true,
        resolvePick: (faceIndex: number): PickResult | null =>
          pickResult(this.expressIdAt(bucket, faceIndex), this.key),
      };
    }
  }

  get expressIds(): number[] {
    return [...this.partsOf.keys()];
  }

  get elementCount(): number {
    return this.partsOf.size;
  }

  has(expressId: number): boolean {
    return this.partsOf.has(expressId);
  }

  /** Element under a face of one of the model's meshes (binary search over ranges). */
  expressIdAt(bucket: MeshBucket, faceIndex: number): number | null {
    // Picking reports faces of the *current* index buffer, which may omit hidden ranges;
    // map the face back through the visible ranges in order.
    return this.idAtFace(bucket, faceIndex, (id) => this.drawnOpaque(id));
  }

  private idAtFace(
    bucket: MeshBucket,
    faceIndex: number,
    included: (id: number) => boolean,
  ): number | null {
    const position = faceIndex * 3;
    let offset = 0;
    for (const range of bucket.ranges) {
      if (!included(range.expressId)) continue;
      if (position < offset + range.indexCount) return range.expressId;
      offset += range.indexCount;
    }
    return null;
  }

  /** Effective opacity override of an element (1 when it has none). */
  opacityOf(expressId: number): number {
    return this.overrideOpacity.get(expressId) ?? 1;
  }

  private drawnOpaque(id: number): boolean {
    return !this.hidden.has(id) && this.opacityOf(id) >= 1;
  }

  private drawnTranslucent(id: number): boolean {
    if (this.hidden.has(id)) return false;
    const opacity = this.opacityOf(id);
    return opacity < 1 && opacity >= INVISIBLE;
  }

  /**
   * Replaces every per-element appearance override (null or empty clears them). A colour
   * wins over the colour-by tint; an opacity below 1 draws the element see-through.
   * Selection still paints on top of both.
   */
  setAppearance(appearance: Map<number, ElementAppearance> | null): void {
    const colors = new Map<number, THREE.Color>();
    const opacity = new Map<number, number>();
    const cache = new Map<THREE.ColorRepresentation, THREE.Color>();
    for (const [id, look] of appearance ?? []) {
      if (look.color !== undefined && look.color !== null) {
        let color = cache.get(look.color);
        if (!color) {
          color = new THREE.Color(look.color);
          cache.set(look.color, color);
        }
        colors.set(id, color);
      }
      if (typeof look.opacity === 'number' && look.opacity < 1) {
        opacity.set(id, Math.max(0, look.opacity));
      }
    }
    // Only elements whose look changed are repainted, so small edits stay cheap even
    // when thousands of elements carry overrides (for example after "ghost others").
    const touched = new Set<number>();
    let opacityChanged = false;
    for (const id of new Set([...this.overrideColors.keys(), ...colors.keys()])) {
      const before = this.overrideColors.get(id);
      const after = colors.get(id);
      if (!before || !after || !before.equals(after)) touched.add(id);
    }
    for (const id of new Set([...this.overrideOpacity.keys(), ...opacity.keys()])) {
      if (this.overrideOpacity.get(id) !== opacity.get(id)) {
        touched.add(id);
        opacityChanged = true;
      }
    }
    this.overrideColors.clear();
    for (const [id, color] of colors) this.overrideColors.set(id, color);
    this.overrideOpacity.clear();
    for (const [id, value] of opacity) this.overrideOpacity.set(id, value);
    for (const id of touched) this.repaint(id);
    if (opacityChanged) this.rebuildIndices();
  }

  /** The see-through companion of a bucket: shares positions and normals, own RGBA colours. */
  private translucentOf(bucket: MeshBucket): THREE.Mesh {
    const existing = this.translucent.get(bucket);
    if (existing) return existing;
    const source = bucket.mesh.geometry;
    const geometry = new THREE.BufferGeometry();
    const position = source.getAttribute('position');
    geometry.setAttribute('position', position);
    const normal = source.getAttribute('normal');
    if (normal) geometry.setAttribute('normal', normal);
    const colors = new Uint8Array(position.count * 4);
    const rgb = source.getAttribute('color').array as Uint8Array;
    for (let i = 0; i < position.count; i++) {
      colors[i * 4] = rgb[i * 3]!;
      colors[i * 4 + 1] = rgb[i * 3 + 1]!;
      colors[i * 4 + 2] = rgb[i * 3 + 2]!;
      colors[i * 4 + 3] = 255;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4, true));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: this.edgesVisible,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${bucket.mesh.name} (see-through)`;
    mesh.renderOrder = 1;
    mesh.position.copy(bucket.mesh.position);
    mesh.quaternion.copy(bucket.mesh.quaternion);
    mesh.scale.copy(bucket.mesh.scale);
    mesh.visible = false;
    mesh.userData = {
      managedSelection: true,
      resolvePick: (faceIndex: number): PickResult | null =>
        pickResult(
          this.idAtFace(bucket, faceIndex, (id) => this.drawnTranslucent(id)),
          this.key,
        ),
    };
    this.translucent.set(bucket, mesh);
    this.group.add(mesh);
    return mesh;
  }

  /** Replaces the selection; null or an empty set clears it. */
  setSelected(expressIds: Iterable<number> | number | null): void {
    const next = new Set<number>(
      expressIds === null ? [] : typeof expressIds === 'number' ? [expressIds] : expressIds,
    );
    const touched = new Set<number>([...this.selected, ...next]);
    this.selected.clear();
    for (const id of next) this.selected.add(id);
    for (const id of touched) this.repaint(id);
  }

  get selectedIds(): ReadonlySet<number> {
    return this.selected;
  }

  /** Replaces the per-element tint map (null or empty clears it). Colours are CSS strings or hex numbers. */
  setTints(tints: Map<number, THREE.ColorRepresentation> | null): void {
    const touched = new Set<number>([...this.tints.keys(), ...(tints?.keys() ?? [])]);
    this.tints.clear();
    if (tints) {
      const cache = new Map<THREE.ColorRepresentation, THREE.Color>();
      for (const [id, value] of tints) {
        let color = cache.get(value);
        if (!color) {
          color = new THREE.Color(value);
          cache.set(value, color);
        }
        this.tints.set(id, color);
      }
    }
    for (const id of touched) this.repaint(id);
  }

  setHidden(ids: Iterable<number>): void {
    this.hidden.clear();
    for (const id of ids) this.hidden.add(id);
    this.rebuildIndices();
  }

  isolate(ids: Iterable<number>): void {
    const keep = new Set(ids);
    this.setHidden(this.expressIds.filter((id) => !keep.has(id)));
  }

  showAll(): void {
    this.setHidden([]);
  }

  get hiddenIds(): ReadonlySet<number> {
    return this.hidden;
  }

  /**
   * World-space triangles of an element as a flat array (nine numbers per triangle), read
   * from the full index so hidden elements are included. Empty when it has no geometry.
   */
  trianglesOf(expressId: number): Float32Array {
    this.group.updateMatrixWorld(true);
    const parts = this.partsOf.get(expressId) ?? [];
    let total = 0;
    for (const { range } of parts) total += range.indexCount;
    const out = new Float32Array(total * 3);
    const point = new THREE.Vector3();
    let offset = 0;
    for (const { bucket, range } of parts) {
      const index = this.fullIndex.get(bucket.mesh);
      const positions = bucket.mesh.geometry.getAttribute('position');
      if (!index) continue;
      const end = range.indexStart + range.indexCount;
      for (let i = range.indexStart; i < end; i++) {
        point.fromBufferAttribute(positions, index[i]!).applyMatrix4(bucket.mesh.matrixWorld);
        out[offset++] = point.x;
        out[offset++] = point.y;
        out[offset++] = point.z;
      }
    }
    return out.subarray(0, offset);
  }

  /**
   * Quantities measured from an element's mesh in world space: volume by the divergence
   * theorem (exact for closed meshes, approximate otherwise), surface area, bounding box
   * and its longest dimension as the length. Null when the element has no triangles.
   */
  quantitiesOf(expressId: number): {
    volume: number;
    surfaceArea: number;
    length: number;
    bboxMin: [number, number, number];
    bboxMax: [number, number, number];
  } | null {
    const tris = this.trianglesOf(expressId);
    if (tris.length < 9) return null;
    let volume = 0;
    let area = 0;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < tris.length; i += 9) {
      const ax = tris[i]!,
        ay = tris[i + 1]!,
        az = tris[i + 2]!;
      const bx = tris[i + 3]!,
        by = tris[i + 4]!,
        bz = tris[i + 5]!;
      const cx = tris[i + 6]!,
        cy = tris[i + 7]!,
        cz = tris[i + 8]!;
      volume +=
        (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      const ux = bx - ax,
        uy = by - ay,
        uz = bz - az;
      const vx = cx - ax,
        vy = cy - ay,
        vz = cz - az;
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
      for (const [x, y, z] of [
        [ax, ay, az],
        [bx, by, bz],
        [cx, cy, cz],
      ] as const) {
        if (x < min[0]!) min[0] = x;
        if (y < min[1]!) min[1] = y;
        if (z < min[2]!) min[2] = z;
        if (x > max[0]!) max[0] = x;
        if (y > max[1]!) max[1] = y;
        if (z > max[2]!) max[2] = z;
      }
    }
    return {
      volume: Math.abs(volume),
      surfaceArea: area,
      length: Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!),
      bboxMin: [min[0]!, min[1]!, min[2]!],
      bboxMax: [max[0]!, max[1]!, max[2]!],
    };
  }

  /** Per-element world bounds as flat min/max arrays, computed once on first use. */
  private elementBoxes: Map<number, Float32Array> | null = null;

  private boxes(): Map<number, Float32Array> {
    if (this.elementBoxes) return this.elementBoxes;
    this.group.updateMatrixWorld(true);
    const out = new Map<number, Float32Array>();
    const point = new THREE.Vector3();
    for (const [id, parts] of this.partsOf) {
      const b = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
      for (const { bucket, range } of parts) {
        const positions = bucket.mesh.geometry.getAttribute('position');
        const end = range.vertexStart + range.vertexCount;
        for (let i = range.vertexStart; i < end; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(bucket.mesh.matrixWorld);
          if (point.x < b[0]!) b[0] = point.x;
          if (point.y < b[1]!) b[1] = point.y;
          if (point.z < b[2]!) b[2] = point.z;
          if (point.x > b[3]!) b[3] = point.x;
          if (point.y > b[4]!) b[4] = point.y;
          if (point.z > b[5]!) b[5] = point.z;
        }
      }
      if (b[0]! <= b[3]!) out.set(id, b);
    }
    this.elementBoxes = out;
    return out;
  }

  /**
   * Elements inside a screen rectangle (normalised device coordinates). A window selection
   * takes elements whose whole box projects inside; a crossing selection takes any that
   * overlaps. Hidden and fully transparent elements, and elements behind the camera, are
   * skipped, as are those entirely cut away by `keep` planes.
   */
  idsInScreenRect(
    camera: THREE.Camera,
    rect: { x0: number; y0: number; x1: number; y1: number },
    crossing: boolean,
    keep: THREE.Plane[] = [],
  ): number[] {
    camera.updateMatrixWorld();
    const viewProjection = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    const corner = new THREE.Vector3();
    const box = new THREE.Box3();
    const result: number[] = [];
    for (const [id, b] of this.boxes()) {
      if (this.hidden.has(id) || this.opacityOf(id) < INVISIBLE) continue;
      box.min.set(b[0]!, b[1]!, b[2]!);
      box.max.set(b[3]!, b[4]!, b[5]!);
      // Fully cut away: even the box corner furthest along the kept side is removed.
      const cutAway = keep.some((plane) => {
        const n = plane.normal;
        const far =
          n.x * (n.x >= 0 ? box.max.x : box.min.x) +
          n.y * (n.y >= 0 ? box.max.y : box.min.y) +
          n.z * (n.z >= 0 ? box.max.z : box.min.z) +
          plane.constant;
        return far < 0;
      });
      if (cutAway) continue;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      let behind = false;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? b[3]! : b[0]!, i & 2 ? b[4]! : b[1]!, i & 4 ? b[5]! : b[2]!);
        corner.applyMatrix4(viewProjection);
        // applyMatrix4 divides by w; a corner behind the camera has w < 0 and flips.
        const w =
          viewProjection.elements[3]! * (i & 1 ? b[3]! : b[0]!) +
          viewProjection.elements[7]! * (i & 2 ? b[4]! : b[1]!) +
          viewProjection.elements[11]! * (i & 4 ? b[5]! : b[2]!) +
          viewProjection.elements[15]!;
        if (w <= 0) behind = true;
        if (corner.x < minX) minX = corner.x;
        if (corner.y < minY) minY = corner.y;
        if (corner.x > maxX) maxX = corner.x;
        if (corner.y > maxY) maxY = corner.y;
      }
      if (behind) continue;
      const inside = crossing
        ? maxX >= rect.x0 && minX <= rect.x1 && maxY >= rect.y0 && minY <= rect.y1
        : minX >= rect.x0 && maxX <= rect.x1 && minY >= rect.y0 && maxY <= rect.y1;
      if (inside) result.push(id);
    }
    return result;
  }

  /** World-space bounds of the given elements, or null when none has geometry. */
  boundsOf(ids: Iterable<number>): THREE.Box3 | null {
    this.group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    let any = false;
    for (const id of ids) {
      for (const { bucket, range } of this.partsOf.get(id) ?? []) {
        const positions = bucket.mesh.geometry.getAttribute('position');
        const end = range.vertexStart + range.vertexCount;
        for (let i = range.vertexStart; i < end; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(bucket.mesh.matrixWorld);
          box.expandByPoint(point);
          any = true;
        }
      }
    }
    return any ? box : null;
  }

  /**
   * Shows or hides element edge lines. The first request builds them (a second or so for
   * a large model, without blocking the interface); the promise resolves when drawn.
   */
  async setEdgesVisible(visible: boolean): Promise<void> {
    this.edgesVisible = visible;
    if (visible && this.edgesState === 'none') await this.buildEdges();
    if (this.disposed) return;
    for (const { lines } of this.edgeLines.values()) lines.visible = this.edgesVisible;
    // Push faces back a little so the lines on their borders win the depth test.
    const materials = [
      ...this.buckets.map((b) => b.mesh.material),
      ...[...this.translucent.values()].map((m) => m.material),
    ].flat() as THREE.Material[];
    for (const material of materials) {
      if (material.polygonOffset === this.edgesVisible) continue;
      material.polygonOffset = this.edgesVisible;
      material.polygonOffsetFactor = 1;
      material.polygonOffsetUnits = 1;
      material.needsUpdate = true;
    }
  }

  get edgesShown(): boolean {
    return this.edgesVisible && this.edgesState === 'ready';
  }

  private async buildEdges(): Promise<void> {
    this.edgesState = 'building';
    for (const bucket of this.buckets) {
      const full = this.fullIndex.get(bucket.mesh);
      if (!full) continue;
      const positions = bucket.mesh.geometry.getAttribute('position').array as ArrayLike<number>;
      const set = await extractEdges(positions, full, bucket.ranges, 30, () => this.disposed);
      if (!set || this.disposed) return;
      if (set.positions.length === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(set.positions, 3));
      const count = set.positions.length / 3;
      const all = new Uint32Array(count);
      for (let i = 0; i < count; i++) all[i] = i;
      geometry.setIndex(new THREE.BufferAttribute(all, 1));
      const lines = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({ color: 0x15181d, transparent: true, opacity: 0.5 }),
      );
      lines.name = `${bucket.mesh.name} (edges)`;
      lines.position.copy(bucket.mesh.position);
      lines.quaternion.copy(bucket.mesh.quaternion);
      lines.scale.copy(bucket.mesh.scale);
      // Edges are drawing aids: never picked, never part of selection.
      lines.raycast = () => {};
      lines.visible = this.edgesVisible;
      this.group.add(lines);
      this.edgeLines.set(bucket, { lines, full: all, ranges: set.ranges });
    }
    this.edgesState = 'ready';
    this.rebuildEdgeIndices();
  }

  /** Edges follow their elements: none for hidden or mostly transparent ones. */
  private rebuildEdgeIndices(): void {
    for (const { lines, full, ranges } of this.edgeLines.values()) {
      const drawn = (id: number) => !this.hidden.has(id) && this.opacityOf(id) >= 0.5;
      if (ranges.every((r) => drawn(r.expressId))) {
        lines.geometry.setIndex(new THREE.BufferAttribute(full, 1));
        continue;
      }
      let total = 0;
      for (const r of ranges) if (drawn(r.expressId)) total += r.count;
      const out = new Uint32Array(total);
      let cursor = 0;
      for (const r of ranges) {
        if (!drawn(r.expressId)) continue;
        out.set(full.subarray(r.start, r.start + r.count), cursor);
        cursor += r.count;
      }
      lines.geometry.setIndex(new THREE.BufferAttribute(out, 1));
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const { lines } of this.edgeLines.values()) {
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    }
    this.edgeLines.clear();
    for (const mesh of this.translucent.values()) {
      // Positions and normals belong to the bucket mesh and are released with it.
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.translucent.clear();
    for (const bucket of this.buckets) {
      bucket.mesh.geometry.dispose();
      const materials = Array.isArray(bucket.mesh.material)
        ? bucket.mesh.material
        : [bucket.mesh.material];
      for (const material of materials) material.dispose();
    }
  }

  private repaint(expressId: number): void {
    for (const { bucket, range } of this.partsOf.get(expressId) ?? []) {
      const color = this.selected.has(expressId)
        ? SELECTION
        : (this.overrideColors.get(expressId) ?? this.tints.get(expressId) ?? bucket.baseColor);
      const attribute = bucket.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const r = Math.round(color.r * 255);
      const g = Math.round(color.g * 255);
      const b = Math.round(color.b * 255);
      const array = attribute.array as Uint8Array;
      const end = range.vertexStart + range.vertexCount;
      for (let i = range.vertexStart; i < end; i++) {
        array[i * 3] = r;
        array[i * 3 + 1] = g;
        array[i * 3 + 2] = b;
      }
      attribute.needsUpdate = true;

      const opacity = this.opacityOf(expressId);
      const companion = opacity < 1 ? this.translucentOf(bucket) : this.translucent.get(bucket);
      if (!companion) continue;
      const rgba = companion.geometry.getAttribute('color') as THREE.BufferAttribute;
      const out = rgba.array as Uint8Array;
      // A selected see-through element stays readable without turning solid.
      const alpha = Math.round(
        (this.selected.has(expressId) ? Math.max(opacity, 0.45) : opacity) * 255,
      );
      for (let i = range.vertexStart; i < end; i++) {
        out[i * 4] = r;
        out[i * 4 + 1] = g;
        out[i * 4 + 2] = b;
        out[i * 4 + 3] = alpha;
      }
      rgba.needsUpdate = true;
    }
  }

  private rebuildIndices(): void {
    for (const bucket of this.buckets) {
      const full = this.fullIndex.get(bucket.mesh);
      if (!full) continue;
      const companion = this.translucent.get(bucket);
      const plain = bucket.ranges.every(
        (r) => !this.hidden.has(r.expressId) && this.opacityOf(r.expressId) >= 1,
      );
      if (plain) {
        bucket.mesh.geometry.setIndex(new THREE.BufferAttribute(full, 1));
        bucket.mesh.visible = true;
        if (companion) {
          companion.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
          companion.visible = false;
        }
        continue;
      }
      const opaque = this.collect(bucket, full, (id) => this.drawnOpaque(id));
      bucket.mesh.geometry.setIndex(new THREE.BufferAttribute(opaque, 1));
      bucket.mesh.visible = opaque.length > 0;
      const seeThrough = this.collect(bucket, full, (id) => this.drawnTranslucent(id));
      if (seeThrough.length > 0 || companion) {
        const mesh = companion ?? this.translucentOf(bucket);
        mesh.geometry.setIndex(new THREE.BufferAttribute(seeThrough, 1));
        mesh.visible = seeThrough.length > 0;
      }
    }
    this.rebuildEdgeIndices();
  }

  private collect(
    bucket: MeshBucket,
    full: Uint32Array,
    included: (id: number) => boolean,
  ): Uint32Array {
    let total = 0;
    for (const range of bucket.ranges) if (included(range.expressId)) total += range.indexCount;
    const out = new Uint32Array(total);
    let cursor = 0;
    for (const range of bucket.ranges) {
      if (!included(range.expressId)) continue;
      out.set(full.subarray(range.indexStart, range.indexStart + range.indexCount), cursor);
      cursor += range.indexCount;
    }
    return out;
  }
}

function pickResult(id: number | null, modelKey: string): PickResult | null {
  return id === null ? null : { name: `#${id}`, type: 'IfcProduct', expressId: id, modelKey };
}

/** Builds the per-vertex colour attribute every model mesh starts with. */
export function solidVertexColors(vertexCount: number, color: THREE.Color): THREE.BufferAttribute {
  const array = new Uint8Array(vertexCount * 3);
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  for (let i = 0; i < vertexCount; i++) {
    array[i * 3] = r;
    array[i * 3 + 1] = g;
    array[i * 3 + 2] = b;
  }
  return new THREE.BufferAttribute(array, 3, true);
}
