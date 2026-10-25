import * as THREE from 'three';
import { extractEdges } from './edges';

/** Unwelded triangles (every triangle has its own vertices), like web-ifc output. */
function soup(geometry: THREE.BufferGeometry) {
  const flat = geometry.toNonIndexed();
  const positions = flat.getAttribute('position').array as Float32Array;
  const count = positions.length / 3;
  return {
    positions,
    index: Uint32Array.from({ length: count }, (_, i) => i),
    count,
  };
}

const range = (expressId: number, indexCount: number, indexStart = 0) => ({
  expressId,
  indexStart,
  indexCount,
  vertexStart: 0,
  vertexCount: 0,
});

describe('extractEdges', () => {
  it('finds the twelve edges of a box and not the face diagonals', async () => {
    const box = soup(new THREE.BoxGeometry(2, 3, 4));
    const set = (await extractEdges(box.positions, box.index, [range(7, box.count)]))!;
    expect(set.positions.length / 6).toBe(12);
    expect(set.ranges).toEqual([{ expressId: 7, start: 0, count: 24 }]);
  });

  it('keeps the outline of a flat sheet only', async () => {
    const sheet = soup(new THREE.PlaneGeometry(5, 5));
    const set = (await extractEdges(sheet.positions, sheet.index, [range(1, sheet.count)]))!;
    expect(set.positions.length / 6).toBe(4);
  });

  it('keeps elements apart and skips gentle bends', async () => {
    const box = soup(new THREE.BoxGeometry(1, 1, 1));
    const cylinder = soup(new THREE.CylinderGeometry(1, 1, 2, 64, 1, true));
    const positions = new Float32Array([...box.positions, ...cylinder.positions]);
    const index = Uint32Array.from({ length: box.count + cylinder.count }, (_, i) => i);
    const set = (await extractEdges(positions, index, [
      range(1, box.count),
      range(2, cylinder.count, box.count),
    ]))!;
    expect(set.ranges.map((r) => r.expressId)).toEqual([1, 2]);
    // An open cylinder: two rim circles of 64 segments; facets 5.6° apart are not creases.
    expect(set.ranges[1]!.count / 2).toBe(128);
  });

  it('can be stopped', async () => {
    const box = soup(new THREE.BoxGeometry(1, 1, 1));
    const ranges = Array.from({ length: 600 }, () => range(1, box.count));
    expect(await extractEdges(box.positions, box.index, ranges, 30, () => true)).toBeNull();
  });
});
