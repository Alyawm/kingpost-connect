import * as THREE from 'three';

export type Triple = [number, number, number];

/**
 * Maps between viewer space and IFC world space.
 *
 * web-ifc delivers geometry as `N · C · p_ifc`, where `C` is the coordination matrix it
 * reports (a translation that brings the model to the origin, in IFC coordinates) and `N`
 * turns IFC's Z-up frame into three.js's Y-up frame: (x, y, z) → (x, z, −y). BCF files,
 * and anything else shared with other tools, use IFC world coordinates, so viewpoints and
 * markup lines pass through this frame on the way in and out.
 */
export class IfcFrame {
  private readonly toViewer: THREE.Matrix4;
  private readonly toIfc: THREE.Matrix4;

  constructor(coordination: ArrayLike<number> | null) {
    const normalize = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
    const coordinate = new THREE.Matrix4();
    if (coordination && coordination.length === 16) coordinate.fromArray(coordination);
    this.toViewer = normalize.multiply(coordinate);
    this.toIfc = this.toViewer.clone().invert();
  }

  /**
   * The rigid transform that moves geometry loaded in `from`'s viewer space into
   * `to`'s, so models exported separately line up in IFC world coordinates.
   */
  static between(from: IfcFrame, to: IfcFrame): THREE.Matrix4 {
    return to.toViewer.clone().multiply(from.toIfc);
  }

  /** Viewer → IFC world transform (a copy). */
  matrixToIfc(): THREE.Matrix4 {
    return this.toIfc.clone();
  }

  /** IFC world → viewer transform (a copy). */
  matrixToViewer(): THREE.Matrix4 {
    return this.toViewer.clone();
  }

  static identity(): IfcFrame {
    return new IfcFrame(null);
  }

  pointToIfc(point: THREE.Vector3): Triple {
    return point.clone().applyMatrix4(this.toIfc).toArray() as Triple;
  }

  pointFromIfc(point: Triple): THREE.Vector3 {
    return new THREE.Vector3().fromArray(point).applyMatrix4(this.toViewer);
  }

  directionToIfc(direction: THREE.Vector3): Triple {
    return direction.clone().transformDirection(this.toIfc).toArray() as Triple;
  }

  directionFromIfc(direction: Triple): THREE.Vector3 {
    return new THREE.Vector3().fromArray(direction).transformDirection(this.toViewer);
  }
}
