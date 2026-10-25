import * as THREE from 'three';

/** World (y up) → CSS (y down) flip, applied on both sides of the camera rotation. */
const FLIP = new THREE.Matrix4().makeScale(1, -1, 1);

/** The CSS transform that turns a world-aligned cube the way the camera sees the world. */
export function cubeTransform(camera: THREE.Camera): string {
  camera.updateMatrixWorld();
  const rotation = new THREE.Matrix4().extractRotation(camera.matrixWorldInverse);
  const m = new THREE.Matrix4().multiplyMatrices(FLIP, rotation).multiply(FLIP);
  return `matrix3d(${m.elements.map((v) => (Math.abs(v) < 1e-10 ? 0 : v)).join(',')})`;
}
