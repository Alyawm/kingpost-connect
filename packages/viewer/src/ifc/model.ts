import * as THREE from 'three';
import type { PickResult } from '../scene';

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

/**
 * A loaded IFC model: few draw calls (one mesh per material) but per-element identity.
 *
 * Elements are addressed by express id. Selection and tints are painted into a per-vertex
 * colour attribute; hiding rewrites the index buffer without the hidden ranges, which also
 * removes hidden elements from picking. Both are cheap enough to run on every click.
 */
export class IfcModel {
  readonly group: THREE.Group;
  private readonly buckets: MeshBucket[];
  private readonly partsOf = new Map<number, { bucket: MeshBucket; range: ElementRange }[]>();
  private readonly fullIndex = new Map<THREE.Mesh, Uint32Array>();
  private readonly hidden = new Set<number>();
  private readonly tints = new Map<number, THREE.Color>();
  private readonly selected = new Set<number>();

  constructor(group: THREE.Group, buckets: MeshBucket[]) {
    this.group = group;
    this.buckets = buckets;
    for (const bucket of buckets) {
      const index = bucket.mesh.geometry.getIndex();
      if (index) this.fullIndex.set(bucket.mesh, new Uint32Array(index.array as ArrayLike<number>));
      for (const range of bucket.ranges) {
        const parts = this.partsOf.get(range.expressId) ?? [];
        parts.push({ bucket, range });
        this.partsOf.set(range.expressId, parts);
      }
      bucket.mesh.userData = {
        ...bucket.mesh.userData,
        managedSelection: true,
        resolvePick: (faceIndex: number): PickResult | null => {
          const id = this.expressIdAt(bucket, faceIndex);
          return id === null ? null : { name: `#${id}`, type: 'IfcProduct', expressId: id };
        },
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
    const position = faceIndex * 3;
    let offset = 0;
    for (const range of bucket.ranges) {
      if (this.hidden.has(range.expressId)) continue;
      if (position < offset + range.indexCount) return range.expressId;
      offset += range.indexCount;
    }
    return null;
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

  dispose(): void {
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
        : (this.tints.get(expressId) ?? bucket.baseColor);
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
    }
  }

  private rebuildIndices(): void {
    for (const bucket of this.buckets) {
      const full = this.fullIndex.get(bucket.mesh);
      if (!full) continue;
      const anyHidden = bucket.ranges.some((r) => this.hidden.has(r.expressId));
      if (!anyHidden) {
        bucket.mesh.geometry.setIndex(new THREE.BufferAttribute(full, 1));
        bucket.mesh.visible = true;
        continue;
      }
      let total = 0;
      for (const range of bucket.ranges)
        if (!this.hidden.has(range.expressId)) total += range.indexCount;
      const filtered = new Uint32Array(total);
      let cursor = 0;
      for (const range of bucket.ranges) {
        if (this.hidden.has(range.expressId)) continue;
        filtered.set(full.subarray(range.indexStart, range.indexStart + range.indexCount), cursor);
        cursor += range.indexCount;
      }
      bucket.mesh.geometry.setIndex(new THREE.BufferAttribute(filtered, 1));
      bucket.mesh.visible = total > 0;
    }
  }
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
