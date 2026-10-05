import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { restartAll } from "./lifecycle.js";
import type { LifecycleDeps } from "./lifecycle.js";
import type { Config } from "./config.js";
import type { LoadedPlugins } from "./plugins-core/registry.js";
import { createSlackClientMock } from "./slack/testSlackClient.js";
import { stub } from "./testStubs.js";

// ============================================================================
// Mocks and Helpers
// ============================================================================

const defaultConfig = (): Config =>
  stub<Config>({
    repositories: [{ name: "test-repo" }],
    changesWorkflow: { enabled: false },
    claudeCode: { watchMcpConfig: false },
    cron: { enabled: false },
  });

function createMockDeps() {
  const mockLoadConfig = vi.fn<LifecycleDeps["loadConfig"]>(defaultConfig);
  const mockGetConfig = vi.fn<LifecycleDeps["getConfig"]>(defaultConfig);
  const mockDotenvConfig = vi.fn<LifecycleDeps["dotenvConfig"]>();
  const mockLoadGitHubCredentials = vi.fn<LifecycleDeps["loadGitHubCredentials"]>();
  const mockClearGitHubTokenCache = vi.fn<LifecycleDeps["clearGitHubTokenCache"]>();
  const mockStartSyncScheduler = vi.fn<LifecycleDeps["startSyncScheduler"]>();
  const mockStopSyncScheduler = vi.fn<LifecycleDeps["stopSyncScheduler"]>();
  const mockInitializeRepositories = vi.fn<LifecycleDeps["initializeRepositories"]>(async () => {});
  const mockSyncAllRepositories = vi.fn<LifecycleDeps["syncAllRepositories"]>(async () => {});
  const mockStartCleanupScheduler = vi.fn<LifecycleDeps["startCleanupScheduler"]>();
  const mockStopCleanupScheduler = vi.fn<LifecycleDeps["stopCleanupScheduler"]>();
  const mockGetSlackClient = vi.fn<LifecycleDeps["getSlackClient"]>(() => null);
  const mockEnsureWorktreeDirectories = vi.fn<LifecycleDeps["ensureWorktreeDirectories"]>();
  const mockStartCompletionMonitor = vi.fn<LifecycleDeps["startCompletionMonitor"]>();
  const mockStopCompletionMonitor = vi.fn<LifecycleDeps["stopCompletionMonitor"]>();
  const mockValidateInstructionFiles = vi.fn<LifecycleDeps["validateInstructionFiles"]>();
  const mockStartConfigWatcher = vi.fn<LifecycleDeps["startConfigWatcher"]>(() => vi.fn());
  const mockStartCronScheduler = vi.fn<LifecycleDeps["startCronScheduler"]>();
  const mockStopCronScheduler = vi.fn<LifecycleDeps["stopCronScheduler"]>();
  const mockResetMcpCache = vi.fn<LifecycleDeps["resetMcpCache"]>();
  const mockInstallAllPinnedMcpServers = vi.fn<LifecycleDeps["installAllPinnedMcpServers"]>(
    async () => ({ failed: [] }),
  );
  const mockResetToolMappingCache = vi.fn<LifecycleDeps["resetToolMappingCache"]>();
  const mockClearRolesCache = vi.fn<LifecycleDeps["clearRolesCache"]>();
  const mockClearPreferencesCache = vi.fn<LifecycleDeps["clearPreferencesCache"]>();
  const mockClearAutoRespondCache = vi.fn<LifecycleDeps["clearAutoRespondCache"]>();
  const mockClearCronJobsCache = vi.fn<LifecycleDeps["clearCronJobsCache"]>();
  const mockClearUserSkillBodyCache = vi.fn<LifecycleDeps["clearUserSkillBodyCache"]>();
  const mockArmDelayedBootDispatch = vi.fn<LifecycleDeps["armDelayedBootDispatch"]>();
  const mockCancelDelayedBootDispatch = vi.fn<LifecycleDeps["cancelDelayedBootDispatch"]>();
  const mockClearDelayedBootHandlers = vi.fn<LifecycleDeps["clearDelayedBootHandlers"]>();
  const mockGetCronCatchUpDelayMinutes = vi.fn<LifecycleDeps["getCronCatchUpDelayMinutes"]>(
    () => 3,
  );
  const mockLoadAndInstallPlugins = vi.fn<LifecycleDeps["loadAndInstallPlugins"]>(
    async (): Promise<LoadedPlugins> => ({ results: [] }),
  );
  const mockCheckServedToolServers = vi.fn<LifecycleDeps["checkServedToolServers"]>(async () => []);
  const mockCheckTokenScopes = vi.fn<LifecycleDeps["checkTokenScopes"]>(async () => []);
  const mockStartManagedFilesSweepScheduler =
    vi.fn<LifecycleDeps["startManagedFilesSweepScheduler"]>();
  const mockStopManagedFilesSweepScheduler =
    vi.fn<LifecycleDeps["stopManagedFilesSweepScheduler"]>();

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
    mockCheckServedToolServers,
    mockCheckTokenScopes,
    mockStartManagedFilesSweepScheduler,
    mockStopManagedFilesSweepScheduler,
  };

  const deps: LifecycleDeps = {
    dotenvConfig: mockDotenvConfig,
    loadConfig: mockLoadConfig,
    getConfig: mockGetConfig,
    loadGitHubCredentials: mockLoadGitHubCredentials,
    gitHubCredentialsExist: () => true,
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
    startConfigWatcher: mockStartConfigWatcher,
    startCronScheduler: mockStartCronScheduler,
    stopCronScheduler: mockStopCronScheduler,
    startStateBackupScheduler: () => {},
    stopStateBackupScheduler: () => {},
    startManagedFilesSweepScheduler: mockStartManagedFilesSweepScheduler,
    stopManagedFilesSweepScheduler: mockStopManagedFilesSweepScheduler,
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
    checkServedToolServers: mockCheckServedToolServers,
    checkTokenScopes: mockCheckTokenScopes,
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
    const cronEnabledConfig = () =>
      stub<Config>({
        repositories: [{ name: "test-repo" }],
        changesWorkflow: { enabled: false },
        claudeCode: { watchMcpConfig: false },
        cron: { enabled: true },
      });
    mocks.mockLoadConfig.mockImplementation(cronEnabledConfig);
    mocks.mockGetConfig.mockImplementation(cronEnabledConfig);
    const client = createSlackClientMock();
    mocks.mockGetSlackClient.mockImplementation(() => client);
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

  it("stops and restarts the managed-files sweep scheduler", async () => {
    const { deps, mocks } = createMockDeps();

    await restartAll(deps);

    assert.equal(mocks.mockStopManagedFilesSweepScheduler.mock.calls.length, 1);
    assert.equal(mocks.mockStartManagedFilesSweepScheduler.mock.calls.length, 1);
    assert.ok(
      mocks.mockStopManagedFilesSweepScheduler.mock.invocationCallOrder[0]! <
        mocks.mockStartManagedFilesSweepScheduler.mock.invocationCallOrder[0]!,
      "the old scheduler stops before the new one starts",
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
    const configWithPlugins = stub<Config>({
      repositories: [],
      changesWorkflow: { enabled: false },
      claudeCode: { watchMcpConfig: false },
      cron: { enabled: false },
      plugins: ["trivia", "giphy"],
    });
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

  it("checks the served tool servers against the reloaded plugins and config", async () => {
    const { deps, mocks } = createMockDeps();
    const client = createSlackClientMock();
    mocks.mockGetSlackClient.mockImplementation(() => client);

    await restartAll(deps);

    assert.equal(mocks.mockCheckServedToolServers.mock.calls.length, 1);
    assert.deepEqual(mocks.mockCheckServedToolServers.mock.calls[0], [
      mocks.mockGetConfig.mock.results[0].value,
      client,
    ]);
    assert.ok(
      mocks.mockCheckServedToolServers.mock.invocationCallOrder[0]! >
        mocks.mockLoadAndInstallPlugins.mock.invocationCallOrder[0]!,
      "the check must see the freshly reloaded plugins",
    );
  });

  it("surfaces unlistable tool servers as warnings without aborting", async () => {
    const { deps, mocks } = createMockDeps();
    mocks.mockCheckServedToolServers.mockResolvedValue([
      { name: "trivia:management", error: "Cannot read properties of undefined" },
    ]);

    const result = await restartAll(deps);

    assert.ok(
      result.warnings.includes(
        "Tool server trivia:management cannot list its tools: Cannot read properties of undefined",
      ),
      `got: ${JSON.stringify(result.warnings)}`,
    );
    assert.equal(mocks.mockStartSyncScheduler.mock.calls.length, 1);
  });

  it("checks the token scopes against the reloaded config and surfaces a missing scope as a warning", async () => {
    const { deps, mocks } = createMockDeps();
    const client = createSlackClientMock();
    mocks.mockGetSlackClient.mockImplementation(() => client);
    mocks.mockCheckTokenScopes.mockResolvedValue(["im:write"]);

    const result = await restartAll(deps);

    assert.equal(mocks.mockCheckTokenScopes.mock.calls.length, 1);
    assert.deepEqual(mocks.mockCheckTokenScopes.mock.calls[0], [
      mocks.mockGetConfig.mock.results[0].value,
      client,
    ]);
    assert.ok(
      result.warnings.includes("Bot token is missing scope im:write"),
      `got: ${JSON.stringify(result.warnings)}`,
    );
    assert.equal(mocks.mockStartSyncScheduler.mock.calls.length, 1);
  });

  it("reloads config before stopping schedulers", async () => {
    const { deps, mocks } = createMockDeps();
    const callOrder: string[] = [];

    mocks.mockLoadConfig.mockImplementation(() => {
      callOrder.push("loadConfig");
      return defaultConfig();
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
