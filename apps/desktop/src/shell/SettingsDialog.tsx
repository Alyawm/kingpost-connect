import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton, cn } from '@kingpost/ui';
import { t } from '../lib/i18n';
import { LENGTH_UNITS, type LengthUnit, type Units } from '../lib/units';
import { diagnosticsBundle, geometryCacheClear, isTauri } from '../lib/ipc';
import { licenceSummary, useLicence } from '../state/licence';
import { log } from '../state/log';
import { useProject } from '../state/project';
import { useUi } from '../state/ui';
import { useUpdates } from '../state/updates';

const field = 'h-7 w-full rounded border border-edge bg-canvas px-2 text-xs';
const label = 'text-[11px] font-semibold text-fg-muted';
const hint = 'text-[10px] text-fg-muted';

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  const close = () => useUi.getState().setSettingsOpen(false);
  const author = useUi((s) => s.author);
  const setAuthor = useUi((s) => s.setAuthor);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const units = useUi((s) => s.units);
  const setUnits = useUi((s) => s.setUnits);
  const checkAtStartup = useUi((s) => s.checkUpdatesAtStartup);
  const setCheckAtStartup = useUi((s) => s.setCheckUpdatesAtStartup);
  const updates = useUpdates((s) => s.state);
  const check = useUpdates((s) => s.check);
  const install = useUpdates((s) => s.install);
  const licence = useLicence((s) => s.status);
  const installLicence = useLicence((s) => s.install);
  const removeLicence = useLicence((s) => s.remove);
  const project = useProject((s) => s.current);
  const [key, setKey] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const saveBundle = async () => {
    if (!isTauri() || !project) return;
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      title: t('settings.logs.bundle'),
      defaultPath: `kingpost-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (!path) return;
    try {
      const summary = await diagnosticsBundle(path);
      log.info(
        `Diagnostics bundle written: ${summary.files} file(s), ${summary.bytes} bytes at ${summary.path}`,
      );
    } catch (error) {
      log.error(`Could not write the bundle: ${String(error)}`);
    }
  };

  const clearCache = async () => {
    try {
      const removed = await geometryCacheClear();
      log.info(`Geometry cache cleared: ${removed} file(s) removed.`);
    } catch (error) {
      log.error(`Could not clear the cache: ${String(error)}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 pt-16"
      onClick={close}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kp-settings-title"
        className="w-[560px] max-w-[calc(100vw-2rem)] rounded-lg border border-edge bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-edge px-4 py-2">
          <h2 id="kp-settings-title" className="text-sm font-semibold">
            {t('settings.title')}
          </h2>
          <IconButton label={t('settings.close')} size="sm" onClick={close}>
            <X size={14} />
          </IconButton>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-auto px-4 py-3 text-xs">
          <section className="space-y-1">
            <label className={label} htmlFor="kp-author">
              {t('settings.author')}
            </label>
            <input
              id="kp-author"
              className={field}
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
            <p className={hint}>{t('settings.author.hint')}</p>
          </section>

          <section className="space-y-1">
            <div className={label}>{t('settings.theme')}</div>
            <div className="flex gap-1">
              {(['dark', 'light'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    'rounded border px-2 py-0.5',
                    theme === value ? 'border-accent text-fg' : 'border-edge text-fg-muted',
                  )}
                  onClick={() => setTheme(value)}
                >
                  {t(`settings.theme.${value}`)}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-1">
            <div className={label}>Units</div>
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-xs">
              <span className="text-fg-muted">Length</span>
              <select
                className="h-7 rounded border border-edge bg-canvas px-1"
                value={units.length}
                onChange={(e) => setUnits({ length: e.target.value as LengthUnit })}
              >
                {LENGTH_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
              <span className="text-fg-muted">Decimals</span>
              <select
                className="h-7 rounded border border-edge bg-canvas px-1"
                value={units.decimals}
                disabled={units.length === 'auto' || units.length === 'ft-in'}
                onChange={(e) => setUnits({ decimals: Number(e.target.value) })}
              >
                {[0, 1, 2, 3, 4].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <span className="text-fg-muted">Area</span>
              <select
                className="h-7 rounded border border-edge bg-canvas px-1"
                value={units.area}
                onChange={(e) => setUnits({ area: e.target.value as Units['area'] })}
              >
                <option value="m2">Square metres</option>
                <option value="ft2">Square feet</option>
              </select>
              <span className="text-fg-muted">Volume</span>
              <select
                className="h-7 rounded border border-edge bg-canvas px-1"
                value={units.volume}
                onChange={(e) => setUnits({ volume: e.target.value as Units['volume'] })}
              >
                <option value="m3">Cubic metres</option>
                <option value="ft3">Cubic feet</option>
              </select>
              <span className="text-fg-muted">Angle</span>
              <select
                className="h-7 rounded border border-edge bg-canvas px-1"
                value={units.angle}
                onChange={(e) => setUnits({ angle: e.target.value as Units['angle'] })}
              >
                <option value="deg">Degrees</option>
                <option value="rad">Radians</option>
              </select>
            </div>
            <p className={hint}>Used for measurements, selection sizes and section positions.</p>
          </section>

          <section className="space-y-1">
            <div className={label}>{t('settings.updates')}</div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={checkAtStartup}
                onChange={(e) => setCheckAtStartup(e.target.checked)}
              />
              {t('settings.updates.startup')}
            </label>
            <p className={hint}>{t('settings.updates.privacy')}</p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={updates.phase === 'checking' || updates.phase === 'downloading'}
                onClick={() => void check()}
              >
                {t('settings.updates.check')}
              </Button>
              <span className={hint}>
                {updates.phase === 'checking' && t('updates.checking')}
                {updates.phase === 'none' && `${t('updates.none')} (${updates.current})`}
                {updates.phase === 'available' &&
                  t('updates.available', { version: updates.version })}
                {updates.phase === 'downloading' &&
                  `${t('updates.downloading')} ${updates.total ? `${Math.round((100 * updates.received) / updates.total)}%` : ''}`}
                {updates.phase === 'error' && `${t('updates.error')}: ${updates.message}`}
              </span>
              {updates.phase === 'available' && (
                <Button variant="primary" size="sm" onClick={() => void install()}>
                  {t('updates.install')}
                </Button>
              )}
            </div>
          </section>

          <section className="space-y-1">
            <div className={label}>{t('settings.licence')}</div>
            <p className={hint}>{licenceSummary(licence)}</p>
            {licence?.state === 'valid' && (
              <p className={hint}>
                {licence.licence.organisation && `${licence.licence.organisation} · `}
                {licence.licence.edition} · {licence.licence.seats} seat(s) · ref{' '}
                {licence.licence.reference || '—'}
              </p>
            )}
            <div className="flex gap-1">
              <input
                className={field}
                value={key}
                placeholder={t('settings.licence.placeholder')}
                aria-label={t('settings.licence')}
                onChange={(e) => setKey(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!key.trim()}
                onClick={() => {
                  void installLicence(key.trim()).then((ok) => ok && setKey(''));
                }}
              >
                {t('settings.licence.install')}
              </Button>
              {licence && licence.state !== 'evaluation' && (
                <Button size="sm" variant="ghost" onClick={() => void removeLicence()}>
                  {t('settings.licence.remove')}
                </Button>
              )}
            </div>
          </section>

          <section className="space-y-1">
            <div className={label}>{t('settings.cache')}</div>
            <p className={hint}>{t('settings.cache.hint')}</p>
            <Button size="sm" disabled={!project} onClick={() => void clearCache()}>
              {t('settings.cache.clear')}
            </Button>
          </section>

          <section className="space-y-1">
            <div className={label}>{t('settings.logs')}</div>
            <p className={hint}>{t('settings.logs.hint')}</p>
            <Button size="sm" disabled={!project} onClick={() => void saveBundle()}>
              {t('settings.logs.bundle')}
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}
