import { describe, it, vi } from "vitest";
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
  cron: { enabled: false },
});

function createMockDeps(): {
  deps: LifecycleDeps;
  mocks: Record<string, ReturnType<typeof vi.fn<(...args: any[]) => any>>>;
} {
  const mockLoadConfig = vi.fn(defaultConfig);
  const mockGetConfig = vi.fn(defaultConfig);
  const mockDotenvConfig = vi.fn();
  const mockLoadGitHubCredentials = vi.fn();
  const mockClearGitHubTokenCache = vi.fn();
  const mockStartSyncScheduler = vi.fn();
  const mockStopSyncScheduler = vi.fn();
  const mockInitializeRepositories = vi.fn(async () => {});
  const mockSyncAllRepositories = vi.fn(async () => {});
  const mockStartCleanupScheduler = vi.fn();
  const mockStopCleanupScheduler = vi.fn();
  const mockGetSlackClient = vi.fn(() => null);
  const mockEnsureWorktreeDirectories = vi.fn();
  const mockStartCompletionMonitor = vi.fn();
  const mockStopCompletionMonitor = vi.fn();
  const mockValidateInstructionFiles = vi.fn();
  const mockStartConfigWatcher = vi.fn(() => vi.fn());
  const mockStartCronScheduler = vi.fn();
  const mockStopCronScheduler = vi.fn();
  const mockResetMcpCache = vi.fn();
  const mockInstallAllPinnedMcpServers = vi.fn(async () => ({ failed: [] as string[] }));
  const mockResetToolMappingCache = vi.fn();
  const mockClearRolesCache = vi.fn();
  const mockClearPreferencesCache = vi.fn();
  const mockClearAutoRespondCache = vi.fn();
  const mockClearCronJobsCache = vi.fn();
  const mockClearUserSkillBodyCache = vi.fn();
  const mockArmDelayedBootDispatch = vi.fn();
  const mockCancelDelayedBootDispatch = vi.fn();
  const mockClearDelayedBootHandlers = vi.fn();
  const mockGetCronCatchUpDelayMinutes = vi.fn(() => 3);
  const mockLoadAndInstallPlugins = vi.fn(
    async (_pluginNames: string[]): Promise<LoadedPlugins> => ({ results: [] }),
  );

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
    mockClearUserSkillBodyCache,
    mockArmDelayedBootDispatch,
    mockCancelDelayedBootDispatch,
    mockClearDelayedBootHandlers,
    mockGetCronCatchUpDelayMinutes,
    mockLoadAndInstallPlugins,
  };

  const deps: LifecycleDeps = {
    dotenvConfig: mockDotenvConfig as Function as LifecycleDeps["dotenvConfig"],
    loadConfig: mockLoadConfig as () => void as LifecycleDeps["loadConfig"],
    getConfig: mockGetConfig as () => void as LifecycleDeps["getConfig"],
    loadGitHubCredentials:
      mockLoadGitHubCredentials as Function as LifecycleDeps["loadGitHubCredentials"],
    gitHubCredentialsExist: (() => true) as LifecycleDeps["gitHubCredentialsExist"],
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
    armDelayedBootDispatch: mockArmDelayedBootDispatch,
    cancelDelayedBootDispatch: mockCancelDelayedBootDispatch,
    clearDelayedBootHandlers: mockClearDelayedBootHandlers,
    getCronCatchUpDelayMinutes: mockGetCronCatchUpDelayMinutes,
    resetMcpCache: mockResetMcpCache,
    installAllPinnedMcpServers: mockInstallAllPinnedMcpServers,
    resetToolMappingCache: mockResetToolMappingCache,
    clearRolesCache: mockClearRolesCache,
    clearPreferencesCache: mockClearPreferencesCache,
    clearAutoRespondCache: mockClearAutoRespondCache,
    clearCronJobsCache: mockClearCronJobsCache,
    clearUserSkillBodyCache: mockClearUserSkillBodyCache,
    loadAndInstallPlugins: mockLoadAndInstallPlugins,
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

    assert.equal(mocks.mockResetMcpCache.mock.calls.length, 1);
    assert.equal(mocks.mockResetToolMappingCache.mock.calls.length, 1);
    assert.equal(mocks.mockClearRolesCache.mock.calls.length, 1);
    assert.equal(mocks.mockClearPreferencesCache.mock.calls.length, 1);
    assert.equal(mocks.mockClearGitHubTokenCache.mock.calls.length, 1);
    assert.equal(mocks.mockClearAutoRespondCache.mock.calls.length, 1);
    assert.equal(mocks.mockClearCronJobsCache.mock.calls.length, 1);
    assert.equal(mocks.mockClearDelayedBootHandlers.mock.calls.length, 1);
  });

  it("cancels the delayed-boot dispatch when stopping schedulers", async () => {
    const { deps, mocks } = createMockDeps();

    await restartAll(deps);

    assert.equal(mocks.mockCancelDelayedBootDispatch.mock.calls.length, 1);
  });

  it("does not arm the delayed-boot dispatch when the cron scheduler doesn't start", async () => {
    const { deps, mocks } = createMockDeps();

    await restartAll(deps);

    assert.equal(mocks.mockArmDelayedBootDispatch.mock.calls.length, 0);
  });

  it("arms the delayed-boot dispatch with the config delay after starting the cron scheduler", async () => {
    const { deps, mocks } = createMockDeps();
    const cronEnabledConfig = () => ({
      repositories: [{ name: "test-repo" }],
      changesWorkflow: { enabled: false },
      claudeCode: { watchMcpConfig: false },
      cron: { enabled: true },
    });
    mocks.mockLoadConfig.mockImplementation(cronEnabledConfig);
    mocks.mockGetConfig.mockImplementation(cronEnabledConfig);
    const fakeClient = {} as ReturnType<LifecycleDeps["getSlackClient"]>;
    mocks.mockGetSlackClient.mockImplementation(() => fakeClient);
    mocks.mockGetCronCatchUpDelayMinutes.mockReturnValue(7);

    await restartAll(deps);

    assert.equal(mocks.mockStartCronScheduler.mock.calls.length, 1);
    assert.deepEqual(mocks.mockArmDelayedBootDispatch.mock.calls[0], [7]);
    assert.ok(
      mocks.mockArmDelayedBootDispatch.mock.invocationCallOrder[0]! >
        mocks.mockStartCronScheduler.mock.invocationCallOrder[0]!,
      "arm must happen after the scheduler starts",
    );
  });

  it("re-installs pinned MCP servers after resetting caches", async () => {
    const { deps, mocks } = createMockDeps();
    const callOrder: string[] = [];

    mocks.mockResetMcpCache.mockImplementation(() => {
      callOrder.push("resetMcp");
    });
    mocks.mockInstallAllPinnedMcpServers.mockImplementation(async () => {
      callOrder.push("installPinned");
      return { failed: [] };
    });

    await restartAll(deps);

    assert.equal(mocks.mockInstallAllPinnedMcpServers.mock.calls.length, 1);
    const resetIdx = callOrder.indexOf("resetMcp");
    const installIdx = callOrder.indexOf("installPinned");
    assert.ok(
      resetIdx < installIdx,
      "pinned install must run after the cache reset (otherwise the install populates a cache that's about to be cleared)",
    );
  });

  it("surfaces pinned MCP install failures as warnings without aborting", async () => {
    const { deps, mocks } = createMockDeps();
    mocks.mockInstallAllPinnedMcpServers.mockImplementation(async () => ({
      failed: ["mongodb-prod"],
    }));

    const result = await restartAll(deps);

    assert.ok(
      result.warnings.some((w) => w.includes("mongodb-prod")),
      `expected a warning mentioning 'mongodb-prod', got: ${JSON.stringify(result.warnings)}`,
    );
    // Restart still completed — schedulers were started.
    assert.equal(mocks.mockStartSyncScheduler.mock.calls.length, 1);
  });

  it("reloads plugins from the freshly-loaded config", async () => {
    const { deps, mocks } = createMockDeps();
    const configWithPlugins = {
      repositories: [],
      changesWorkflow: { enabled: false },
      claudeCode: { watchMcpConfig: false },
      cron: { enabled: false },
      plugins: ["trivia", "giphy"],
    };
    mocks.mockLoadConfig.mockImplementation(() => configWithPlugins);
    mocks.mockGetConfig.mockImplementation(() => configWithPlugins);
    const harvested: LoadedPlugins = { results: [] };
    mocks.mockLoadAndInstallPlugins.mockImplementation(async () => harvested);

    await restartAll(deps);

    assert.equal(mocks.mockLoadAndInstallPlugins.mock.calls.length, 1);
    assert.deepEqual(mocks.mockLoadAndInstallPlugins.mock.calls[0][0], ["trivia", "giphy"]);
  });

  it("clears plugin state when config has no plugins", async () => {
    const { deps, mocks } = createMockDeps();
    // Default config has no `plugins` field — loader should be called with []
    // so a previously-loaded plugin set is cleared.
    await restartAll(deps);

    assert.equal(mocks.mockLoadAndInstallPlugins.mock.calls.length, 1);
    assert.deepEqual(mocks.mockLoadAndInstallPlugins.mock.calls[0][0], []);
  });

  it("surfaces plugin reload failures as warnings without aborting", async () => {
    const { deps, mocks } = createMockDeps();
    mocks.mockLoadAndInstallPlugins.mockImplementation(async () => {
      throw new Error("plugin import failed");
    });

    const result = await restartAll(deps);

    assert.ok(
      result.warnings.some((w) => w.includes("plugin import failed")),
      `expected a warning mentioning 'plugin import failed', got: ${JSON.stringify(result.warnings)}`,
    );
    // Restart still completed.
    assert.equal(mocks.mockStartSyncScheduler.mock.calls.length, 1);
  });

  it("reloads config before stopping schedulers", async () => {
    const { deps, mocks } = createMockDeps();
    const callOrder: string[] = [];

    mocks.mockLoadConfig.mockImplementation(() => {
      callOrder.push("loadConfig");
      return {
        repositories: [],
        changesWorkflow: { enabled: false },
        claudeCode: { watchMcpConfig: false },
        cron: { enabled: false },
      };
    });
    mocks.mockGetConfig.mockImplementation(() => {
      return {
        repositories: [],
        changesWorkflow: { enabled: false },
        claudeCode: { watchMcpConfig: false },
        cron: { enabled: false },
      };
    });
    mocks.mockStopSyncScheduler.mockImplementation(() => {
      callOrder.push("stopSync");
    });

    await restartAll(deps);

    const configIdx = callOrder.indexOf("loadConfig");
    const stopIdx = callOrder.indexOf("stopSync");
    assert.ok(configIdx < stopIdx, "loadConfig should be called before stopping schedulers");
  });

  it("aborts without side effects on config validation failure", async () => {
    const { deps, mocks } = createMockDeps();

    mocks.mockLoadConfig.mockImplementation(() => {
      throw new Error("Invalid config");
    });

    await assert.rejects(() => restartAll(deps), { message: "Invalid config" });

    // No schedulers should have been stopped or caches reset
    assert.equal(mocks.mockStopSyncScheduler.mock.calls.length, 0);
    assert.equal(mocks.mockResetMcpCache.mock.calls.length, 0);
    assert.equal(mocks.mockClearRolesCache.mock.calls.length, 0);
  });

  it("restarts schedulers after reset", async () => {
    const { deps, mocks } = createMockDeps();

    await restartAll(deps);

    assert.equal(mocks.mockStopSyncScheduler.mock.calls.length, 1);
    assert.equal(mocks.mockStartSyncScheduler.mock.calls.length, 1);
    assert.equal(mocks.mockStopCleanupScheduler.mock.calls.length, 1);
    assert.equal(mocks.mockStartCleanupScheduler.mock.calls.length, 1);
    assert.equal(mocks.mockStopCompletionMonitor.mock.calls.length, 1);
    assert.equal(mocks.mockStartCompletionMonitor.mock.calls.length, 1);
  });

  it("returns repo count and warnings", async () => {
    const { deps } = createMockDeps();

    const result = await restartAll(deps);

    assert.equal(result.repoCount, 1);
    assert.ok(Array.isArray(result.warnings));
  });

  it("tolerates non-critical failures and includes them in warnings", async () => {
    const { deps, mocks } = createMockDeps();

    mocks.mockInitializeRepositories.mockImplementation(async () => {
      throw new Error("clone failed");
    });

    const result = await restartAll(deps);

    assert.ok(result.warnings.some((w) => w.includes("clone failed")));
    // Schedulers should still have been restarted
    assert.equal(mocks.mockStartSyncScheduler.mock.calls.length, 1);
  });
});
