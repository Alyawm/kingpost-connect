import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { IfcAPI } from 'web-ifc';
import { colorKey, toBufferGeometry } from './geometry';
import { IFC_WASM_DIR } from './wasm';

export interface IfcLoadStats {
  schema: string;
  /** Products that produced at least one placed geometry. */
  meshes: number;
  /** Distinct materials after merging by colour. */
  materials: number;
  triangles: number;
  initMs: number;
  parseMs: number;
  geometryMs: number;
  totalMs: number;
}

export interface IfcLoadResult {
  group: THREE.Group;
  stats: IfcLoadStats;
}

let apiPromise: Promise<{ api: IfcAPI; initMs: number }> | null = null;

/**
 * The web-ifc runtime is initialised once per page and shared by every load. Its
 * JavaScript is several megabytes, so it is imported on first use rather than at start-up.
 */
function runtime(): Promise<{ api: IfcAPI; initMs: number }> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const started = performance.now();
      const { IfcAPI } = await import('web-ifc');
      const api = new IfcAPI();
      api.SetWasmPath(IFC_WASM_DIR, true);
      await api.Init();
      return { api, initMs: Math.round(performance.now() - started) };
    })();
  }
  return apiPromise;
}

/**
 * Parses an IFC file and returns its geometry as one three.js group, merged into a
 * single mesh per colour. This is the plain, unoptimised path used to measure how far
 * web-ifc gets on real structural models before the fragment cache is designed.
 *
 * The returned group is Y-up (IFC is Z-up; the rotation is applied on the group).
 */
export async function loadIfcToGroup(data: Uint8Array): Promise<IfcLoadResult> {
  const total = performance.now();
  const { api, initMs } = await runtime();

  const parseStart = performance.now();
  const modelID = api.OpenModel(data, { COORDINATE_TO_ORIGIN: true });
  const parseMs = Math.round(performance.now() - parseStart);

  const schema = api.GetModelSchema(modelID) ?? 'unknown';

  const geometryStart = performance.now();
  const byMaterial = new Map<
    string,
    { color: THREE.Color; opacity: number; parts: THREE.BufferGeometry[] }
  >();
  let meshes = 0;
  let triangles = 0;

  try {
    api.StreamAllMeshes(modelID, (flatMesh) => {
      meshes++;
      const placed = flatMesh.geometries;
      for (let i = 0; i < placed.size(); i++) {
        const item = placed.get(i);
        const ifcGeometry = api.GetGeometry(modelID, item.geometryExpressID);
        const vertices = api.GetVertexArray(
          ifcGeometry.GetVertexData(),
          ifcGeometry.GetVertexDataSize(),
        );
        const indices = api.GetIndexArray(
          ifcGeometry.GetIndexData(),
          ifcGeometry.GetIndexDataSize(),
        );
        const geometry = toBufferGeometry(vertices, indices);
        ifcGeometry.delete();

        geometry.applyMatrix4(new THREE.Matrix4().fromArray(item.flatTransformation));
        triangles += indices.length / 3;

        const key = colorKey(item.color);
        let bucket = byMaterial.get(key);
        if (!bucket) {
          bucket = {
            color: new THREE.Color(item.color.x, item.color.y, item.color.z),
            opacity: item.color.w,
            parts: [],
          };
          byMaterial.set(key, bucket);
        }
        bucket.parts.push(geometry);
      }
    });
  } finally {
    api.CloseModel(modelID);
  }

  const group = new THREE.Group();
  group.name = 'IFC model';
  group.rotation.x = -Math.PI / 2;

  for (const [key, bucket] of byMaterial) {
    const merged = mergeGeometries(bucket.parts, false);
    for (const part of bucket.parts) part.dispose();
    if (!merged) continue;
    const material = new THREE.MeshLambertMaterial({
      color: bucket.color,
      transparent: bucket.opacity < 1,
      opacity: bucket.opacity,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `material ${key}`;
    mesh.userData = { name: `Merged geometry (${bucket.parts.length} parts)`, type: 'IfcProduct' };
    group.add(mesh);
  }

  const geometryMs = Math.round(performance.now() - geometryStart);

  return {
    group,
    stats: {
      schema,
      meshes,
      materials: byMaterial.size,
      triangles: Math.round(triangles),
      initMs,
      parseMs,
      geometryMs,
      totalMs: Math.round(performance.now() - total),
    },
  };
}
