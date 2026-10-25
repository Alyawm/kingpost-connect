export {};

// The stores pull in the viewer (WebGL) and Tauri; neither exists under jsdom.
vi.mock('@kingpost/viewer', () => ({
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

const { columnLetter, remapFormula } = await import('./schedules');
const { planeLabel, planesFromStored } = await import('./view');

describe('schedule formulas', () => {
  it('names columns like a spreadsheet', () => {
    expect([0, 1, 25, 26, 27].map(columnLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
  });

  it('keeps letter references on their columns when columns move', () => {
    // Columns A B C D; C moved to the front: new order is C A B D.
    const order = [2, 0, 1, 3];
    expect(remapFormula('C / B', order)).toBe('A / C');
    expect(remapFormula('[Mass] / b + D', order)).toBe('[Mass] / C + D');
    expect(remapFormula('2 * (A + 1.5)', order)).toBe('2 * (B + 1.5)');
  });
});

describe('section planes from storage', () => {
  it('reads the current list form', () => {
    const planes = [{ id: 'a', point: [0, 1, 0], normal: [0, 1, 0], enabled: true }];
    expect(planesFromStored(planes)).toEqual(planes);
    expect(planesFromStored([{ nonsense: true }])).toEqual([]);
  });

  it('converts the single section saved by earlier versions', () => {
    const [plane] = planesFromStored({ enabled: true, axis: 'y', position: 3.2, flip: false });
    expect(plane?.normal).toEqual([0, 1, 0]);
    expect(plane?.point[1]).toBe(3.2);
    const [flipped] = planesFromStored({ enabled: true, axis: 'x', position: -1, flip: true });
    expect(flipped?.normal).toEqual([-1, 0, 0]);
    expect(planesFromStored({ enabled: false, axis: 'y', position: 0, flip: false })).toEqual([]);
    expect(planesFromStored(null)).toEqual([]);
  });

  it('labels planes by direction', () => {
    const at = (normal: [number, number, number]) => ({
      id: 'p',
      point: [0, 0, 0] as [number, number, number],
      normal,
      enabled: true,
    });
    expect(planeLabel(at([0, -1, 0]))).toBe('Horizontal');
    expect(planeLabel(at([1, 0, 0]))).toBe('Vertical X');
    expect(planeLabel(at([0.6, 0, 0.8]))).toBe('Vertical');
    expect(planeLabel(at([0.5, 0.5, 0.7]))).toBe('Angled');
  });
});
