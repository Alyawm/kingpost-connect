import { useEffect, useRef } from 'react';
import {
  SceneController,
  type PickModifiers,
  type PickResult,
  type PointPick,
  type ScreenRect,
  type ViewportHandle,
} from './scene';

export interface ViewportProps {
  className?: string;
  /** Called with the picked object (null when the click hit nothing) and the modifier keys. */
  onSelect?: (hit: PickResult | null, modifiers: PickModifiers) => void;
  /** Called with a surface point (and its normal) while the viewport is in point-pick mode. */
  onPickPoint?: (pick: PointPick) => void;
  /** Called while a section plane handle is dragged, with the plane's new point. */
  onClipPlaneMove?: (id: string, point: [number, number, number]) => void;
  /** Called when a section plane handle is clicked. */
  onClipPlaneSelect?: (id: string) => void;
  /** Called when a Shift+drag selection box is released. */
  onBoxSelect?: (rect: ScreenRect, crossing: boolean, modifiers: PickModifiers) => void;
  /** Called with the handle once the scene exists, and with null before it is torn down. */
  onReady?: (handle: ViewportHandle | null) => void;
}

/**
 * A full-size canvas owned by one SceneController. The controller is created once per
 * mount; callbacks are read through refs so that re-renders never rebuild the scene.
 */
export function Viewport(props: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);

  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new SceneController(canvas);
    controller.onPick = (hit, modifiers) => propsRef.current.onSelect?.(hit, modifiers);
    controller.onPickPoint = (pick) => propsRef.current.onPickPoint?.(pick);
    controller.onClipPlaneMove = (id, point) => propsRef.current.onClipPlaneMove?.(id, point);
    controller.onClipPlaneSelect = (id) => propsRef.current.onClipPlaneSelect?.(id);
    controller.onBoxSelect = (rect, crossing, modifiers) =>
      propsRef.current.onBoxSelect?.(rect, crossing, modifiers);
    // The middle button pans; stop the browser's auto-scroll from starting as well.
    const noAutoScroll = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };
    canvas.addEventListener('mousedown', noAutoScroll);
    propsRef.current.onReady?.(controller);
    return () => {
      canvas.removeEventListener('mousedown', noAutoScroll);
      propsRef.current.onReady?.(null);
      controller.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={props.className}
      style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
    />
  );
}
