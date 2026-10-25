import {
  DEFAULT_UNITS,
  formatAngle,
  formatArea,
  formatLength,
  formatVolume,
  lengthNumber,
} from './units';

const u = (patch: Partial<typeof DEFAULT_UNITS>) => ({ ...DEFAULT_UNITS, ...patch });

describe('units', () => {
  it('keeps the automatic metric format by default', () => {
    expect(formatLength(0.45)).toBe('450 mm');
    expect(formatLength(4.25)).toBe('4.250 m');
    expect(formatLength(12.345)).toBe('12.35 m');
  });

  it('formats metric and imperial lengths with the chosen decimals', () => {
    expect(formatLength(1.2345, u({ length: 'mm', decimals: 0 }))).toBe('1235 mm');
    expect(formatLength(1.2345, u({ length: 'm', decimals: 2 }))).toBe('1.23 m');
    expect(formatLength(0.3048, u({ length: 'ft', decimals: 2 }))).toBe('1.00 ft');
    expect(formatLength(0.0254 * 7.5, u({ length: 'in', decimals: 1 }))).toBe('7.5 in');
  });

  it('writes feet, inches and reduced sixteenths', () => {
    const ftIn = u({ length: 'ft-in' });
    expect(formatLength(0.3048 * 12 + 0.0254 * 3.625, ftIn)).toBe(`12' 3 5/8"`);
    expect(formatLength(0.3048, ftIn)).toBe(`1' 0"`);
    expect(formatLength(0.0254 * 0.5, ftIn)).toBe(`0' 0 1/2"`);
    expect(lengthNumber(0.3048 * 2, ftIn)).toBe(`2' 0"`);
  });

  it('formats areas, volumes and angles', () => {
    expect(formatArea(1)).toBe('1.000 m²');
    expect(formatArea(0.09290304, u({ area: 'ft2' }))).toBe('1.00 ft²');
    expect(formatVolume(0.028316846592, u({ volume: 'ft3' }))).toBe('1.00 ft³');
    expect(formatAngle(90)).toBe('90.0°');
    expect(formatAngle(180, u({ angle: 'rad' }))).toBe('3.1416 rad');
  });
});
