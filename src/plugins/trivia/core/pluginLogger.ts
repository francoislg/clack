/**
 * Module-level plugin logger. Initialized once by `triviaPlugin()` with the
 * SDK's `logger`, then consumed by other plugin modules that don't have direct
 * SDK access (pure utility functions, action handlers, etc.).
 *
 * Per the plugin hard rules (see src/plugins/CLAUDE.md), plugin code must use
 * the SDK's logger rather than importing `src/logger.ts` directly. This module
 * is the indirection layer that lets utility code log without each function
 * taking an SDK parameter.
 */

import type { PluginLogger } from "../../../plugins-sdk/sdk.js";

const noopLogger: PluginLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

let current: PluginLogger = noopLogger;

/**
 * Wire the plugin logger. Call once at plugin init (before any other module
 * logs). Until called, all log calls go to a no-op sink — safe in tests that
 * don't init the plugin.
 */
export function setTriviaLogger(logger: PluginLogger): void {
  current = logger;
}

/** Reset to the no-op sink. Test-only. */
export function _resetTriviaLogger(): void {
  current = noopLogger;
}

/**
 * The current plugin logger. Use exactly like `sdk.logger` (e.g. `triviaLogger.warn(...)`).
 * Lines emitted here are prefixed with `[trivia]` by the SDK wrapper.
 */
export const triviaLogger: PluginLogger = {
  debug: (...args) => current.debug(...args),
  info: (...args) => current.info(...args),
  warn: (...args) => current.warn(...args),
  error: (...args) => current.error(...args),
};
