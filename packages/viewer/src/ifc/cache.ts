import * as THREE from 'three';
import { IfcModel, solidVertexColors, type ElementRange, type MeshBucket } from './model';

/**
 * A compact binary form of a loaded model's merged meshes, so a revision opened once
 * opens again without running web-ifc. Layout (little-endian):
 *
 *   magic "KPG1" · u32 bucketCount · f32 coordination[16]
 *   per bucket: f32 r,g,b,opacity · u32 vertexCount · u32 indexCount · u32 rangeCount
 *               f32 positions[vertexCount*3] · f32 normals[vertexCount*3]
 *               u32 indices[indexCount] · u32 ranges[rangeCount*5]
 */
const MAGIC = 0x3147504b; // "KPG1"

export interface CachedModel {
  group: THREE.Group;
  buckets: MeshBucket[];
  coordination: number[];
  triangles: number;
}

export function serializeBuckets(buckets: MeshBucket[], coordination: number[] | null): Uint8Array {
  let size = 4 + 4 + 16 * 4;
  const parts: {
    positions: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
    ranges: ElementRange[];
    color: THREE.Color;
    opacity: number;
  }[] = [];
  for (const bucket of buckets) {
    const geometry = bucket.mesh.geometry;
    const positions = geometry.getAttribute('position').array as Float32Array;
    const normals =
      (geometry.getAttribute('normal')?.array as Float32Array | undefined) ??
      new Float32Array(positions.length);
    const indices = new Uint32Array(geometry.getIndex()!.array as ArrayLike<number>);
    const material = bucket.mesh.material as THREE.MeshLambertMaterial;
    parts.push({
      positions,
      normals,
      indices,
      ranges: bucket.ranges,
      color: bucket.baseColor,
      opacity: material.opacity ?? 1,
    });
    size +=
      4 * 4 +
      3 * 4 +
      positions.byteLength +
      normals.byteLength +
      indices.byteLength +
      bucket.ranges.length * 5 * 4;
  }
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  let o = 0;
  view.setUint32(o, MAGIC, true);
  o += 4;
  view.setUint32(o, parts.length, true);
  o += 4;
  const matrix =
    coordination && coordination.length === 16
      ? coordination
      : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const v of matrix) {
    view.setFloat32(o, v, true);
    o += 4;
  }
  for (const p of parts) {
    for (const v of [p.color.r, p.color.g, p.color.b, p.opacity]) {
      view.setFloat32(o, v, true);
      o += 4;
    }
    view.setUint32(o, p.positions.length / 3, true);
    o += 4;
    view.setUint32(o, p.indices.length, true);
    o += 4;
    view.setUint32(o, p.ranges.length, true);
    o += 4;
    new Uint8Array(buffer, o, p.positions.byteLength).set(
      new Uint8Array(p.positions.buffer, p.positions.byteOffset, p.positions.byteLength),
    );
    o += p.positions.byteLength;
    new Uint8Array(buffer, o, p.normals.byteLength).set(
      new Uint8Array(p.normals.buffer, p.normals.byteOffset, p.normals.byteLength),
    );
    o += p.normals.byteLength;
    new Uint8Array(buffer, o, p.indices.byteLength).set(
      new Uint8Array(p.indices.buffer, p.indices.byteOffset, p.indices.byteLength),
    );
    o += p.indices.byteLength;
    for (const r of p.ranges) {
      for (const v of [r.expressId, r.indexStart, r.indexCount, r.vertexStart, r.vertexCount]) {
        view.setUint32(o, v, true);
        o += 4;
      }
    }
  }
  return new Uint8Array(buffer);
}

/** Rebuilds the meshes from a cached form; null when the bytes are not a cache file. */
export function deserializeBuckets(bytes: Uint8Array): CachedModel | null {
  if (bytes.byteLength < 8) return null;
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const view = new DataView(buffer);
  let o = 0;
  if (view.getUint32(o, true) !== MAGIC) return null;
  o += 4;
  const bucketCount = view.getUint32(o, true);
  o += 4;
  const coordination: number[] = [];
  for (let i = 0; i < 16; i++) {
    coordination.push(view.getFloat32(o, true));
    o += 4;
  }
  const group = new THREE.Group();
  const buckets: MeshBucket[] = [];
  let triangles = 0;
  for (let b = 0; b < bucketCount; b++) {
    const color = new THREE.Color(
      view.getFloat32(o, true),
      view.getFloat32(o + 4, true),
      view.getFloat32(o + 8, true),
    );
    const opacity = view.getFloat32(o + 12, true);
    o += 16;
    const vertexCount = view.getUint32(o, true);
    o += 4;
    const indexCount = view.getUint32(o, true);
    o += 4;
    const rangeCount = view.getUint32(o, true);
    o += 4;
    const positions = new Float32Array(buffer.slice(o, o + vertexCount * 12));
    o += vertexCount * 12;
    const normals = new Float32Array(buffer.slice(o, o + vertexCount * 12));
    o += vertexCount * 12;
    const indices = new Uint32Array(buffer.slice(o, o + indexCount * 4));
    o += indexCount * 4;
    const ranges: ElementRange[] = [];
    for (let r = 0; r < rangeCount; r++) {
      ranges.push({
        expressId: view.getUint32(o, true),
        indexStart: view.getUint32(o + 4, true),
        indexCount: view.getUint32(o + 8, true),
        vertexStart: view.getUint32(o + 12, true),
        vertexCount: view.getUint32(o + 16, true),
      });
      o += 20;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', solidVertexColors(vertexCount, color));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    buckets.push({ mesh, baseColor: color, ranges });
    triangles += indexCount / 3;
  }
  return { group, buckets, coordination, triangles };
}

export function modelFromCache(cached: CachedModel): IfcModel {
  return new IfcModel(cached.group, cached.buckets);
}
