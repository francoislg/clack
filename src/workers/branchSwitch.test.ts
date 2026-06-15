import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { RepositoryConfig } from "../config.js";
import type { Worker } from "./types.js";
import { RemoteBranchNotFound } from "./errors.js";
import { switchBranch } from "./branchSwitch.js";

// Per-test knobs for the fake git boundary: which remote branches exist, and the captured
// `checkout -B <branch> <base>` base so we can assert what the new branch was based on.
const gitState = vi.hoisted(() => ({ remotes: [] as string[], checkoutBase: "" }));

vi.mock("../repositories.js", () => {
  const makeFakeGit = () => ({
    fetch: async () => "",
    branchLocal: async () => ({ all: [] as string[] }),
    branch: async (args: string[]) => {
      if (args.includes("-r")) return { all: gitState.remotes };
      return { all: [] as string[] };
    },
    raw: async (args: string[]) => {
      if (args[0] === "checkout" && args[1] === "-B") {
        gitState.checkoutBase = args[3];
      }
      if (args[0] === "diff") return "";
      return "";
    },
  });
  return {
    getGitInstance: () => makeFakeGit(),
    setAuthenticatedRemote: async () => {},
  };
});

// quarantine.getDirtyTrackedFiles → clean, so the switch proceeds.
vi.mock("./quarantine.js", () => ({
  getDirtyTrackedFiles: async () => [],
  writeQuarantineRecord: () => {},
}));

function makeWorker(): Worker {
  return {
    id: "worker-1",
    repo: "test-repo",
    worktreePath: "/tmp/worker-1",
    currentBranch: "main",
    status: "busy",
    setupComplete: true,
    setupVersionHash: null,
    claimedBy: "s1",
    lastUsedAt: new Date(0),
    createdAt: new Date(0),
  };
}

const repo: RepositoryConfig = {
  name: "test-repo",
  url: "https://github.com/org/test-repo.git",
  description: "t",
  branch: "main",
};

describe("switchBranch resume-from-remote-branch", () => {
  beforeEach(() => {
    gitState.remotes = [];
    gitState.checkoutBase = "";
  });

  it("default (no resume) bases the branch on origin/<default>", async () => {
    await switchBranch(makeWorker(), repo, "clack/feat/new");
    assert.equal(gitState.checkoutBase, "origin/main");
  });

  it("resume bases on the branch's own remote head when it exists", async () => {
    gitState.remotes = ["origin/main", "origin/clack/fix/pr-88"];
    await switchBranch(makeWorker(), repo, "clack/fix/pr-88", true);
    assert.equal(gitState.checkoutBase, "origin/clack/fix/pr-88");
  });

  it("resume throws RemoteBranchNotFound when the remote branch is gone (never clobbers)", async () => {
    gitState.remotes = ["origin/main"];
    await assert.rejects(
      () => switchBranch(makeWorker(), repo, "clack/fix/deleted", true),
      RemoteBranchNotFound,
    );
    assert.equal(gitState.checkoutBase, "", "must not have checked anything out");
  });
});
