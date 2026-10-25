import type { ElementRange } from './model';

/** Line segments of one bucket, with each element's slice of them. */
export interface EdgeSet {
  /** Two points (six numbers) per segment, in the bucket mesh's local space. */
  positions: Float32Array;
  /** Per element: first vertex and vertex count in `positions`. */
  ranges: { expressId: number; start: number; count: number }[];
}

/**
 * The visible edges of each element: boundary edges and creases sharper than
 * `thresholdDegrees`, the lines a viewer draws to make shapes readable. Triangles of one
 * element are welded by position first, so seams in the mesh do not show as lines.
 *
 * Yields to the event loop every few hundred elements so the interface stays responsive
 * on large models.
 */
export async function extractEdges(
  positions: ArrayLike<number>,
  index: ArrayLike<number>,
  ranges: ElementRange[],
  thresholdDegrees = 30,
  shouldStop: () => boolean = () => false,
): Promise<EdgeSet | null> {
  const cosLimit = Math.cos((thresholdDegrees * Math.PI) / 180);
  let out = new Float32Array(1 << 16);
  let used = 0;
  const push = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    if (used + 6 > out.length) {
      const grown = new Float32Array(out.length * 2);
      grown.set(out);
      out = grown;
    }
    out[used++] = ax;
    out[used++] = ay;
    out[used++] = az;
    out[used++] = bx;
    out[used++] = by;
    out[used++] = bz;
  };
  const result: EdgeSet['ranges'] = [];

  for (let r = 0; r < ranges.length; r++) {
    if (r % 250 === 249) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (shouldStop()) return null;
    }
    const range = ranges[r]!;
    const startVertex = used / 3;
    // Weld vertices of this element by quantised position (0.1 mm).
    const weld = new Map<string, number>();
    const canonical = (v: number): number => {
      const key = `${Math.round(positions[v * 3]! * 1e4)},${Math.round(positions[v * 3 + 1]! * 1e4)},${Math.round(positions[v * 3 + 2]! * 1e4)}`;
      let id = weld.get(key);
      if (id === undefined) {
        id = v;
        weld.set(key, id);
      }
      return id;
    };
    // Edge key → first face normal and whether it has been matched.
    const edges = new Map<
      string,
      { nx: number; ny: number; nz: number; a: number; b: number; sharp: boolean; shared: boolean }
    >();
    const end = range.indexStart + range.indexCount;
    for (let i = range.indexStart; i + 2 < end; i += 3) {
      const v0 = index[i]!;
      const v1 = index[i + 1]!;
      const v2 = index[i + 2]!;
      const ax = positions[v0 * 3]!,
        ay = positions[v0 * 3 + 1]!,
        az = positions[v0 * 3 + 2]!;
      const bx = positions[v1 * 3]!,
        by = positions[v1 * 3 + 1]!,
        bz = positions[v1 * 3 + 2]!;
      const cx = positions[v2 * 3]!,
        cy = positions[v2 * 3 + 1]!,
        cz = positions[v2 * 3 + 2]!;
      let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const length = Math.hypot(nx, ny, nz);
      if (length < 1e-12) continue; // degenerate triangle
      nx /= length;
      ny /= length;
      nz /= length;
      const ids = [canonical(v0), canonical(v1), canonical(v2)];
      for (let e = 0; e < 3; e++) {
        const p = ids[e]!;
        const q = ids[(e + 1) % 3]!;
        if (p === q) continue;
        const key = p < q ? `${p}_${q}` : `${q}_${p}`;
        const seen = edges.get(key);
        if (!seen) {
          edges.set(key, { nx, ny, nz, a: p, b: q, sharp: false, shared: false });
        } else {
          seen.shared = true;
          if (seen.nx * nx + seen.ny * ny + seen.nz * nz < cosLimit) seen.sharp = true;
        }
      }
    }
    for (const edge of edges.values()) {
      if (edge.shared && !edge.sharp) continue;
      push(
        positions[edge.a * 3]!,
        positions[edge.a * 3 + 1]!,
        positions[edge.a * 3 + 2]!,
        positions[edge.b * 3]!,
        positions[edge.b * 3 + 1]!,
        positions[edge.b * 3 + 2]!,
      );
    }
    const count = used / 3 - startVertex;
    if (count > 0) result.push({ expressId: range.expressId, start: startVertex, count });
  }
  return { positions: out.slice(0, used), ranges: result };
}
