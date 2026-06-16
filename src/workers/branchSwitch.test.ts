import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { RepositoryConfig } from "../config.js";
import type { Worker } from "./types.js";
import { RemoteBranchNotFound, RemoteBranchUnreachable } from "./errors.js";
import { switchBranch } from "./branchSwitch.js";

// Per-test knobs for the fake git boundary: which remote branches exist, the captured
// `checkout -B <branch> <base>` base, and an optional error the targeted fetch throws.
const gitState = vi.hoisted(() => ({
  remotes: [] as string[],
  checkoutBase: "",
  fetchError: null as Error | null,
}));

vi.mock("../repositories.js", () => {
  const makeFakeGit = () => ({
    fetch: async (remote?: unknown, ref?: unknown) => {
      // Only the targeted resume fetch (origin <branch>:...) honors the error knob.
      if (gitState.fetchError && remote === "origin" && typeof ref === "string") {
        throw gitState.fetchError;
      }
      return "";
    },
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
    gitState.fetchError = null;
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

  it("resume throws RemoteBranchNotFound when the targeted fetch reports a missing ref", async () => {
    gitState.remotes = ["origin/main"];
    gitState.fetchError = new Error("fatal: couldn't find remote ref clack/fix/deleted");
    await assert.rejects(
      () => switchBranch(makeWorker(), repo, "clack/fix/deleted", true),
      RemoteBranchNotFound,
    );
    assert.equal(gitState.checkoutBase, "");
  });

  it("resume throws RemoteBranchUnreachable when the fetch fails for another reason", async () => {
    gitState.remotes = ["origin/main"];
    gitState.fetchError = new Error("fatal: unable to access remote: Connection timed out");
    await assert.rejects(
      () => switchBranch(makeWorker(), repo, "clack/fix/pr-88", true),
      RemoteBranchUnreachable,
    );
    assert.equal(gitState.checkoutBase, "");
  });
});
