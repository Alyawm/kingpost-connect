// The viewer owns the three.js dependency; the application gets the vector type from here.
export { Vector3 } from 'three';
export { Viewport, type ViewportProps } from './Viewport';
export {
  SceneController,
  type CameraState,
  type PickMode,
  type PickModifiers,
  type PickResult,
  type PointPick,
  type SectionSpec,
  type ViewDirection,
  type ViewportHandle,
} from './scene';
export { createSampleFrame } from './sample';
export { loadIfcToGroup, type IfcLoadStats, type IfcLoadResult } from './ifc/load';
export { IfcModel, type ElementRange, type MeshBucket } from './ifc/model';
export { IfcFrame, type Triple } from './ifc/coordinates';
export {
  AnalysisLayer,
  MEMBER_KIND_COLORS,
  type AnalysisDrawSource,
  type AnalysisVisibility,
} from './analysis';
export {
  createLineObject,
  createMeasurementObject,
  formatDistance,
  measure,
  type Measurement,
} from './measure';
