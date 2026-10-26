import type { SyncReport } from '../lib/ipc';

// The store pulls in the viewer (WebGL) and Tauri; neither exists under jsdom.
vi.mock('@kingpost/viewer', () => ({
  DEFAULT_SNAP: { vertex: true, midpoint: true, edge: true, face: true },
  AnalysisLayer: class {},
  IfcFrame: { identity: () => ({}) },
  Vector3: class {},
  createLineObject: vi.fn(),
  createMeasurementObject: vi.fn(),
  measure: vi.fn(),
  loadIfcToGroup: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const { describeSync } = await import('./sync');
const { ago } = await import('../lib/time');
const { shortPath } = await import('../lib/path');

function report(partial: Partial<SyncReport> = {}): SyncReport {
  return {
    sent: 0,
    files_sent: 0,
    applied: 0,
    skipped: 0,
    pending: 0,
    received_files: [],
    conflicts: [],
    peers: [],
    ...partial,
  };
}

describe('sync summary', () => {
  it('says when nothing moved', () => {
    expect(describeSync(report())).toBe('Synced: up to date.');
  });

  it('lists what was sent and received, and with whom', () => {
    const text = describeSync(
      report({
        sent: 3,
        files_sent: 1,
        applied: 1,
        pending: 2,
        received_files: [{ rel_path: 'a.ifc', kind: 'ifc', from_user: 'Sam' }],
        peers: [
          { device: 'd1', user: 'Sam', machine: 'SAM-PC', last_sync: '' },
          { device: 'd2', user: '', machine: '', last_sync: '' },
        ],
      }),
    );
    expect(text).toBe(
      'Synced with Sam, another computer: sent 3 changes, published 1 file, received 1 change, received 1 file, 2 changes waiting.',
    );
  });

  it('counts changes applied after imports', () => {
    expect(describeSync(report({ applied: 1 }), 4)).toBe('Synced: received 4 changes.');
  });
});

describe('ago', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  it('reads like a person would say it', () => {
    expect(ago(null, now)).toBe('never');
    expect(ago('nonsense', now)).toBe('unknown');
    expect(ago('2026-10-26T11:59:40Z', now)).toBe('just now');
    expect(ago('2026-10-26T11:55:00Z', now)).toBe('5 min ago');
    expect(ago('2026-10-26T09:00:00Z', now)).toBe('3 h ago');
  });
});

describe('shortPath', () => {
  it('keeps short paths whole', () => {
    expect(shortPath(String.raw`D:\Share`)).toBe(String.raw`D:\Share`);
  });
  it('keeps the root and the last folders of long ones', () => {
    expect(shortPath(String.raw`C:\Users\ann\OneDrive - Firm\Projects\Shared`)).toBe(
      String.raw`C:\…\Projects\Shared`,
    );
    expect(shortPath(String.raw`\\fileserver\engineering\2026\bridge-7\sync`)).toBe(
      String.raw`\\fileserver\…\bridge-7\sync`,
    );
    expect(shortPath('/home/ann/Dropbox/Clients/Harbour/Structural/sync')).toBe(
      '/home/…/Structural/sync',
    );
  });
});
