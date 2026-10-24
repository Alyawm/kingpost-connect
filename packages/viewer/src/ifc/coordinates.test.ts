import * as THREE from 'three';
import { IfcFrame } from './coordinates';

const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - (b[i] ?? NaN)) < 1e-9);

describe('IfcFrame', () => {
  it('turns Z-up IFC points into Y-up viewer points and back', () => {
    const frame = IfcFrame.identity();
    const viewer = frame.pointFromIfc([1, 2, 3]);
    expect(close(viewer.toArray(), [1, 3, -2])).toBe(true);
    expect(close(frame.pointToIfc(viewer), [1, 2, 3])).toBe(true);
  });

  it('applies the coordination translation before the axis swap', () => {
    // web-ifc moved the model by (-100, -200, -5) in IFC space.
    const coordination = new THREE.Matrix4().makeTranslation(-100, -200, -5).toArray();
    const frame = new IfcFrame(coordination);
    const viewer = frame.pointFromIfc([100, 200, 5]);
    expect(close(viewer.toArray(), [0, 0, 0])).toBe(true);
    expect(close(frame.pointToIfc(new THREE.Vector3(0, 10, 0)), [100, 200, 15])).toBe(true);
  });

  it('maps directions without translation and keeps them unit length', () => {
    const coordination = new THREE.Matrix4().makeTranslation(-100, -200, -5).toArray();
    const frame = new IfcFrame(coordination);
    const up = frame.directionToIfc(new THREE.Vector3(0, 1, 0));
    expect(close(up, [0, 0, 1])).toBe(true);
    const back = frame.directionFromIfc([0, 0, 1]);
    expect(close(back.toArray(), [0, 1, 0])).toBe(true);
    expect(frame.directionFromIfc([3, 0, 0]).length()).toBeCloseTo(1);
  });
});
