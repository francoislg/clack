import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { UserRole } from "../../roles.js";
import type { Config } from "../../config.js";
import type { TriggerType } from "../../changes/types.js";
import { getClaudeOptions, type ChangeWorkflowHelperDeps } from "./changeWorkflowHelper.js";

// ============================================================================
// Helpers
// ============================================================================

function makeDeps(overrides: Partial<ChangeWorkflowHelperDeps> = {}): ChangeWorkflowHelperDeps {
  return {
    getConfig: mock.fn<() => Config>(() => ({}) as never),
    getRole: mock.fn<(userId: string) => Promise<UserRole>>(async () => "dev"),
    canRequestChanges: mock.fn<(role: UserRole) => boolean>(() => true),
    isChangesEnabledForTrigger: mock.fn<(triggerType: TriggerType, config: Config) => boolean>(
      () => true,
    ),
    getChangeEnabledRepos: mock.fn<
      (config: Config, role: UserRole) => Array<{ name: string; description: string }>
    >(() => [{ name: "org/repo", description: "desc" }]),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("getClaudeOptions", () => {
  it("returns changesWorkflowEnabled true when all conditions are met", async () => {
    const deps = makeDeps();
    const result = await getClaudeOptions("U001", "mentions", undefined, deps);

    assert.equal(result.changesWorkflowEnabled, true);
    assert.equal(result.role, "dev");
  });

  it("returns changesWorkflowEnabled false when trigger is not enabled", async () => {
    const deps = makeDeps({
      isChangesEnabledForTrigger: mock.fn(() => false),
    });

    const result = await getClaudeOptions("U001", "mentions", undefined, deps);

    assert.equal(result.changesWorkflowEnabled, false);
  });

  it("returns changesWorkflowEnabled false when user cannot request changes", async () => {
    const deps = makeDeps({
      canRequestChanges: mock.fn(() => false),
    });

    const result = await getClaudeOptions("U001", "mentions", undefined, deps);

    assert.equal(result.changesWorkflowEnabled, false);
  });

  it("returns changesWorkflowEnabled false when no repos are available", async () => {
    const deps = makeDeps({
      getChangeEnabledRepos: mock.fn(() => []),
    });

    const result = await getClaudeOptions("U001", "mentions", undefined, deps);

    assert.equal(result.changesWorkflowEnabled, false);
  });

  it("passes the config to isChangesEnabledForTrigger", async () => {
    const fakeConfig = { changesWorkflow: { enabled: true } } as never;
    const mockIsChangesEnabled = mock.fn<(triggerType: TriggerType, config: Config) => boolean>(
      () => true,
    );
    const deps = makeDeps({
      getConfig: mock.fn(() => fakeConfig),
      isChangesEnabledForTrigger: mockIsChangesEnabled,
    });

    await getClaudeOptions("U001", "directMessages", undefined, deps);

    assert.equal(mockIsChangesEnabled.mock.callCount(), 1);
    assert.equal(mockIsChangesEnabled.mock.calls[0]!.arguments[0], "directMessages");
    assert.equal(mockIsChangesEnabled.mock.calls[0]!.arguments[1], fakeConfig);
  });

  it("resolves the role for the given userId", async () => {
    const mockGetRole = mock.fn<(userId: string) => Promise<UserRole>>(async () => "admin");
    const deps = makeDeps({ getRole: mockGetRole });

    const result = await getClaudeOptions("U_ADMIN", "reactions", undefined, deps);

    assert.equal(result.role, "admin");
    assert.equal(mockGetRole.mock.callCount(), 1);
    assert.equal(mockGetRole.mock.calls[0]!.arguments[0], "U_ADMIN");
  });

  it("passes role and config to getChangeEnabledRepos", async () => {
    const fakeConfig = { repositories: [] } as never;
    const mockGetChangeEnabledRepos = mock.fn<
      (config: Config, role: UserRole) => Array<{ name: string; description: string }>
    >(() => [{ name: "r", description: "d" }]);
    const deps = makeDeps({
      getConfig: mock.fn(() => fakeConfig),
      getRole: mock.fn(async () => "owner" as UserRole),
      getChangeEnabledRepos: mockGetChangeEnabledRepos,
    });

    await getClaudeOptions("U001", "mentions", undefined, deps);

    assert.equal(mockGetChangeEnabledRepos.mock.callCount(), 1);
    assert.equal(mockGetChangeEnabledRepos.mock.calls[0]!.arguments[0], fakeConfig);
    assert.equal(mockGetChangeEnabledRepos.mock.calls[0]!.arguments[1], "owner");
  });

  it("does not call getChangeEnabledRepos when changes are disabled", async () => {
    const mockGetChangeEnabledRepos = mock.fn(() => []);
    const deps = makeDeps({
      isChangesEnabledForTrigger: mock.fn(() => false),
      getChangeEnabledRepos: mockGetChangeEnabledRepos,
    });

    await getClaudeOptions("U001", "mentions", undefined, deps);

    assert.equal(mockGetChangeEnabledRepos.mock.callCount(), 0);
  });

  it("does not call getChangeEnabledRepos when user lacks permission", async () => {
    const mockGetChangeEnabledRepos = mock.fn(() => []);
    const deps = makeDeps({
      canRequestChanges: mock.fn(() => false),
      getChangeEnabledRepos: mockGetChangeEnabledRepos,
    });

    await getClaudeOptions("U001", "mentions", undefined, deps);

    assert.equal(mockGetChangeEnabledRepos.mock.callCount(), 0);
  });
});
