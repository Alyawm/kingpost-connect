import * as THREE from 'three';

/**
 * Clash detection on the loaded meshes.
 *
 * Elements are triangle soups in world space. Each element gets a small bounding-volume
 * tree over its triangles; a pair is tested only when the elements' boxes (inflated by the
 * clearance) overlap, and then tree against tree down to triangle pairs. A hard clash is
 * two intersecting triangles; a clearance clash is two triangles closer than the
 * clearance. Work is chunked so the interface stays responsive on large sets.
 */

export interface ClashSource {
  /** World-space triangles of an element, nine numbers per triangle. */
  trianglesOf(expressId: number): Float32Array;
}

export interface ClashOptions {
  /** Minimum gap in metres; 0 finds hard clashes only. */
  clearance: number;
  /** Pairs tested between yields to the event loop. */
  batch?: number;
  signal?: AbortSignal;
}

export interface ClashHit {
  a: number;
  b: number;
  kind: 'hard' | 'clearance';
  /** 0 for a hard clash, else the smallest gap found (metres). */
  distance: number;
  /** A point on or between the clashing surfaces, world space. */
  point: [number, number, number];
}

export interface ClashProgress {
  done: number;
  total: number;
  found: number;
}

interface Node {
  box: THREE.Box3;
  tris: number[] | null;
  left: Node | null;
  right: Node | null;
}

interface Shape {
  id: number;
  tris: Float32Array;
  box: THREE.Box3;
  root: Node | null;
}

const LEAF = 8;

function buildShape(id: number, tris: Float32Array): Shape {
  const count = tris.length / 9;
  const box = new THREE.Box3();
  const centroids = new Float32Array(count * 3);
  for (let t = 0; t < count; t++) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      cx += tris[o]!;
      cy += tris[o + 1]!;
      cz += tris[o + 2]!;
      box.expandByPoint(new THREE.Vector3(tris[o], tris[o + 1], tris[o + 2]));
    }
    centroids[t * 3] = cx / 3;
    centroids[t * 3 + 1] = cy / 3;
    centroids[t * 3 + 2] = cz / 3;
  }
  const all = Array.from({ length: count }, (_, i) => i);
  return { id, tris, box, root: count ? buildNode(tris, centroids, all) : null };
}

function triBox(tris: Float32Array, list: number[]): THREE.Box3 {
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (const t of list) {
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      box.expandByPoint(p.set(tris[o]!, tris[o + 1]!, tris[o + 2]!));
    }
  }
  return box;
}

function buildNode(tris: Float32Array, centroids: Float32Array, list: number[]): Node {
  const box = triBox(tris, list);
  if (list.length <= LEAF) return { box, tris: list, left: null, right: null };
  const size = new THREE.Vector3();
  box.getSize(size);
  const axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
  const sorted = [...list].sort((a, b) => centroids[a * 3 + axis]! - centroids[b * 3 + axis]!);
  const mid = sorted.length >> 1;
  return {
    box,
    tris: null,
    left: buildNode(tris, centroids, sorted.slice(0, mid)),
    right: buildNode(tris, centroids, sorted.slice(mid)),
  };
}

/** Finds clashes between every element of `setA` and every element of `setB`. */
export async function findClashes(
  source: ClashSource,
  setA: Iterable<number>,
  setB: Iterable<number>,
  options: ClashOptions,
  onProgress?: (progress: ClashProgress) => void,
): Promise<ClashHit[]> {
  const clearance = Math.max(0, options.clearance);
  const batch = options.batch ?? 200;
  const shapes = new Map<number, Shape>();
  const shapeOf = (id: number): Shape => {
    let s = shapes.get(id);
    if (!s) {
      s = buildShape(id, source.trianglesOf(id));
      shapes.set(id, s);
    }
    return s;
  };

  // Broad phase on element boxes only; trees are built when a pair survives it.
  const a = [...new Set(setA)];
  const b = [...new Set(setB)];
  const boxesB = b
    .map((id) => ({ id, box: shapeOf(id).box }))
    .filter((e) => !e.box.isEmpty())
    .sort((x, y) => x.box.min.x - y.box.min.x);
  const pairs: [number, number][] = [];
  const seen = new Set<string>();
  for (const idA of a) {
    const boxA = shapeOf(idA).box;
    if (boxA.isEmpty()) continue;
    const inflated = boxA.clone().expandByScalar(clearance);
    for (const { id: idB, box } of boxesB) {
      if (box.min.x > inflated.max.x) break;
      if (idB === idA || !inflated.intersectsBox(box)) continue;
      const key = idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([idA, idB]);
    }
  }

  const hits: ClashHit[] = [];
  for (let i = 0; i < pairs.length; i++) {
    if (options.signal?.aborted) break;
    const [idA, idB] = pairs[i]!;
    const hit = testPair(shapeOf(idA), shapeOf(idB), clearance);
    if (hit) hits.push(hit);
    if ((i + 1) % batch === 0 || i === pairs.length - 1) {
      onProgress?.({ done: i + 1, total: pairs.length, found: hits.length });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return hits;
}

function testPair(a: Shape, b: Shape, clearance: number): ClashHit | null {
  if (!a.root || !b.root) return null;
  const state = { best: Infinity, point: new THREE.Vector3(), hard: false };
  visit(a, a.root, b, b.root, clearance, state);
  if (state.hard) {
    return {
      a: a.id,
      b: b.id,
      kind: 'hard',
      distance: 0,
      point: state.point.toArray() as [number, number, number],
    };
  }
  if (state.best <= clearance) {
    return {
      a: a.id,
      b: b.id,
      kind: 'clearance',
      distance: state.best,
      point: state.point.toArray() as [number, number, number],
    };
  }
  return null;
}

function boxDistance(p: THREE.Box3, q: THREE.Box3): number {
  const dx = Math.max(p.min.x - q.max.x, q.min.x - p.max.x, 0);
  const dy = Math.max(p.min.y - q.max.y, q.min.y - p.max.y, 0);
  const dz = Math.max(p.min.z - q.max.z, q.min.z - p.max.z, 0);
  return Math.hypot(dx, dy, dz);
}

function visit(
  a: Shape,
  na: Node,
  b: Shape,
  nb: Node,
  clearance: number,
  state: { best: number; point: THREE.Vector3; hard: boolean },
): void {
  if (state.hard) return;
  const gap = boxDistance(na.box, nb.box);
  if (gap > clearance || gap >= state.best) return;
  if (na.tris && nb.tris) {
    for (const ta of na.tris) {
      for (const tb of nb.tris) {
        const result = triangleTriangle(a.tris, ta, b.tris, tb);
        if (result.distance < state.best) {
          state.best = result.distance;
          state.point.copy(result.point);
        }
        if (result.distance === 0) {
          state.hard = true;
          return;
        }
      }
    }
    return;
  }
  // Descend the larger node first; both orders are tried for the other.
  if (!na.tris && (nb.tris || volume(na.box) >= volume(nb.box))) {
    visit(a, na.left!, b, nb, clearance, state);
    visit(a, na.right!, b, nb, clearance, state);
  } else {
    visit(a, na, b, nb.left!, clearance, state);
    visit(a, na, b, nb.right!, clearance, state);
  }
}

function volume(box: THREE.Box3): number {
  const s = new THREE.Vector3();
  box.getSize(s);
  return s.x * s.y * s.z;
}

// ---- triangle primitives ----

const A0 = new THREE.Vector3();
const A1 = new THREE.Vector3();
const A2 = new THREE.Vector3();
const B0 = new THREE.Vector3();
const B1 = new THREE.Vector3();
const B2 = new THREE.Vector3();
const TA = new THREE.Triangle();
const TB = new THREE.Triangle();
const tmpPoint = new THREE.Vector3();

/**
 * Distance between two triangles with a point on or between them; 0 when they intersect
 * (an edge of one crosses the other's face, or they are coplanar and overlap).
 */
function triangleTriangle(
  ta: Float32Array,
  ia: number,
  tb: Float32Array,
  ib: number,
): { distance: number; point: THREE.Vector3 } {
  A0.fromArray(ta, ia * 9);
  A1.fromArray(ta, ia * 9 + 3);
  A2.fromArray(ta, ia * 9 + 6);
  B0.fromArray(tb, ib * 9);
  B1.fromArray(tb, ib * 9 + 3);
  B2.fromArray(tb, ib * 9 + 6);
  TA.set(A0, A1, A2);
  TB.set(B0, B1, B2);

  // Edges of one crossing the face of the other.
  for (const [p, q, tri] of [
    [A0, A1, TB],
    [A1, A2, TB],
    [A2, A0, TB],
    [B0, B1, TA],
    [B1, B2, TA],
    [B2, B0, TA],
  ] as const) {
    const hit = segmentTriangle(p, q, tri);
    if (hit) return { distance: 0, point: hit.clone() };
  }

  // Otherwise the closest features are a vertex and a face, or two edges.
  let best = Infinity;
  const bestPoint = new THREE.Vector3();
  for (const [v, tri] of [
    [A0, TB],
    [A1, TB],
    [A2, TB],
    [B0, TA],
    [B1, TA],
    [B2, TA],
  ] as const) {
    tri.closestPointToPoint(v, tmpPoint);
    const d = v.distanceTo(tmpPoint);
    if (d < best) {
      best = d;
      bestPoint.copy(v).add(tmpPoint).multiplyScalar(0.5);
    }
  }
  const edgesA = [
    [A0, A1],
    [A1, A2],
    [A2, A0],
  ] as const;
  const edgesB = [
    [B0, B1],
    [B1, B2],
    [B2, B0],
  ] as const;
  for (const [p0, p1] of edgesA) {
    for (const [q0, q1] of edgesB) {
      const r = segmentSegment(p0, p1, q0, q1);
      if (r.distance < best) {
        best = r.distance;
        bestPoint.copy(r.point);
      }
    }
  }
  return { distance: best, point: bestPoint };
}

const ray = new THREE.Ray();
const dir = new THREE.Vector3();

/** Where segment pq crosses triangle `tri`, or null. Coplanar overlap counts as a hit. */
function segmentTriangle(
  p: THREE.Vector3,
  q: THREE.Vector3,
  tri: THREE.Triangle,
): THREE.Vector3 | null {
  dir.subVectors(q, p);
  const length = dir.length();
  if (length < 1e-12) return null;
  dir.divideScalar(length);
  ray.set(p, dir);
  const hit = ray.intersectTriangle(tri.a, tri.b, tri.c, false, tmpPoint);
  if (hit && p.distanceTo(hit) <= length + 1e-9) return hit;
  // Coplanar: the ray misses a face it lies in; test the segment's midpoint instead.
  const normal = new THREE.Vector3();
  tri.getNormal(normal);
  const dp = Math.abs(normal.dot(new THREE.Vector3().subVectors(p, tri.a)));
  const dq = Math.abs(normal.dot(new THREE.Vector3().subVectors(q, tri.a)));
  if (dp < 1e-9 && dq < 1e-9) {
    const mid = new THREE.Vector3().addVectors(p, q).multiplyScalar(0.5);
    if (tri.containsPoint(mid)) return mid;
  }
  return null;
}

/** Closest approach of two segments (Ericson, Real-Time Collision Detection 5.1.9). */
function segmentSegment(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
): { distance: number; point: THREE.Vector3 } {
  const d1 = new THREE.Vector3().subVectors(q1, p1);
  const d2 = new THREE.Vector3().subVectors(q2, p2);
  const r = new THREE.Vector3().subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;
  const eps = 1e-12;
  if (a <= eps && e <= eps) {
    s = t = 0;
  } else if (a <= eps) {
    t = clamp(f / e);
  } else {
    const c = d1.dot(r);
    if (e <= eps) {
      s = clamp(-c / a);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a);
      }
    }
  }
  const c1 = new THREE.Vector3().copy(p1).addScaledVector(d1, s);
  const c2 = new THREE.Vector3().copy(p2).addScaledVector(d2, t);
  return { distance: c1.distanceTo(c2), point: c1.add(c2).multiplyScalar(0.5) };
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
