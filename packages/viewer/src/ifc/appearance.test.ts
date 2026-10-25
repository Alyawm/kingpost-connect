import * as THREE from 'three';
import { IfcModel, solidVertexColors, type MeshBucket } from './model';

/** One bucket with three single-triangle elements: ids 1, 2 and 3. */
function threeElements(): { model: IfcModel; bucket: MeshBucket } {
  const positions = new Float32Array(9 * 3);
  for (let e = 0; e < 3; e++) {
    positions.set([e, 0, 0, e + 1, 0, 0, e, 1, 0], e * 9);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', solidVertexColors(9, new THREE.Color('#808080')));
  geometry.setIndex(Array.from({ length: 9 }, (_, i) => i));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
  const group = new THREE.Group();
  group.add(mesh);
  const bucket: MeshBucket = {
    mesh,
    baseColor: new THREE.Color('#808080'),
    ranges: [1, 2, 3].map((expressId, i) => ({
      expressId,
      indexStart: i * 3,
      indexCount: 3,
      vertexStart: i * 3,
      vertexCount: 3,
    })),
  };
  return { model: new IfcModel(group, [bucket]), bucket };
}

const rgbAt = (mesh: THREE.Mesh, vertex: number) => {
  const attribute = mesh.geometry.getAttribute('color');
  return Array.from((attribute.array as Uint8Array).slice(vertex * 3, vertex * 3 + 3));
};

/** Bytes the model writes for a CSS colour (three.js keeps colours in linear space). */
const rgb = (css: string) => {
  const c = new THREE.Color(css);
  return [c.r, c.g, c.b].map((v) => Math.round(v * 255));
};

const companionOf = (model: IfcModel) =>
  model.group.children.find((c) => c.name.endsWith('(see-through)')) as THREE.Mesh | undefined;

describe('IfcModel.setAppearance', () => {
  it('paints an override colour over the base colour and clears it again', () => {
    const { model, bucket } = threeElements();
    model.setAppearance(new Map([[2, { color: '#ff0000' }]]));
    expect(rgbAt(bucket.mesh, 3)).toEqual([255, 0, 0]);
    expect(rgbAt(bucket.mesh, 0)).toEqual(rgb('#808080'));
    model.setAppearance(null);
    expect(rgbAt(bucket.mesh, 3)).toEqual(rgb('#808080'));
  });

  it('wins over a colour-by tint, and selection wins over both', () => {
    const { model, bucket } = threeElements();
    model.setTints(new Map([[1, '#00ff00']]));
    model.setAppearance(new Map([[1, { color: '#0000ff' }]]));
    expect(rgbAt(bucket.mesh, 0)).toEqual([0, 0, 255]);
    model.setSelected(1);
    expect(rgbAt(bucket.mesh, 0)).toEqual(rgb('#ffb020'));
    model.setSelected(null);
    model.setAppearance(null);
    expect(rgbAt(bucket.mesh, 0)).toEqual([0, 255, 0]);
  });

  it('moves see-through elements to a companion mesh with their alpha', () => {
    const { model, bucket } = threeElements();
    model.setAppearance(new Map([[3, { opacity: 0.5, color: '#ffffff' }]]));
    expect(bucket.mesh.geometry.getIndex()?.count).toBe(6);
    const companion = companionOf(model)!;
    expect(companion.visible).toBe(true);
    expect(companion.geometry.getIndex()?.count).toBe(3);
    const rgba = companion.geometry.getAttribute('color').array as Uint8Array;
    expect(Array.from(rgba.slice(6 * 4, 6 * 4 + 4))).toEqual([255, 255, 255, 128]);
    // Picking a face on either mesh resolves to the right element.
    expect(bucket.mesh.userData.resolvePick(1).expressId).toBe(2);
    expect(companion.userData.resolvePick(0).expressId).toBe(3);

    model.setAppearance(null);
    expect(bucket.mesh.geometry.getIndex()?.count).toBe(9);
    expect(companion.visible).toBe(false);
  });

  it('draws nothing for a fully transparent element but keeps hiding separate', () => {
    const { model, bucket } = threeElements();
    model.setAppearance(new Map([[1, { opacity: 0 }]]));
    model.setHidden([2]);
    expect(bucket.mesh.geometry.getIndex()?.count).toBe(3);
    expect(companionOf(model)?.geometry.getIndex()?.count ?? 0).toBe(0);
    expect(model.opacityOf(1)).toBe(0);
    expect(model.opacityOf(3)).toBe(1);
  });

  it('caches every element even while some are hidden or see-through', () => {
    const { model, bucket } = threeElements();
    model.setHidden([1]);
    model.setAppearance(new Map([[2, { opacity: 0.3 }]]));
    expect((bucket.mesh.userData.fullIndex as Uint32Array).length).toBe(9);
  });
});
