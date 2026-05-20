import localforage from "localforage";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
}

const MAX_ENTRIES = 5000;
const STORE_KEY = "remote-sync-logs";
let entries: LogEntry[] = [];
let intercepting = false;

const originalConsole: Partial<typeof console> = {};

function capture(level: LogLevel, args: unknown[]) {
  const message = args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? a.message;
      if (typeof a === "object") {
        try {
          return JSON.stringify(a, null, 2);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(" ");
  entries.push({ timestamp: Date.now(), level, message });
  if (entries.length > MAX_ENTRIES)
    entries.splice(0, entries.length - MAX_ENTRIES);
}

export function startLogInterception() {
  if (intercepting) return;
  intercepting = true;
  for (const level of ["debug", "info", "warn", "error"] as LogLevel[]) {
    originalConsole[level] = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      capture(level, args);
      originalConsole[level]!(...args);
    };
  }
}

export function stopLogInterception() {
  if (!intercepting) return;
  intercepting = false;
  for (const level of ["debug", "info", "warn", "error"] as LogLevel[]) {
    if (originalConsole[level]) {
      console[level] = originalConsole[level]!;
    }
  }
}

export function getLogs(filterLevel?: LogLevel): LogEntry[] {
  if (filterLevel) return entries.filter((e) => e.level === filterLevel);
  return [...entries];
}

export function getLogsAsText(filterLevel?: LogLevel): string {
  const filtered = filterLevel
    ? entries.filter((e) => e.level === filterLevel)
    : entries;
  return filtered
    .map((e) => {
      const d = new Date(e.timestamp).toISOString();
      return `[${d}] [${e.level.toUpperCase()}] ${e.message}`;
    })
    .join("\n");
}

export async function clearLogs() {
  entries = [];
  await persistLogs();
}

// ── Persistence via localforage (IndexedDB) ──

export async function persistLogs(): Promise<void> {
  try {
    const toStore = entries.slice(-1000); // keep last 1000 in storage
    await localforage.setItem(STORE_KEY, toStore);
  } catch {
    // storage full or unavailable, silently ignore
  }
}

export async function loadLogs(): Promise<void> {
  try {
    const stored = await localforage.getItem<LogEntry[]>(STORE_KEY);
    if (stored && Array.isArray(stored)) {
      // Merge stored entries with current, avoiding duplicates by timestamp
      const existingTimestamps = new Set(entries.map((e) => e.timestamp));
      for (const entry of stored) {
        if (!existingTimestamps.has(entry.timestamp)) {
          entries.push(entry);
        }
      }
      // Sort by timestamp
      entries.sort((a, b) => a.timestamp - b.timestamp);
      // Trim to max
      if (entries.length > MAX_ENTRIES)
        entries.splice(0, entries.length - MAX_ENTRIES);
    }
  } catch {
    // ignore parse errors
  }
}

// Persist periodically
setInterval(() => {
  if (intercepting && entries.length > 0) {
    persistLogs();
  }
}, 30000);
