import { describe, it, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearQuarantineRecord,
  hasUnpushedCommits,
  isQuarantined,
  readDirtyIgnoreGlobs,
  readQuarantineRecord,
  writeQuarantineRecord,
} from "./quarantine.js";
import { QUARANTINE_SIDECAR } from "./persistence.js";
import type { Worker } from "./types.js";

const gitMock = vi.hoisted(() => ({
  raw: (async () => "") as (args: string[]) => Promise<string>,
}));

vi.mock("../repositories.js", () => ({
  getGitInstance: () => ({ raw: (args: string[]) => gitMock.raw(args) }),
}));

let tmpRoot: string;
let originalCwd: string;

function makeWorker(over: Partial<Worker> = {}): Worker {
  const path = mkdtempSync(join(tmpdir(), "wt-"));
  return {
    id: "worker-1",
    repo: "my-repo",
    worktreePath: path,
    currentBranch: "main",
    status: "idle",
    setupComplete: true,
    setupVersionHash: null,
    claimedBy: null,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    ...over,
  };
}

function writeIgnoreGlobs(repo: string, content: string): void {
  const dir = join(tmpRoot, "data", "configuration", repo);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "worktree_dirty_ignore.txt"), content);
}

beforeAll(() => {
  originalCwd = process.cwd();
});

afterAll(() => {
  process.chdir(originalCwd);
});

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "quarantine-"));
  mkdirSync(join(tmpRoot, "data"), { recursive: true });
  process.chdir(tmpRoot);
});

afterEach(() => {
  // Leave the temp dir before removing it: on Windows you cannot rmdir the
  // current working directory (EBUSY).
  process.chdir(originalCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("readDirtyIgnoreGlobs", () => {
  it("returns [] when the file is absent", () => {
    assert.deepEqual(readDirtyIgnoreGlobs("ghost"), []);
  });

  it("returns trimmed non-empty non-comment lines", () => {
    writeIgnoreGlobs(
      "my-repo",
      ["# comment", "", "  ", "package.json", "  pnpm-lock.yaml", "# trailing comment"].join("\n"),
    );
    assert.deepEqual(readDirtyIgnoreGlobs("my-repo"), ["package.json", "pnpm-lock.yaml"]);
  });

  it("preserves order from the file", () => {
    writeIgnoreGlobs("my-repo", ["c", "a", "b"].join("\n"));
    assert.deepEqual(readDirtyIgnoreGlobs("my-repo"), ["c", "a", "b"]);
  });
});

describe("writeQuarantineRecord + readQuarantineRecord + clearQuarantineRecord", () => {
  it("writes then reads back a valid record", () => {
    const worker = makeWorker({ id: "w-7", currentBranch: "feat/x" });
    writeQuarantineRecord(worker, ["src/a.ts", "package.json"]);

    assert.ok(isQuarantined(worker));
    const record = readQuarantineRecord(worker);
    assert.ok(record);
    assert.equal(record!.workerId, "w-7");
    assert.equal(record!.branch, "feat/x");
    assert.deepEqual(record!.dirtyFiles, ["src/a.ts", "package.json"]);
    assert.ok(typeof record!.quarantinedAt === "string");

    rmSync(worker.worktreePath, { recursive: true, force: true });
  });

  it("writeQuarantineRecord is a no-op when the worker dir does not exist", () => {
    const worker = makeWorker();
    rmSync(worker.worktreePath, { recursive: true, force: true });
    assert.doesNotThrow(() => writeQuarantineRecord(worker, ["x"]));
    assert.equal(isQuarantined(worker), false);
  });

  it("readQuarantineRecord returns null when the sidecar is absent", () => {
    const worker = makeWorker();
    assert.equal(readQuarantineRecord(worker), null);
    rmSync(worker.worktreePath, { recursive: true, force: true });
  });

  it("readQuarantineRecord returns null when the sidecar has invalid JSON", () => {
    const worker = makeWorker();
    writeFileSync(join(worker.worktreePath, QUARANTINE_SIDECAR), "not json");
    assert.equal(readQuarantineRecord(worker), null);
    rmSync(worker.worktreePath, { recursive: true, force: true });
  });

  it("readQuarantineRecord returns null when the JSON is structurally invalid", () => {
    const worker = makeWorker();
    writeFileSync(
      join(worker.worktreePath, QUARANTINE_SIDECAR),
      JSON.stringify({ workerId: 123, dirtyFiles: "not-an-array" }),
    );
    assert.equal(readQuarantineRecord(worker), null);
    rmSync(worker.worktreePath, { recursive: true, force: true });
  });

  it("clearQuarantineRecord removes the sidecar", () => {
    const worker = makeWorker();
    writeQuarantineRecord(worker, ["a"]);
    assert.ok(isQuarantined(worker));

    clearQuarantineRecord(worker);
    assert.equal(isQuarantined(worker), false);
    assert.equal(existsSync(join(worker.worktreePath, QUARANTINE_SIDECAR)), false);
    rmSync(worker.worktreePath, { recursive: true, force: true });
  });

  it("clearQuarantineRecord is a no-op when there's nothing to clear", () => {
    const worker = makeWorker();
    assert.doesNotThrow(() => clearQuarantineRecord(worker));
    rmSync(worker.worktreePath, { recursive: true, force: true });
  });
});

describe("hasUnpushedCommits", () => {
  it("returns true when the branch is ahead of its upstream", async () => {
    gitMock.raw = async (args) => {
      assert.deepEqual(args, ["rev-list", "--count", "@{upstream}..HEAD"]);
      return "2\n";
    };
    const worker = makeWorker();

    assert.equal(await hasUnpushedCommits(worker, "main"), true);
    rmSync(worker.worktreePath, { recursive: true, force: true });
  });

  it("returns false when the branch matches its upstream", async () => {
    gitMock.raw = async () => "0\n";
    const worker = makeWorker();

    assert.equal(await hasUnpushedCommits(worker, "main"), false);
    rmSync(worker.worktreePath, { recursive: true, force: true });
  });

  it("falls back to origin/<default> when no upstream is set", async () => {
    const calls: string[][] = [];
    gitMock.raw = async (args) => {
      calls.push(args);
      if (args[2] === "@{upstream}..HEAD") throw new Error("no upstream configured");
      return "3\n";
    };
    const worker = makeWorker();

    assert.equal(await hasUnpushedCommits(worker, "main"), true);
    assert.deepEqual(calls[1], ["rev-list", "--count", "origin/main..HEAD"]);
    rmSync(worker.worktreePath, { recursive: true, force: true });
  });

  it("returns false when no upstream exists but nothing is ahead of origin/<default>", async () => {
    gitMock.raw = async (args) => {
      if (args[2] === "@{upstream}..HEAD") throw new Error("no upstream configured");
      return "0\n";
    };
    const worker = makeWorker();

    assert.equal(await hasUnpushedCommits(worker, "main"), false);
    rmSync(worker.worktreePath, { recursive: true, force: true });
  });

  it("returns true when the push state cannot be read at all", async () => {
    gitMock.raw = async () => {
      throw new Error("not a git repository");
    };
    const worker = makeWorker();

    assert.equal(await hasUnpushedCommits(worker, "main"), true);
    rmSync(worker.worktreePath, { recursive: true, force: true });
  });
});
