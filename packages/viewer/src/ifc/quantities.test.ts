import * as THREE from 'three';
import { IfcModel, solidVertexColors, type MeshBucket } from './model';

/** One bucket holding a single element: a closed box 2 × 3 × 4 at (10, 20, 30). */
function boxModel(): IfcModel {
  const geometry = new THREE.BoxGeometry(2, 3, 4).toNonIndexed();
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', positions);
  indexed.setAttribute('color', solidVertexColors(positions.count, new THREE.Color('#888888')));
  indexed.setIndex(Array.from({ length: positions.count }, (_, i) => i));
  const mesh = new THREE.Mesh(indexed, new THREE.MeshBasicMaterial({ vertexColors: true }));
  mesh.position.set(10, 20, 30);
  const group = new THREE.Group();
  group.add(mesh);
  const bucket: MeshBucket = {
    mesh,
    baseColor: new THREE.Color('#888888'),
    ranges: [
      {
        expressId: 7,
        indexStart: 0,
        indexCount: positions.count,
        vertexStart: 0,
        vertexCount: positions.count,
      },
    ],
  };
  return new IfcModel(group, [bucket]);
}

describe('IfcModel.quantitiesOf', () => {
  it('measures volume, surface area, bounds and length of a closed box in world space', () => {
    const q = boxModel().quantitiesOf(7)!;
    expect(q.volume).toBeCloseTo(24, 6);
    expect(q.surfaceArea).toBeCloseTo(2 * (2 * 3 + 3 * 4 + 2 * 4), 6);
    expect(q.length).toBeCloseTo(4, 6);
    expect(q.bboxMin.map((v) => +v.toFixed(6))).toEqual([9, 18.5, 28]);
    expect(q.bboxMax.map((v) => +v.toFixed(6))).toEqual([11, 21.5, 32]);
  });

  it('returns null for an element without triangles', () => {
    expect(boxModel().quantitiesOf(99)).toBeNull();
  });
});
