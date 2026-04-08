import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  getGitInstance,
  setAuthenticatedRemote,
  cloneRepository,
  syncRepository,
  syncAllRepositories,
  initializeRepositories,
  startSyncScheduler,
  stopSyncScheduler,
  setRepositoriesDeps,
  resetRepositoriesDeps,
  type RepositoriesDeps,
} from "./repositories.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExistsSync = mock.fn<(path: string) => boolean>();
const mockMkdirSync = mock.fn<(path: string, opts?: { recursive: boolean }) => void>();

// Mock simple-git: simpleGit() returns a mock git instance
const mockGitClone = mock.fn<(url: string, path: string, opts?: string[]) => Promise<void>>();
const mockGitFetch = mock.fn<(remote: string, branch: string) => Promise<void>>();
const mockGitCheckout = mock.fn<(opts: string[]) => Promise<void>>();
const mockGitReset = mock.fn<(opts: string[]) => Promise<void>>();
const mockGitRemote = mock.fn<(opts: string[]) => Promise<void>>();

const mockGitInstance = {
  clone: mockGitClone,
  fetch: mockGitFetch,
  checkout: mockGitCheckout,
  reset: mockGitReset,
  remote: mockGitRemote,
};

interface SimpleGitOptions {
  baseDir?: string;
}

// Mock config module
const mockGetConfig = mock.fn<
  () => {
    repositories: Array<{ name: string; url: string; description: string; branch?: string }>;
    git: { pullIntervalMinutes: number; shallowClone: boolean; cloneDepth: number };
  }
>();
const mockGetRepositoriesDir = mock.fn<() => string>();

// Mock github module
const mockGetAuthenticatedCloneUrl = mock.fn<(url: string) => Promise<string>>();

const mockSimpleGit = mock.fn<(opts?: SimpleGitOptions) => typeof mockGitInstance>(
  () => mockGitInstance,
);

function makeDeps(): RepositoriesDeps {
  return {
    existsSync: mockExistsSync as RepositoriesDeps["existsSync"],
    mkdirSync: mockMkdirSync as Function as RepositoriesDeps["mkdirSync"],
    simpleGit: mockSimpleGit as Function as RepositoriesDeps["simpleGit"],
    getConfig: mockGetConfig as () => void as RepositoriesDeps["getConfig"],
    getRepositoriesDir: mockGetRepositoriesDir,
    getAuthenticatedCloneUrl: mockGetAuthenticatedCloneUrl,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(
  overrides?: Partial<{ name: string; url: string; description: string; branch: string }>,
) {
  return {
    name: "test-repo",
    url: "https://github.com/org/test-repo.git",
    description: "A test repository",
    ...overrides,
  };
}

function defaultConfig(
  overrides?: Partial<{
    shallowClone: boolean;
    cloneDepth: number;
    pullIntervalMinutes: number;
    repositories: Array<{ name: string; url: string; description: string; branch?: string }>;
  }>,
) {
  return {
    repositories: overrides?.repositories ?? [makeRepo()],
    git: {
      pullIntervalMinutes: overrides?.pullIntervalMinutes ?? 60,
      shallowClone: overrides?.shallowClone ?? true,
      cloneDepth: overrides?.cloneDepth ?? 1,
    },
  };
}

function resetAllMocks(): void {
  mockExistsSync.mock.resetCalls();
  mockMkdirSync.mock.resetCalls();
  mockGitClone.mock.resetCalls();
  mockGitFetch.mock.resetCalls();
  mockGitCheckout.mock.resetCalls();
  mockGitReset.mock.resetCalls();
  mockGitRemote.mock.resetCalls();
  mockSimpleGit.mock.resetCalls();
  mockGetConfig.mock.resetCalls();
  mockGetRepositoriesDir.mock.resetCalls();
  mockGetAuthenticatedCloneUrl.mock.resetCalls();

  // Defaults
  mockExistsSync.mock.mockImplementation(() => false);
  mockMkdirSync.mock.mockImplementation(() => {});
  mockGetRepositoriesDir.mock.mockImplementation(() => "/data/repositories");
  mockGetConfig.mock.mockImplementation(() => defaultConfig());
  mockGetAuthenticatedCloneUrl.mock.mockImplementation(
    async (_url: string) => `https://x-access-token:TOKEN@github.com/org/test-repo.git`,
  );
  mockGitClone.mock.mockImplementation(async () => {});
  mockGitFetch.mock.mockImplementation(async () => {});
  mockGitCheckout.mock.mockImplementation(async () => {});
  mockGitReset.mock.mockImplementation(async () => {});
  mockGitRemote.mock.mockImplementation(async () => {});

  resetRepositoriesDeps();
}

// ---------------------------------------------------------------------------
// getGitInstance
// ---------------------------------------------------------------------------

describe("getGitInstance", () => {
  beforeEach(resetAllMocks);

  it("calls simpleGit with empty options when no baseDir provided", () => {
    setRepositoriesDeps(makeDeps());
    getGitInstance();
    assert.equal(mockSimpleGit.mock.callCount(), 1);
    const args = mockSimpleGit.mock.calls[0].arguments[0] as SimpleGitOptions;
    assert.equal(args.baseDir, undefined);
  });

  it("calls simpleGit with baseDir when provided", () => {
    setRepositoriesDeps(makeDeps());
    getGitInstance("/some/path");
    assert.equal(mockSimpleGit.mock.callCount(), 1);
    const args = mockSimpleGit.mock.calls[0].arguments[0] as SimpleGitOptions;
    assert.equal(args.baseDir, "/some/path");
  });
});

// ---------------------------------------------------------------------------
// setAuthenticatedRemote
// ---------------------------------------------------------------------------

describe("setAuthenticatedRemote", () => {
  beforeEach(resetAllMocks);

  it("sets the remote URL to an authenticated URL", async () => {
    mockGetAuthenticatedCloneUrl.mock.mockImplementation(
      async () => "https://x-access-token:FRESH@github.com/org/repo.git",
    );
    setRepositoriesDeps(makeDeps());

    await setAuthenticatedRemote("/repo/path", "https://github.com/org/repo.git");

    assert.equal(mockGetAuthenticatedCloneUrl.mock.callCount(), 1);
    assert.equal(
      mockGetAuthenticatedCloneUrl.mock.calls[0].arguments[0],
      "https://github.com/org/repo.git",
    );

    assert.equal(mockGitRemote.mock.callCount(), 1);
    const remoteArgs = mockGitRemote.mock.calls[0].arguments[0];
    assert.deepEqual(remoteArgs, [
      "set-url",
      "origin",
      "https://x-access-token:FRESH@github.com/org/repo.git",
    ]);
  });

  it("creates a git instance with the repo path as baseDir", async () => {
    setRepositoriesDeps(makeDeps());
    await setAuthenticatedRemote("/my/repo", "https://github.com/org/repo.git");

    // simpleGit should be called with baseDir = /my/repo
    const call = mockSimpleGit.mock.calls.find(
      (c) => (c.arguments[0] as SimpleGitOptions)?.baseDir === "/my/repo",
    );
    assert.ok(call, "Expected simpleGit to be called with baseDir /my/repo");
  });
});

// ---------------------------------------------------------------------------
// cloneRepository
// ---------------------------------------------------------------------------

describe("cloneRepository", () => {
  beforeEach(resetAllMocks);

  it("creates the repositories directory if it does not exist", async () => {
    // First call (reposDir) returns false, second call (repoPath) returns false
    let _callCount = 0;
    mockExistsSync.mock.mockImplementation(() => {
      _callCount++;
      return false;
    });
    setRepositoriesDeps(makeDeps());

    await cloneRepository(makeRepo());

    assert.equal(mockMkdirSync.mock.callCount(), 1);
    const mkdirArgs = mockMkdirSync.mock.calls[0].arguments;
    assert.equal(mkdirArgs[0], "/data/repositories");
  });

  it("skips cloning if the repository directory already exists", async () => {
    let callCount = 0;
    mockExistsSync.mock.mockImplementation(() => {
      callCount++;
      // First call: reposDir (doesn't matter), Second call: repoPath exists
      return callCount >= 2;
    });
    setRepositoriesDeps(makeDeps());

    await cloneRepository(makeRepo());

    assert.equal(mockGitClone.mock.callCount(), 0);
  });

  it("clones with shallow clone options when configured", async () => {
    mockGetConfig.mock.mockImplementation(() =>
      defaultConfig({ shallowClone: true, cloneDepth: 5 }),
    );
    setRepositoriesDeps(makeDeps());

    await cloneRepository(makeRepo());

    assert.equal(mockGitClone.mock.callCount(), 1);
    const cloneArgs = mockGitClone.mock.calls[0].arguments;
    const options = cloneArgs[2] as string[];
    assert.ok(options.includes("--depth"));
    assert.ok(options.includes("5"));
  });

  it("clones without shallow options when shallowClone is false", async () => {
    mockGetConfig.mock.mockImplementation(() => defaultConfig({ shallowClone: false }));
    setRepositoriesDeps(makeDeps());

    await cloneRepository(makeRepo());

    assert.equal(mockGitClone.mock.callCount(), 1);
    const options = mockGitClone.mock.calls[0].arguments[2] as string[];
    assert.ok(!options.includes("--depth"));
  });

  it("includes --branch option when repo has a branch configured", async () => {
    setRepositoriesDeps(makeDeps());
    await cloneRepository(makeRepo({ branch: "develop" }));

    assert.equal(mockGitClone.mock.callCount(), 1);
    const options = mockGitClone.mock.calls[0].arguments[2] as string[];
    assert.ok(options.includes("--branch"));
    assert.ok(options.includes("develop"));
  });

  it("does not include --branch option when no branch configured", async () => {
    setRepositoriesDeps(makeDeps());
    await cloneRepository(makeRepo());

    assert.equal(mockGitClone.mock.callCount(), 1);
    const options = mockGitClone.mock.calls[0].arguments[2] as string[];
    assert.ok(!options.includes("--branch"));
  });

  it("uses the authenticated clone URL", async () => {
    mockGetAuthenticatedCloneUrl.mock.mockImplementation(
      async () => "https://x-access-token:SECRET@github.com/org/test-repo.git",
    );
    setRepositoriesDeps(makeDeps());

    await cloneRepository(makeRepo());

    assert.equal(mockGitClone.mock.callCount(), 1);
    const url = mockGitClone.mock.calls[0].arguments[0];
    assert.equal(url, "https://x-access-token:SECRET@github.com/org/test-repo.git");
  });

  it("clones to the correct repo path", async () => {
    setRepositoriesDeps(makeDeps());
    await cloneRepository(makeRepo({ name: "my-project" }));

    assert.equal(mockGitClone.mock.callCount(), 1);
    const repoPath = mockGitClone.mock.calls[0].arguments[1];
    assert.ok(repoPath.endsWith("/my-project"));
  });
});

// ---------------------------------------------------------------------------
// syncRepository
// ---------------------------------------------------------------------------

describe("syncRepository", () => {
  beforeEach(resetAllMocks);

  it("falls back to cloneRepository when repo path does not exist", async () => {
    // existsSync returns false for repoPath (first call in syncRepository)
    // then also for subsequent calls in cloneRepository
    mockExistsSync.mock.mockImplementation(() => false);
    setRepositoriesDeps(makeDeps());

    await syncRepository(makeRepo());

    // Should have cloned since the repo didn't exist
    assert.equal(mockGitClone.mock.callCount(), 1);
    // Should NOT have fetched (sync path was not taken)
    assert.equal(mockGitFetch.mock.callCount(), 0);
  });

  it("fetches, checkouts, and resets when repo exists", async () => {
    let callCount = 0;
    mockExistsSync.mock.mockImplementation(() => {
      callCount++;
      return callCount === 1; // First call in syncRepository: repo exists
    });
    setRepositoriesDeps(makeDeps());

    await syncRepository(makeRepo());

    assert.equal(mockGitFetch.mock.callCount(), 1);
    assert.equal(mockGitCheckout.mock.callCount(), 1);
    assert.equal(mockGitReset.mock.callCount(), 1);
  });

  it("uses the repo branch or defaults to main", async () => {
    mockExistsSync.mock.mockImplementation(() => true);
    setRepositoriesDeps(makeDeps());

    await syncRepository(makeRepo({ branch: "develop" }));

    // fetch should use the branch
    const fetchArgs = mockGitFetch.mock.calls[0].arguments;
    assert.equal(fetchArgs[0], "origin");
    assert.equal(fetchArgs[1], "develop");

    // checkout should force-checkout the branch
    const checkoutArgs = mockGitCheckout.mock.calls[0].arguments[0];
    assert.deepEqual(checkoutArgs, ["-f", "develop"]);

    // reset should target origin/<branch>
    const resetArgs = mockGitReset.mock.calls[0].arguments[0];
    assert.deepEqual(resetArgs, ["--hard", "origin/develop"]);
  });

  it("defaults to main branch when no branch specified", async () => {
    mockExistsSync.mock.mockImplementation(() => true);
    setRepositoriesDeps(makeDeps());

    await syncRepository(makeRepo());

    const fetchArgs = mockGitFetch.mock.calls[0].arguments;
    assert.equal(fetchArgs[1], "main");
  });

  it("refreshes the authenticated remote before fetching", async () => {
    mockExistsSync.mock.mockImplementation(() => true);
    setRepositoriesDeps(makeDeps());

    await syncRepository(makeRepo());

    // setAuthenticatedRemote calls getAuthenticatedCloneUrl and git.remote
    assert.equal(mockGetAuthenticatedCloneUrl.mock.callCount(), 1);
    assert.equal(mockGitRemote.mock.callCount(), 1);
  });
});

// ---------------------------------------------------------------------------
// syncAllRepositories
// ---------------------------------------------------------------------------

describe("syncAllRepositories", () => {
  beforeEach(resetAllMocks);

  it("syncs all repositories from config", async () => {
    const repos = [makeRepo({ name: "repo-a" }), makeRepo({ name: "repo-b" })];
    mockGetConfig.mock.mockImplementation(() => defaultConfig({ repositories: repos }));
    // All repos exist
    mockExistsSync.mock.mockImplementation(() => true);
    setRepositoriesDeps(makeDeps());

    await syncAllRepositories();

    // Each sync calls fetch once
    assert.equal(mockGitFetch.mock.callCount(), 2);
  });

  it("continues syncing remaining repositories when one fails", async () => {
    const repos = [makeRepo({ name: "repo-a" }), makeRepo({ name: "repo-b" })];
    mockGetConfig.mock.mockImplementation(() => defaultConfig({ repositories: repos }));
    mockExistsSync.mock.mockImplementation(() => true);

    // First fetch fails, second succeeds
    let fetchCount = 0;
    mockGitFetch.mock.mockImplementation(async () => {
      fetchCount++;
      if (fetchCount === 1) throw new Error("Network error");
    });
    setRepositoriesDeps(makeDeps());

    // Should not throw
    await syncAllRepositories();

    // Both repos were attempted
    assert.equal(fetchCount, 2);
  });

  it("handles empty repository list", async () => {
    mockGetConfig.mock.mockImplementation(() => defaultConfig({ repositories: [] }));
    setRepositoriesDeps(makeDeps());

    await syncAllRepositories();

    assert.equal(mockGitFetch.mock.callCount(), 0);
  });
});

// ---------------------------------------------------------------------------
// initializeRepositories
// ---------------------------------------------------------------------------

describe("initializeRepositories", () => {
  beforeEach(resetAllMocks);

  it("creates the repositories directory if it does not exist", async () => {
    mockGetConfig.mock.mockImplementation(() => defaultConfig({ repositories: [] }));
    setRepositoriesDeps(makeDeps());

    await initializeRepositories();

    assert.equal(mockMkdirSync.mock.callCount(), 1);
    assert.equal(mockMkdirSync.mock.calls[0].arguments[0], "/data/repositories");
  });

  it("skips mkdir when the repositories directory already exists", async () => {
    mockExistsSync.mock.mockImplementation(() => true);
    mockGetConfig.mock.mockImplementation(() => defaultConfig({ repositories: [] }));
    setRepositoriesDeps(makeDeps());

    await initializeRepositories();

    assert.equal(mockMkdirSync.mock.callCount(), 0);
  });

  it("clones all configured repositories", async () => {
    const repos = [makeRepo({ name: "repo-a" }), makeRepo({ name: "repo-b" })];
    mockGetConfig.mock.mockImplementation(() => defaultConfig({ repositories: repos }));
    setRepositoriesDeps(makeDeps());

    await initializeRepositories();

    assert.equal(mockGitClone.mock.callCount(), 2);
  });

  it("continues cloning when one repository fails", async () => {
    const repos = [makeRepo({ name: "repo-a" }), makeRepo({ name: "repo-b" })];
    mockGetConfig.mock.mockImplementation(() => defaultConfig({ repositories: repos }));

    let cloneCount = 0;
    mockGitClone.mock.mockImplementation(async () => {
      cloneCount++;
      if (cloneCount === 1) throw new Error("Clone failed");
    });
    setRepositoriesDeps(makeDeps());

    await initializeRepositories();

    // Both repos were attempted
    assert.equal(cloneCount, 2);
  });
});

// ---------------------------------------------------------------------------
// startSyncScheduler / stopSyncScheduler
// ---------------------------------------------------------------------------

describe("startSyncScheduler", () => {
  beforeEach(resetAllMocks);

  afterEach(() => {
    stopSyncScheduler();
  });

  it("starts a scheduler based on config interval", () => {
    mockGetConfig.mock.mockImplementation(() => defaultConfig({ pullIntervalMinutes: 30 }));
    setRepositoriesDeps(makeDeps());

    // Should not throw
    startSyncScheduler();

    // Clean up
    stopSyncScheduler();
  });
});

describe("stopSyncScheduler", () => {
  beforeEach(resetAllMocks);

  it("stops the scheduler without error when not started", () => {
    // Should not throw
    stopSyncScheduler();
  });

  it("stops the scheduler when running", () => {
    mockGetConfig.mock.mockImplementation(() => defaultConfig({ pullIntervalMinutes: 60 }));
    setRepositoriesDeps(makeDeps());
    startSyncScheduler();
    stopSyncScheduler();
    // Calling again should be safe
    stopSyncScheduler();
  });
});
