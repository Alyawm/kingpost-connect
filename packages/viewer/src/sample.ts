import * as THREE from 'three';

/**
 * A small two-bay steel portal frame used to exercise the viewport before real models
 * are loaded: columns, eaves beams, purlins and base plates, each tagged with the IFC
 * type it would carry in a real model so picking and the inspector have something to say.
 *
 * Dimensions are metres, Y up (three.js convention).
 */
export function createSampleFrame(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Sample portal frame';

  const steel = new THREE.MeshStandardMaterial({
    color: 0x8da2b8,
    metalness: 0.35,
    roughness: 0.55,
  });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb8b4ab, roughness: 0.9 });

  const bays = [0, 6, 12];
  const frames = [0, 6, 12];
  const height = 4;

  let column = 1;
  let beam = 1;
  let purlin = 1;
  let footing = 1;

  for (const z of frames) {
    for (const x of bays) {
      group.add(box(0.3, height, 0.3, x, height / 2, z, steel, `C${column++}`, 'IfcColumn'));
      group.add(box(1.2, 0.4, 1.2, x, -0.2, z, concrete, `F${footing++}`, 'IfcFooting'));
    }
    for (let i = 0; i < bays.length - 1; i++) {
      const x0 = bays[i] ?? 0;
      const x1 = bays[i + 1] ?? 0;
      group.add(
        box(x1 - x0, 0.45, 0.25, (x0 + x1) / 2, height + 0.225, z, steel, `B${beam++}`, 'IfcBeam'),
      );
    }
  }

  for (let i = 0; i < frames.length - 1; i++) {
    const z0 = frames[i] ?? 0;
    const z1 = frames[i + 1] ?? 0;
    for (const x of [1.5, 4.5, 7.5, 10.5]) {
      group.add(
        box(
          0.15,
          0.2,
          z1 - z0,
          x,
          height + 0.55,
          (z0 + z1) / 2,
          steel,
          `P${purlin++}`,
          'IfcMember',
        ),
      );
    }
  }

  return group;
}

function box(
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  name: string,
  type: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.name = name;
  mesh.userData = { name, type };
  return mesh;
}
