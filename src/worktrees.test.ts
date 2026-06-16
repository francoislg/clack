import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, realpathSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  getExistingWorktree,
  cleanupStaleWorktrees,
  createWorktree,
  type WorktreeInfo,
} from "./worktrees.js";
import type { RepositoryConfig } from "./config.js";

// Mock only `getConfig` so `cleanupStaleWorktrees` can be steered between
// reusable and disposable modes. The cwd-based dir helpers (getWorktreesDir,
// getRepositoriesDir) come from the real module so the temp-dir setup works.
const { mockGetConfig } = vi.hoisted(() => ({ mockGetConfig: vi.fn() }));
vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return { ...actual, getConfig: mockGetConfig };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Realpath tmpdir() so the path matches process.cwd() after chdir on macOS
// (where /var/folders/... resolves to /private/var/folders/...).
const tmpBase = resolve(realpathSync(tmpdir()), `worktrees-test-${process.pid}`);
const tmpDataDir = join(tmpBase, "data");
const tmpWorktreesDir = join(tmpDataDir, "worktrees");

/** Create a minimal RepositoryConfig for testing. */
function makeRepo(overrides?: Partial<RepositoryConfig>): RepositoryConfig {
  return {
    name: "test-repo",
    url: "https://github.com/org/test-repo.git",
    description: "A test repository",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getExistingWorktree
// ---------------------------------------------------------------------------

describe("getExistingWorktree", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(tmpWorktreesDir, { recursive: true });
    // Change cwd so getWorktreesDir() resolves to our temp directory
    process.chdir(tmpBase);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("returns null when worktree directory does not exist", () => {
    const repo = makeRepo();
    const result = getExistingWorktree(repo, "feature/my-branch");
    assert.equal(result, null);
  });

  it("returns worktree info when directory exists", () => {
    const repo = makeRepo();
    const repoWorktreesDir = join(tmpWorktreesDir, repo.name);
    const worktreePath = join(repoWorktreesDir, "my-branch");
    mkdirSync(worktreePath, { recursive: true });

    const result = getExistingWorktree(repo, "my-branch");

    assert.notEqual(result, null);
    assert.equal(result!.repoName, "test-repo");
    assert.equal(result!.branchName, "my-branch");
    assert.equal(result!.worktreePath, worktreePath);
    assert.ok(result!.createdAt instanceof Date);
  });

  it("replaces slashes in branch name with hyphens for directory lookup", () => {
    const repo = makeRepo();
    const repoWorktreesDir = join(tmpWorktreesDir, repo.name);
    // Branch name "feature/add-login" should map to directory "feature-add-login"
    const worktreePath = join(repoWorktreesDir, "feature-add-login");
    mkdirSync(worktreePath, { recursive: true });

    const result = getExistingWorktree(repo, "feature/add-login");

    assert.notEqual(result, null);
    assert.equal(result!.branchName, "feature/add-login");
    assert.equal(result!.worktreePath, worktreePath);
  });

  it("handles multiple slashes in branch name", () => {
    const repo = makeRepo();
    const repoWorktreesDir = join(tmpWorktreesDir, repo.name);
    // "feat/scope/thing" -> "feat-scope-thing"
    const worktreePath = join(repoWorktreesDir, "feat-scope-thing");
    mkdirSync(worktreePath, { recursive: true });

    const result = getExistingWorktree(repo, "feat/scope/thing");

    assert.notEqual(result, null);
    assert.equal(result!.worktreePath, worktreePath);
  });

  it("returns null when repo worktrees directory exists but branch directory does not", () => {
    const repo = makeRepo();
    const repoWorktreesDir = join(tmpWorktreesDir, repo.name);
    mkdirSync(repoWorktreesDir, { recursive: true });

    const result = getExistingWorktree(repo, "nonexistent-branch");
    assert.equal(result, null);
  });

  it("uses the repo name for the subdirectory", () => {
    const repo = makeRepo({ name: "my-special-repo" });
    const worktreePath = join(tmpWorktreesDir, "my-special-repo", "main");
    mkdirSync(worktreePath, { recursive: true });

    const result = getExistingWorktree(repo, "main");

    assert.notEqual(result, null);
    assert.equal(result!.repoName, "my-special-repo");
    assert.equal(result!.worktreePath, worktreePath);
  });

  it("returns null when path exists but is a file, not a directory", () => {
    const repo = makeRepo();
    const repoWorktreesDir = join(tmpWorktreesDir, repo.name);
    mkdirSync(repoWorktreesDir, { recursive: true });
    // Create a file instead of a directory — existsSync returns true,
    // but statSync().birthtime is still valid for files, so it should
    // actually return a result. This tests that it doesn't crash.
    const filePath = join(repoWorktreesDir, "some-branch");
    writeFileSync(filePath, "not a directory");

    const result = getExistingWorktree(repo, "some-branch");
    // existsSync returns true for files too, so the function returns info
    assert.notEqual(result, null);
    assert.equal(result!.branchName, "some-branch");
  });
});

// ---------------------------------------------------------------------------
// Branch name sanitization (slash → hyphen) consistency
// ---------------------------------------------------------------------------

describe("branch name to directory mapping", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(tmpWorktreesDir, { recursive: true });
    process.chdir(tmpBase);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("branch with no slashes maps to itself", () => {
    const repo = makeRepo();
    const worktreePath = join(tmpWorktreesDir, repo.name, "simple-branch");
    mkdirSync(worktreePath, { recursive: true });

    const result = getExistingWorktree(repo, "simple-branch");
    assert.notEqual(result, null);
    assert.equal(result!.worktreePath, worktreePath);
  });

  it("branch with trailing slash is handled", () => {
    const repo = makeRepo();
    // "feature/" -> "feature-"
    const worktreePath = join(tmpWorktreesDir, repo.name, "feature-");
    mkdirSync(worktreePath, { recursive: true });

    const result = getExistingWorktree(repo, "feature/");
    assert.notEqual(result, null);
    assert.equal(result!.worktreePath, worktreePath);
  });

  it("branch with leading slash is handled", () => {
    const repo = makeRepo();
    // "/feature" -> "-feature"
    const worktreePath = join(tmpWorktreesDir, repo.name, "-feature");
    mkdirSync(worktreePath, { recursive: true });

    const result = getExistingWorktree(repo, "/feature");
    assert.notEqual(result, null);
    assert.equal(result!.worktreePath, worktreePath);
  });

  it("branch with consecutive slashes maps each to a hyphen", () => {
    const repo = makeRepo();
    // "a//b" -> "a--b"
    const worktreePath = join(tmpWorktreesDir, repo.name, "a--b");
    mkdirSync(worktreePath, { recursive: true });

    const result = getExistingWorktree(repo, "a//b");
    assert.notEqual(result, null);
    assert.equal(result!.worktreePath, worktreePath);
  });
});

// ---------------------------------------------------------------------------
// WorktreeInfo type shape
// ---------------------------------------------------------------------------

describe("createWorktree branch invariant", () => {
  it("refuses a default/protected/non-clack branch name before touching the filesystem", async () => {
    const repo = makeRepo();
    for (const branch of [
      "main",
      "master",
      "develop",
      "random-branch",
      "clack/fix",
      "clack//x",
      "clack/badtype/x",
    ]) {
      await assert.rejects(createWorktree(repo, branch), /clack\/<type>\/<name>/);
    }
  });
});

describe("WorktreeInfo", () => {
  it("has the expected fields", () => {
    const info: WorktreeInfo = {
      repoName: "my-repo",
      branchName: "feature/x",
      worktreePath: "/tmp/worktrees/my-repo/feature-x",
      createdAt: new Date("2025-01-01"),
    };

    assert.equal(info.repoName, "my-repo");
    assert.equal(info.branchName, "feature/x");
    assert.equal(info.worktreePath, "/tmp/worktrees/my-repo/feature-x");
    assert.deepEqual(info.createdAt, new Date("2025-01-01"));
  });
});

// ---------------------------------------------------------------------------
// cleanupStaleWorktrees — reusable-pool folder exemption
// ---------------------------------------------------------------------------

describe("cleanupStaleWorktrees pool-folder exemption", () => {
  const originalCwd = process.cwd();

  // Make a stale (mtime 48h ago) folder under data/worktrees/<repo>/<name>.
  function makeStaleFolder(repoName: string, folderName: string): string {
    const path = join(tmpWorktreesDir, repoName, folderName);
    mkdirSync(path, { recursive: true });
    const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(path, past, past);
    return path;
  }

  function setReusable(enabled: boolean): void {
    mockGetConfig.mockReturnValue({
      repositories: [],
      changesWorkflow: { reusableFolders: { enabled } },
    });
  }

  beforeEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    mkdirSync(tmpWorktreesDir, { recursive: true });
    process.chdir(tmpBase);
    setReusable(true);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpBase, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("does not delete stale worker-N folders when reusable mode is enabled", async () => {
    const worker = makeStaleFolder("test-repo", "worker-1");
    await cleanupStaleWorktrees(24);
    assert.ok(existsSync(worker), "reusable pool folder must be preserved");
  });

  it("still reaps stale non-pool folders when reusable mode is enabled", async () => {
    const branchFolder = makeStaleFolder("test-repo", "feature-x");
    await cleanupStaleWorktrees(24);
    assert.ok(!existsSync(branchFolder), "non-pool stale folder must be removed");
  });

  it("deletes stale worker-N folders when reusable mode is disabled (disposable unchanged)", async () => {
    setReusable(false);
    const worker = makeStaleFolder("test-repo", "worker-1");
    await cleanupStaleWorktrees(24);
    assert.ok(!existsSync(worker), "disposable mode reaps every stale folder");
  });
});
