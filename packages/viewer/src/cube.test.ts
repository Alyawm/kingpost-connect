import * as THREE from 'three';
import { cubeTransform } from './cube';

/** Where a CSS-space normal ends up after the cube transform. */
function turn(css: string, normal: [number, number, number]): number[] {
  const values = css.slice('matrix3d('.length, -1).split(',').map(Number);
  const m = new THREE.Matrix4().fromArray(values);
  return new THREE.Vector3(...normal)
    .transformDirection(m)
    .toArray()
    .map((v) => Math.round(v * 1000) / 1000 + 0);
}

function cameraAt(position: [number, number, number]): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(...position);
  camera.lookAt(0, 0, 0);
  return camera;
}

describe('cubeTransform', () => {
  it('shows the front face when looking from the front', () => {
    const css = cubeTransform(cameraAt([0, 0, 10]));
    expect(turn(css, [0, 0, 1])).toEqual([0, 0, 1]); // front face points at the viewer
  });

  it('shows the top face when looking down', () => {
    const camera = cameraAt([0, 10, 0.001]);
    // Top face normal in CSS space is -y (up on screen).
    expect(turn(cubeTransform(camera), [0, -1, 0])).toEqual([0, 0, 1]);
  });

  it('shows the right face when looking from +x', () => {
    expect(turn(cubeTransform(cameraAt([10, 0, 0])), [1, 0, 0])).toEqual([0, 0, 1]);
  });
});
