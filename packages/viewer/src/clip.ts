import * as THREE from 'three';

type Triple = [number, number, number];

/**
 * A section plane in viewer coordinates. `normal` points to the side that is cut away
 * (the BCF convention), so a plane placed on a face with the face's normal removes what
 * is in front of that face and nothing of the element itself.
 */
export interface ClipPlaneSpec {
  id: string;
  point: Triple;
  normal: Triple;
  enabled: boolean;
}

/** The three.js plane that keeps the side opposite the spec's normal. */
export function toThreePlane(spec: ClipPlaneSpec): THREE.Plane {
  const n = new THREE.Vector3(...spec.normal).normalize();
  const p = new THREE.Vector3(...spec.point);
  // Kept where -n·x + n·p >= 0, i.e. behind the plane.
  return new THREE.Plane(n.clone().negate(), n.dot(p));
}

/** Snaps a direction to the nearest axis when it is within `degrees` of it. */
export function snapToAxis(normal: THREE.Vector3, degrees = 3): THREE.Vector3 {
  const n = normal.clone().normalize();
  const limit = Math.cos(THREE.MathUtils.degToRad(degrees));
  for (const axis of [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ]) {
    const d = n.dot(axis);
    // Written out so the other components stay +0 rather than -0.
    if (Math.abs(d) >= limit) {
      const sign = Math.sign(d);
      return new THREE.Vector3(axis.x ? sign : 0, axis.y ? sign : 0, axis.z ? sign : 0);
    }
  }
  return n;
}

/** Signed position of a plane along its normal, and the model's extent on that line. */
export function planeOffset(spec: ClipPlaneSpec): number {
  return new THREE.Vector3(...spec.normal).normalize().dot(new THREE.Vector3(...spec.point));
}

export function extentAlong(box: THREE.Box3, normal: Triple): { min: number; max: number } {
  const n = new THREE.Vector3(...normal).normalize();
  let min = Infinity;
  let max = -Infinity;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const d = n.x * x + n.y * y + n.z * z;
        if (d < min) min = d;
        if (d > max) max = d;
      }
  return { min, max };
}

/** Moves a plane to an offset along its normal. */
export function withOffset(spec: ClipPlaneSpec, offset: number): ClipPlaneSpec {
  const n = new THREE.Vector3(...spec.normal).normalize();
  const p = new THREE.Vector3(...spec.point);
  p.addScaledVector(n, offset - n.dot(p));
  return { ...spec, point: p.toArray() as Triple };
}

const ACCENT = new THREE.Color(0x5b9dff);
const ACTIVE = new THREE.Color(0xffb020);

/**
 * Visible handles for section planes: a translucent square, its outline and an arrow along
 * the normal. They live in their own scene so the section planes never cut them.
 */
export class ClipGizmos {
  readonly scene = new THREE.Scene();
  private readonly items = new Map<string, THREE.Group>();

  /** Rebuilds the handles for the given planes, sized to the model's bounds. */
  update(planes: ClipPlaneSpec[], activeId: string | null, bounds: THREE.Box3, visible: boolean) {
    for (const group of this.items.values()) disposeGroup(group, this.scene);
    this.items.clear();
    if (!visible) return;
    for (const plane of planes) {
      const group = this.build(plane, plane.id === activeId, bounds);
      this.items.set(plane.id, group);
      this.scene.add(group);
    }
  }

  /** The plane under a ray, if any handle is hit. */
  hit(raycaster: THREE.Raycaster): string | null {
    const hits = raycaster.intersectObjects([...this.items.values()], true);
    for (const h of hits) {
      const id = h.object.userData.clipPlaneId as string | undefined;
      if (id) return id;
    }
    return null;
  }

  dispose(): void {
    for (const group of this.items.values()) disposeGroup(group, this.scene);
    this.items.clear();
  }

  private build(plane: ClipPlaneSpec, active: boolean, bounds: THREE.Box3): THREE.Group {
    const n = new THREE.Vector3(...plane.normal).normalize();
    const p = new THREE.Vector3(...plane.point);
    const center = bounds.getCenter(new THREE.Vector3());
    // Rectangle covering the model's bounds as seen along the normal, plus a margin.
    const origin = center.clone().addScaledVector(n, n.dot(p) - n.dot(center));
    const group = new THREE.Group();
    group.position.copy(origin);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const u = new THREE.Vector3(1, 0, 0).applyQuaternion(group.quaternion);
    const v = new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion);
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner
        .set(
          i & 1 ? bounds.max.x : bounds.min.x,
          i & 2 ? bounds.max.y : bounds.min.y,
          i & 4 ? bounds.max.z : bounds.min.z,
        )
        .sub(origin);
      const du = corner.dot(u);
      const dv = corner.dot(v);
      minU = Math.min(minU, du);
      maxU = Math.max(maxU, du);
      minV = Math.min(minV, dv);
      maxV = Math.max(maxV, dv);
    }
    const margin = Math.max(maxU - minU, maxV - minV, 1) * 0.05;
    const width = maxU - minU + 2 * margin;
    const height = maxV - minV + 2 * margin;
    const span = Math.max(width, height);
    const rect = new THREE.PlaneGeometry(width, height);
    rect.translate((minU + maxU) / 2, (minV + maxV) / 2, 0);
    const color = active ? ACTIVE : ACCENT;
    const tag = (o: THREE.Object3D) => {
      o.userData.clipPlaneId = plane.id;
      return o;
    };

    const fill = new THREE.Mesh(
      rect,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: plane.enabled ? (active ? 0.07 : 0.035) : 0.015,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    group.add(tag(fill));

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(rect),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: plane.enabled ? 0.9 : 0.3 }),
    );
    group.add(edge);

    // Arrow at the plane's own point, pointing to the removed side; drag it to move.
    const length = Math.max(span * 0.08, 0.5);
    const radius = length * 0.06;
    const arrowMaterial = new THREE.MeshBasicMaterial({ color, depthTest: false });
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 12),
      arrowMaterial,
    );
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = length / 2;
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 3, length * 0.4, 16),
      arrowMaterial,
    );
    head.rotation.x = Math.PI / 2;
    head.position.z = length * 1.2;
    const handle = new THREE.Group();
    handle.add(tag(shaft), tag(head));
    // Bigger invisible grip so the arrow is easy to catch.
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 4, radius * 4, length * 1.5, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    grip.rotation.x = Math.PI / 2;
    grip.position.z = length * 0.75;
    handle.add(tag(grip));
    const local = p.clone().sub(origin).applyQuaternion(group.quaternion.clone().invert());
    handle.position.set(local.x, local.y, 0);
    handle.renderOrder = 10;
    group.add(handle);
    return group;
  }
}

function disposeGroup(group: THREE.Group, scene: THREE.Scene): void {
  scene.remove(group);
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}

/**
 * The point on the line `origin + t·direction` closest to a ray, as the parameter t.
 * Used to drag a plane along its normal with the mouse.
 */
export function closestOnLine(
  ray: THREE.Ray,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
): number {
  const d1 = direction.clone().normalize();
  const d2 = ray.direction;
  const r = origin.clone().sub(ray.origin);
  const a = d1.dot(d1);
  const b = d1.dot(d2);
  const c = d2.dot(d2);
  const d = d1.dot(r);
  const e = d2.dot(r);
  const denom = a * c - b * b;
  // Nearly parallel to the view: fall back to no movement.
  if (Math.abs(denom) < 1e-9) return 0;
  return (b * e - c * d) / denom;
}
