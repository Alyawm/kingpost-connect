// The viewer owns the three.js dependency; the application gets the vector type from here.
export { Box3, Matrix4, Vector3 } from 'three';
export { Viewport, type ViewportProps } from './Viewport';
export {
  SceneController,
  type CameraState,
  type NavigationMode,
  type PickMode,
  type PickModifiers,
  type PickResult,
  type PointPick,
  type ScreenRect,
  type ViewDirection,
  type ViewportHandle,
} from './scene';
export { createSampleFrame } from './sample';
export {
  extentAlong,
  planeOffset,
  snapToAxis,
  toThreePlane,
  withOffset,
  type ClipPlaneSpec,
} from './clip';
export { loadIfcToGroup, type IfcLoadStats, type IfcLoadResult } from './ifc/load';
export { IfcModel, type ElementAppearance, type ElementRange, type MeshBucket } from './ifc/model';
export {
  deserializeBuckets,
  modelFromCache,
  serializeBuckets,
  type CachedModel,
} from './ifc/cache';
export {
  findClashes,
  type ClashHit,
  type ClashOptions,
  type ClashProgress,
  type ClashSource,
} from './clash';
export { IfcFrame, type Triple } from './ifc/coordinates';
export { extractEdges, type EdgeSet } from './ifc/edges';
export {
  AnalysisLayer,
  MEMBER_KIND_COLORS,
  type AnalysisDrawSource,
  type AnalysisVisibility,
} from './analysis';
export {
  createLineObject,
  createMarkerObject,
  createMeasurementObject,
  createAngleObject,
  createPerpendicularObject,
  createPointObject,
  createNoteObject,
  createGridObject,
  formatDistance,
  measure,
  type Measurement,
} from './measure';
export { ViewCube } from './ViewCube';
export { cubeTransform } from './cube';
export {
  DEFAULT_SNAP,
  angleAt,
  distanceToPlane,
  orthoPoint,
  snapToSegments,
  type SnapKind,
  type SnapOptions,
  type SnapResult,
} from './snap';
