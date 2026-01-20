type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[LOG_LEVEL];
}

function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  debug: (...args: unknown[]) =>
    shouldLog("debug") && console.log("[DEBUG]", ...args),
  info: (...args: unknown[]) =>
    shouldLog("info") && console.log("[INFO]", ...args),
  warn: (...args: unknown[]) =>
    shouldLog("warn") && console.warn("[WARN]", ...args),
  error: (...args: unknown[]) =>
    shouldLog("error") && console.error("[ERROR]", ...args),
  // For startup/shutdown messages with timestamps
  startup: (...args: unknown[]) => console.log(`[${timestamp()}]`, ...args),
};
