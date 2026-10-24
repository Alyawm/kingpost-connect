import { useRef, useState, type ChangeEvent } from 'react';
import { FileUp } from 'lucide-react';
import { loadIfcToGroup, type IfcLoadStats } from '@kingpost/viewer';
import { Button, Panel, PanelBody, PanelHeader } from '@kingpost/ui';
import { log } from '../../state/log';
import { useViewer } from '../../state/viewer';

/**
 * Measurement bench for the Phase 1 performance spike: loads an IFC file through the
 * plain web-ifc path and reports timings. Not a product feature.
 */
export function LabPanel() {
  const handle = useViewer((s) => s.handle);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [stats, setStats] = useState<IfcLoadStats | null>(null);
  const [heapMb, setHeapMb] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !handle) return;
    setBusy(true);
    setError(null);
    setStats(null);
    setFileName(file.name);
    log.info(`Loading ${file.name} (${formatBytes(file.size)})…`);
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const result = await loadIfcToGroup(data);
      handle.clear();
      handle.add(result.model.group);
      handle.fit();
      setStats(result.stats);
      setHeapMb(usedHeapMb());
      log.info(
        `${file.name}: ${result.stats.meshes} products, ${result.stats.triangles.toLocaleString()} triangles, ` +
          `${result.stats.materials} materials in ${result.stats.totalMs} ms`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      log.error(`IFC load failed: ${message}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <Panel>
      <PanelHeader title="Lab · IFC load bench" />
      <PanelBody className="space-y-3">
        <p className="text-xs text-fg-muted">
          Loads an IFC file with web-ifc and merges geometry by colour. Use it to measure real
          models before the fragment cache is designed.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".ifc"
          className="hidden"
          onChange={(e) => void onFile(e)}
        />
        <Button
          variant="primary"
          disabled={busy || !handle}
          onClick={() => inputRef.current?.click()}
        >
          <FileUp size={14} />
          {busy ? 'Loading…' : 'Load IFC file…'}
        </Button>

        {error && <p className="text-xs text-danger">{error}</p>}

        {stats && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-fg-muted">File</dt>
            <dd className="truncate">{fileName}</dd>
            <dt className="text-fg-muted">Schema</dt>
            <dd className="font-mono">{stats.schema}</dd>
            <dt className="text-fg-muted">Products</dt>
            <dd className="font-mono">{stats.meshes.toLocaleString()}</dd>
            <dt className="text-fg-muted">Triangles</dt>
            <dd className="font-mono">{stats.triangles.toLocaleString()}</dd>
            <dt className="text-fg-muted">Materials</dt>
            <dd className="font-mono">{stats.materials}</dd>
            <dt className="text-fg-muted">Runtime init</dt>
            <dd className="font-mono">{stats.initMs} ms</dd>
            <dt className="text-fg-muted">Parse</dt>
            <dd className="font-mono">{stats.parseMs} ms</dd>
            <dt className="text-fg-muted">Geometry</dt>
            <dd className="font-mono">{stats.geometryMs} ms</dd>
            <dt className="text-fg-muted">Total</dt>
            <dd className="font-mono font-semibold">{stats.totalMs} ms</dd>
            {heapMb !== null && (
              <>
                <dt className="text-fg-muted">JS heap</dt>
                <dd className="font-mono">{heapMb} MB</dd>
              </>
            )}
          </dl>
        )}
      </PanelBody>
    </Panel>
  );
}

function usedHeapMb(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / 1_048_576) : null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
