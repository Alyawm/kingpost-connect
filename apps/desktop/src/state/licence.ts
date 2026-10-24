import { create } from 'zustand';
import { licenceInstall, licenceRemove, licenceStatus, type LicenceStatus } from '../lib/ipc';
import { log } from './log';

interface LicenceState {
  status: LicenceStatus | null;
  refresh(): Promise<void>;
  install(key: string): Promise<boolean>;
  remove(): Promise<void>;
}

export const useLicence = create<LicenceState>((set) => ({
  status: null,

  refresh: async () => {
    try {
      set({ status: await licenceStatus() });
    } catch (error) {
      log.error(`Could not read the licence: ${String(error)}`);
    }
  },

  install: async (key) => {
    try {
      const status = await licenceInstall(key);
      set({ status });
      if (status.state === 'valid') log.info(`Licence installed for ${status.licence.name}.`);
      return status.state === 'valid';
    } catch (error) {
      log.error(`Licence not accepted: ${String(error)}`);
      return false;
    }
  },

  remove: async () => {
    try {
      set({ status: await licenceRemove() });
      log.info('Licence removed; running as an evaluation copy.');
    } catch (error) {
      log.error(`Could not remove the licence: ${String(error)}`);
    }
  },
}));

/** One line for the status bar. */
export function licenceSummary(status: LicenceStatus | null): string {
  if (!status) return '';
  switch (status.state) {
    case 'evaluation':
      return 'Evaluation copy';
    case 'valid':
      return status.days_left === null
        ? `Licensed to ${status.licence.name}`
        : `Licensed to ${status.licence.name} · ${status.days_left} day(s) left`;
    case 'expired':
      return `Licence expired (${status.licence.expires})`;
    case 'invalid':
      return `Licence problem: ${status.reason}`;
  }
}
