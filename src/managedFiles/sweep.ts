import { readdir, realpath, rmdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

import { getConfig, type ManagedRootName, type RetentionWindow } from "../config.js";
import { MANAGED_FILES_DEFAULT_RETENTION } from "../configSchemas.js";
import { errorMessage } from "../errors.js";
import { fileExists } from "../fs.js";
import { logger } from "../logger.js";
import { getSession } from "../sessions.js";
import { getByThread } from "../slack/activeRuns.js";
import { getActiveTesterRuns } from "../tester/concurrency.js";
import { entryKey, loadLedger, updateLedger, type FileLedgerEntry } from "./ledger.js";
import {
  getManagedRoots,
  ownerOf,
  resolveInRoot,
  SYSTEM_OWNER,
  type ManagedRoot,
} from "./roots.js";

export interface SweepDeps {
  roots: ManagedRoot[];
  retention: Record<ManagedRootName, RetentionWindow>;
  now: () => Date;
  isOwnerLive: (root: ManagedRoot, owner: string) => Promise<boolean>;
  /** Recursive, regular files only, absolute paths; `[]` when `dir` is missing. */
  listFiles: (dir: string) => Promise<string[]>;
  stat: (path: string) => Promise<{ mtime: Date }>;
  unlink: (path: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  /** Removes empty subfolders under `dir` (never `dir` itself). */
  removeEmptyDirs: (dir: string) => Promise<void>;
  realpath: (p: string) => Promise<string>;
  loadLedger: () => Promise<FileLedgerEntry[]>;
  updateLedger: (mutate: (e: FileLedgerEntry[]) => FileLedgerEntry[]) => Promise<void>;
  logger: { info: (msg: string) => void; warn: (msg: string) => void };
}

export interface SweepResult {
  deleted: string[];
  tagged: number;
  dropped: number;
}

const HOUR_MS = 60 * 60 * 1000;

/** Hours elapsed from `iso` to `now`, or null when `iso` is unparseable. */
function hoursSince(iso: string, now: Date): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / HOUR_MS;
}

/** Why an existing file's entry is expired, or null when it should be kept. */
function expiryReason(entry: FileLedgerEntry, window: RetentionWindow, now: Date): string | null {
  if (entry.uploadedAt !== undefined) {
    const age = hoursSince(entry.uploadedAt, now);
    if (age === null || age < window.keepUploadedHours) return null;
    return `uploaded, older than ${window.keepUploadedHours}h`;
  }
  const age = hoursSince(entry.createdAt, now);
  if (age === null || age < window.keepUnuploadedHours) return null;
  return `never uploaded, older than ${window.keepUnuploadedHours}h`;
}

async function discover(root: ManagedRoot, deps: SweepDeps): Promise<number> {
  const ledger = await deps.loadLedger();
  const known = new Set(ledger.map((e) => entryKey(e.root, e.path)));
  const additions: FileLedgerEntry[] = [];
  for (const file of await deps.listFiles(root.dir)) {
    const resolved = await resolveInRoot(root, file, { realpath: deps.realpath });
    if (!resolved.ok) {
      deps.logger.warn(`managed-files: skipping ${file}: ${resolved.error}`);
      continue;
    }
    const key = entryKey(root.name, resolved.relPath);
    if (known.has(key)) continue;
    let mtime: Date;
    try {
      ({ mtime } = await deps.stat(file));
    } catch (error) {
      deps.logger.warn(`managed-files: skipping ${file}: ${errorMessage(error)}`);
      continue;
    }
    additions.push({
      root: root.name,
      path: resolved.relPath,
      owner: ownerOf(root, resolved.relPath),
      createdAt: mtime.toISOString(),
    });
    known.add(key);
  }
  if (additions.length > 0) {
    await deps.updateLedger((entries) => [...entries, ...additions]);
  }
  return additions.length;
}

async function sweepRoot(root: ManagedRoot, deps: SweepDeps, result: SweepResult): Promise<void> {
  result.tagged += await discover(root, deps);

  const window = deps.retention[root.name];
  const now = deps.now();
  const liveCache = new Map<string, boolean>();
  const isLive = async (owner: string): Promise<boolean> => {
    const cached = liveCache.get(owner);
    if (cached !== undefined) return cached;
    const live = await deps.isOwnerLive(root, owner);
    liveCache.set(owner, live);
    return live;
  };

  const removals = new Set<string>();
  const entries = (await deps.loadLedger()).filter((e) => e.root === root.name);
  for (const entry of entries) {
    const absPath = join(root.dir, entry.path);
    if (!(await deps.exists(absPath))) {
      const age = hoursSince(entry.createdAt, now);
      if (age !== null && age >= window.keepUnuploadedHours) {
        removals.add(entryKey(entry.root, entry.path));
        result.dropped += 1;
      }
      continue;
    }

    const reason = expiryReason(entry, window, now);
    if (reason === null) continue;
    if (await isLive(entry.owner)) continue;

    const resolved = await resolveInRoot(root, absPath, { realpath: deps.realpath });
    if (!resolved.ok) {
      deps.logger.warn(
        `managed-files: refusing to unlink ${root.name}/${entry.path}: ${resolved.error}`,
      );
      continue;
    }
    try {
      await deps.unlink(resolved.realPath);
    } catch (error) {
      deps.logger.warn(
        `managed-files: failed to unlink ${root.name}/${entry.path}: ${errorMessage(error)}`,
      );
      continue;
    }
    deps.logger.info(`managed-files: deleted ${root.name}/${entry.path} (${reason})`);
    removals.add(entryKey(entry.root, entry.path));
    result.deleted.push(`${root.name}/${entry.path}`);
  }

  if (removals.size > 0) {
    await deps.updateLedger((all) => all.filter((e) => !removals.has(entryKey(e.root, e.path))));
  }

  await deps.removeEmptyDirs(root.dir);
}

/**
 * Tag untracked files in every managed root, then unlink files past their retention window
 * (unless their owner is still live) and drop ledger entries for files that never appeared.
 */
export async function sweepManagedFiles(deps: SweepDeps): Promise<SweepResult> {
  const result: SweepResult = { deleted: [], tagged: 0, dropped: 0 };
  for (const root of deps.roots) {
    try {
      if (!(await deps.exists(root.dir))) continue;
      await sweepRoot(root, deps, result);
    } catch (error) {
      deps.logger.warn(`managed-files: sweep of ${root.name} failed: ${errorMessage(error)}`);
    }
  }
  return result;
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
  } catch {
    return [];
  }
}

async function removeEmptySubdirs(dir: string): Promise<void> {
  let subdirs: string[];
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    subdirs = entries.filter((e) => e.isDirectory()).map((e) => join(e.parentPath, e.name));
  } catch {
    return;
  }
  // Deepest first, so a parent emptied by its children's removal goes too.
  subdirs.sort((a, b) => b.length - a.length);
  for (const sub of subdirs) {
    try {
      await rmdir(sub);
    } catch {
      // Not empty (or already gone) — keep it.
    }
  }
}

async function defaultIsOwnerLive(root: ManagedRoot, owner: string): Promise<boolean> {
  if (root.name === "recordings") {
    return getActiveTesterRuns().length > 0;
  }
  if (owner === SYSTEM_OWNER || owner.startsWith("plugin:")) return false;
  const session = await getSession(owner);
  if (session === null) return false;
  return getByThread(session.channelId, session.threadTs) !== undefined;
}

export function defaultSweepDeps(): SweepDeps {
  const config = getConfig();
  return {
    roots: getManagedRoots(config),
    retention: config.managedFiles?.retention ?? {
      downloads: { ...MANAGED_FILES_DEFAULT_RETENTION.downloads },
      recordings: { ...MANAGED_FILES_DEFAULT_RETENTION.recordings },
    },
    now: () => new Date(),
    isOwnerLive: defaultIsOwnerLive,
    listFiles: listFilesRecursive,
    stat: (path) => stat(path),
    unlink: (path) => unlink(path),
    exists: (path) => fileExists(path),
    removeEmptyDirs: removeEmptySubdirs,
    realpath: (p) => realpath(p),
    loadLedger,
    updateLedger,
    logger,
  };
}
