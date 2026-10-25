/**
 * Display units for measurements and sizes. Values are always kept in metres, square
 * metres, cubic metres and degrees; these functions only format them.
 */
export type LengthUnit = 'auto' | 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'ft-in';
export type AreaUnit = 'm2' | 'ft2';
export type VolumeUnit = 'm3' | 'ft3';
export type AngleUnit = 'deg' | 'rad';

export interface Units {
  length: LengthUnit;
  /** Decimal places for lengths in the chosen unit (ignored by feet-inches). */
  decimals: number;
  area: AreaUnit;
  volume: VolumeUnit;
  angle: AngleUnit;
}

export const DEFAULT_UNITS: Units = {
  length: 'auto',
  decimals: 3,
  area: 'm2',
  volume: 'm3',
  angle: 'deg',
};

export const LENGTH_UNITS: { value: LengthUnit; label: string }[] = [
  { value: 'auto', label: 'Automatic (mm below 1 m, else m)' },
  { value: 'mm', label: 'Millimetres' },
  { value: 'cm', label: 'Centimetres' },
  { value: 'm', label: 'Metres' },
  { value: 'in', label: 'Inches' },
  { value: 'ft', label: 'Feet (decimal)' },
  { value: 'ft-in', label: 'Feet and inches' },
];

const FACTOR: Record<Exclude<LengthUnit, 'auto' | 'ft-in'>, [number, string]> = {
  mm: [1000, 'mm'],
  cm: [100, 'cm'],
  m: [1, 'm'],
  in: [1 / 0.0254, 'in'],
  ft: [1 / 0.3048, 'ft'],
};

/** Feet, inches and sixteenths: 12' 3 5/8". */
function feetInches(metres: number): string {
  const sign = metres < 0 ? '-' : '';
  let sixteenths = Math.round((Math.abs(metres) / 0.0254) * 16);
  const feet = Math.floor(sixteenths / (12 * 16));
  sixteenths -= feet * 12 * 16;
  const inches = Math.floor(sixteenths / 16);
  let fraction = sixteenths - inches * 16;
  let denominator = 16;
  while (fraction > 0 && fraction % 2 === 0) {
    fraction /= 2;
    denominator /= 2;
  }
  const frac = fraction ? ` ${fraction}/${denominator}` : '';
  return `${sign}${feet}' ${inches}${frac}"`;
}

export function formatLength(metres: number, units: Units = DEFAULT_UNITS): string {
  const d = Math.max(0, Math.min(6, units.decimals));
  switch (units.length) {
    case 'auto':
      return Math.abs(metres) < 1
        ? `${Math.round(metres * 1000)} mm`
        : `${metres.toFixed(Math.abs(metres) < 10 ? 3 : 2)} m`;
    case 'ft-in':
      return feetInches(metres);
    default: {
      const [factor, symbol] = FACTOR[units.length];
      return `${(metres * factor).toFixed(d)} ${symbol}`;
    }
  }
}

/** A length as a bare number in the chosen unit (for compact lists such as ΔX ΔY ΔZ). */
export function lengthNumber(metres: number, units: Units = DEFAULT_UNITS): string {
  if (units.length === 'ft-in') return feetInches(metres);
  if (units.length === 'auto') return metres.toFixed(3);
  const [factor] = FACTOR[units.length];
  return (metres * factor).toFixed(Math.max(0, Math.min(6, units.decimals)));
}

/** Symbol of the unit `lengthNumber` uses. */
export function lengthSymbol(units: Units = DEFAULT_UNITS): string {
  if (units.length === 'auto') return 'm';
  if (units.length === 'ft-in') return '';
  return FACTOR[units.length][1];
}

export function formatArea(m2: number, units: Units = DEFAULT_UNITS): string {
  return units.area === 'ft2' ? `${(m2 / 0.09290304).toFixed(2)} ft²` : `${m2.toFixed(3)} m²`;
}

export function formatVolume(m3: number, units: Units = DEFAULT_UNITS): string {
  return units.volume === 'ft3' ? `${(m3 / 0.028316846592).toFixed(2)} ft³` : `${m3.toFixed(3)} m³`;
}

export function formatAngle(degrees: number, units: Units = DEFAULT_UNITS): string {
  return units.angle === 'rad'
    ? `${((degrees * Math.PI) / 180).toFixed(4)} rad`
    : `${degrees.toFixed(1)}°`;
}
