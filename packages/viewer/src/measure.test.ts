import * as THREE from 'three';
import { formatDistance, measure } from './measure';

describe('measure', () => {
  it('reports distance and per-axis deltas', () => {
    const m = measure(new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 4, 0));
    expect(m.distance).toBeCloseTo(5);
    expect(m.delta.toArray()).toEqual([3, 4, 0]);
  });

  it('does not alias the input points', () => {
    const a = new THREE.Vector3(1, 1, 1);
    const m = measure(a, new THREE.Vector3(2, 2, 2));
    a.set(9, 9, 9);
    expect(m.a.toArray()).toEqual([1, 1, 1]);
  });
});

describe('formatDistance', () => {
  it('uses millimetres under a metre and metres above', () => {
    expect(formatDistance(0.3504)).toBe('350 mm');
    expect(formatDistance(5.2345)).toBe('5.234 m');
    expect(formatDistance(125.456)).toBe('125.46 m');
  });
});
