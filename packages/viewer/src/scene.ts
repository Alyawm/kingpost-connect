import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** What the viewport reports when the user clicks an object. */
export interface PickResult {
  name: string;
  type: string;
  expressId?: number;
}

/** The part of the scene controller that application code is allowed to drive. */
export interface ViewportHandle {
  add(object: THREE.Object3D): void;
  remove(object: THREE.Object3D): void;
  clear(): void;
  fit(): void;
  fitTo(box: THREE.Box3): void;
  select(object: THREE.Mesh | null): void;
  render(): void;
}

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

  onPick: ((hit: PickResult | null) => void) | null = null;

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

  clear(): void {
    this.select(null);
    for (const child of [...this.content.children]) {
      this.content.remove(child);
      disposeTree(child);
    }
    this.requestRender();
  }

  /** Frames the loaded content; falls back to a sensible default when nothing is loaded. */
  fit(): void {
    const box = new THREE.Box3().setFromObject(this.content);
    if (box.isEmpty()) {
      box.set(new THREE.Vector3(-8, 0, -8), new THREE.Vector3(8, 6, 8));
    }
    this.fitTo(box);
  }

  /** Frames a world-space box, keeping the current viewing direction. */
  fitTo(box: THREE.Box3): void {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1) * 0.5;
    const distance = (radius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) * 1.25;

    const direction = this.camera.position.clone().sub(this.controls.target);
    if (direction.lengthSq() < 1e-6) direction.set(1, 0.8, 1.2);
    direction.normalize();
    this.camera.position.copy(center).addScaledVector(direction, distance);
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
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material.dispose();
  });
}
