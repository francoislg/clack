import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { poolWorkerForChange } from "./poolWorker.js";
import type { ActiveChangeState } from "./activeState.js";
import type { Worker, WorkerPool } from "../workers/types.js";

function makeActiveChange(overrides: Partial<ActiveChangeState> = {}): ActiveChangeState {
  return {
    branch: "feat/x",
    repo: "my-repo",
    description: "d",
    status: "failed",
    startedAt: new Date(),
    lastActivityAt: new Date(),
    worktree: {
      repoName: "my-repo",
      branchName: "feat/x",
      worktreePath: "/tmp/worktrees/my-repo/feat-x",
      createdAt: new Date("2026-01-15T10:00:00Z"),
    },
    ...overrides,
  };
}

function makePool(findByBranch: WorkerPool["findByBranch"]): WorkerPool {
  return {
    acquire: async () => {
      throw new Error("unused");
    },
    release: async () => {},
    findByBranch,
    list: () => [],
    ensureMinimum: async () => {},
  };
}

describe("poolWorkerForChange", () => {
  it("returns null when the change has no worktree bound", () => {
    const pool = makePool(() => null);

    assert.equal(poolWorkerForChange(makeActiveChange({ worktree: undefined }), pool), null);
  });

  it("returns the pool's worker when the branch is tracked", () => {
    const tracked: Worker = {
      id: "worker-2",
      repo: "my-repo",
      worktreePath: "/tmp/worktrees/my-repo/worker-2",
      currentBranch: "feat/x",
      status: "busy",
      setupComplete: true,
      setupVersionHash: "abc",
      claimedBy: "session-1",
      lastUsedAt: new Date(),
      createdAt: new Date(),
    };
    const pool = makePool((repo, branch) =>
      repo === "my-repo" && branch === "feat/x" ? tracked : null,
    );

    assert.equal(poolWorkerForChange(makeActiveChange(), pool), tracked);
  });

  it("synthesizes a worker from the worktree info when the pool misses (disposable mode)", () => {
    const pool = makePool(() => null);

    const worker = poolWorkerForChange(makeActiveChange(), pool);

    assert.ok(worker);
    assert.equal(worker.repo, "my-repo");
    assert.equal(worker.currentBranch, "feat/x");
    assert.equal(worker.worktreePath, "/tmp/worktrees/my-repo/feat-x");
    assert.equal(worker.id, "feat-x");
  });
});
