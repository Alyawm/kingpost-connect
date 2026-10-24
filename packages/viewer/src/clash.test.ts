import { findClashes, type ClashSource } from './clash';

/** Twelve triangles of an axis-aligned box. */
function box(min: [number, number, number], max: [number, number, number]): Float32Array {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const v = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const faces = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [1, 2, 6, 5],
    [0, 3, 7, 4],
  ];
  const out: number[] = [];
  for (const [a, b, c, d] of faces) {
    out.push(...v[a!]!, ...v[b!]!, ...v[c!]!, ...v[a!]!, ...v[c!]!, ...v[d!]!);
  }
  return new Float32Array(out);
}

function source(shapes: Record<number, Float32Array>): ClashSource {
  return { trianglesOf: (id) => shapes[id] ?? new Float32Array() };
}

describe('findClashes', () => {
  const shapes = {
    1: box([0, 0, 0], [1, 1, 1]),
    2: box([0.5, 0.5, 0.5], [1.5, 1.5, 1.5]), // overlaps 1
    3: box([1.3, 0, 0], [2.3, 1, 1]), // 0.3 from 1, touches nothing
    4: box([5, 5, 5], [6, 6, 6]), // far away
    5: box([1, 0, 0], [2, 1, 1]), // shares a face with 1
  };

  it('finds hard clashes between overlapping elements only', async () => {
    const hits = await findClashes(source(shapes), [1], [2, 3, 4], { clearance: 0 });
    expect(hits.map((h) => [h.a, h.b, h.kind])).toEqual([[1, 2, 'hard']]);
    expect(hits[0]!.distance).toBe(0);
    const [x, y, z] = hits[0]!.point;
    expect(x).toBeGreaterThanOrEqual(0.5);
    expect(x).toBeLessThanOrEqual(1);
    expect(y).toBeGreaterThanOrEqual(0.5);
    expect(z).toBeGreaterThanOrEqual(0.5);
  });

  it('reports clearance clashes with the gap', async () => {
    const hits = await findClashes(source(shapes), [1], [3, 4], { clearance: 0.5 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe('clearance');
    expect(hits[0]!.distance).toBeCloseTo(0.3, 6);
    const none = await findClashes(source(shapes), [1], [3], { clearance: 0.2 });
    expect(none).toHaveLength(0);
  });

  it('treats touching faces as a hard clash and tests each unordered pair once', async () => {
    const hits = await findClashes(source(shapes), [1, 5], [1, 5], { clearance: 0 });
    expect(hits.map((h) => [h.a, h.b])).toEqual([[1, 5]]);
  });

  it('reports progress and respects an abort', async () => {
    const progress: number[] = [];
    await findClashes(
      source(shapes),
      [1, 2, 3, 4, 5],
      [1, 2, 3, 4, 5],
      { clearance: 1, batch: 2 },
      (p) => progress.push(p.done),
    );
    expect(progress.length).toBeGreaterThan(0);
    const controller = new AbortController();
    controller.abort();
    const hits = await findClashes(source(shapes), [1], [2], {
      clearance: 0,
      signal: controller.signal,
    });
    expect(hits).toHaveLength(0);
  });
});
