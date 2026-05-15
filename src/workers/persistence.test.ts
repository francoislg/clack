import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  loadPoolState,
  QUARANTINE_SIDECAR,
  reconcilePoolState,
  readWorkerSidecar,
  savePoolState,
  writeWorkerSidecar,
} from "./persistence.js";
import type { Worker, WorkerStatus } from "./types.js";

let tmpRoot: string;
let originalCwd: string;

function makeWorker(over: Partial<Worker> = {}): Worker {
  return {
    id: "worker-1",
    repo: "my-repo",
    worktreePath: join(tmpRoot, "data", "worktrees", "my-repo", "worker-1"),
    currentBranch: null,
    status: "idle",
    setupComplete: true,
    setupVersionHash: null,
    claimedBy: null,
    lastUsedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...over,
  };
}

/**
 * Create a real git worktree-like folder rooted under tmpRoot. We `git init`
 * inside the worker folder so `reconcilePoolState`'s `git rev-parse` succeeds.
 * For tests we only care that HEAD reports the expected branch.
 */
function makeWorkerFolder(repo: string, workerId: string, branch: string | null): string {
  const path = resolve(tmpRoot, "data", "worktrees", repo, workerId);
  mkdirSync(path, { recursive: true });
  execSync("git init -q", { cwd: path });
  execSync("git config user.email test@example.com", { cwd: path });
  execSync("git config user.name test", { cwd: path });
  // Empty commit so HEAD is valid
  execSync("git commit --allow-empty -m init -q", { cwd: path });
  if (branch === null) {
    // Detach HEAD
    const sha = execSync("git rev-parse HEAD", { cwd: path }).toString().trim();
    execSync(`git checkout -q --detach ${sha}`, { cwd: path });
  } else {
    execSync(`git checkout -B ${branch} -q`, { cwd: path });
  }
  return path;
}

before(() => {
  originalCwd = process.cwd();
});

after(() => {
  process.chdir(originalCwd);
});

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "persistence-"));
  mkdirSync(join(tmpRoot, "data"), { recursive: true });
  process.chdir(tmpRoot);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("savePoolState + loadPoolState", () => {
  it("loadPoolState returns [] when workers.json is absent", () => {
    assert.deepEqual(loadPoolState(), []);
  });

  it("savePoolState then loadPoolState round-trips", () => {
    const original = [
      makeWorker({ id: "worker-1", currentBranch: "feat/x" }),
      makeWorker({ id: "worker-2", currentBranch: null, status: "quarantined" }),
    ];
    savePoolState(original);

    const loaded = loadPoolState();
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0]!.id, "worker-1");
    assert.equal(loaded[0]!.currentBranch, "feat/x");
    assert.equal(loaded[1]!.status, "quarantined");
    assert.ok(loaded[0]!.lastUsedAt instanceof Date);
  });

  it("loadPoolState returns [] when workers.json has invalid shape", () => {
    const statePath = join(tmpRoot, "data", "state", "workers.json");
    mkdirSync(join(tmpRoot, "data", "state"), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ version: 999, workers: [] }));
    assert.deepEqual(loadPoolState(), []);
  });

  it("loadPoolState returns [] when workers.json is not valid JSON", () => {
    const statePath = join(tmpRoot, "data", "state", "workers.json");
    mkdirSync(join(tmpRoot, "data", "state"), { recursive: true });
    writeFileSync(statePath, "{ not json");
    assert.deepEqual(loadPoolState(), []);
  });

  it("savePoolState writes atomically (no tmp left behind on success)", () => {
    const w = makeWorker();
    savePoolState([w]);
    const statePath = join(tmpRoot, "data", "state", "workers.json");
    assert.ok(existsSync(statePath));
    assert.equal(existsSync(`${statePath}.tmp`), false);
  });
});

describe("writeWorkerSidecar + readWorkerSidecar", () => {
  it("writes the sidecar inside the worker dir when it exists", () => {
    const path = makeWorkerFolder("my-repo", "worker-1", "main");
    const worker = makeWorker({ worktreePath: path, currentBranch: "main" });
    writeWorkerSidecar(worker);

    const round = readWorkerSidecar(path);
    assert.ok(round);
    assert.equal(round!.id, "worker-1");
    assert.equal(round!.currentBranch, "main");
  });

  it("writeWorkerSidecar silently skips when the worker dir is absent", () => {
    const worker = makeWorker({ worktreePath: join(tmpRoot, "missing") });
    assert.doesNotThrow(() => writeWorkerSidecar(worker));
  });

  it("readWorkerSidecar returns null on missing or malformed sidecar", () => {
    const path = makeWorkerFolder("my-repo", "worker-1", "main");
    assert.equal(readWorkerSidecar(path), null);

    writeFileSync(join(path, ".clack-worker-state.json"), "not json");
    assert.equal(readWorkerSidecar(path), null);
  });
});

describe("reconcilePoolState — stale-claim normalization", () => {
  it("resets `busy` workers to `idle` on restart and clears the claim", async () => {
    const path = makeWorkerFolder("my-repo", "worker-1", "feat/x");
    const persisted: Worker = makeWorker({
      worktreePath: path,
      currentBranch: "feat/x",
      status: "busy",
      claimedBy: "dead-session",
    });
    savePoolState([persisted]);

    const reconciled = await reconcilePoolState();
    assert.equal(reconciled.length, 1);
    assert.equal(reconciled[0]!.status, "idle");
    assert.equal(reconciled[0]!.claimedBy, null);
    assert.equal(reconciled[0]!.currentBranch, "feat/x");
  });

  it("resets `initializing` workers to `idle` (setup never finished)", async () => {
    const path = makeWorkerFolder("my-repo", "worker-2", "main");
    const persisted: Worker = makeWorker({
      id: "worker-2",
      worktreePath: path,
      currentBranch: "main",
      status: "initializing",
      claimedBy: null,
    });
    savePoolState([persisted]);

    const reconciled = await reconcilePoolState();
    assert.equal(reconciled[0]!.status, "idle");
  });

  it("preserves `quarantined` status across restart", async () => {
    const path = makeWorkerFolder("my-repo", "worker-3", "feat/bad");
    writeFileSync(join(path, QUARANTINE_SIDECAR), JSON.stringify({ workerId: "worker-3" }));
    const persisted: Worker = makeWorker({
      id: "worker-3",
      worktreePath: path,
      currentBranch: "feat/bad",
      status: "quarantined",
    });
    savePoolState([persisted]);

    const reconciled = await reconcilePoolState();
    assert.equal(reconciled[0]!.status, "quarantined");
  });

  it("preserves `failed` status across restart", async () => {
    const path = makeWorkerFolder("my-repo", "worker-4", "main");
    const persisted: Worker = makeWorker({
      id: "worker-4",
      worktreePath: path,
      currentBranch: "main",
      status: "failed",
    });
    savePoolState([persisted]);

    const reconciled = await reconcilePoolState();
    assert.equal(reconciled[0]!.status, "failed");
  });

  it("forces `quarantined` when the sidecar exists, even if state.json says otherwise", async () => {
    const path = makeWorkerFolder("my-repo", "worker-5", "main");
    writeFileSync(join(path, QUARANTINE_SIDECAR), "{}");
    const persisted: Worker = makeWorker({
      id: "worker-5",
      worktreePath: path,
      currentBranch: "main",
      status: "busy",
      claimedBy: "ghost-session",
    });
    savePoolState([persisted]);

    const reconciled = await reconcilePoolState();
    assert.equal(reconciled[0]!.status, "quarantined");
  });
});

describe("reconcilePoolState — disk vs state divergence", () => {
  it("uses disk's actual branch when state.json disagrees", async () => {
    const path = makeWorkerFolder("my-repo", "worker-1", "feat/actual");
    const persisted: Worker = makeWorker({
      worktreePath: path,
      currentBranch: "feat/stale-from-state-json",
    });
    savePoolState([persisted]);

    const reconciled = await reconcilePoolState();
    assert.equal(reconciled[0]!.currentBranch, "feat/actual");
  });

  it("adopts an orphan `worker-N` folder as a fresh idle worker", async () => {
    makeWorkerFolder("my-repo", "worker-7", "main");
    // No state.json entry for this worker.

    const reconciled = await reconcilePoolState();
    assert.equal(reconciled.length, 1);
    assert.equal(reconciled[0]!.id, "worker-7");
    assert.equal(reconciled[0]!.status, "idle");
    assert.equal(reconciled[0]!.setupComplete, true);
  });

  it("ignores non-worker-N folders on disk", async () => {
    makeWorkerFolder("my-repo", "worker-1", "main");
    // Legacy disposable-style folder name — should NOT be adopted.
    const legacyPath = resolve(tmpRoot, "data", "worktrees", "my-repo", "clack-feat-x");
    mkdirSync(legacyPath, { recursive: true });

    const reconciled = await reconcilePoolState();
    const ids = reconciled.map((w) => w.id).sort();
    assert.deepEqual(ids, ["worker-1"]);
  });

  it("prunes state-only entries whose folder no longer exists", async () => {
    // Persisted state references a worker folder that we never create.
    const persisted: Worker = makeWorker({
      id: "worker-ghost",
      worktreePath: join(tmpRoot, "data", "worktrees", "my-repo", "worker-ghost"),
    });
    savePoolState([persisted]);

    const reconciled = await reconcilePoolState();
    assert.equal(reconciled.length, 0);
  });

  it("returns [] and prunes state when the worktrees dir does not exist", async () => {
    const persisted: Worker = makeWorker({ id: "worker-1" });
    savePoolState([persisted]);
    rmSync(join(tmpRoot, "data", "worktrees"), { recursive: true, force: true });

    const reconciled = await reconcilePoolState();
    assert.equal(reconciled.length, 0);
    // workers.json should now reflect the pruned state
    assert.deepEqual(loadPoolState(), []);
  });
});

describe("reconcilePoolState — multiple repos and statuses", () => {
  it("scans all repos and returns combined results", async () => {
    makeWorkerFolder("repo-a", "worker-1", "main");
    makeWorkerFolder("repo-b", "worker-1", "feat/y");

    const reconciled = await reconcilePoolState();
    assert.equal(reconciled.length, 2);
    const byRepo = new Map<string, WorkerStatus>(reconciled.map((w) => [w.repo, w.status]));
    assert.equal(byRepo.get("repo-a"), "idle");
    assert.equal(byRepo.get("repo-b"), "idle");
  });
});
