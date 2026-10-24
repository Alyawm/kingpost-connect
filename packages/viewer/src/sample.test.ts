import { createSampleFrame } from './sample';

describe('createSampleFrame', () => {
  it('builds the expected number of tagged members', () => {
    const group = createSampleFrame();
    const byType = new Map<string, number>();
    group.traverse((object) => {
      const type = (object.userData as { type?: string }).type;
      if (type) byType.set(type, (byType.get(type) ?? 0) + 1);
    });
    expect(byType.get('IfcColumn')).toBe(9);
    expect(byType.get('IfcFooting')).toBe(9);
    expect(byType.get('IfcBeam')).toBe(6);
    expect(byType.get('IfcMember')).toBe(8);
  });
});
