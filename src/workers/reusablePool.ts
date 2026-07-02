import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  findRepoByName,
  getConfig,
  getRepositoriesDir,
  getWorktreesDir,
  type ReusableFoldersConfig,
  type RepositoryConfig,
} from "../config.js";
import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import { getGitInstance, setAuthenticatedRemote } from "../repositories.js";
import type { AcquireOptions, ReleaseReason, Worker, WorkerPool, QueueEntry } from "./types.js";
import { AlreadyInFlight, Cancelled, DirtyWorkerQuarantined, PoolExhausted } from "./errors.js";
import { reconcilePoolState, savePoolState, writeWorkerSidecar } from "./persistence.js";
import { WorkerQueue } from "./queue.js";
import { switchBranch, switchToDefault } from "./branchSwitch.js";
import {
  clearQuarantineRecord,
  getDirtyTrackedFiles,
  hasUnpushedCommits,
  writeQuarantineRecord,
} from "./quarantine.js";
import { computeSetupVersionHash } from "./setupVersion.js";

/**
 * Optional hooks wired in by `src/index.ts` after the pool is constructed.
 * - `runSetup` is the heavy, one-shot initial provisioning (ports, .env, first install).
 *   Runs only on worker creation, or when `worktree_setup_instructions.md` itself changes.
 * - `runInstall` is the light, idempotent pre-work step (e.g., `pnpm install --frozen-lockfile`).
 *   Runs before every claim that involved a branch switch, so deps stay in sync with the
 *   newly-checked-out branch without re-doing the heavy setup.
 * - `onQuarantine` is fired when a worker transitions to `quarantined` status. The wirer
 *   in index.ts sends a DM to the workspace owner with the dirty file list so they can
 *   triage. Pool internals don't depend on Slack — the hook abstracts the side effect.
 *
 * Any runner being null is allowed — the pool degrades gracefully (skips that step).
 */
export interface SetupRunner {
  runSetup(repoName: string, worktreePath: string, branch: string): Promise<void>;
  runInstall?(repoName: string, worktreePath: string, branch: string): Promise<void>;
  onQuarantine?(event: QuarantineEvent): Promise<void>;
}

export interface QuarantineEvent {
  workerId: string;
  repo: string;
  branch: string | null;
  worktreePath: string;
  dirtyFiles: string[];
  /** Why the dirty check ran. Helps the operator decide what to do. */
  trigger: "release" | "branch_switch" | "idle_release";
}

/**
 * Reusable worker pool. Long-lived `worker-N` folders, branch-switching, queueing,
 * boot warm-up, idle release, quarantine. See design.md for full decision rationale.
 */
export class ReusablePool implements WorkerPool {
  private workers: Worker[] = [];
  private readonly queue = new WorkerQueue();
  private readonly config: Required<ReusableFoldersConfig>;
  private setupRunner: SetupRunner | null = null;
  private reconciled = false;

  constructor(config: ReusableFoldersConfig) {
    this.config = {
      enabled: config.enabled,
      minimumProvisioned: config.minimumProvisioned ?? 0,
      maxConcurrent: config.maxConcurrent ?? 3,
      maxQueueDepth: config.maxQueueDepth ?? 5,
      idleReleaseHours: config.idleReleaseHours ?? 24,
      dirtyTrackedQuarantine: config.dirtyTrackedQuarantine ?? true,
    };
  }

  /** Inject the setup runner. Called from index.ts after creation. */
  setSetupRunner(runner: SetupRunner): void {
    this.setupRunner = runner;
  }

  /** Reconcile against disk on first use (or explicitly from index.ts at boot). */
  async reconcile(): Promise<void> {
    this.workers = await reconcilePoolState();
    this.reconciled = true;
  }

  list(repo?: string): Worker[] {
    return repo ? this.workers.filter((w) => w.repo === repo) : [...this.workers];
  }

  findByBranch(repo: string, branch: string): Worker | null {
    return (
      this.workers.find(
        (w) =>
          w.repo === repo &&
          w.currentBranch === branch &&
          w.status !== "quarantined" &&
          w.status !== "failed",
      ) ?? null
    );
  }

  async ensureMinimum(repo: RepositoryConfig): Promise<void> {
    if (!this.reconciled) await this.reconcile();
    const repoWorkers = this.workers.filter((w) => w.repo === repo.name);
    const needed = this.config.minimumProvisioned - repoWorkers.length;
    if (needed <= 0) return;
    logger.info(
      `Provisioning ${needed} worker(s) for repo ${repo.name} (minimumProvisioned=${this.config.minimumProvisioned})`,
    );
    // Sequential per-repo so repo-setup scripts that pick "unique ports" by
    // scanning existing worktrees cannot race. Different repos still provision
    // in parallel because `provisionMinimumWorkers` calls `ensureMinimum` per
    // repo concurrently.
    for (let i = 0; i < needed; i++) {
      try {
        const worker = await this.createNewWorker(repo);
        if (worker.readyPromise) {
          await worker.readyPromise.catch(() => {
            // runInitialSetup already logged + marked status='failed' — continue to next.
          });
        }
      } catch (err) {
        logger.warn(`Provisioning worker for ${repo.name} failed: ${errorMessage(err)}`);
      }
    }
  }

  async acquire(
    repo: RepositoryConfig,
    branch: string,
    sessionId: string,
    options?: AcquireOptions,
  ): Promise<Worker> {
    if (!this.reconciled) await this.reconcile();

    // 1. Branch already on a worker?
    const existing = this.findByBranch(repo.name, branch);
    if (existing) {
      if (existing.status === "idle") {
        if (this.dropIfFolderMissing(existing)) {
          return this.acquire(repo, branch, sessionId, options);
        }
        await this.maybeRerunSetup(existing, repo);
        await this.runInstallStep(existing, repo);
        return this.claim(existing, sessionId);
      }
      if (existing.status === "busy") {
        if (existing.claimedBy === sessionId) {
          return existing;
        }
        throw new AlreadyInFlight(repo.name, branch, existing.claimedBy ?? "unknown");
      }
    }

    // 2. Idle worker for this repo?
    const idle = this.workers.find((w) => w.repo === repo.name && w.status === "idle");
    if (idle) {
      if (this.dropIfFolderMissing(idle)) {
        return this.acquire(repo, branch, sessionId, options);
      }
      try {
        await switchBranch(idle, repo, branch, options?.resumeRemoteBranch);
      } catch (err) {
        if (err instanceof DirtyWorkerQuarantined) {
          this.persist();
          this.notifyQuarantine(idle, err.dirtyFiles, "branch_switch");
          return this.acquire(repo, branch, sessionId, options);
        }
        throw err;
      }
      await this.maybeRerunSetup(idle, repo);
      // After switchBranch the worktree is on the new branch's tip; run the
      // idempotent install step so deps match this branch's lockfile.
      await this.runInstallStep(idle, repo);
      return this.claim(idle, sessionId);
    }

    // 3. Initializing worker we can wait for?
    const initializing = this.workers.find(
      (w) => w.repo === repo.name && w.status === "initializing",
    );
    if (initializing && initializing.readyPromise) {
      try {
        await initializing.readyPromise;
      } catch {
        // Setup failed — worker is now `failed`. Recurse to try alternatives.
      }
      return this.acquire(repo, branch, sessionId, options);
    }

    // 4. Pool size < maxConcurrent → create.
    const repoCount = this.workers.filter((w) => w.repo === repo.name).length;
    if (repoCount < this.config.maxConcurrent) {
      await this.createNewWorker(repo);
      return this.acquire(repo, branch, sessionId, options);
    }

    // 5. Queue with bound.
    const queueDepth = this.queue.depth(repo.name);
    if (queueDepth >= this.config.maxQueueDepth) {
      throw new PoolExhausted(repo.name, queueDepth, this.config.maxQueueDepth);
    }
    // Notify the caller of the queue position (1-based) so it can post an ack.
    // Position is current depth + 1 — the entry we're about to push.
    options?.onQueued?.(queueDepth + 1);
    return this.queue.enqueueAndWait(repo.name, branch, sessionId);
  }

  async release(worker: Worker, reason: ReleaseReason): Promise<void> {
    const dirtyFiles = await getDirtyTrackedFiles(worker);
    if (dirtyFiles.length > 0) {
      writeQuarantineRecord(worker, dirtyFiles);
      worker.status = "quarantined";
      worker.claimedBy = null;
      worker.lastUsedAt = new Date();
      this.persist();
      logger.warn(
        `Worker ${worker.id} quarantined on release (reason=${reason}): ${dirtyFiles.length} dirty file(s)`,
      );
      this.notifyQuarantine(worker, dirtyFiles, "release");
      return;
    }

    worker.status = "idle";
    worker.claimedBy = null;
    worker.lastUsedAt = new Date();
    this.persist();

    this.pumpQueue(worker.repo);
  }

  /**
   * Hand the next queued waiter an available worker for `repo`. MUST be called from
   * every path that returns a worker to `idle` (`release`, `detachIfClean`,
   * `clearQuarantine`) so a freed worker never strands a queued acquire.
   *
   * Dequeues ONE entry per call (a single freed worker satisfies at most one waiter) and
   * no-ops when nothing is queued or no worker is idle. The idle worker is `claim`ed
   * synchronously before the async branch-switch, so a concurrent pump on the same repo
   * can't select the same worker mid-switch and hand it to a second waiter.
   */
  private pumpQueue(repo: string): void {
    if (this.queue.depth(repo) === 0) return;
    const idle = this.workers.find((w) => w.repo === repo && w.status === "idle");
    if (!idle) return;
    if (this.dropIfFolderMissing(idle)) {
      this.pumpQueue(repo);
      return;
    }
    const next = this.queue.dequeue(repo);
    if (!next) return;
    this.claim(idle, next.sessionId);
    // fulfillReserved settles `next` internally; the catch is a last-resort settle so an
    // unexpected throw can never leave the waiter hanging.
    this.fulfillReserved(idle, next).catch((err) => {
      next.reject(err instanceof Error ? err : new Error(String(err)));
    });
  }

  /**
   * Drain every repo that currently has queued waiters. Public entry point for the
   * change-monitor backstop: if any idle-transition ever fails to drain, the periodic
   * tick recovers the stranded waiter by handing it an idle worker. Resolves waiters
   * by giving them a worker — it never times out or abandons work. Cheap no-op when
   * no repo has both a waiter and an idle worker.
   */
  pumpQueuedRepos(): void {
    const repos = new Set(this.queue.list().map((e) => e.repo));
    for (const repo of repos) this.pumpQueue(repo);
  }

  /**
   * Fire the optional `onQuarantine` hook for every dirty-quarantine transition.
   * Fire-and-forget: a failing notification must NOT break the pool's caller.
   * The trigger string tells the operator whether the quarantine came from a
   * release (PR completion path), a branch swap, or the idle-release sweep.
   */
  private notifyQuarantine(
    worker: Worker,
    dirtyFiles: string[],
    trigger: QuarantineEvent["trigger"],
  ): void {
    const hook = this.setupRunner?.onQuarantine;
    if (!hook) return;
    const event: QuarantineEvent = {
      workerId: worker.id,
      repo: worker.repo,
      branch: worker.currentBranch,
      worktreePath: worker.worktreePath,
      dirtyFiles,
      trigger,
    };
    hook(event).catch((err) => {
      logger.warn(`Quarantine notification failed for ${worker.id}: ${errorMessage(err)}`);
    });
  }

  /**
   * Prepare a worker that `pumpQueue` has already claimed for the queued entry's branch,
   * then resolve the waiter with it — the branch-switch + setup half of acquire's idle path.
   * Unlike `acquire`, any failure (including a mid-switch quarantine) REJECTS this entry
   * rather than retrying another worker: a freshly-idle pooled worker is clean by construction,
   * so the dirty case is near-impossible here, and the caller re-requests on the rare failure.
   * Always settles `entry`: on failure the reservation's claim is cleared (worker back to idle
   * unless the switch quarantined it) and the waiter is rejected, never left hanging.
   */
  private async fulfillReserved(worker: Worker, entry: QueueEntry): Promise<void> {
    try {
      const repo = findRepoByName(entry.repo, getConfig());
      if (!repo) {
        this.releaseReservation(worker);
        entry.reject(new Error(`Repository ${entry.repo} no longer configured`));
        return;
      }
      // Queued entries never carry `resumeRemoteBranch` (only propose_change's
      // continue_existing_pr sets it, and that path isn't queued), so branch from
      // origin/<default> as usual.
      if (worker.currentBranch !== entry.branch) {
        await switchBranch(worker, repo, entry.branch);
      }
      await this.maybeRerunSetup(worker, repo);
      await this.runInstallStep(worker, repo);
      entry.resolve(worker);
    } catch (err) {
      // `switchBranch` already quarantined a dirty worker (status + record) before throwing;
      // surface it to the owner like `acquire` does, not just to the waiter via the rejection.
      if (err instanceof DirtyWorkerQuarantined) {
        this.notifyQuarantine(worker, err.dirtyFiles, "branch_switch");
      }
      this.releaseReservation(worker);
      entry.reject(err instanceof Error ? err : new Cancelled(String(err)));
    }
  }

  /**
   * Undo a `pumpQueue` reservation when fulfillment fails: always clear the claim so the
   * rejected session no longer owns the worker, and return it to `idle` only when the
   * failure left it `busy` (a mid-switch quarantine or a failed setup keep their own status).
   */
  private releaseReservation(worker: Worker): void {
    if (worker.status === "busy") worker.status = "idle";
    worker.claimedBy = null;
    this.persist();
  }

  async refreshSetup(worker: Worker, repo: RepositoryConfig): Promise<void> {
    await this.maybeRerunSetup(worker, repo);
    await this.runInstallStep(worker, repo);
  }

  private claim(worker: Worker, sessionId: string): Worker {
    worker.status = "busy";
    worker.claimedBy = sessionId;
    worker.lastUsedAt = new Date();
    this.persist();
    return worker;
  }

  private async maybeRerunSetup(worker: Worker, repo: RepositoryConfig): Promise<void> {
    const currentHash = computeSetupVersionHash(repo.name);
    if (worker.setupVersionHash === currentHash) return;
    if (!this.setupRunner) {
      worker.setupVersionHash = currentHash;
      return;
    }
    // Restore the entry status afterwards: acquire paths arrive here with an idle
    // worker, but refreshSetup() runs on a busy (claimed) worker mid-recovery.
    const priorStatus = worker.status;
    worker.status = "initializing";
    this.persist();
    try {
      await this.setupRunner.runSetup(repo.name, worker.worktreePath, worker.currentBranch ?? "");
      worker.setupVersionHash = currentHash;
      worker.setupComplete = true;
      worker.status = priorStatus;
    } catch (err) {
      worker.status = "failed";
      logger.warn(`Setup re-run failed for ${worker.id}: ${errorMessage(err)}`);
      throw err;
    } finally {
      this.persist();
    }
  }

  /**
   * Run the per-repo install step after a branch switch. Idempotent: when the
   * lockfile is unchanged this is a fast no-op (e.g., `pnpm install --frozen-lockfile`
   * exits quickly). Skipped if no `runInstall` hook is wired or no install
   * instructions file exists for the repo.
   */
  private async runInstallStep(worker: Worker, repo: RepositoryConfig): Promise<void> {
    if (!this.setupRunner?.runInstall) return;
    try {
      await this.setupRunner.runInstall(repo.name, worker.worktreePath, worker.currentBranch ?? "");
    } catch (err) {
      // Don't fail the acquire — surface the warning and let the worker run.
      // The dev will see the install failure in their own commands if deps are broken.
      logger.warn(`Install step failed for ${worker.id}: ${errorMessage(err)}`);
    }
  }

  private async createNewWorker(repo: RepositoryConfig): Promise<Worker> {
    const reposDir = getRepositoriesDir();
    const worktreesDir = getWorktreesDir();
    const mainRepoPath = resolve(reposDir, repo.name);
    if (!existsSync(mainRepoPath)) {
      throw new Error(`Main repository not found at ${mainRepoPath}`);
    }
    const repoWorktreesDir = resolve(worktreesDir, repo.name);
    if (!existsSync(repoWorktreesDir)) {
      mkdirSync(repoWorktreesDir, { recursive: true });
    }

    const id = this.allocateWorkerId(repo.name);
    const worktreePath = resolve(repoWorktreesDir, id);
    const defaultBranch = repo.branch || "main";

    await setAuthenticatedRemote(mainRepoPath, repo.url);
    const git = getGitInstance(mainRepoPath);
    try {
      await git.fetch(["--all"]);
    } catch (err) {
      logger.warn(`fetch failed before worktree create: ${errorMessage(err)}`);
    }

    await git.raw(["worktree", "add", "--detach", worktreePath, `origin/${defaultBranch}`]);
    await setAuthenticatedRemote(worktreePath, repo.url);

    const now = new Date();
    const worker: Worker = {
      id,
      repo: repo.name,
      worktreePath,
      currentBranch: null,
      status: "initializing",
      setupComplete: false,
      setupVersionHash: null,
      claimedBy: null,
      lastUsedAt: now,
      createdAt: now,
    };
    this.workers.push(worker);
    this.persist();

    worker.readyPromise = this.runInitialSetup(worker, repo);
    return worker;
  }

  // A newly-provisioned worker transitions to `idle` here but deliberately does NOT
  // pumpQueue: entries only queue when the pool is at `maxConcurrent` (no room to
  // grow), and an in-flight `initializing` worker is awaited directly by `acquire`
  // (step 3), never via the queue — so a fresh worker going idle cannot coincide with
  // a queued waiter. The monitor backstop covers any unforeseen residual.
  private async runInitialSetup(worker: Worker, repo: RepositoryConfig): Promise<void> {
    if (!this.setupRunner) {
      worker.setupComplete = true;
      worker.setupVersionHash = computeSetupVersionHash(repo.name);
      worker.status = "idle";
      this.persist();
      return;
    }
    try {
      await this.setupRunner.runSetup(repo.name, worker.worktreePath, "");
      worker.setupComplete = true;
      worker.setupVersionHash = computeSetupVersionHash(repo.name);
      worker.status = "idle";
      this.persist();
    } catch (err) {
      worker.status = "failed";
      logger.warn(`Initial setup failed for worker ${worker.id}: ${errorMessage(err)}`);
      this.persist();
      throw err;
    }
  }

  private allocateWorkerId(repoName: string): string {
    const used = new Set(this.workers.filter((w) => w.repo === repoName).map((w) => w.id));
    for (let i = 1; i < 10_000; i++) {
      const id = `worker-${i}`;
      if (!used.has(id)) return id;
    }
    throw new Error(`Could not allocate worker id for repo ${repoName}`);
  }

  private persist(): void {
    savePoolState(this.workers);
    for (const w of this.workers) writeWorkerSidecar(w);
  }

  /**
   * Guard against an idle worker whose folder was deleted out-of-band (external
   * cleanup, manual `rm`, container disk wipe). Reusing it would throw a
   * simple-git construction error ("Cannot use simple-git on a directory that
   * does not exist") deep inside `switchBranch`/dirty-check and fail the change
   * with an opaque "Failed to create workspace". Instead, drop it from the pool
   * so `acquire` falls through and re-provisions a fresh worker.
   * Returns true when the worker was missing and removed.
   */
  private dropIfFolderMissing(worker: Worker): boolean {
    if (existsSync(worker.worktreePath)) return false;
    logger.warn(
      `Worker ${worker.repo}/${worker.id} folder missing at ${worker.worktreePath}; dropping and re-provisioning`,
    );
    this.workers = this.workers.filter((w) => w !== worker);
    this.persist();
    return true;
  }

  /**
   * Idle release sweep — detach busy workers idle past `idleReleaseHours`.
   * The caller (monitor.ts) is responsible for filtering by session-state
   * (pr_created, no live handle) before invoking detach via release().
   * This sweep itself just identifies candidates; the actual detach is performed
   * by `detachIfClean`.
   */
  async idleSweepCandidates(now: Date = new Date()): Promise<Worker[]> {
    if (!this.reconciled) await this.reconcile();
    const cutoff = now.getTime() - this.config.idleReleaseHours * 3600_000;
    return this.workers.filter(
      (w) => w.status === "busy" && w.claimedBy !== null && w.lastUsedAt.getTime() < cutoff,
    );
  }

  /**
   * Detach a busy worker if clean; quarantine if dirty.
   * `treatUnpushedAsDirty` additionally quarantines a worker whose branch has
   * committed-but-unpushed work — used when releasing failed sessions, where a
   * later `checkout -B` from origin would silently destroy local-only commits.
   * Returns true if the worker was successfully detached.
   */
  async detachIfClean(
    worker: Worker,
    options?: { treatUnpushedAsDirty?: boolean },
  ): Promise<boolean> {
    const dirtyFiles = await getDirtyTrackedFiles(worker);
    if (dirtyFiles.length > 0) {
      writeQuarantineRecord(worker, dirtyFiles);
      worker.status = "quarantined";
      worker.lastUsedAt = new Date();
      this.persist();
      this.notifyQuarantine(worker, dirtyFiles, "idle_release");
      return false;
    }
    const repo = findRepoByName(worker.repo, getConfig());
    if (!repo) return false;
    if (options?.treatUnpushedAsDirty) {
      const unpushed = await hasUnpushedCommits(worker, repo.branch || "main");
      if (unpushed) {
        const marker = [`(unpushed commits on ${worker.currentBranch ?? "detached HEAD"})`];
        writeQuarantineRecord(worker, marker);
        worker.status = "quarantined";
        worker.lastUsedAt = new Date();
        this.persist();
        this.notifyQuarantine(worker, marker, "idle_release");
        return false;
      }
    }
    try {
      await switchToDefault(worker, repo);
    } catch (err) {
      if (err instanceof DirtyWorkerQuarantined) {
        this.persist();
        return false;
      }
      throw err;
    }
    worker.claimedBy = null;
    worker.status = "idle";
    worker.lastUsedAt = new Date();
    this.persist();
    this.pumpQueue(worker.repo);
    return true;
  }

  /** Find a queued entry by sessionId — used by cancel paths. */
  findQueuedBySession(sessionId: string): QueueEntry | null {
    return this.queue.findBySession(sessionId);
  }

  /** Returns the queue's per-repo depth. Used by Slack ack copy. */
  queueDepth(repo: string): number {
    return this.queue.depth(repo);
  }

  /** List queued entries — used by Home Tab. */
  listQueued(repo?: string): ReadonlyArray<QueueEntry> {
    return this.queue.list(repo);
  }

  /**
   * Discard local changes on a quarantined worker and restore it to idle.
   * Admin-only operation invoked from the Home Tab "Discard & restore" button.
   * Performs `git reset --hard HEAD` + `git clean -fd` in the worker dir,
   * removes the `.clack-quarantine.json` sidecar, then flips the status.
   */
  async clearQuarantine(
    workerId: string,
    repo: string,
  ): Promise<{ ok: true; worker: Worker } | { ok: false; reason: string }> {
    if (!this.reconciled) await this.reconcile();
    const worker = this.workers.find((w) => w.id === workerId && w.repo === repo);
    if (!worker) {
      return { ok: false, reason: `Worker ${workerId} for repo ${repo} not found` };
    }
    if (worker.status !== "quarantined") {
      return {
        ok: false,
        reason: `Worker ${workerId} is in status ${worker.status}, not quarantined`,
      };
    }
    const git = getGitInstance(worker.worktreePath);
    try {
      await git.raw(["reset", "--hard", "HEAD"]);
      await git.raw(["clean", "-fd"]);
    } catch (err) {
      return {
        ok: false,
        reason: `git reset/clean failed for ${workerId}: ${errorMessage(err)}`,
      };
    }
    clearQuarantineRecord(worker);
    worker.status = "idle";
    worker.claimedBy = null;
    worker.lastUsedAt = new Date();
    this.persist();
    this.pumpQueue(worker.repo);
    logger.info(`Worker ${workerId} restored from quarantine (admin discard)`);
    return { ok: true, worker };
  }
}
