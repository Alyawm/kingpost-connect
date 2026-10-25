import { Vector3, type PointPick } from '@kingpost/viewer';

// Labels draw on a canvas, which jsdom lacks; they are not under test.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

// The real viewer module (three.js maths and overlay objects) works under jsdom; only the
// Tauri bridge is replaced.
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const { useMeasure } = await import('./measure');
const { useViewer } = await import('./viewer');

const added: unknown[] = [];
const removed: unknown[] = [];
useViewer.setState({
  handle: {
    addOverlay: (o: unknown) => added.push(o),
    removeOverlay: (o: unknown) => removed.push(o),
    setPreview: vi.fn(),
    setSnapOptions: vi.fn(),
    contentBounds: () => ({ getSize: (v: Vector3) => v.set(10, 10, 10) }),
  } as never,
});

const at = (x: number, y: number, z: number, extra: Partial<PointPick> = {}): PointPick => ({
  point: new Vector3(x, y, z),
  ...extra,
});

describe('measuring', () => {
  beforeEach(() => {
    useMeasure.getState().clear();
    useMeasure.setState({ mode: 'distance', ortho: false });
  });

  it('measures a distance from two clicks', () => {
    const m = useMeasure.getState();
    m.pick(at(0, 0, 0));
    expect(useMeasure.getState().points).toHaveLength(1);
    m.pick(at(3, 4, 0));
    const [record] = useMeasure.getState().records;
    expect(record?.value).toBe(5);
    expect(record?.text).toBe('5.000 m');
    expect(useMeasure.getState().points).toHaveLength(0);
  });

  it('keeps the distance along one axis in ortho mode', () => {
    useMeasure.setState({ ortho: true });
    useMeasure.getState().pick(at(0, 0, 0));
    useMeasure.getState().pick(at(4, 1, 0.5));
    expect(useMeasure.getState().records[0]?.value).toBe(4);
  });

  it('measures an angle from three clicks', () => {
    useMeasure.getState().setMode('angle');
    useMeasure.getState().pick(at(1, 0, 0));
    useMeasure.getState().pick(at(0, 0, 0));
    useMeasure.getState().pick(at(0, 0, 1));
    expect(useMeasure.getState().records[0]?.text).toBe('90.0°');
  });

  it('measures square to a face and needs a face first', () => {
    useMeasure.getState().setMode('perpendicular');
    useMeasure.getState().pick(at(0, 0, 0)); // no normal: ignored
    expect(useMeasure.getState().points).toHaveLength(0);
    useMeasure.getState().pick(at(0, 2, 0, { normal: new Vector3(0, 1, 0) }));
    useMeasure.getState().pick(at(5, 7, 1));
    expect(useMeasure.getState().records[0]?.value).toBe(5);
  });

  it('measures an edge in one click and reports a point', () => {
    useMeasure.getState().setMode('edge');
    useMeasure.getState().pick(at(0, 0, 0)); // not on an edge: ignored
    expect(useMeasure.getState().records).toHaveLength(0);
    useMeasure
      .getState()
      .pick(at(1, 0, 0, { snap: 'edge', edge: [new Vector3(0, 0, 0), new Vector3(0, 0, 6)] }));
    expect(useMeasure.getState().records[0]?.value).toBe(6);

    useMeasure.getState().setMode('point');
    useMeasure.getState().pick(at(1, 2, 3));
    expect(useMeasure.getState().records[1]?.text).toContain('X 1.000');
  });

  it('deletes one measurement or all of them', () => {
    const m = useMeasure.getState();
    m.pick(at(0, 0, 0));
    m.pick(at(1, 0, 0));
    m.pick(at(0, 0, 0));
    m.pick(at(2, 0, 0));
    const [first] = useMeasure.getState().records;
    useMeasure.getState().remove(first!.id);
    expect(useMeasure.getState().records.map((r) => r.value)).toEqual([2]);
    const before = removed.length;
    useMeasure.getState().clear();
    expect(useMeasure.getState().records).toHaveLength(0);
    expect(removed.length).toBe(before + 1);
  });
});
