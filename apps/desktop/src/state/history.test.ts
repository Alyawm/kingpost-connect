export {};

// The stores pull in the viewer (WebGL) and Tauri; neither exists under jsdom.
vi.mock('@kingpost/viewer', () => ({
  DEFAULT_SNAP: { vertex: true, midpoint: true, edge: true, face: true },
  Vector3: class {},
  createLineObject: vi.fn(),
  createMeasurementObject: vi.fn(),
  measure: vi.fn(),
  loadIfcToGroup: vi.fn(),
  planeOffset: vi.fn(),
  snapToAxis: vi.fn(),
  withOffset: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const { useModel } = await import('./model');
const { useAppearance } = await import('./appearance');
const { useHistory } = await import('./history');

/** A stand-in for the viewer model: the stores only call these. */
const fakeModel = {
  setHidden: vi.fn(),
  setAppearance: vi.fn(),
  isolate: vi.fn(),
  showAll: vi.fn(),
  hiddenIds: new Set<number>(),
  setEdgesVisible: vi.fn(async () => undefined),
  edgesShown: false,
};

describe('undo and redo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
    useModel.setState({ model: fakeModel as never, hidden: new Set() });
    useAppearance.setState({ looks: new Map() });
    useHistory.getState().clear();
  });
  afterEach(() => vi.useRealTimers());

  it('undoes and redoes hiding and colouring', () => {
    useModel.getState().hide([1, 2]);
    vi.advanceTimersByTime(1000);
    useAppearance.getState().setColor([3], '#ff0000');
    expect(useHistory.getState().past).toHaveLength(2);

    useHistory.getState().undo();
    expect(useAppearance.getState().looks.size).toBe(0);
    expect([...useModel.getState().hidden]).toEqual([1, 2]);

    useHistory.getState().undo();
    expect(useModel.getState().hidden.size).toBe(0);
    expect(useHistory.getState().future).toHaveLength(2);

    useHistory.getState().redo();
    expect([...useModel.getState().hidden]).toEqual([1, 2]);
    useHistory.getState().redo();
    expect(useAppearance.getState().looks.get(3)).toEqual({ color: '#ff0000' });
  });

  it('merges quick successive changes (a slider drag) into one step', () => {
    for (const opacity of [0.9, 0.7, 0.5, 0.3]) {
      useAppearance.getState().setOpacity([5], opacity);
      vi.advanceTimersByTime(50);
    }
    expect(useHistory.getState().past).toHaveLength(1);
    useHistory.getState().undo();
    expect(useAppearance.getState().looks.size).toBe(0);
  });

  it('starts over when another model is loaded', () => {
    useModel.getState().hide([9]);
    expect(useHistory.getState().past).toHaveLength(1);
    useModel.setState({ model: { ...fakeModel } as never });
    expect(useHistory.getState().past).toHaveLength(0);
  });
});
