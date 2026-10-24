import * as THREE from 'three';

export interface Measurement {
  a: THREE.Vector3;
  b: THREE.Vector3;
  distance: number;
  delta: THREE.Vector3;
}

const LINE_COLOR = 0xffb020;

export function measure(a: THREE.Vector3, b: THREE.Vector3): Measurement {
  const delta = b.clone().sub(a);
  return { a: a.clone(), b: b.clone(), distance: delta.length(), delta };
}

/** Line, end markers and a distance label, drawn on top of the model. */
export function createMeasurementObject(m: Measurement): THREE.Group {
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

  const label = textSprite(formatDistance(m.distance));
  label.position.copy(m.a).lerp(m.b, 0.5);
  const height = Math.max(0.35, Math.min(2.5, m.distance * 0.12));
  label.scale.set(height * 3.2, height, 1);
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

export function formatDistance(metres: number): string {
  if (metres < 1) return `${Math.round(metres * 1000)} mm`;
  return `${metres.toFixed(metres < 10 ? 3 : 2)} m`;
}

function textSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = 'rgba(14, 17, 22, 0.85)';
    roundRect(context, 4, 4, canvas.width - 8, canvas.height - 8, 14);
    context.fill();
    context.font = '600 40px "Segoe UI", system-ui, sans-serif';
    context.fillStyle = '#ffb020';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  return new THREE.Sprite(material);
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
