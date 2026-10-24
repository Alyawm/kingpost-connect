import * as THREE from 'three';

/**
 * web-ifc hands back vertices as one interleaved Float32Array: for every vertex,
 * position (x, y, z) followed by normal (nx, ny, nz). This splits it into the two
 * attributes three.js expects. The input views point into WASM memory and are only
 * valid until the next web-ifc call, so the data is always copied here.
 */
export function toBufferGeometry(
  vertexData: Float32Array,
  indexData: Uint32Array,
): THREE.BufferGeometry {
  const vertexCount = vertexData.length / 6;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const source = i * 6;
    const target = i * 3;
    positions[target] = vertexData[source] ?? 0;
    positions[target + 1] = vertexData[source + 1] ?? 0;
    positions[target + 2] = vertexData[source + 2] ?? 0;
    normals[target] = vertexData[source + 3] ?? 0;
    normals[target + 1] = vertexData[source + 4] ?? 0;
    normals[target + 2] = vertexData[source + 5] ?? 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indexData), 1));
  return geometry;
}

/** Stable key for a web-ifc colour so geometry sharing a material can be merged. */
export function colorKey(color: { x: number; y: number; z: number; w: number }): string {
  return `${color.x.toFixed(3)},${color.y.toFixed(3)},${color.z.toFixed(3)},${color.w.toFixed(3)}`;
}
