import { useCallback } from 'react';
import {
  Viewport,
  createSampleFrame,
  toThreePlane,
  type PickModifiers,
  type PickResult,
  type PointPick,
  type ScreenRect,
  type ViewportHandle,
} from '@kingpost/viewer';
import { useViewer } from '../state/viewer';
import { useModel } from '../state/model';
import { useView } from '../state/view';
import { useAnalysis } from '../state/analysis';
import { useFederation } from '../state/federation';
import { useDrawings } from '../state/drawings';
import { useUi } from '../state/ui';
import { SheetView } from '../features/drawings/SheetView';
import { SheetCompare } from '../features/drawings/SheetCompare';
import { ScheduleView } from '../features/schedules/ScheduleView';

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
    (hit: PickResult | null, modifiers: PickModifiers) => {
      setSelection(hit);
      if (hit?.member) {
        useAnalysis.getState().selectMember(hit.member);
        return;
      }
      // An element of a reference model: show its properties; the main selection clears.
      if (hit?.modelKey && hit.modelKey !== 'main' && hit.expressId !== undefined) {
        void useModel.getState().select(null);
        void useFederation.getState().pick(hit.modelKey, hit.expressId);
        return;
      }
      void useFederation.getState().pick(null);
      useModel.getState().onPick(hit, modifiers);
    },
    [setSelection],
  );

  const onPickPoint = useCallback((pick: PointPick) => {
    useView.getState().pickPoint(pick);
  }, []);

  const onClipPlaneMove = useCallback((id: string, point: [number, number, number]) => {
    useView.getState().movePlane(id, point, true);
  }, []);

  const onClipPlaneSelect = useCallback((id: string) => {
    useView.getState().setActivePlane(id);
  }, []);

  const onBoxSelect = useCallback(
    (rect: ScreenRect, crossing: boolean, modifiers: PickModifiers) => {
      const { model, selectedIds, selectMany } = useModel.getState();
      const handle = useViewer.getState().handle;
      if (!model || !handle) return;
      const keep = useView
        .getState()
        .planes.filter((p) => p.enabled)
        .map(toThreePlane);
      const ids = model.idsInScreenRect(handle.getCameraObject(), rect, crossing, keep);
      void selectMany(modifiers.ctrl ? [...selectedIds, ...ids] : ids);
    },
    [],
  );

  const workspace = useUi((s) => s.workspace);
  const sheetOpen = useDrawings((s) => s.open !== null);
  const comparing = useDrawings((s) => s.compare !== null);
  const showSheet = workspace === 'sheet' && (sheetOpen || comparing);
  const showSchedule = workspace === 'schedule';

  // The viewport stays mounted under a sheet so the loaded model survives the switch.
  return (
    <>
      <div
        className={showSheet || showSchedule ? 'invisible absolute inset-0' : 'absolute inset-0'}
      >
        <Viewport
          onReady={onReady}
          onSelect={onSelect}
          onPickPoint={onPickPoint}
          onClipPlaneMove={onClipPlaneMove}
          onClipPlaneSelect={onClipPlaneSelect}
          onBoxSelect={onBoxSelect}
        />
      </div>
      {showSheet && (comparing ? <SheetCompare /> : <SheetView />)}
      {showSchedule && <ScheduleView />}
    </>
  );
}
