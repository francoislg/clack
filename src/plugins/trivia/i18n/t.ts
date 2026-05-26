/**
 * Module-level plugin translator. Initialized once by `triviaPlugin()` with the
 * SDK's `t`, then consumed by other plugin modules (utility renderers, action
 * handlers) that don't have direct SDK access.
 *
 * Mirrors `core/pluginLogger.ts`: until `setTriviaT` is called, lookups resolve
 * against the EN table directly so tests that bypass the plugin init still get
 * predictable English strings.
 */

import { en } from "./strings.js";

type TVars = Record<string, string | number>;
type TFn = (key: string, vars?: TVars) => string;

function interpolate(template: string, vars: TVars): string {
  let out = template;
  for (const [name, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${name}}`, String(value));
  }
  return out;
}

const fallbackT: TFn = (key, vars) => {
  if (!(key in en)) {
    throw new Error(`[trivia] fallback t() missing EN key "${key}"`);
  }
  const template = en[key as keyof typeof en];
  return vars ? interpolate(template, vars) : template;
};

let current: TFn = fallbackT;

/** Wire the SDK's `t` for the trivia plugin. Call at plugin init. */
export function setTriviaT(fn: TFn): void {
  current = fn;
}

/** Reset to the EN-fallback resolver. Test-only. */
export function _resetTriviaT(): void {
  current = fallbackT;
}

/**
 * Look up `key` against the active workspace language. Pass `vars` to interpolate
 * `{name}` placeholders. Identical contract to `sdk.t(...)`.
 */
export function t(key: keyof typeof en, vars?: TVars): string {
  return current(key, vars);
}
