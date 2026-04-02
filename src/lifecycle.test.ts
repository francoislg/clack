import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ============================================================================
// Mocks
// ============================================================================

const mockLoadConfig = mock.fn(() => ({
  repositories: [{ name: "test-repo" }],
  changesWorkflow: { enabled: false },
  claudeCode: { watchMcpConfig: false },
  allowScheduledMessages: false,
}));
const mockGetConfig = mock.fn(() => mockLoadConfig());

mock.module("./config.js", {
  namedExports: {
    loadConfig: mockLoadConfig,
    getConfig: mockGetConfig,
    getDataDir: () => "/tmp/test",
    getRepositoriesDir: () => "/tmp/test/repositories",
    getSessionsDir: () => "/tmp/test/sessions",
    getWorktreesDir: () => "/tmp/test/worktrees",
    getConfigurationDir: () => "/tmp/test/configuration",
    getDefaultConfigurationDir: () => "/tmp/test/default_configuration",
    getWorktreeSessionsDir: () => "/tmp/test/worktree-sessions",
    findRepoByName: () => undefined,
  },
});

mock.module("dotenv", { namedExports: { config: mock.fn() } });

const mockLoadGitHubCredentials = mock.fn();
const mockClearGitHubTokenCache = mock.fn();
mock.module("./github.js", {
  namedExports: {
    loadGitHubCredentials: mockLoadGitHubCredentials,
    clearGitHubTokenCache: mockClearGitHubTokenCache,
    validateGitHubApp: mock.fn(async () => {}),
    getOctokit: mock.fn(async () => ({})),
    parseRepoUrl: mock.fn(),
    getAuthenticatedCloneUrl: mock.fn(async () => ""),
    getInstallationToken: mock.fn(async () => ({ token: "", permissions: {} })),
  },
});

mock.module("./logger.js", {
  namedExports: {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, startup: () => {} },
  },
});

const mockStartSyncScheduler = mock.fn();
const mockStopSyncScheduler = mock.fn();
const mockInitializeRepositories = mock.fn(async () => {});
const mockSyncAllRepositories = mock.fn(async () => {});
mock.module("./repositories.js", {
  namedExports: {
    startSyncScheduler: mockStartSyncScheduler,
    stopSyncScheduler: mockStopSyncScheduler,
    initializeRepositories: mockInitializeRepositories,
    syncAllRepositories: mockSyncAllRepositories,
  },
});

const mockStartCleanupScheduler = mock.fn();
const mockStopCleanupScheduler = mock.fn();
mock.module("./sessions.js", {
  namedExports: {
    startCleanupScheduler: mockStartCleanupScheduler,
    stopCleanupScheduler: mockStopCleanupScheduler,
  },
});

mock.module("./slack/app.js", {
  namedExports: { getSlackClient: mock.fn(() => null) },
});

const mockEnsureWorktreeDirectories = mock.fn();
mock.module("./worktrees.js", {
  namedExports: { ensureWorktreeDirectories: mockEnsureWorktreeDirectories },
});

const mockStartCompletionMonitor = mock.fn();
const mockStopCompletionMonitor = mock.fn();
mock.module("./changes/monitor.js", {
  namedExports: {
    startCompletionMonitor: mockStartCompletionMonitor,
    stopCompletionMonitor: mockStopCompletionMonitor,
  },
});

const mockValidateInstructionFiles = mock.fn();
mock.module("./instructions.js", {
  namedExports: { validateInstructionFiles: mockValidateInstructionFiles },
});

const mockStartConfigWatcher = mock.fn(() => mock.fn());
mock.module("./configWatcher.js", {
  namedExports: { startConfigWatcher: mockStartConfigWatcher },
});

const mockStartCronScheduler = mock.fn();
const mockStopCronScheduler = mock.fn();
mock.module("./cronScheduler.js", {
  namedExports: {
    startCronScheduler: mockStartCronScheduler,
    stopCronScheduler: mockStopCronScheduler,
  },
});

const mockResetMcpCache = mock.fn();
mock.module("./mcp.js", {
  namedExports: { resetMcpCache: mockResetMcpCache },
});

const mockResetToolMappingCache = mock.fn();
mock.module("./streaming/toolMappingLoader.js", {
  namedExports: { resetToolMappingCache: mockResetToolMappingCache },
});

const mockClearRolesCache = mock.fn();
mock.module("./roles.js", {
  namedExports: { clearRolesCache: mockClearRolesCache },
});

const mockClearPreferencesCache = mock.fn();
mock.module("./userPreferences.js", {
  namedExports: { clearPreferencesCache: mockClearPreferencesCache },
});

const mockClearAutoRespondCache = mock.fn();
mock.module("./autoRespond.js", {
  namedExports: { clearAutoRespondCache: mockClearAutoRespondCache },
});

const mockClearCronJobsCache = mock.fn();
mock.module("./cronJobs.js", {
  namedExports: { clearCronJobsCache: mockClearCronJobsCache },
});

// Import after mocks
const { restartAll } = await import("./lifecycle.js");

// ============================================================================
// Helpers
// ============================================================================

const defaultConfig = () => ({
  repositories: [{ name: "test-repo" }],
  changesWorkflow: { enabled: false },
  claudeCode: { watchMcpConfig: false },
  allowScheduledMessages: false,
});

function resetMocks() {
  for (const fn of [
    mockLoadConfig,
    mockGetConfig,
    mockLoadGitHubCredentials,
    mockClearGitHubTokenCache,
    mockStartSyncScheduler,
    mockStopSyncScheduler,
    mockInitializeRepositories,
    mockSyncAllRepositories,
    mockStartCleanupScheduler,
    mockStopCleanupScheduler,
    mockStartCompletionMonitor,
    mockStopCompletionMonitor,
    mockValidateInstructionFiles,
    mockStartConfigWatcher,
    mockStartCronScheduler,
    mockStopCronScheduler,
    mockResetMcpCache,
    mockResetToolMappingCache,
    mockClearRolesCache,
    mockClearPreferencesCache,
    mockClearAutoRespondCache,
    mockClearCronJobsCache,
    mockEnsureWorktreeDirectories,
  ]) {
    fn.mock.resetCalls();
  }
  // Restore default implementations
  mockLoadConfig.mock.mockImplementation(defaultConfig);
  mockGetConfig.mock.mockImplementation(defaultConfig);
  mockInitializeRepositories.mock.mockImplementation(async () => {});
}

// ============================================================================
// Tests
// ============================================================================

describe("restartAll", () => {
  beforeEach(() => resetMocks());

  it("resets all caches on successful restart", async () => {
    await restartAll();

    assert.equal(mockResetMcpCache.mock.callCount(), 1);
    assert.equal(mockResetToolMappingCache.mock.callCount(), 1);
    assert.equal(mockClearRolesCache.mock.callCount(), 1);
    assert.equal(mockClearPreferencesCache.mock.callCount(), 1);
    assert.equal(mockClearGitHubTokenCache.mock.callCount(), 1);
    assert.equal(mockClearAutoRespondCache.mock.callCount(), 1);
    assert.equal(mockClearCronJobsCache.mock.callCount(), 1);
  });

  it("reloads config before stopping schedulers", async () => {
    const callOrder: string[] = [];
    mockLoadConfig.mock.mockImplementation(() => {
      callOrder.push("loadConfig");
      return {
        repositories: [],
        changesWorkflow: { enabled: false },
        claudeCode: { watchMcpConfig: false },
        allowScheduledMessages: false,
      };
    });
    mockStopSyncScheduler.mock.mockImplementation(() => {
      callOrder.push("stopSync");
    });

    await restartAll();

    const configIdx = callOrder.indexOf("loadConfig");
    const stopIdx = callOrder.indexOf("stopSync");
    assert.ok(configIdx < stopIdx, "loadConfig should be called before stopping schedulers");
  });

  it("aborts without side effects on config validation failure", async () => {
    mockLoadConfig.mock.mockImplementation(() => {
      throw new Error("Invalid config");
    });

    await assert.rejects(() => restartAll(), { message: "Invalid config" });

    // No schedulers should have been stopped or caches reset
    assert.equal(mockStopSyncScheduler.mock.callCount(), 0);
    assert.equal(mockResetMcpCache.mock.callCount(), 0);
    assert.equal(mockClearRolesCache.mock.callCount(), 0);
  });

  it("restarts schedulers after reset", async () => {
    await restartAll();

    assert.equal(mockStopSyncScheduler.mock.callCount(), 1);
    assert.equal(mockStartSyncScheduler.mock.callCount(), 1);
    assert.equal(mockStopCleanupScheduler.mock.callCount(), 1);
    assert.equal(mockStartCleanupScheduler.mock.callCount(), 1);
    assert.equal(mockStopCompletionMonitor.mock.callCount(), 1);
    assert.equal(mockStartCompletionMonitor.mock.callCount(), 1);
  });

  it("returns repo count and warnings", async () => {
    const result = await restartAll();

    assert.equal(result.repoCount, 1);
    assert.ok(Array.isArray(result.warnings));
  });

  it("tolerates non-critical failures and includes them in warnings", async () => {
    mockInitializeRepositories.mock.mockImplementation(async () => {
      throw new Error("clone failed");
    });

    const result = await restartAll();

    assert.ok(result.warnings.some((w) => w.includes("clone failed")));
    // Schedulers should still have been restarted
    assert.equal(mockStartSyncScheduler.mock.callCount(), 1);
  });
});
