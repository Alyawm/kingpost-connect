import { useEffect, useRef } from 'react';
import { cubeTransform } from './cube';
import type { ViewDirection, ViewportHandle } from './scene';

const SIZE = 64;
const HALF = SIZE / 2;

/** Faces in CSS space (y down): the transform that places each one, and its view. */
const FACES: { label: string; direction: ViewDirection; transform: string }[] = [
  { label: 'Front', direction: 'front', transform: `translateZ(${HALF}px)` },
  { label: 'Back', direction: 'back', transform: `rotateY(180deg) translateZ(${HALF}px)` },
  { label: 'Right', direction: 'right', transform: `rotateY(90deg) translateZ(${HALF}px)` },
  { label: 'Left', direction: 'left', transform: `rotateY(-90deg) translateZ(${HALF}px)` },
  { label: 'Top', direction: 'top', transform: `rotateX(90deg) translateZ(${HALF}px)` },
  { label: 'Bottom', direction: 'bottom', transform: `rotateX(-90deg) translateZ(${HALF}px)` },
];

/**
 * An orientation cube for the corner of the viewport. It turns with the camera; clicking a
 * face looks at the model from that side, and the button below returns to the iso view.
 */
export function ViewCube({ handle }: { handle: ViewportHandle | null }) {
  const cubeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!handle) return;
    const update = () => {
      if (cubeRef.current)
        cubeRef.current.style.transform = cubeTransform(handle.getCameraObject());
    };
    update();
    return handle.onCameraChange(update);
  }, [handle]);

  return (
    <div
      className="pointer-events-auto flex select-none flex-col items-center gap-4"
      style={{ width: SIZE + 16 }}
    >
      <div style={{ width: SIZE, height: SIZE, perspective: 400 }}>
        <div
          ref={cubeRef}
          style={{
            position: 'relative',
            width: SIZE,
            height: SIZE,
            transformStyle: 'preserve-3d',
          }}
        >
          {FACES.map((face) => (
            <button
              key={face.direction}
              type="button"
              title={`View from ${face.label.toLowerCase()}`}
              onClick={() => handle?.viewFrom(face.direction)}
              className="kp-viewcube-face"
              style={{
                position: 'absolute',
                inset: 0,
                transform: face.transform,
                backfaceVisibility: 'hidden',
              }}
            >
              {face.label}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        title="Iso view"
        onClick={() => handle?.viewFrom('iso')}
        className="kp-viewcube-home"
      >
        Iso
      </button>
    </div>
  );
}
