import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { getConfigurationDir } from "../config.js";
import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import { getGitInstance } from "../repositories.js";
import type { Worker } from "./types.js";
import { QUARANTINE_SIDECAR } from "./persistence.js";

// `quarantinedAt` stays an ISO string (no `Date` coercion) — readers expect a string.
const quarantineRecordZod = z.object({
  workerId: z.string(),
  repo: z.string(),
  branch: z.string().nullable(),
  dirtyFiles: z.array(z.string()),
  quarantinedAt: z.string(),
});

type QuarantineRecord = z.infer<typeof quarantineRecordZod>;

/**
 * Match a path against a glob-ish pattern. Supports `*` (any chars within a segment),
 * `**` (any depth), and `?` (single char). Lightweight to avoid a `minimatch` dep.
 */
function matchGlob(pattern: string, path: string): boolean {
  const re =
    "^" +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "::DOUBLESTAR::")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/::DOUBLESTAR::/g, ".*") +
    "$";
  return new RegExp(re).test(path);
}

/**
 * Read per-repo dirty-ignore globs from `data/configuration/<repo>/worktree_dirty_ignore.txt`.
 * Format: one glob per line, blank lines and `#`-prefixed comments ignored. Missing file → no extra ignores.
 */
export function readDirtyIgnoreGlobs(repoName: string): string[] {
  const path = resolve(getConfigurationDir(), repoName, "worktree_dirty_ignore.txt");
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, "utf-8").split("\n");
    return lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch (err) {
    logger.warn(`Failed to read ${path}: ${errorMessage(err)}`);
    return [];
  }
}

/**
 * Return the list of modified-tracked files in the worker, after applying
 * per-repo dirty-ignore globs. An empty list means the worker is clean.
 */
export async function getDirtyTrackedFiles(worker: Worker): Promise<string[]> {
  const git = getGitInstance(worker.worktreePath);
  let output: string;
  try {
    output = await git.raw(["diff", "--name-only", "HEAD"]);
  } catch (err) {
    logger.warn(`git diff failed in ${worker.worktreePath}: ${errorMessage(err)}`);
    return [];
  }
  const files = output
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (files.length === 0) return [];
  const globs = readDirtyIgnoreGlobs(worker.repo);
  if (globs.length === 0) return files;
  return files.filter((file) => !globs.some((g) => matchGlob(g, file)));
}

export function isQuarantined(worker: Worker): boolean {
  return existsSync(join(worker.worktreePath, QUARANTINE_SIDECAR));
}

export function writeQuarantineRecord(worker: Worker, dirtyFiles: string[]): void {
  if (!existsSync(worker.worktreePath)) return;
  const record: QuarantineRecord = {
    workerId: worker.id,
    repo: worker.repo,
    branch: worker.currentBranch,
    dirtyFiles,
    quarantinedAt: new Date().toISOString(),
  };
  const path = join(worker.worktreePath, QUARANTINE_SIDECAR);
  writeFileSync(path, JSON.stringify(record, null, 2), "utf-8");
}

export function clearQuarantineRecord(worker: Worker): void {
  const path = join(worker.worktreePath, QUARANTINE_SIDECAR);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch (err) {
      logger.warn(`Failed to remove quarantine sidecar at ${path}: ${errorMessage(err)}`);
    }
  }
}

export function readQuarantineRecord(worker: Worker): QuarantineRecord | null {
  const path = join(worker.worktreePath, QUARANTINE_SIDECAR);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const result = quarantineRecordZod.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
