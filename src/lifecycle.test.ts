import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { restartAll } from "./lifecycle.js";
import type { LifecycleDeps } from "./lifecycle.js";

// ============================================================================
// Mocks and Helpers
// ============================================================================

const defaultConfig = () => ({
  repositories: [{ name: "test-repo" }],
  changesWorkflow: { enabled: false },
  claudeCode: { watchMcpConfig: false },
  allowScheduledMessages: false,
});

function createMockDeps(): {
  deps: LifecycleDeps;
  mocks: Record<string, ReturnType<typeof mock.fn>>;
} {
  const mockLoadConfig = mock.fn(defaultConfig);
  const mockGetConfig = mock.fn(defaultConfig);
  const mockDotenvConfig = mock.fn();
  const mockLoadGitHubCredentials = mock.fn();
  const mockClearGitHubTokenCache = mock.fn();
  const mockStartSyncScheduler = mock.fn();
  const mockStopSyncScheduler = mock.fn();
  const mockInitializeRepositories = mock.fn(async () => {});
  const mockSyncAllRepositories = mock.fn(async () => {});
  const mockStartCleanupScheduler = mock.fn();
  const mockStopCleanupScheduler = mock.fn();
  const mockGetSlackClient = mock.fn(() => null);
  const mockEnsureWorktreeDirectories = mock.fn();
  const mockStartCompletionMonitor = mock.fn();
  const mockStopCompletionMonitor = mock.fn();
  const mockValidateInstructionFiles = mock.fn();
  const mockStartConfigWatcher = mock.fn(() => mock.fn());
  const mockStartCronScheduler = mock.fn();
  const mockStopCronScheduler = mock.fn();
  const mockResetMcpCache = mock.fn();
  const mockResetToolMappingCache = mock.fn();
  const mockClearRolesCache = mock.fn();
  const mockClearPreferencesCache = mock.fn();
  const mockClearAutoRespondCache = mock.fn();
  const mockClearCronJobsCache = mock.fn();

  const mocks = {
    mockLoadConfig,
    mockGetConfig,
    mockDotenvConfig,
    mockLoadGitHubCredentials,
    mockClearGitHubTokenCache,
    mockStartSyncScheduler,
    mockStopSyncScheduler,
    mockInitializeRepositories,
    mockSyncAllRepositories,
    mockStartCleanupScheduler,
    mockStopCleanupScheduler,
    mockGetSlackClient,
    mockEnsureWorktreeDirectories,
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
  };

  const deps: LifecycleDeps = {
    dotenvConfig: mockDotenvConfig as Function as LifecycleDeps["dotenvConfig"],
    loadConfig: mockLoadConfig as () => void as LifecycleDeps["loadConfig"],
    getConfig: mockGetConfig as () => void as LifecycleDeps["getConfig"],
    loadGitHubCredentials:
      mockLoadGitHubCredentials as Function as LifecycleDeps["loadGitHubCredentials"],
    clearGitHubTokenCache: mockClearGitHubTokenCache,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, startup: () => {} },
    initializeRepositories: mockInitializeRepositories,
    syncAllRepositories: mockSyncAllRepositories,
    startSyncScheduler: mockStartSyncScheduler,
    stopSyncScheduler: mockStopSyncScheduler,
    startCleanupScheduler: mockStartCleanupScheduler,
    stopCleanupScheduler: mockStopCleanupScheduler,
    getSlackClient: mockGetSlackClient,
    ensureWorktreeDirectories: mockEnsureWorktreeDirectories,
    startCompletionMonitor: mockStartCompletionMonitor,
    stopCompletionMonitor: mockStopCompletionMonitor,
    validateInstructionFiles: mockValidateInstructionFiles,
    startConfigWatcher: mockStartConfigWatcher as Function as LifecycleDeps["startConfigWatcher"],
    startCronScheduler: mockStartCronScheduler,
    stopCronScheduler: mockStopCronScheduler,
    resetMcpCache: mockResetMcpCache,
    resetToolMappingCache: mockResetToolMappingCache,
    clearRolesCache: mockClearRolesCache,
    clearPreferencesCache: mockClearPreferencesCache,
    clearAutoRespondCache: mockClearAutoRespondCache,
    clearCronJobsCache: mockClearCronJobsCache,
  };

  return { deps, mocks };
}

// ============================================================================
// Tests
// ============================================================================

describe("restartAll", () => {
  it("resets all caches on successful restart", async () => {
    const { deps, mocks } = createMockDeps();

    await restartAll(deps);

    assert.equal(mocks.mockResetMcpCache.mock.callCount(), 1);
    assert.equal(mocks.mockResetToolMappingCache.mock.callCount(), 1);
    assert.equal(mocks.mockClearRolesCache.mock.callCount(), 1);
    assert.equal(mocks.mockClearPreferencesCache.mock.callCount(), 1);
    assert.equal(mocks.mockClearGitHubTokenCache.mock.callCount(), 1);
    assert.equal(mocks.mockClearAutoRespondCache.mock.callCount(), 1);
    assert.equal(mocks.mockClearCronJobsCache.mock.callCount(), 1);
  });

  it("reloads config before stopping schedulers", async () => {
    const { deps, mocks } = createMockDeps();
    const callOrder: string[] = [];

    mocks.mockLoadConfig.mock.mockImplementation(() => {
      callOrder.push("loadConfig");
      return {
        repositories: [],
        changesWorkflow: { enabled: false },
        claudeCode: { watchMcpConfig: false },
        allowScheduledMessages: false,
      };
    });
    mocks.mockGetConfig.mock.mockImplementation(() => {
      return {
        repositories: [],
        changesWorkflow: { enabled: false },
        claudeCode: { watchMcpConfig: false },
        allowScheduledMessages: false,
      };
    });
    mocks.mockStopSyncScheduler.mock.mockImplementation(() => {
      callOrder.push("stopSync");
    });

    await restartAll(deps);

    const configIdx = callOrder.indexOf("loadConfig");
    const stopIdx = callOrder.indexOf("stopSync");
    assert.ok(configIdx < stopIdx, "loadConfig should be called before stopping schedulers");
  });

  it("aborts without side effects on config validation failure", async () => {
    const { deps, mocks } = createMockDeps();

    mocks.mockLoadConfig.mock.mockImplementation(() => {
      throw new Error("Invalid config");
    });

    await assert.rejects(() => restartAll(deps), { message: "Invalid config" });

    // No schedulers should have been stopped or caches reset
    assert.equal(mocks.mockStopSyncScheduler.mock.callCount(), 0);
    assert.equal(mocks.mockResetMcpCache.mock.callCount(), 0);
    assert.equal(mocks.mockClearRolesCache.mock.callCount(), 0);
  });

  it("restarts schedulers after reset", async () => {
    const { deps, mocks } = createMockDeps();

    await restartAll(deps);

    assert.equal(mocks.mockStopSyncScheduler.mock.callCount(), 1);
    assert.equal(mocks.mockStartSyncScheduler.mock.callCount(), 1);
    assert.equal(mocks.mockStopCleanupScheduler.mock.callCount(), 1);
    assert.equal(mocks.mockStartCleanupScheduler.mock.callCount(), 1);
    assert.equal(mocks.mockStopCompletionMonitor.mock.callCount(), 1);
    assert.equal(mocks.mockStartCompletionMonitor.mock.callCount(), 1);
  });

  it("returns repo count and warnings", async () => {
    const { deps } = createMockDeps();

    const result = await restartAll(deps);

    assert.equal(result.repoCount, 1);
    assert.ok(Array.isArray(result.warnings));
  });

  it("tolerates non-critical failures and includes them in warnings", async () => {
    const { deps, mocks } = createMockDeps();

    mocks.mockInitializeRepositories.mock.mockImplementation(async () => {
      throw new Error("clone failed");
    });

    const result = await restartAll(deps);

    assert.ok(result.warnings.some((w) => w.includes("clone failed")));
    // Schedulers should still have been restarted
    assert.equal(mocks.mockStartSyncScheduler.mock.callCount(), 1);
  });
});
