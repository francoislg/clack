type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

function shouldLog(level: LogLevel): boolean {
  const logLevel = (process.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;
  return LEVELS[level] >= (LEVELS[logLevel] ?? 1);
}

function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  debug: (...args: unknown[]) => shouldLog("debug") && console.log("[DEBUG]", ...args),
  info: (...args: unknown[]) => shouldLog("info") && console.log("[INFO]", ...args),
  warn: (...args: unknown[]) => shouldLog("warn") && console.warn("[WARN]", ...args),
  error: (...args: unknown[]) => shouldLog("error") && console.error("[ERROR]", ...args),
  // For startup/shutdown messages with timestamps
  startup: (...args: unknown[]) => console.log(`[${timestamp()}]`, ...args),
};
