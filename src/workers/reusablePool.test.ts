import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { ReusablePool } from "./reusablePool.js";
import type { SetupRunner } from "./reusablePool.js";
import type { RepositoryConfig } from "../config.js";

// Per-test knobs for the fake git boundary: what `diff` (dirty-check) and
// `rev-list` (unpushed-check) report.
const gitState = vi.hoisted(() => ({ dirtyFiles: "", revListCount: "0", throwCheckoutBranch: "" }));

// Mock the git boundary (no real git/subprocess per test conventions). The fake
// `worktree add` creates the target folder on disk so re-provisioning mirrors
// real git, and `rev-parse` lets reconcile adopt a seeded folder as idle.
// `mkdirSync` is only invoked inside `raw()` at test runtime, after imports init.
vi.mock("../repositories.js", () => {
  const makeFakeGit = () => ({
    fetch: async () => "",
    branchLocal: async () => ({ all: [] as string[] }),
    raw: async (args: string[]) => {
      // `git checkout -B <branch> origin/<default>` — let a test force a branch-switch
      // failure to exercise queue fulfillment-error isolation.
      if (
        args[0] === "checkout" &&
        gitState.throwCheckoutBranch &&
        args[2] === gitState.throwCheckoutBranch
      ) {
        throw new Error(`fake checkout failure for ${gitState.throwCheckoutBranch}`);
      }
      if (args[0] === "worktree" && args[1] === "add") {
        mkdirSync(args[3], { recursive: true });
        return "";
      }
      if (args[0] === "rev-parse") return "main";
      if (args[0] === "diff") return gitState.dirtyFiles;
      if (args[0] === "rev-list") return gitState.revListCount;
      return "";
    },
  });
  return {
    getGitInstance: () => makeFakeGit(),
    setAuthenticatedRemote: async () => {},
  };
});

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  const repo = { name: "test-repo", url: "https://github.com/org/test-repo.git" };
  return {
    ...actual,
    getConfig: () => ({ repositories: [repo] }),
    findRepoByName: (name: string) => (name === "test-repo" ? repo : undefined),
  };
});

const tmpBase = resolve(realpathSync(tmpdir()), `reusable-pool-test-${process.pid}`);
const tmpDataDir = join(tmpBase, "data");
const tmpWorktreesDir = join(tmpDataDir, "worktrees");

function makeRepo(): RepositoryConfig {
  return { name: "test-repo", url: "https://github.com/org/test-repo.git", description: "test" };
}

function makePool() {
  return new ReusablePool({
    enabled: true,
    minimumProvisioned: 0,
    maxConcurrent: 3,
    maxQueueDepth: 5,
    idleReleaseHours: 24,
    dirtyTrackedQuarantine: true,
  });
}

describe("ReusablePool.acquire self-heal on missing worker folder", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    // Main repo dir must exist for createNewWorker; worktrees dir for the pool.
    mkdirSync(join(tmpDataDir, "repositories", "test-repo"), { recursive: true });
    mkdirSync(tmpWorktreesDir, { recursive: true });
    process.chdir(tmpBase);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpBase, { recursive: true, force: true });
  });

  /**
   * Reconcile adopts a seeded `worker-1` folder as idle, then we delete the
   * folder out-of-band (as the stale-cleanup sweep or a disk wipe would).
   */
  async function poolWithMissingIdleWorker() {
    const pool = makePool();
    const workerPath = join(tmpWorktreesDir, "test-repo", "worker-1");
    mkdirSync(workerPath, { recursive: true });
    await pool.reconcile();
    assert.equal(pool.list("test-repo").length, 1, "precondition: one idle worker adopted");
    rmSync(workerPath, { recursive: true, force: true });
    return { pool, workerPath };
  }

  it("drops the missing idle worker and provisions a fresh one instead of throwing", async () => {
    const { pool, workerPath } = await poolWithMissingIdleWorker();

    const worker = await pool.acquire(makeRepo(), "clack/fix/x", "session-1");

    assert.equal(worker.status, "busy");
    assert.ok(existsSync(workerPath), "the worker folder is re-created on disk");
    assert.equal(pool.list("test-repo").length, 1, "no duplicate/leaked workers");
  });

  it("recovered worker is usable on the requested branch with no simple-git error", async () => {
    const { pool } = await poolWithMissingIdleWorker();

    const worker = await pool.acquire(makeRepo(), "clack/fix/x", "session-1");

    assert.equal(worker.currentBranch, "clack/fix/x");
    assert.equal(worker.claimedBy, "session-1");
  });
});

describe("ReusablePool setup healing", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(join(tmpDataDir, "repositories", "test-repo"), { recursive: true });
    mkdirSync(tmpWorktreesDir, { recursive: true });
    process.chdir(tmpBase);
    gitState.dirtyFiles = "";
    gitState.revListCount = "0";
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpBase, { recursive: true, force: true });
  });

  function makeSetupRunner() {
    const runSetup = vi.fn<SetupRunner["runSetup"]>(async () => {});
    const runInstall = vi.fn<NonNullable<SetupRunner["runInstall"]>>(async () => {});
    return { runner: { runSetup, runInstall } satisfies SetupRunner, runSetup, runInstall };
  }

  function writeSetupInstructions(content: string): void {
    const dir = join(tmpDataDir, "configuration", "test-repo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "worktree_setup_instructions.md"), content);
  }

  async function poolWithReleasedWorkerOnBranch(branch: string) {
    const pool = makePool();
    const { runner, runSetup, runInstall } = makeSetupRunner();
    pool.setSetupRunner(runner);
    const worker = await pool.acquire(makeRepo(), branch, "session-1");
    await pool.release(worker, "pr_merged");
    assert.equal(worker.status, "idle");
    assert.equal(worker.currentBranch, branch, "release keeps the branch checked out");
    runSetup.mockClear();
    runInstall.mockClear();
    return { pool, worker, runSetup, runInstall };
  }

  it("branch-sticky acquire skips setup when the hash matches", async () => {
    const { pool, runSetup, runInstall } = await poolWithReleasedWorkerOnBranch("feat/x");

    await pool.acquire(makeRepo(), "feat/x", "session-2");

    assert.equal(runSetup.mock.calls.length, 0);
    assert.equal(runInstall.mock.calls.length, 1, "install step still runs on claim");
  });

  it("branch-sticky acquire re-runs setup when the instructions changed", async () => {
    const { pool, worker, runSetup, runInstall } = await poolWithReleasedWorkerOnBranch("feat/x");
    writeSetupInstructions("npm run new-build-step");

    const claimed = await pool.acquire(makeRepo(), "feat/x", "session-2");

    assert.equal(claimed.id, worker.id);
    assert.equal(runSetup.mock.calls.length, 1);
    assert.equal(runInstall.mock.calls.length, 1);
    assert.equal(claimed.status, "busy");
  });

  it("refreshSetup re-runs setup on a busy worker and keeps it busy", async () => {
    const pool = makePool();
    const { runner, runSetup, runInstall } = makeSetupRunner();
    pool.setSetupRunner(runner);
    const worker = await pool.acquire(makeRepo(), "feat/x", "session-1");
    runSetup.mockClear();
    runInstall.mockClear();
    writeSetupInstructions("npm run new-build-step");

    await pool.refreshSetup(worker, makeRepo());

    assert.equal(runSetup.mock.calls.length, 1);
    assert.equal(runInstall.mock.calls.length, 1);
    assert.equal(worker.status, "busy");
    assert.equal(worker.claimedBy, "session-1");
  });

  it("refreshSetup skips setup when the hash matches", async () => {
    const pool = makePool();
    const { runner, runSetup } = makeSetupRunner();
    pool.setSetupRunner(runner);
    const worker = await pool.acquire(makeRepo(), "feat/x", "session-1");
    runSetup.mockClear();

    await pool.refreshSetup(worker, makeRepo());

    assert.equal(runSetup.mock.calls.length, 0);
  });
});

describe("ReusablePool.detachIfClean unpushed-commit protection", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(join(tmpDataDir, "repositories", "test-repo"), { recursive: true });
    mkdirSync(tmpWorktreesDir, { recursive: true });
    process.chdir(tmpBase);
    gitState.dirtyFiles = "";
    gitState.revListCount = "0";
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("quarantines instead of detaching when unpushed commits exist", async () => {
    const pool = makePool();
    const worker = await pool.acquire(makeRepo(), "feat/x", "session-1");
    gitState.revListCount = "2";

    const detached = await pool.detachIfClean(worker, { treatUnpushedAsDirty: true });

    assert.equal(detached, false);
    assert.equal(worker.status, "quarantined");
    assert.ok(existsSync(join(worker.worktreePath, ".clack-quarantine.json")));
  });

  it("detaches a clean, fully-pushed worker", async () => {
    const pool = makePool();
    const worker = await pool.acquire(makeRepo(), "feat/x", "session-1");

    const detached = await pool.detachIfClean(worker, { treatUnpushedAsDirty: true });

    assert.equal(detached, true);
    assert.equal(worker.status, "idle");
    assert.equal(worker.claimedBy, null);
  });

  it("ignores unpushed commits when the option is off (pr_created semantics)", async () => {
    const pool = makePool();
    const worker = await pool.acquire(makeRepo(), "feat/x", "session-1");
    gitState.revListCount = "2";

    const detached = await pool.detachIfClean(worker);

    assert.equal(detached, true);
    assert.equal(worker.status, "idle");
  });
});

describe("ReusablePool.release with 'discarded'", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(join(tmpDataDir, "repositories", "test-repo"), { recursive: true });
    mkdirSync(tmpWorktreesDir, { recursive: true });
    process.chdir(tmpBase);
    gitState.dirtyFiles = "";
    gitState.revListCount = "0";
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("returns a clean worker to the pool as idle", async () => {
    const pool = makePool();
    const worker = await pool.acquire(makeRepo(), "feat/x", "session-1");

    await pool.release(worker, "discarded");

    assert.equal(worker.status, "idle");
    assert.equal(worker.claimedBy, null);
  });

  it("quarantines a worker with dirty tracked files", async () => {
    const pool = makePool();
    const worker = await pool.acquire(makeRepo(), "feat/x", "session-1");
    gitState.dirtyFiles = "src/a.ts\n";

    await pool.release(worker, "discarded");

    assert.equal(worker.status, "quarantined");
    assert.ok(existsSync(join(worker.worktreePath, ".clack-quarantine.json")));
  });
});

describe("ReusablePool.reassignClaim", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(join(tmpDataDir, "repositories", "test-repo"), { recursive: true });
    mkdirSync(tmpWorktreesDir, { recursive: true });
    process.chdir(tmpBase);
    gitState.dirtyFiles = "";
    gitState.revListCount = "0";
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("moves a busy worker's claim to the new session and persists", async () => {
    const pool = makePool();
    const worker = await pool.acquire(makeRepo(), "feat/x", "session-1");

    const ok = pool.reassignClaim(worker, "session-2");

    assert.equal(ok, true);
    assert.equal(worker.claimedBy, "session-2");
    const persisted = pool.findByBranch("test-repo", "feat/x");
    assert.equal(persisted?.claimedBy, "session-2");
  });

  it("does not mutate branch, status, or worktree on reassign", async () => {
    const pool = makePool();
    const worker = await pool.acquire(makeRepo(), "feat/x", "session-1");
    const priorPath = worker.worktreePath;

    pool.reassignClaim(worker, "session-2");

    assert.equal(worker.status, "busy");
    assert.equal(worker.currentBranch, "feat/x");
    assert.equal(worker.worktreePath, priorPath);
  });

  it("rejects reassignment for a non-busy worker", async () => {
    const pool = makePool();
    const worker = await pool.acquire(makeRepo(), "feat/x", "session-1");
    await pool.release(worker, "discarded");
    assert.equal(worker.status, "idle");

    const ok = pool.reassignClaim(worker, "session-2");

    assert.equal(ok, false);
    assert.equal(worker.claimedBy, null);
  });

  it("rejects reassignment for a quarantined worker", async () => {
    const pool = makePool();
    const worker = await pool.acquire(makeRepo(), "feat/x", "session-1");
    gitState.dirtyFiles = "src/a.ts\n";
    await pool.release(worker, "discarded");
    assert.equal(worker.status, "quarantined");

    const ok = pool.reassignClaim(worker, "session-2");

    assert.equal(ok, false);
    assert.equal(worker.claimedBy, null);
  });
});

describe("ReusablePool queue drain on idle-transitions", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(join(tmpDataDir, "repositories", "test-repo"), { recursive: true });
    mkdirSync(tmpWorktreesDir, { recursive: true });
    process.chdir(tmpBase);
    gitState.dirtyFiles = "";
    gitState.revListCount = "0";
    gitState.throwCheckoutBranch = "";
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpBase, { recursive: true, force: true });
    gitState.throwCheckoutBranch = "";
  });

  // Fill the pool to maxConcurrent (3) with busy workers so the next acquire queues.
  async function saturate() {
    const pool = makePool();
    const w1 = await pool.acquire(makeRepo(), "clack/fix/b1", "session-1");
    const w2 = await pool.acquire(makeRepo(), "clack/fix/b2", "session-2");
    const w3 = await pool.acquire(makeRepo(), "clack/fix/b3", "session-3");
    return { pool, w1, w2, w3 };
  }

  function writeSetupInstructions(content: string): void {
    const dir = join(tmpDataDir, "configuration", "test-repo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "worktree_setup_instructions.md"), content);
  }

  it("idle-release detach hands the freed worker to a queued waiter", async () => {
    const { pool, w1 } = await saturate();
    const queued = pool.acquire(makeRepo(), "clack/fix/b4", "session-4");
    assert.equal(pool.queueDepth("test-repo"), 1, "4th acquire is queued while saturated");

    const detached = await pool.detachIfClean(w1);

    assert.equal(detached, true);
    const w4 = await queued;
    assert.equal(w4.status, "busy");
    assert.equal(w4.claimedBy, "session-4");
    assert.equal(w4.currentBranch, "clack/fix/b4");
    assert.equal(pool.queueDepth("test-repo"), 0);
  });

  it("clearing a quarantine hands the restored worker to a queued waiter", async () => {
    const { pool, w1 } = await saturate();
    gitState.dirtyFiles = "src/a.ts\n";
    await pool.release(w1, "discarded");
    assert.equal(w1.status, "quarantined");
    gitState.dirtyFiles = "";

    const queued = pool.acquire(makeRepo(), "clack/fix/b4", "session-4");
    assert.equal(pool.queueDepth("test-repo"), 1, "queued behind the quarantined + 2 busy workers");

    const result = await pool.clearQuarantine(w1.id, "test-repo");

    assert.equal(result.ok, true);
    const w4 = await queued;
    assert.equal(w4.claimedBy, "session-4");
    assert.equal(w4.currentBranch, "clack/fix/b4");
  });

  it("release drains one waiter per freed worker in FIFO order", async () => {
    const { pool, w1, w2 } = await saturate();
    const p4 = pool.acquire(makeRepo(), "clack/fix/b4", "session-4");
    const p5 = pool.acquire(makeRepo(), "clack/fix/b5", "session-5");
    assert.equal(pool.queueDepth("test-repo"), 2);

    await pool.release(w1, "pr_merged");
    const w4 = await p4;
    assert.equal(w4.claimedBy, "session-4", "first-enqueued waiter served first");
    assert.equal(pool.queueDepth("test-repo"), 1, "only one waiter dequeued per freed worker");

    await pool.release(w2, "pr_merged");
    const w5 = await p5;
    assert.equal(w5.claimedBy, "session-5");
    assert.equal(pool.queueDepth("test-repo"), 0);
  });

  it("is a no-op when no worker is idle — the waiter stays queued", async () => {
    const { pool } = await saturate();
    const queued = pool.acquire(makeRepo(), "clack/fix/b4", "session-4");
    assert.equal(pool.queueDepth("test-repo"), 1);

    // No idle worker exists (all three busy); draining must leave the waiter pending.
    pool.pumpQueuedRepos();

    assert.equal(pool.queueDepth("test-repo"), 1);
    // Prove it's still pending (not resolved/rejected) before cleaning up.
    const pending = await Promise.race([queued.then(() => "resolved"), Promise.resolve("pending")]);
    assert.equal(pending, "pending");
  });

  it("pumpQueuedRepos is a no-op when nothing is queued", () => {
    const pool = makePool();
    assert.doesNotThrow(() => pool.pumpQueuedRepos());
  });

  it("concurrent idle-transitions do not double-fulfill (each waiter gets a distinct worker)", async () => {
    const { pool, w1, w2 } = await saturate();
    const p4 = pool.acquire(makeRepo(), "clack/fix/b4", "session-4");
    const p5 = pool.acquire(makeRepo(), "clack/fix/b5", "session-5");
    assert.equal(pool.queueDepth("test-repo"), 2);

    // Two workers freed near-simultaneously — both waiters must be served, each by a
    // DISTINCT worker (no single freed worker handed to two waiters).
    await Promise.all([pool.release(w1, "pr_merged"), pool.release(w2, "pr_merged")]);

    const w4 = await p4;
    const w5 = await p5;
    assert.equal(w4.claimedBy, "session-4");
    assert.equal(w5.claimedBy, "session-5");
    assert.notEqual(w4.id, w5.id, "each waiter is handed its own worker, not the same one twice");
    assert.equal(pool.queueDepth("test-repo"), 0);
  });

  it("drops an idle worker whose folder vanished, then serves the waiter from a healthy one", async () => {
    const { pool, w1, w2 } = await saturate();
    const p4 = pool.acquire(makeRepo(), "clack/fix/b4", "session-4");
    assert.equal(pool.queueDepth("test-repo"), 1);

    // The worker about to be freed has lost its folder out-of-band (disk wipe / external rm).
    rmSync(w1.worktreePath, { recursive: true, force: true });
    await pool.release(w1, "pr_merged");

    assert.equal(
      pool.list("test-repo").length,
      2,
      "the folder-less worker is dropped from the pool",
    );
    assert.equal(
      pool.queueDepth("test-repo"),
      1,
      "no idle worker remains, so the waiter stays queued",
    );

    await pool.release(w2, "pr_merged");
    const w4 = await p4;
    assert.equal(w4.claimedBy, "session-4");
  });

  it("a setup failure during fulfillment marks the worker failed and clears its claim", async () => {
    const pool = makePool();
    let failSetup = false;
    const runSetup = vi.fn<SetupRunner["runSetup"]>(async () => {
      if (failSetup) throw new Error("setup boom");
    });
    pool.setSetupRunner({ runSetup } satisfies SetupRunner);
    const w1 = await pool.acquire(makeRepo(), "clack/fix/b1", "session-1");
    await pool.acquire(makeRepo(), "clack/fix/b2", "session-2");
    await pool.acquire(makeRepo(), "clack/fix/b3", "session-3");
    const p4 = pool.acquire(makeRepo(), "clack/fix/b4", "session-4");
    assert.equal(pool.queueDepth("test-repo"), 1);

    // Change the setup instructions so the next claim re-runs setup — and make that re-run throw.
    writeSetupInstructions("npm run changed-build");
    failSetup = true;

    await pool.release(w1, "pr_merged");

    await assert.rejects(p4, /setup boom/);
    assert.equal(w1.status, "failed", "a setup failure leaves the worker failed, not idle");
    assert.equal(w1.claimedBy, null, "the rejected session's claim is cleared");
  });

  it("a failed fulfillment rejects only that waiter and leaves others queued", async () => {
    const { pool, w1 } = await saturate();
    gitState.throwCheckoutBranch = "clack/fix/b4";
    const p4 = pool.acquire(makeRepo(), "clack/fix/b4", "session-4");
    const p5 = pool.acquire(makeRepo(), "clack/fix/b5", "session-5");
    assert.equal(pool.queueDepth("test-repo"), 2);

    // Free one worker: the FIFO-first waiter (b4) is dequeued and its branch switch fails.
    await pool.release(w1, "pr_merged");
    await assert.rejects(p4, /fake checkout failure/);
    assert.equal(w1.status, "idle", "failed fulfillment releases the reservation back to idle");
    assert.equal(pool.queueDepth("test-repo"), 1, "the second waiter is untouched");

    // The backstop recovers the still-queued waiter (a worker is now idle).
    gitState.throwCheckoutBranch = "";
    pool.pumpQueuedRepos();
    const w5 = await p5;
    assert.equal(w5.claimedBy, "session-5");
  });
});
