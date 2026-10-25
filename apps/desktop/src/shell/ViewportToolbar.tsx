import { ViewCube } from '@kingpost/viewer';
import { useViewer } from '../state/viewer';
import { useView } from '../state/view';
import { MeasurePanel, SnapTip } from '../features/viewer/MeasurePanel';

/**
 * What floats over the viewport now that the tools live in the main toolbar: the hint for
 * the active tool, the measure panel, the cursor tip and the orientation cube.
 */
export function ViewportToolbar() {
  const handle = useViewer((s) => s.handle);
  const tool = useView((s) => s.tool);
  const pending = useView((s) => s.pendingPoint);
  const boxSelect = useView((s) => s.boxSelect);

  return (
    <>
      <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-2">
        {(tool === 'section' || tool === 'markup' || boxSelect) && (
          <div className="rounded-md border border-edge bg-surface/90 px-2 py-1 text-[11px] text-fg-muted shadow">
            {boxSelect
              ? 'Drag a box to select · right to left also takes touching elements · Ctrl adds'
              : tool === 'section'
                ? 'Click a face: the plane is placed on it, then drag its arrow to cut'
                : pending
                  ? 'Click the second point'
                  : 'Click the first point on the model to draw a line'}
          </div>
        )}
        <MeasurePanel />
      </div>
      <SnapTip />
      <div className="pointer-events-none absolute bottom-14 right-3">
        <ViewCube handle={handle} />
      </div>
    </>
  );
}
