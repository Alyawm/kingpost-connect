export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

export function formatCount(value: number): string {
  return value.toLocaleString();
}

/** Seconds since the epoch (as the shell reports file times) to a short local string. */
export function formatEpochSeconds(seconds: string | null): string {
  if (!seconds) return '';
  const date = new Date(Number(seconds) * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

export function formatIsoDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Numbers with a sensible number of decimals for display next to a unit. */
export function formatQuantity(value: number): string {
  const magnitude = Math.abs(value);
  const decimals = magnitude >= 1000 ? 0 : magnitude >= 10 ? 1 : magnitude >= 1 ? 2 : 3;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}
