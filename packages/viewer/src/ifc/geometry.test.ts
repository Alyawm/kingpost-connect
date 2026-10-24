import { colorKey, toBufferGeometry } from './geometry';

describe('toBufferGeometry', () => {
  it('splits interleaved position/normal data into two attributes and copies indices', () => {
    const vertices = new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1]);
    const indices = new Uint32Array([0, 1, 2]);

    const geometry = toBufferGeometry(vertices, indices);

    expect(geometry.getAttribute('position').count).toBe(3);
    expect(geometry.getAttribute('normal').count).toBe(3);
    expect(Array.from(geometry.getAttribute('position').array)).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]);
    expect(Array.from(geometry.getAttribute('normal').array)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(geometry.getIndex()?.array).not.toBe(indices);
    expect(Array.from(geometry.getIndex()?.array ?? [])).toEqual([0, 1, 2]);
  });
});

describe('colorKey', () => {
  it('is stable for equal colours and distinct for different ones', () => {
    expect(colorKey({ x: 0.5, y: 0.5, z: 0.5, w: 1 })).toBe(
      colorKey({ x: 0.5, y: 0.5, z: 0.5, w: 1 }),
    );
    expect(colorKey({ x: 0.5, y: 0.5, z: 0.5, w: 1 })).not.toBe(
      colorKey({ x: 0.5, y: 0.5, z: 0.5, w: 0.5 }),
    );
  });
});
