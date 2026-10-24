import { useCallback } from 'react';
import { Viewport, createSampleFrame, type ViewportHandle } from '@kingpost/viewer';
import { useViewer } from '../state/viewer';

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
      if (handle) {
        handle.add(createSampleFrame());
        handle.fit();
      }
    },
    [setHandle],
  );

  return <Viewport onReady={onReady} onSelect={setSelection} />;
}
