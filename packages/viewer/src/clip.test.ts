import * as THREE from 'three';
import {
  closestOnLine,
  extentAlong,
  planeOffset,
  snapToAxis,
  toThreePlane,
  withOffset,
  type ClipPlaneSpec,
} from './clip';
import { IfcModel, solidVertexColors, type MeshBucket } from './ifc/model';

const plane = (
  point: [number, number, number],
  normal: [number, number, number],
): ClipPlaneSpec => ({
  id: 'p',
  point,
  normal,
  enabled: true,
});

describe('section plane maths', () => {
  it('keeps the side opposite the normal (BCF convention)', () => {
    const three = toThreePlane(plane([0, 2, 0], [0, 1, 0]));
    expect(three.distanceToPoint(new THREE.Vector3(0, 1, 0))).toBeGreaterThan(0); // kept
    expect(three.distanceToPoint(new THREE.Vector3(0, 3, 0))).toBeLessThan(0); // removed
  });

  it('snaps nearly axis-aligned normals and leaves others alone', () => {
    const near = snapToAxis(new THREE.Vector3(0.02, -1, 0.01));
    expect(near.toArray()).toEqual([0, -1, 0]);
    const diagonal = snapToAxis(new THREE.Vector3(1, 1, 0));
    expect(diagonal.x).toBeCloseTo(Math.SQRT1_2);
  });

  it('moves a plane along its normal and reports the model extent on that line', () => {
    const p = plane([1, 5, 1], [0, 0, 1]);
    expect(planeOffset(p)).toBe(1);
    expect(withOffset(p, 4).point).toEqual([1, 5, 4]);
    const box = new THREE.Box3(new THREE.Vector3(0, 0, -2), new THREE.Vector3(3, 3, 6));
    expect(extentAlong(box, [0, 0, 1])).toEqual({ min: -2, max: 6 });
  });

  it('finds where a ray passes closest to a line', () => {
    // Line along x through the origin; ray straight down at x = 3.
    const ray = new THREE.Ray(new THREE.Vector3(3, 10, 0), new THREE.Vector3(0, -1, 0));
    expect(closestOnLine(ray, new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0))).toBeCloseTo(
      3,
    );
  });
});

/** Two unit cubes as elements 1 (around x = 0) and 2 (around x = 10). */
function twoCubes(): IfcModel {
  const geometries = [0, 10].map((x) => {
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    g.translate(x, 0, 0);
    return g;
  });
  const positions = new Float32Array([
    ...(geometries[0]!.getAttribute('position').array as Float32Array),
    ...(geometries[1]!.getAttribute('position').array as Float32Array),
  ]);
  const count = positions.length / 3;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', solidVertexColors(count, new THREE.Color('#888888')));
  geometry.setIndex(Array.from({ length: count }, (_, i) => i));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
  const group = new THREE.Group();
  group.add(mesh);
  const half = count / 2;
  const bucket: MeshBucket = {
    mesh,
    baseColor: new THREE.Color('#888888'),
    ranges: [
      { expressId: 1, indexStart: 0, indexCount: half, vertexStart: 0, vertexCount: half },
      { expressId: 2, indexStart: half, indexCount: half, vertexStart: half, vertexCount: half },
    ],
  };
  return new IfcModel(group, [bucket]);
}

describe('IfcModel.idsInScreenRect', () => {
  // Orthographic camera looking down -z, showing x from -2 to 12.
  const camera = new THREE.OrthographicCamera(-2, 12, 5, -5, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.updateProjectionMatrix();
  const ndcX = (x: number) => ((x + 2) / 14) * 2 - 1;

  it('takes whole boxes for a window and touching boxes for a crossing', () => {
    const model = twoCubes();
    const rect = { x0: ndcX(-1), y0: -0.5, x1: ndcX(10), y1: 0.5 };
    expect(model.idsInScreenRect(camera, rect, false)).toEqual([1]);
    expect(model.idsInScreenRect(camera, rect, true).sort()).toEqual([1, 2]);
  });

  it('skips hidden elements and those cut away by a section plane', () => {
    const model = twoCubes();
    const all = { x0: -1, y0: -1, x1: 1, y1: 1 };
    model.setHidden([1]);
    expect(model.idsInScreenRect(camera, all, true)).toEqual([2]);
    model.setHidden([]);
    // Remove everything beyond x = 5.
    const cut = toThreePlane(plane([5, 0, 0], [1, 0, 0]));
    expect(model.idsInScreenRect(camera, all, true, [cut])).toEqual([1]);
  });
});
