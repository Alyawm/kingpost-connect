import { create } from 'zustand';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  time: Date;
  level: LogLevel;
  message: string;
}

interface LogState {
  entries: LogEntry[];
  push(level: LogLevel, message: string): void;
  clear(): void;
}

const MAX_ENTRIES = 500;
let nextId = 1;

/** The Output panel's backing store. Oldest entries are dropped past MAX_ENTRIES. */
export const useLog = create<LogState>((set) => ({
  entries: [],
  push: (level, message) =>
    set((s) => ({
      entries: [...s.entries, { id: nextId++, time: new Date(), level, message }].slice(
        -MAX_ENTRIES,
      ),
    })),
  clear: () => set({ entries: [] }),
}));

export const log = {
  info: (message: string) => useLog.getState().push('info', message),
  warn: (message: string) => useLog.getState().push('warn', message),
  error: (message: string) => useLog.getState().push('error', message),
};
