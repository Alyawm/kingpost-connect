import * as THREE from 'three';

export interface Measurement {
  a: THREE.Vector3;
  b: THREE.Vector3;
  distance: number;
  delta: THREE.Vector3;
}

const LINE_COLOR = 0xffb020;
/** Label height as a fraction of the view (about 30 px in a typical window). */
const LABEL_SIZE = 0.03;

export function measure(a: THREE.Vector3, b: THREE.Vector3): Measurement {
  const delta = b.clone().sub(a);
  return { a: a.clone(), b: b.clone(), distance: delta.length(), delta };
}

/** Line, end markers and a distance label, drawn on top of the model. */
export function createMeasurementObject(m: Measurement, text?: string): THREE.Group {
  const group = new THREE.Group();
  group.name = 'measurement';

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([m.a, m.b]),
    new THREE.LineBasicMaterial({ color: LINE_COLOR, depthTest: false, transparent: true }),
  );
  line.renderOrder = 10;
  group.add(line);

  const markerSize = Math.max(0.04, Math.min(0.25, m.distance * 0.02));
  for (const point of [m.a, m.b]) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(markerSize, 12, 8),
      new THREE.MeshBasicMaterial({ color: LINE_COLOR, depthTest: false, transparent: true }),
    );
    marker.position.copy(point);
    marker.renderOrder = 11;
    group.add(marker);
  }

  const label = textSprite(text ?? formatDistance(m.distance));
  label.position.copy(m.a).lerp(m.b, 0.5);
  sizeLabel(label);
  label.renderOrder = 12;
  group.add(label);

  return group;
}

/** A plain annotation line drawn on top of the model (markups, imported BCF lines). */
export function createLineObject(
  a: THREE.Vector3,
  b: THREE.Vector3,
  color = LINE_COLOR,
): THREE.Line {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([a, b]),
    new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, linewidth: 2 }),
  );
  line.renderOrder = 10;
  line.name = 'markup';
  return line;
}

/** A small sphere drawn on top of everything, for marking a point such as a clash. */
export function createMarkerObject(
  at: THREE.Vector3,
  color: THREE.ColorRepresentation,
): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 16, 16),
    new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 }),
  );
  marker.position.copy(at);
  marker.renderOrder = 11;
  marker.name = 'marker';
  return marker;
}

export function formatDistance(metres: number): string {
  if (metres < 1) return `${Math.round(metres * 1000)} mm`;
  return `${metres.toFixed(metres < 10 ? 3 : 2)} m`;
}

/** Font of all labels; the canvas is sized to the text it carries. */
const LABEL_FONT = '600 40px "Segoe UI", system-ui, sans-serif';

function textSprite(text: string, minWidth = 160): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.height = 80;
  const context = canvas.getContext('2d');
  let width = minWidth;
  if (context) {
    context.font = LABEL_FONT;
    width = Math.max(minWidth, Math.ceil(context.measureText(text).width) + 48);
  }
  canvas.width = width;
  if (context) {
    context.fillStyle = 'rgba(14, 17, 22, 0.85)';
    roundRect(context, 4, 4, canvas.width - 8, canvas.height - 8, 14);
    context.fill();
    context.font = LABEL_FONT;
    context.fillStyle = '#ffb020';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Labels keep the same size on screen at any zoom (sizeAttenuation off).
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    transparent: true,
    sizeAttenuation: false,
  });
  const sprite = new THREE.Sprite(material);
  // Width over height, so callers keep the box in proportion to its text.
  sprite.userData.aspect = width / canvas.height;
  return sprite;
}

/** Scales a label to the constant on-screen height, keeping its proportions. */
function sizeLabel(sprite: THREE.Sprite): void {
  const aspect = (sprite.userData.aspect as number | undefined) ?? 3.2;
  sprite.scale.set(LABEL_SIZE * aspect, LABEL_SIZE, 1);
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function marker(point: THREE.Vector3, size: number, color = LINE_COLOR): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(size, 12, 8),
    new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }),
  );
  mesh.position.copy(point);
  mesh.renderOrder = 11;
  return mesh;
}

function overlayLine(points: THREE.Vector3[], color = LINE_COLOR, dashed = false): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = dashed
    ? new THREE.LineDashedMaterial({
        color,
        depthTest: false,
        transparent: true,
        dashSize: 0.15,
        gapSize: 0.1,
      })
    : new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
  const line = new THREE.Line(geometry, material);
  if (dashed) line.computeLineDistances();
  line.renderOrder = 10;
  return line;
}

function label(text: string, at: THREE.Vector3, height: number): THREE.Sprite {
  const sprite = textSprite(text);
  sprite.position.copy(at);
  // Constant size on screen, whatever the distance (height is kept for older callers).
  void height;
  sizeLabel(sprite);
  sprite.renderOrder = 12;
  return sprite;
}

const labelHeight = (span: number) => Math.max(0.35, Math.min(2.5, span * 0.12));

/** Two arms, an arc at the vertex and the angle in degrees. */
export function createAngleObject(
  a: THREE.Vector3,
  vertex: THREE.Vector3,
  b: THREE.Vector3,
  degrees: number,
  text?: string,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'measurement';
  group.add(overlayLine([a, vertex, b]));
  const u = a.clone().sub(vertex);
  const v = b.clone().sub(vertex);
  const radius = Math.min(u.length(), v.length()) * 0.3;
  const size = Math.max(0.04, Math.min(0.25, radius * 0.08));
  for (const p of [a, vertex, b]) group.add(marker(p, size));
  if (radius > 1e-6) {
    const un = u.clone().normalize();
    const vn = v.clone().normalize();
    const arc: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      // Spherical interpolation between the two arm directions.
      const t = i / 24;
      const dir = new THREE.Vector3().copy(un).lerp(vn, t).normalize();
      arc.push(vertex.clone().addScaledVector(dir, radius));
    }
    group.add(overlayLine(arc));
    const mid = un.clone().add(vn).normalize();
    group.add(
      label(
        text ?? `${degrees.toFixed(1)}°`,
        vertex.clone().addScaledVector(mid.lengthSq() > 0 ? mid : un, radius * 1.6),
        labelHeight(radius * 3),
      ),
    );
  }
  return group;
}

/** A perpendicular from a point to a plane, with its foot and length. */
export function createPerpendicularObject(
  point: THREE.Vector3,
  foot: THREE.Vector3,
  distance: number,
  text?: string,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'measurement';
  group.add(overlayLine([point, foot]));
  const size = Math.max(0.04, Math.min(0.25, distance * 0.02));
  group.add(marker(point, size));
  group.add(marker(foot, size, 0x4dd4e0));
  group.add(
    label(
      `⊥ ${text ?? formatDistance(distance)}`,
      point.clone().lerp(foot, 0.5),
      labelHeight(distance),
    ),
  );
  return group;
}

/** A point with its coordinates. */
export function createPointObject(point: THREE.Vector3, text: string, span: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'measurement';
  group.add(marker(point, Math.max(0.05, span * 0.004)));
  const lift = new THREE.Vector3(0, labelHeight(span * 0.1) * 0.9, 0);
  const sprite = textSprite(text);
  sprite.position.copy(point).add(lift);
  sizeLabel(sprite);
  sprite.renderOrder = 12;
  group.add(sprite);
  return group;
}

/** A dashed preview polyline, redrawn while the pointer moves. */
export function createPreviewObject(points: THREE.Vector3[]): THREE.Line {
  const line = overlayLine(points, 0x5b9dff, true);
  line.name = 'preview';
  return line;
}

const NOTE_COLOR = 0xf5b941;

/** A note pin: a stem from the point and a label with its number and text. */
export function createNoteObject(point: THREE.Vector3, text: string, span: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'note';
  const lift = Math.max(span * 0.02, 0.4);
  const top = point.clone().add(new THREE.Vector3(0, lift, 0));
  group.add(overlayLine([point, top], NOTE_COLOR));
  group.add(marker(point, Math.max(0.04, span * 0.003), NOTE_COLOR));
  const sprite = textSprite(text.length > 48 ? `${text.slice(0, 47)}…` : text);
  sprite.position.copy(top);
  sprite.center.set(0.5, 0);
  sizeLabel(sprite);
  sprite.renderOrder = 12;
  group.add(sprite);
  return group;
}
