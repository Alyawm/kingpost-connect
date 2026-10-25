import * as THREE from 'three';
import { angleAt, distanceToPlane, orthoPoint, snapToSegments, DEFAULT_SNAP } from './snap';

// Screen = world x, y in pixels (a plan view at 1 px per unit); the ray looks down -z.
const project = (p: THREE.Vector3) => ({ x: p.x, y: p.y });
const rayAt = (x: number, y: number) =>
  new THREE.Ray(new THREE.Vector3(x, y, 100), new THREE.Vector3(0, 0, -1));
// One segment from (0,0) to (100,0).
const segment = [0, 0, 0, 100, 0, 0];

describe('snapToSegments', () => {
  it('prefers a corner within the radius', () => {
    const s = snapToSegments({ x: 5, y: 4 }, rayAt(5, 4), segment, project)!;
    expect(s.kind).toBe('vertex');
    expect(s.point.toArray()).toEqual([0, 0, 0]);
  });

  it('takes the midpoint near the middle', () => {
    const s = snapToSegments({ x: 52, y: 3 }, rayAt(52, 3), segment, project)!;
    expect(s.kind).toBe('midpoint');
    expect(s.point.x).toBe(50);
  });

  it('falls back to the nearest point on the edge', () => {
    const s = snapToSegments({ x: 30, y: 5 }, rayAt(30, 5), segment, project)!;
    expect(s.kind).toBe('edge');
    expect(s.point.x).toBeCloseTo(30);
    expect(s.point.y).toBeCloseTo(0);
  });

  it('returns nothing when the pointer is far, and respects switched-off snaps', () => {
    expect(snapToSegments({ x: 30, y: 40 }, rayAt(30, 40), segment, project)).toBeNull();
    const noCorners = snapToSegments({ x: 3, y: 2 }, rayAt(3, 2), segment, project, {
      ...DEFAULT_SNAP,
      vertex: false,
    })!;
    expect(noCorners.kind).toBe('edge');
  });
});

describe('measurement maths', () => {
  it('keeps only the largest step in ortho mode', () => {
    const from = new THREE.Vector3(1, 1, 1);
    expect(orthoPoint(from, new THREE.Vector3(5, 2, 1.5)).toArray()).toEqual([5, 1, 1]);
    expect(orthoPoint(from, new THREE.Vector3(1.2, 9, 0)).toArray()).toEqual([1, 9, 1]);
    expect(orthoPoint(from, new THREE.Vector3(0, 0, -7)).toArray()).toEqual([1, 1, -7]);
  });

  it('measures angles at a vertex', () => {
    const o = new THREE.Vector3();
    expect(angleAt(new THREE.Vector3(1, 0, 0), o, new THREE.Vector3(0, 1, 0))).toBeCloseTo(90);
    expect(angleAt(new THREE.Vector3(1, 0, 0), o, new THREE.Vector3(1, 1, 0))).toBeCloseTo(45);
    expect(angleAt(o, o, new THREE.Vector3(1, 0, 0))).toBe(0);
  });

  it('drops a perpendicular onto a plane', () => {
    const { distance, foot } = distanceToPlane(
      new THREE.Vector3(2, 5, 3),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 2, 0),
    );
    expect(distance).toBe(4);
    expect(foot.toArray()).toEqual([2, 1, 3]);
  });
});
