/**
 * A long path shortened in the middle, keeping its root and its last folders, which are
 * the parts people recognise: `C:\Users\ann\OneDrive - Firm\Projects\Shared` becomes
 * `C:\…\Projects\Shared`.
 */
export function shortPath(path: string, max = 40, keep = 2): string {
  if (path.length <= max) return path;
  const unc = path.startsWith('\\\\') || path.startsWith('//');
  const sep = path.includes('\\') ? '\\' : '/';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= keep + 1) return path;
  const root = (unc ? sep + sep : path.startsWith(sep) ? sep : '') + parts[0];
  return [root, '…', ...parts.slice(-keep)].join(sep);
}

/** Plain http to anything but this computer travels unencrypted. */
export function unencrypted(url: string): boolean {
  const lower = url.trim().toLowerCase();
  if (!lower.startsWith('http://')) return false;
  const host = lower.slice(7).split(/[/:]/)[0] ?? '';
  return !(host === 'localhost' || host === '127.0.0.1' || host === '[::1]');
}
