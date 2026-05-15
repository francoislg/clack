import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { getStateDir, getWorktreesDir } from "../config.js";
import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import { getGitInstance } from "../repositories.js";
import type { Worker, WorkerStatus } from "./types.js";

const WORKERS_STATE_FILE = "workers.json";
const WORKER_SIDECAR = ".clack-worker-state.json";
export const QUARANTINE_SIDECAR = ".clack-quarantine.json";

// JSON-shaped input for validators — a real type rather than `unknown`.
type JsonPrimitive = string | number | boolean | null;
type JsonArray = JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}
type JsonValue = JsonPrimitive | JsonArray | JsonObject;

const VALID_STATUSES = new Set<string>(["idle", "busy", "initializing", "quarantined", "failed"]);

interface PersistedWorker {
  id: string;
  repo: string;
  worktreePath: string;
  currentBranch: string | null;
  status: WorkerStatus;
  setupComplete: boolean;
  setupVersionHash: string | null;
  claimedBy: string | null;
  lastUsedAt: string;
  createdAt: string;
}

interface WorkersState {
  version: 1;
  workers: PersistedWorker[];
}

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatus(value: JsonValue): value is WorkerStatus {
  return typeof value === "string" && VALID_STATUSES.has(value);
}

function isPersistedWorker(value: JsonValue): value is JsonObject & PersistedWorker {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.repo === "string" &&
    typeof value.worktreePath === "string" &&
    (typeof value.currentBranch === "string" || value.currentBranch === null) &&
    isStatus(value.status) &&
    typeof value.setupComplete === "boolean" &&
    (typeof value.setupVersionHash === "string" || value.setupVersionHash === null) &&
    (typeof value.claimedBy === "string" || value.claimedBy === null) &&
    typeof value.lastUsedAt === "string" &&
    typeof value.createdAt === "string"
  );
}

function isWorkersState(value: JsonValue): value is JsonObject & WorkersState {
  if (!isObject(value)) return false;
  if (value.version !== 1) return false;
  if (!Array.isArray(value.workers)) return false;
  return value.workers.every(isPersistedWorker);
}

function statePath(): string {
  return resolve(getStateDir(), WORKERS_STATE_FILE);
}

function normalizeRestartStatus(persisted: WorkerStatus, isQuarantined: boolean): WorkerStatus {
  if (isQuarantined) return "quarantined";
  if (persisted === "quarantined" || persisted === "failed") return persisted;
  return "idle";
}

function ensureStateDir(): void {
  const dir = getStateDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function toPersisted(w: Worker): PersistedWorker {
  return {
    id: w.id,
    repo: w.repo,
    worktreePath: w.worktreePath,
    currentBranch: w.currentBranch,
    status: w.status,
    setupComplete: w.setupComplete,
    setupVersionHash: w.setupVersionHash,
    claimedBy: w.claimedBy,
    lastUsedAt: w.lastUsedAt.toISOString(),
    createdAt: w.createdAt.toISOString(),
  };
}

function fromPersisted(p: PersistedWorker): Worker {
  return {
    id: p.id,
    repo: p.repo,
    worktreePath: p.worktreePath,
    currentBranch: p.currentBranch,
    status: p.status,
    setupComplete: p.setupComplete,
    setupVersionHash: p.setupVersionHash,
    claimedBy: p.claimedBy,
    lastUsedAt: new Date(p.lastUsedAt),
    createdAt: new Date(p.createdAt),
  };
}

export function loadPoolState(): Worker[] {
  const path = statePath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed: JsonValue = JSON.parse(raw);
    if (!isWorkersState(parsed)) {
      logger.warn(`workers.json has unexpected shape; ignoring`);
      return [];
    }
    return parsed.workers.map(fromPersisted);
  } catch (err) {
    logger.warn(`Failed to load workers.json: ${errorMessage(err)}`);
    return [];
  }
}

export function savePoolState(workers: Worker[]): void {
  ensureStateDir();
  const path = statePath();
  const tmp = `${path}.tmp`;
  const state: WorkersState = {
    version: 1,
    workers: workers.map(toPersisted),
  };
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmp, path);
}

export function writeWorkerSidecar(worker: Worker): void {
  if (!existsSync(worker.worktreePath)) return;
  const path = join(worker.worktreePath, WORKER_SIDECAR);
  try {
    writeFileSync(path, JSON.stringify(toPersisted(worker), null, 2), "utf-8");
  } catch (err) {
    logger.warn(`Failed to write worker sidecar at ${path}: ${errorMessage(err)}`);
  }
}

export function readWorkerSidecar(worktreePath: string): Worker | null {
  const path = join(worktreePath, WORKER_SIDECAR);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed: JsonValue = JSON.parse(raw);
    if (!isPersistedWorker(parsed)) return null;
    return fromPersisted(parsed);
  } catch {
    return null;
  }
}

/**
 * Reconcile persisted state with what's actually on disk.
 * Disk wins for `currentBranch`. Orphan folders adopted as `idle`. Orphan state entries pruned.
 */
export async function reconcilePoolState(): Promise<Worker[]> {
  const persisted = loadPoolState();
  const persistedById = new Map<string, Worker>(persisted.map((w) => [`${w.repo}/${w.id}`, w]));
  const reconciled: Worker[] = [];
  const worktreesDir = getWorktreesDir();
  if (!existsSync(worktreesDir)) {
    if (persisted.length > 0) {
      logger.info(
        `workers.json had ${persisted.length} entries but worktrees dir does not exist; pruning all`,
      );
      savePoolState([]);
    }
    return [];
  }

  const repos = readdirSync(worktreesDir).filter((name) =>
    statSync(join(worktreesDir, name)).isDirectory(),
  );

  for (const repoName of repos) {
    const repoDir = join(worktreesDir, repoName);
    const folders = readdirSync(repoDir).filter((name) =>
      statSync(join(repoDir, name)).isDirectory(),
    );

    for (const folder of folders) {
      // Only `worker-N` folders are part of the reusable pool.
      if (!/^worker-\d+$/.test(folder)) continue;
      const path = join(repoDir, folder);
      const persistedEntry = persistedById.get(`${repoName}/${folder}`);
      const stats = statSync(path);

      // Detect actual current branch from git; disk wins on conflict.
      let actualBranch: string | null = null;
      try {
        const git = getGitInstance(path);
        const branch = (await git.raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
        actualBranch = branch === "HEAD" ? null : branch;
      } catch (err) {
        logger.warn(
          `Could not read HEAD for ${path}: ${errorMessage(err)} — treating worker as orphaned`,
        );
        continue;
      }

      if (persistedEntry) {
        if (persistedEntry.currentBranch !== actualBranch) {
          logger.warn(
            `Worker ${repoName}/${folder} state.json says branch=${persistedEntry.currentBranch} but disk says ${actualBranch}; using disk`,
          );
        }
        const isQuarantined = existsSync(join(path, QUARANTINE_SIDECAR));
        // On restart, any `busy` or `initializing` claim belongs to a dead process
        // — reset to `idle` and clear the claim so the worker is acquirable again.
        // The next acquire's setup-hash check re-runs setup if instructions changed.
        const normalizedStatus = normalizeRestartStatus(persistedEntry.status, isQuarantined);
        const claimedBy = normalizedStatus === "idle" ? null : persistedEntry.claimedBy;
        reconciled.push({
          ...persistedEntry,
          currentBranch: actualBranch,
          status: normalizedStatus,
          claimedBy,
        });
        persistedById.delete(`${repoName}/${folder}`);
      } else {
        logger.info(`Adopting orphan worker folder ${repoName}/${folder} as idle`);
        const isQuarantined = existsSync(join(path, QUARANTINE_SIDECAR));
        reconciled.push({
          id: folder,
          repo: repoName,
          worktreePath: path,
          currentBranch: actualBranch,
          status: isQuarantined ? "quarantined" : "idle",
          setupComplete: true,
          setupVersionHash: null,
          claimedBy: null,
          lastUsedAt: stats.mtime,
          createdAt: stats.birthtime,
        });
      }
    }
  }

  for (const [key] of persistedById) {
    logger.info(`Pruning orphan worker state entry ${key} (folder no longer exists)`);
  }

  savePoolState(reconciled);
  return reconciled;
}
