import * as THREE from 'three';

/** What a measurement point snapped to. */
export type SnapKind = 'vertex' | 'midpoint' | 'edge' | 'face';

/** Which snaps are allowed. */
export interface SnapOptions {
  vertex: boolean;
  midpoint: boolean;
  edge: boolean;
  face: boolean;
}

export const DEFAULT_SNAP: SnapOptions = { vertex: true, midpoint: true, edge: true, face: true };

/** A snapped point; `edge` is the segment it lies on, for edge and midpoint snaps. */
export interface SnapResult {
  point: THREE.Vector3;
  kind: SnapKind;
  edge?: [THREE.Vector3, THREE.Vector3];
}

/** Screen distance (pixels) within which corners and midpoints catch the pointer. */
export const SNAP_RADIUS = 12;

/**
 * Finds the best snap among an element's edge segments for a pointer at `pointer` (pixels):
 * a corner, else a midpoint, else the nearest point on an edge, each only within the snap
 * radius on screen. `project` maps world points to pixels. Null when nothing is close.
 */
export function snapToSegments(
  pointer: { x: number; y: number },
  ray: THREE.Ray,
  segments: ArrayLike<number>,
  project: (point: THREE.Vector3) => { x: number; y: number } | null,
  options: SnapOptions = DEFAULT_SNAP,
  radius = SNAP_RADIUS,
): SnapResult | null {
  type Candidate = { d: number; point: THREE.Vector3; edge: [THREE.Vector3, THREE.Vector3] };
  let bestVertex: Candidate | null = null;
  let bestMid: Candidate | null = null;
  let bestEdge: Candidate | null = null;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const pixelDistance = (p: { x: number; y: number } | null) =>
    p ? Math.hypot(p.x - pointer.x, p.y - pointer.y) : Infinity;

  for (let i = 0; i + 5 < segments.length; i += 6) {
    a.set(segments[i]!, segments[i + 1]!, segments[i + 2]!);
    b.set(segments[i + 3]!, segments[i + 4]!, segments[i + 5]!);
    const pa = project(a);
    const pb = project(b);
    if (!pa || !pb) continue;
    if (options.vertex) {
      for (const [p, q] of [
        [a, pa],
        [b, pb],
      ] as const) {
        const d = pixelDistance(q);
        if (d <= radius && (!bestVertex || d < bestVertex.d)) {
          bestVertex = { d, point: p.clone(), edge: [a.clone(), b.clone()] };
        }
      }
    }
    if (options.midpoint) {
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const d = pixelDistance(project(mid));
      if (d <= radius && (!bestMid || d < bestMid.d)) {
        bestMid = { d, point: mid, edge: [a.clone(), b.clone()] };
      }
    }
    if (options.edge) {
      // Distance from the pointer to the segment on screen.
      const sx = pb.x - pa.x;
      const sy = pb.y - pa.y;
      const lengthSq = sx * sx + sy * sy;
      if (lengthSq < 1) continue;
      const t = Math.max(
        0,
        Math.min(1, ((pointer.x - pa.x) * sx + (pointer.y - pa.y) * sy) / lengthSq),
      );
      const d = Math.hypot(pa.x + sx * t - pointer.x, pa.y + sy * t - pointer.y);
      if (d <= radius * 0.75 && (!bestEdge || d < bestEdge.d)) {
        bestEdge = { d, point: closestOnSegmentToRay(ray, a, b), edge: [a.clone(), b.clone()] };
      }
    }
  }
  if (bestVertex) return { point: bestVertex.point, kind: 'vertex', edge: bestVertex.edge };
  if (bestMid) return { point: bestMid.point, kind: 'midpoint', edge: bestMid.edge };
  if (bestEdge) return { point: bestEdge.point, kind: 'edge', edge: bestEdge.edge };
  return null;
}

/** The point of segment ab closest to a ray (the 3D point under the pointer on that edge). */
export function closestOnSegmentToRay(
  ray: THREE.Ray,
  a: THREE.Vector3,
  b: THREE.Vector3,
): THREE.Vector3 {
  const onSegment = new THREE.Vector3();
  ray.distanceSqToSegment(a, b, undefined, onSegment);
  return onSegment;
}

/**
 * Ortho constraint: keeps only the largest component of the step from `from` to `to`, so
 * a measurement runs along X, Y or Z.
 */
export function orthoPoint(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
  const d = to.clone().sub(from);
  const ax = Math.abs(d.x);
  const ay = Math.abs(d.y);
  const az = Math.abs(d.z);
  if (ax >= ay && ax >= az) return new THREE.Vector3(to.x, from.y, from.z);
  if (ay >= az) return new THREE.Vector3(from.x, to.y, from.z);
  return new THREE.Vector3(from.x, from.y, to.z);
}

/** Angle at `vertex` between the arms to `a` and `b`, in degrees. */
export function angleAt(a: THREE.Vector3, vertex: THREE.Vector3, b: THREE.Vector3): number {
  const u = a.clone().sub(vertex);
  const v = b.clone().sub(vertex);
  if (u.lengthSq() < 1e-12 || v.lengthSq() < 1e-12) return 0;
  return THREE.MathUtils.radToDeg(u.angleTo(v));
}

/** Perpendicular distance from `point` to the plane through `origin` with `normal`. */
export function distanceToPlane(
  point: THREE.Vector3,
  origin: THREE.Vector3,
  normal: THREE.Vector3,
): { distance: number; foot: THREE.Vector3 } {
  const n = normal.clone().normalize();
  const signed = point.clone().sub(origin).dot(n);
  return { distance: Math.abs(signed), foot: point.clone().addScaledVector(n, -signed) };
}
