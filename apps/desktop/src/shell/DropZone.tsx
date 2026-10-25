import { useEffect, useState } from 'react';
import { FileDown } from 'lucide-react';
import { isTauri } from '../lib/ipc';
import { useProject } from '../state/project';

/**
 * Accepts files dragged onto the window. While files hover it shows what will happen;
 * on drop the project store copies, imports and shows them.
 */
export function DropZone() {
  const [over, setOver] = useState(false);
  const hasProject = useProject((s) => s.current !== null);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      const off = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === 'enter' || payload.type === 'over') setOver(true);
        else if (payload.type === 'leave') setOver(false);
        else if (payload.type === 'drop') {
          setOver(false);
          void useProject.getState().addDroppedFiles(payload.paths);
        }
      });
      if (cancelled) off();
      else unlisten = off;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (!over) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-accent bg-surface px-8 py-6 text-sm shadow-2xl">
        <FileDown size={28} className="text-accent" />
        <div className="font-semibold">Drop to add to the project</div>
        <div className="text-xs text-fg-muted">
          {hasProject
            ? 'IFC models are imported and shown; PDF and analysis files are added for import.'
            : 'No project is open: the folder of the dropped file becomes the project.'}
        </div>
      </div>
    </div>
  );
}
