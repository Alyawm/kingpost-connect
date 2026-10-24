import { useCallback } from 'react';
import {
  Viewport,
  createSampleFrame,
  type PickResult,
  type PointPick,
  type ViewportHandle,
} from '@kingpost/viewer';
import { useViewer } from '../state/viewer';
import { useModel } from '../state/model';
import { useView } from '../state/view';

/**
 * The 3D viewport. Mounted once for the life of the window so the WebGL context and
 * loaded geometry survive panel changes; panels reach it through the viewer store.
 */
export function Workspace() {
  const setHandle = useViewer((s) => s.setHandle);
  const setSelection = useViewer((s) => s.setSelection);

  const onReady = useCallback(
    (handle: ViewportHandle | null) => {
      setHandle(handle);
      if (handle && !useModel.getState().model) {
        handle.add(createSampleFrame());
        handle.fit();
      }
    },
    [setHandle],
  );

  const onSelect = useCallback(
    (hit: PickResult | null) => {
      setSelection(hit);
      useModel.getState().onPick(hit);
    },
    [setSelection],
  );

  const onPickPoint = useCallback((pick: PointPick) => {
    useView.getState().pickPoint(pick);
  }, []);

  return <Viewport onReady={onReady} onSelect={onSelect} onPickPoint={onPickPoint} />;
}
