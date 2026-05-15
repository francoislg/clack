import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { restartAll } from "./lifecycle.js";
import type { LifecycleDeps } from "./lifecycle.js";
import type { LoadedPlugins } from "./plugins/registry.js";

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
  const mockInstallAllPinnedMcpServers = mock.fn(async () => ({ failed: [] as string[] }));
  const mockResetToolMappingCache = mock.fn();
  const mockClearRolesCache = mock.fn();
  const mockClearPreferencesCache = mock.fn();
  const mockClearAutoRespondCache = mock.fn();
  const mockClearCronJobsCache = mock.fn();
  const mockLoadPlugins = mock.fn(
    async (_pluginNames: string[]): Promise<LoadedPlugins> => ({ results: [] }),
  );
  const mockSetLoadedPlugins = mock.fn((_plugins: LoadedPlugins): void => {});

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
    mockInstallAllPinnedMcpServers,
    mockResetToolMappingCache,
    mockClearRolesCache,
    mockClearPreferencesCache,
    mockClearAutoRespondCache,
    mockClearCronJobsCache,
    mockLoadPlugins,
    mockSetLoadedPlugins,
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
    installAllPinnedMcpServers: mockInstallAllPinnedMcpServers,
    resetToolMappingCache: mockResetToolMappingCache,
    clearRolesCache: mockClearRolesCache,
    clearPreferencesCache: mockClearPreferencesCache,
    clearAutoRespondCache: mockClearAutoRespondCache,
    clearCronJobsCache: mockClearCronJobsCache,
    loadPlugins: mockLoadPlugins,
    setLoadedPlugins: mockSetLoadedPlugins,
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

  it("re-installs pinned MCP servers after resetting caches", async () => {
    const { deps, mocks } = createMockDeps();
    const callOrder: string[] = [];

    mocks.mockResetMcpCache.mock.mockImplementation(() => {
      callOrder.push("resetMcp");
    });
    mocks.mockInstallAllPinnedMcpServers.mock.mockImplementation(async () => {
      callOrder.push("installPinned");
      return { failed: [] };
    });

    await restartAll(deps);

    assert.equal(mocks.mockInstallAllPinnedMcpServers.mock.callCount(), 1);
    const resetIdx = callOrder.indexOf("resetMcp");
    const installIdx = callOrder.indexOf("installPinned");
    assert.ok(
      resetIdx < installIdx,
      "pinned install must run after the cache reset (otherwise the install populates a cache that's about to be cleared)",
    );
  });

  it("surfaces pinned MCP install failures as warnings without aborting", async () => {
    const { deps, mocks } = createMockDeps();
    mocks.mockInstallAllPinnedMcpServers.mock.mockImplementation(async () => ({
      failed: ["mongodb-prod"],
    }));

    const result = await restartAll(deps);

    assert.ok(
      result.warnings.some((w) => w.includes("mongodb-prod")),
      `expected a warning mentioning 'mongodb-prod', got: ${JSON.stringify(result.warnings)}`,
    );
    // Restart still completed — schedulers were started.
    assert.equal(mocks.mockStartSyncScheduler.mock.callCount(), 1);
  });

  it("reloads plugins from the freshly-loaded config", async () => {
    const { deps, mocks } = createMockDeps();
    const configWithPlugins = {
      repositories: [],
      changesWorkflow: { enabled: false },
      claudeCode: { watchMcpConfig: false },
      allowScheduledMessages: false,
      plugins: ["trivia", "giphy"],
    };
    mocks.mockLoadConfig.mock.mockImplementation(() => configWithPlugins);
    mocks.mockGetConfig.mock.mockImplementation(() => configWithPlugins);
    const harvested: LoadedPlugins = { results: [] };
    mocks.mockLoadPlugins.mock.mockImplementation(async () => harvested);

    await restartAll(deps);

    assert.equal(mocks.mockLoadPlugins.mock.callCount(), 1);
    assert.deepEqual(mocks.mockLoadPlugins.mock.calls[0].arguments[0], ["trivia", "giphy"]);
    assert.equal(mocks.mockSetLoadedPlugins.mock.callCount(), 1);
    assert.strictEqual(mocks.mockSetLoadedPlugins.mock.calls[0].arguments[0], harvested);
  });

  it("clears plugin state when config has no plugins", async () => {
    const { deps, mocks } = createMockDeps();
    // Default config has no `plugins` field — loader should be called with []
    // so a previously-loaded plugin set is cleared.
    await restartAll(deps);

    assert.equal(mocks.mockLoadPlugins.mock.callCount(), 1);
    assert.deepEqual(mocks.mockLoadPlugins.mock.calls[0].arguments[0], []);
    assert.equal(mocks.mockSetLoadedPlugins.mock.callCount(), 1);
  });

  it("surfaces plugin reload failures as warnings without aborting", async () => {
    const { deps, mocks } = createMockDeps();
    mocks.mockLoadPlugins.mock.mockImplementation(async () => {
      throw new Error("plugin import failed");
    });

    const result = await restartAll(deps);

    assert.ok(
      result.warnings.some((w) => w.includes("plugin import failed")),
      `expected a warning mentioning 'plugin import failed', got: ${JSON.stringify(result.warnings)}`,
    );
    // Restart still completed.
    assert.equal(mocks.mockStartSyncScheduler.mock.callCount(), 1);
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
