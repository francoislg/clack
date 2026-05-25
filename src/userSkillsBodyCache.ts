import { readUserSkill, getSkillMtimeMs } from "./userSkills.js";

/**
 * Process-level mtime-keyed cache for user-skill bodies. `load_skill({ pack: "user-skills" })`
 * consults this cache: on every call, the current on-disk mtime is compared against the cached
 * entry and re-read on mismatch. That gives us hot-reload of edited bodies without restarting
 * Clack, with a single `stat` per call as the only per-hit cost.
 *
 * Disabled skills (those with `disabledAt` in `.meta.json`) are returned as `{ ok: false,
 * reason: "not_found" }` so callers can surface "unknown skill" to Claude — disabled is
 * indistinguishable from non-existent at the lookup layer.
 *
 * The cache is process-level (not session-scoped) because user-skill bodies are pure data
 * keyed by `(slug, mtime)` — there's nothing session-specific to track.
 */

interface CacheEntry {
  mtimeMs: number;
  body: string;
}

const cache: Map<string, CacheEntry> = new Map();

export type GetUserSkillBodyResult =
  | { ok: true; body: string; fromCache: boolean }
  | { ok: false; reason: "not_found" };

export function getUserSkillBody(slug: string): GetUserSkillBodyResult {
  const skill = readUserSkill(slug);
  if (!skill) {
    cache.delete(slug);
    return { ok: false, reason: "not_found" };
  }
  if (skill.disabledAt) {
    cache.delete(slug);
    return { ok: false, reason: "not_found" };
  }

  const mtime = getSkillMtimeMs(slug);
  if (mtime === null) {
    cache.delete(slug);
    return { ok: false, reason: "not_found" };
  }

  const cached = cache.get(slug);
  if (cached && cached.mtimeMs === mtime) {
    return { ok: true, body: cached.body, fromCache: true };
  }

  cache.set(slug, { mtimeMs: mtime, body: skill.body });
  return { ok: true, body: skill.body, fromCache: false };
}

export function clearUserSkillBodyCache(slug?: string): void {
  if (slug === undefined) {
    cache.clear();
    return;
  }
  cache.delete(slug);
}

/** Test-only inspection helper. */
export function _cacheSize(): number {
  return cache.size;
}
