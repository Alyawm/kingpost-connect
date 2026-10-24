import { create } from 'zustand';
import { logAppend } from '../lib/ipc';

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

// Entries are also written to the open project's log file, a few at a time.
let queue: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function enqueue(level: LogLevel, message: string): void {
  queue.push(`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      const lines = queue;
      queue = [];
      flushTimer = null;
      void logAppend(lines).catch(() => undefined);
    }, 500);
  }
}

export const log = {
  info: (message: string) => {
    useLog.getState().push('info', message);
    enqueue('info', message);
  },
  warn: (message: string) => {
    useLog.getState().push('warn', message);
    enqueue('warn', message);
  },
  error: (message: string) => {
    useLog.getState().push('error', message);
    enqueue('error', message);
  },
};
