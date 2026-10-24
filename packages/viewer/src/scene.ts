import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** What the viewport reports when the user clicks an object. */
export interface PickResult {
  name: string;
  type: string;
  expressId?: number;
}

export type ViewDirection = 'iso' | 'top' | 'front' | 'back' | 'left' | 'right';

/** An axis-aligned section plane in world metres. */
export interface SectionSpec {
  axis: 'x' | 'y' | 'z';
  position: number;
  /** false keeps the side below/behind the plane; true keeps the other side. */
  flip: boolean;
}

export type PickMode = 'select' | 'point';

/** A world-space point picked on the model surface. */
export interface PointPick {
  point: THREE.Vector3;
  expressId?: number;
}

/** Camera position and orbit target, in world coordinates. */
export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
}

/** The part of the scene controller that application code is allowed to drive. */
export interface ViewportHandle {
  add(object: THREE.Object3D): void;
  remove(object: THREE.Object3D): void;
  clear(): void;
  /** Overlay objects (measurements, markers) live above the content and survive `clear`. */
  addOverlay(object: THREE.Object3D): void;
  clearOverlay(): void;
  setPickMode(mode: PickMode): void;
  getCamera(): CameraState;
  setCamera(state: CameraState): void;
  /** Renders a frame and returns it as a JPEG data URL no wider than `maxWidth`. */
  snapshot(maxWidth?: number): string;
  fit(): void;
  fitTo(box: THREE.Box3, direction?: ViewDirection): void;
  viewFrom(direction: ViewDirection): void;
  contentBounds(): THREE.Box3;
  /** Extent of the content along one axis, for section sliders. */
  extent(axis: 'x' | 'y' | 'z'): { min: number; max: number };
  setSection(section: SectionSpec | null): void;
  select(object: THREE.Mesh | null): void;
  render(): void;
}

const VIEW_DIRECTIONS: Record<ViewDirection, THREE.Vector3> = {
  iso: new THREE.Vector3(1, 0.8, 1.2),
  top: new THREE.Vector3(0, 1, 0.0001),
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
};

/** Meshes may resolve their own picks (e.g. an element inside a merged IFC mesh). */
interface PickableUserData {
  resolvePick?: (faceIndex: number) => PickResult | null;
  managedSelection?: boolean;
}

const SELECTION_COLOR = new THREE.Color(0xffb020);
const CLICK_TOLERANCE_PX = 4;

/**
 * Owns the three.js objects behind one <canvas>.
 *
 * Rendering is on demand: a frame is drawn after camera movement, resize, selection
 * or content changes, never continuously. That keeps laptops cool while a model is
 * simply being looked at.
 */
export class SceneController implements ViewportHandle {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  /** Everything loaded by the application lives under this group. */
  readonly content = new THREE.Group();
  /** Measurements and other annotations; not part of the model's bounds. */
  readonly overlay = new THREE.Group();

  onPick: ((hit: PickResult | null) => void) | null = null;
  onPickPoint: ((pick: PointPick) => void) | null = null;
  private pickMode: PickMode = 'select';

  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private readonly themeObserver: MutationObserver;
  private selected: THREE.Mesh | null = null;
  private selectedMaterial: THREE.Material | THREE.Material[] | null = null;
  private frame = 0;
  private pointerDown: { x: number; y: number } | null = null;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    this.camera.position.set(18, 14, 22);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', this.requestRender);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4250, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(30, 50, 20);
    this.scene.add(sun);

    const grid = new THREE.GridHelper(200, 200, 0x6b7584, 0x3b4452);
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.35;
    this.scene.add(grid);
    this.scene.add(new THREE.AxesHelper(2));
    this.scene.add(this.content);
    this.scene.add(this.overlay);

    this.applyTheme();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.themeObserver = new MutationObserver(() => this.applyTheme());
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);

    this.resize();
  }

  add(object: THREE.Object3D): void {
    this.content.add(object);
    this.requestRender();
  }

  /** Removes an object without disposing it; the caller keeps ownership. */
  remove(object: THREE.Object3D): void {
    this.content.remove(object);
    this.requestRender();
  }

  render(): void {
    this.requestRender();
  }

  addOverlay(object: THREE.Object3D): void {
    this.overlay.add(object);
    this.requestRender();
  }

  clearOverlay(): void {
    for (const child of [...this.overlay.children]) {
      this.overlay.remove(child);
      disposeTree(child);
    }
    this.requestRender();
  }

  setPickMode(mode: PickMode): void {
    this.pickMode = mode;
    this.canvas.style.cursor = mode === 'point' ? 'crosshair' : '';
  }

  getCamera(): CameraState {
    return {
      position: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
    };
  }

  setCamera(state: CameraState): void {
    this.camera.position.fromArray(state.position);
    this.controls.target.fromArray(state.target);
    const distance = Math.max(this.camera.position.distanceTo(this.controls.target), 1);
    this.camera.near = Math.max(distance / 1000, 0.01);
    this.camera.far = Math.max(distance * 50, 1000);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }

  snapshot(maxWidth = 320): string {
    // Draw straight after rendering: the WebGL buffer stays readable until this task ends.
    this.renderer.render(this.scene, this.camera);
    const scale = Math.min(1, maxWidth / Math.max(this.canvas.width, 1));
    const target = document.createElement('canvas');
    target.width = Math.max(1, Math.round(this.canvas.width * scale));
    target.height = Math.max(1, Math.round(this.canvas.height * scale));
    target.getContext('2d')?.drawImage(this.canvas, 0, 0, target.width, target.height);
    return target.toDataURL('image/jpeg', 0.75);
  }

  clear(): void {
    this.select(null);
    for (const child of [...this.content.children]) {
      this.content.remove(child);
      disposeTree(child);
    }
    this.requestRender();
  }

  /** Bounds of everything loaded; a default box when the scene is empty. */
  contentBounds(): THREE.Box3 {
    const box = new THREE.Box3().setFromObject(this.content);
    if (box.isEmpty()) {
      box.set(new THREE.Vector3(-8, 0, -8), new THREE.Vector3(8, 6, 8));
    }
    return box;
  }

  /** Frames the loaded content, keeping the current viewing direction. */
  fit(): void {
    this.fitTo(this.contentBounds());
  }

  /** Looks at the whole model from a standard direction. */
  viewFrom(direction: ViewDirection): void {
    this.fitTo(this.contentBounds(), direction);
  }

  extent(axis: 'x' | 'y' | 'z'): { min: number; max: number } {
    const box = this.contentBounds();
    return { min: box.min[axis], max: box.max[axis] };
  }

  /** One global section plane, or none. */
  setSection(section: SectionSpec | null): void {
    if (!section) {
      this.renderer.clippingPlanes = [];
    } else {
      const normal = new THREE.Vector3(
        section.axis === 'x' ? 1 : 0,
        section.axis === 'y' ? 1 : 0,
        section.axis === 'z' ? 1 : 0,
      );
      // A plane keeps points where normal·p + constant >= 0; unflipped keeps the lower side.
      this.renderer.clippingPlanes = [
        section.flip
          ? new THREE.Plane(normal, -section.position)
          : new THREE.Plane(normal.negate(), section.position),
      ];
    }
    this.requestRender();
  }

  /** Frames a world-space box, from `direction` or else the current viewing direction. */
  fitTo(box: THREE.Box3, direction?: ViewDirection): void {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1) * 0.5;
    const distance = (radius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) * 1.25;

    const towardCamera = direction
      ? VIEW_DIRECTIONS[direction].clone()
      : this.camera.position.clone().sub(this.controls.target);
    if (towardCamera.lengthSq() < 1e-6) towardCamera.set(1, 0.8, 1.2);
    towardCamera.normalize();
    this.camera.position.copy(center).addScaledVector(towardCamera, distance);
    this.camera.near = Math.max(distance / 1000, 0.01);
    this.camera.far = distance * 50;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this.requestRender();
  }

  select(mesh: THREE.Mesh | null): void {
    if (this.selected && this.selectedMaterial) {
      this.selected.material = this.selectedMaterial;
    }
    this.selected = mesh;
    this.selectedMaterial = mesh ? mesh.material : null;
    if (mesh) {
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(highlighted)
        : highlighted(mesh.material);
    }
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.themeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.controls.removeEventListener('change', this.requestRender);
    this.controls.dispose();
    this.clear();
    this.clearOverlay();
    this.renderer.dispose();
  }

  private readonly requestRender = (): void => {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.render(this.scene, this.camera);
    });
  };

  private resize(): void {
    const host = this.canvas.parentElement ?? this.canvas;
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private applyTheme(): void {
    const canvasColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--kp-canvas')
      .trim();
    this.scene.background = new THREE.Color(canvasColor || '#0e1116');
    this.requestRender();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const start = this.pointerDown;
    this.pointerDown = null;
    if (!start || event.button !== 0) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > CLICK_TOLERANCE_PX) return;

    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster
      .intersectObjects(this.content.children, true)
      .find((h) => (h.object as THREE.Mesh).isMesh && h.object.visible);

    if (this.pickMode === 'point') {
      if (!hit) return;
      const pickable = hit.object.userData as PickableUserData;
      const resolved = pickable.resolvePick?.(hit.faceIndex ?? 0);
      this.onPickPoint?.({
        point: hit.point.clone(),
        ...(resolved?.expressId !== undefined ? { expressId: resolved.expressId } : {}),
      });
      return;
    }

    if (!hit) {
      this.select(null);
      this.onPick?.(null);
      return;
    }

    const mesh = hit.object as THREE.Mesh;
    const pickable = mesh.userData as PickableUserData;
    if (pickable.resolvePick) {
      // The mesh paints its own selection; only report what was hit.
      this.select(null);
      this.onPick?.(pickable.resolvePick(hit.faceIndex ?? 0));
      return;
    }
    this.select(mesh);
    this.onPick?.(pickResultOf(mesh));
  };
}

function pickResultOf(mesh: THREE.Mesh): PickResult {
  const data = mesh.userData as Partial<PickResult>;
  return {
    name: data.name ?? mesh.name ?? 'Unnamed',
    type: data.type ?? 'Mesh',
    ...(data.expressId !== undefined ? { expressId: data.expressId } : {}),
  };
}

function highlighted(material: THREE.Material): THREE.Material {
  const clone = material.clone();
  if ('emissive' in clone && clone.emissive instanceof THREE.Color) {
    clone.emissive.copy(SELECTION_COLOR);
    if ('emissiveIntensity' in clone) clone.emissiveIntensity = 0.6;
  } else if ('color' in clone && clone.color instanceof THREE.Color) {
    clone.color.copy(SELECTION_COLOR);
  }
  return clone;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const drawable = object as THREE.Mesh | THREE.Line | THREE.Sprite;
    if (!('geometry' in drawable) || !('material' in drawable)) return;
    drawable.geometry.dispose();
    const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
    for (const material of materials) {
      if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
      material.dispose();
    }
  });
}
