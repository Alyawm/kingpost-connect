import { useEffect, useRef } from 'react';
import { SceneController, type PickResult, type ViewportHandle } from './scene';

export interface ViewportProps {
  className?: string;
  /** Called with the picked object, or null when the click hit nothing. */
  onSelect?: (hit: PickResult | null) => void;
  /** Called with the handle once the scene exists, and with null before it is torn down. */
  onReady?: (handle: ViewportHandle | null) => void;
}

/**
 * A full-size canvas owned by one SceneController. The controller is created once per
 * mount; callbacks are read through refs so that re-renders never rebuild the scene.
 */
export function Viewport({ className, onSelect, onReady }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onSelectRef = useRef(onSelect);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new SceneController(canvas);
    controller.onPick = (hit) => onSelectRef.current?.(hit);
    onReadyRef.current?.(controller);
    return () => {
      onReadyRef.current?.(null);
      controller.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
    />
  );
}
