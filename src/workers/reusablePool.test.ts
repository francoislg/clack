import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { ReusablePool } from "./reusablePool.js";
import type { RepositoryConfig } from "../config.js";

// Mock the git boundary (no real git/subprocess per test conventions). The fake
// `worktree add` creates the target folder on disk so re-provisioning mirrors
// real git, and `rev-parse` lets reconcile adopt a seeded folder as idle.
// `mkdirSync` is only invoked inside `raw()` at test runtime, after imports init.
vi.mock("../repositories.js", () => {
  const makeFakeGit = () => ({
    fetch: async () => "",
    branchLocal: async () => ({ all: [] as string[] }),
    raw: async (args: string[]) => {
      if (args[0] === "worktree" && args[1] === "add") {
        mkdirSync(args[3], { recursive: true });
        return "";
      }
      if (args[0] === "rev-parse") return "main";
      return "";
    },
  });
  return {
    getGitInstance: () => makeFakeGit(),
    setAuthenticatedRemote: async () => {},
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
