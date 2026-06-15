import { readWorkerSkillBody, getWorkerSkillMtimeMs } from "./workerSkills.js";

/**
 * Process-level mtime-keyed cache for worker-skill bodies, keyed by `(repoName, slug)`.
 * The worker `load_skill` tool consults this: each call compares the current on-disk mtime
 * of the resolved `SKILL.md` against the cached entry and re-reads on mismatch, so edits
 * (or a newly-written override) hot-reload within a run without a restart. One `stat` per hit.
 */

interface CacheEntry {
  mtimeMs: number;
  body: string;
}

const cache: Map<string, CacheEntry> = new Map();

const keyOf = (repoName: string, slug: string): string => `${repoName}\t${slug}`;

export type GetWorkerSkillBodyResult =
  | { ok: true; body: string; fromCache: boolean }
  | { ok: false };

export function getWorkerSkillBody(repoName: string, slug: string): GetWorkerSkillBodyResult {
  const key = keyOf(repoName, slug);
  const mtime = getWorkerSkillMtimeMs(repoName, slug);
  if (mtime === null) {
    cache.delete(key);
    return { ok: false };
  }

  const cached = cache.get(key);
  if (cached && cached.mtimeMs === mtime) {
    return { ok: true, body: cached.body, fromCache: true };
  }

  const result = readWorkerSkillBody(repoName, slug);
  if (!result.ok) {
    cache.delete(key);
    return { ok: false };
  }

  cache.set(key, { mtimeMs: mtime, body: result.body });
  return { ok: true, body: result.body, fromCache: false };
}

export function clearWorkerSkillBodyCache(): void {
  cache.clear();
}
