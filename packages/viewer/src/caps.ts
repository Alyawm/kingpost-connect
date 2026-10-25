import * as THREE from 'three';

/**
 * Filled section cuts. For each section plane, the model is drawn twice into the stencil
 * buffer only (back faces count up, front faces count down) with every plane clipping;
 * where the count is not zero the plane cuts through the inside of a solid, and a cap face
 * is drawn there, clipped by the other planes. Works for any number of planes, so a
 * section box gets caps on all six faces. Assumes closed (watertight) element meshes,
 * which IFC solids are.
 */
export class SectionCaps {
  enabled = true;
  private readonly back: THREE.MeshBasicMaterial;
  private readonly front: THREE.MeshBasicMaterial;
  private readonly capScene = new THREE.Scene();
  private readonly cap: THREE.Mesh;
  private readonly capMaterial: THREE.MeshBasicMaterial;

  constructor(color: THREE.ColorRepresentation = 0x9aa3ad) {
    const stencil = (side: THREE.Side, op: THREE.StencilOp) =>
      new THREE.MeshBasicMaterial({
        side,
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        stencilWrite: true,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilFail: op,
        stencilZFail: op,
        stencilZPass: op,
      });
    this.back = stencil(THREE.BackSide, THREE.IncrementWrapStencilOp);
    this.front = stencil(THREE.FrontSide, THREE.DecrementWrapStencilOp);
    this.capMaterial = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });
    this.cap = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.capMaterial);
    this.cap.renderOrder = 1;
    this.capScene.add(this.cap);
  }

  setColor(color: THREE.ColorRepresentation): void {
    this.capMaterial.color.set(color);
  }

  /**
   * Draws the caps after the main pass. `content` holds the model; everything else in the
   * scene is hidden during the stencil passes so lines, labels and helpers do not count.
   */
  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    content: THREE.Object3D,
    camera: THREE.Camera,
    planes: THREE.Plane[],
    bounds: THREE.Box3,
  ): void {
    if (!this.enabled || planes.length === 0 || bounds.isEmpty()) return;
    const hidden: THREE.Object3D[] = [];
    for (const child of scene.children) {
      if (child !== content && child.visible) {
        child.visible = false;
        hidden.push(child);
      }
    }
    content.traverse((o) => {
      const drawable = o as THREE.Mesh & THREE.Line & THREE.Points & THREE.Sprite;
      if (o.visible && (drawable.isLine || drawable.isPoints || drawable.isSprite)) {
        o.visible = false;
        hidden.push(o);
      }
    });

    const size = bounds.getSize(new THREE.Vector3()).length() * 2 + 1;
    const centre = bounds.getCenter(new THREE.Vector3());
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    const background = scene.background;
    scene.background = null;

    planes.forEach((plane, index) => {
      renderer.clearStencil();
      renderer.clippingPlanes = planes;
      scene.overrideMaterial = this.back;
      renderer.render(scene, camera);
      scene.overrideMaterial = this.front;
      renderer.render(scene, camera);
      scene.overrideMaterial = null;

      // The cap: a large square on this plane, centred where the model centre projects.
      const normal = plane.normal;
      const point = centre.clone().addScaledVector(normal, -plane.distanceToPoint(centre));
      this.cap.position.copy(point);
      this.cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      this.cap.scale.set(size, size, 1);
      const others = planes.filter((_, i) => i !== index);
      this.capMaterial.clippingPlanes = others;
      renderer.clippingPlanes = [];
      renderer.render(this.capScene, camera);
    });

    renderer.clippingPlanes = planes;
    renderer.autoClear = autoClear;
    scene.background = background;
    for (const o of hidden) o.visible = true;
  }

  dispose(): void {
    this.back.dispose();
    this.front.dispose();
    this.capMaterial.dispose();
    this.cap.geometry.dispose();
  }
}
