export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
}

const MAX_ENTRIES = 2000;
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

export function clearLogs() {
  entries = [];
}
