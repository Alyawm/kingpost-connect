import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { IfcAPI } from 'web-ifc';
import { IfcFrame } from './coordinates';
import { colorKey, toBufferGeometry } from './geometry';
import { IfcModel, solidVertexColors, type ElementRange, type MeshBucket } from './model';
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
  model: IfcModel;
  stats: IfcLoadStats;
  /** Maps viewer space to IFC world coordinates (see `IfcFrame`). */
  frame: IfcFrame;
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

interface Bucket {
  color: THREE.Color;
  opacity: number;
  parts: { geometry: THREE.BufferGeometry; expressId: number }[];
}

/**
 * Parses an IFC file's geometry and returns it as an [`IfcModel`]: one mesh per colour,
 * with the element ranges needed for picking, hiding and tinting.
 *
 * The returned group is Y-up, as web-ifc delivers it.
 */
export async function loadIfcToGroup(data: Uint8Array): Promise<IfcLoadResult> {
  const total = performance.now();
  const { api, initMs } = await runtime();

  const parseStart = performance.now();
  const modelID = api.OpenModel(data, { COORDINATE_TO_ORIGIN: true });
  const parseMs = Math.round(performance.now() - parseStart);
  const schema = api.GetModelSchema(modelID) ?? 'unknown';

  const geometryStart = performance.now();
  const byMaterial = new Map<string, Bucket>();
  let meshes = 0;
  let triangles = 0;
  let coordination: number[] | null = null;

  try {
    coordination = api.GetCoordinationMatrix(modelID);
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
        bucket.parts.push({ geometry, expressId: flatMesh.expressID });
      }
    });
  } finally {
    api.CloseModel(modelID);
  }

  // web-ifc already converts IFC's Z-up coordinates to three.js Y-up; no rotation here.
  const group = new THREE.Group();
  group.name = 'IFC model';

  const buckets: MeshBucket[] = [];
  for (const [key, bucket] of byMaterial) {
    // Parts of one element are kept adjacent so each element is a single range.
    bucket.parts.sort((a, b) => a.expressId - b.expressId);
    const ranges: ElementRange[] = [];
    let indexCursor = 0;
    let vertexCursor = 0;
    for (const part of bucket.parts) {
      const indexCount = part.geometry.getIndex()?.count ?? 0;
      const vertexCount = part.geometry.getAttribute('position').count;
      const last = ranges[ranges.length - 1];
      if (last && last.expressId === part.expressId) {
        last.indexCount += indexCount;
        last.vertexCount += vertexCount;
      } else {
        ranges.push({
          expressId: part.expressId,
          indexStart: indexCursor,
          indexCount,
          vertexStart: vertexCursor,
          vertexCount,
        });
      }
      indexCursor += indexCount;
      vertexCursor += vertexCount;
    }

    const merged = mergeGeometries(
      bucket.parts.map((p) => p.geometry),
      false,
    );
    for (const part of bucket.parts) part.geometry.dispose();
    if (!merged) continue;
    merged.setAttribute('color', solidVertexColors(vertexCursor, bucket.color));

    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: bucket.opacity < 1,
      opacity: bucket.opacity,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `material ${key}`;
    group.add(mesh);
    buckets.push({ mesh, baseColor: bucket.color, ranges });
  }

  const geometryMs = Math.round(performance.now() - geometryStart);

  return {
    model: new IfcModel(group, buckets),
    frame: new IfcFrame(coordination),
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
