import { describe, it, vi, beforeEach } from "vitest";
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
    getConfig: vi.fn<() => Config>(() => ({}) as never),
    getRole: vi.fn<(userId: string) => Promise<UserRole>>(async () => "dev"),
    canRequestChanges: vi.fn<(role: UserRole) => boolean>(() => true),
    isChangesEnabledForTrigger: vi.fn<(triggerType: TriggerType, config: Config) => boolean>(
      () => true,
    ),
    getChangeEnabledRepos: vi.fn<
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
      isChangesEnabledForTrigger: vi.fn(() => false),
    });

    const result = await getClaudeOptions("U001", "mentions", undefined, deps);

    assert.equal(result.changesWorkflowEnabled, false);
  });

  it("returns changesWorkflowEnabled false when user cannot request changes", async () => {
    const deps = makeDeps({
      canRequestChanges: vi.fn(() => false),
    });

    const result = await getClaudeOptions("U001", "mentions", undefined, deps);

    assert.equal(result.changesWorkflowEnabled, false);
  });

  it("returns changesWorkflowEnabled false when no repos are available", async () => {
    const deps = makeDeps({
      getChangeEnabledRepos: vi.fn(() => []),
    });

    const result = await getClaudeOptions("U001", "mentions", undefined, deps);

    assert.equal(result.changesWorkflowEnabled, false);
  });

  it("passes the config to isChangesEnabledForTrigger", async () => {
    const fakeConfig = { changesWorkflow: { enabled: true } } as never;
    const mockIsChangesEnabled = vi.fn<(triggerType: TriggerType, config: Config) => boolean>(
      () => true,
    );
    const deps = makeDeps({
      getConfig: vi.fn(() => fakeConfig),
      isChangesEnabledForTrigger: mockIsChangesEnabled,
    });

    await getClaudeOptions("U001", "directMessages", undefined, deps);

    assert.equal(mockIsChangesEnabled.mock.calls.length, 1);
    assert.equal(mockIsChangesEnabled.mock.calls[0]![0], "directMessages");
    assert.equal(mockIsChangesEnabled.mock.calls[0]![1], fakeConfig);
  });

  it("resolves the role for the given userId", async () => {
    const mockGetRole = vi.fn<(userId: string) => Promise<UserRole>>(async () => "admin");
    const deps = makeDeps({ getRole: mockGetRole });

    const result = await getClaudeOptions("U_ADMIN", "reactions", undefined, deps);

    assert.equal(result.role, "admin");
    assert.equal(mockGetRole.mock.calls.length, 1);
    assert.equal(mockGetRole.mock.calls[0]![0], "U_ADMIN");
  });

  it("passes role and config to getChangeEnabledRepos", async () => {
    const fakeConfig = { repositories: [] } as never;
    const mockGetChangeEnabledRepos = vi.fn<
      (config: Config, role: UserRole) => Array<{ name: string; description: string }>
    >(() => [{ name: "r", description: "d" }]);
    const deps = makeDeps({
      getConfig: vi.fn(() => fakeConfig),
      getRole: vi.fn(async () => "owner" as UserRole),
      getChangeEnabledRepos: mockGetChangeEnabledRepos,
    });

    await getClaudeOptions("U001", "mentions", undefined, deps);

    assert.equal(mockGetChangeEnabledRepos.mock.calls.length, 1);
    assert.equal(mockGetChangeEnabledRepos.mock.calls[0]![0], fakeConfig);
    assert.equal(mockGetChangeEnabledRepos.mock.calls[0]![1], "owner");
  });

  it("does not call getChangeEnabledRepos when changes are disabled", async () => {
    const mockGetChangeEnabledRepos = vi.fn(() => []);
    const deps = makeDeps({
      isChangesEnabledForTrigger: vi.fn(() => false),
      getChangeEnabledRepos: mockGetChangeEnabledRepos,
    });

    await getClaudeOptions("U001", "mentions", undefined, deps);

    assert.equal(mockGetChangeEnabledRepos.mock.calls.length, 0);
  });

  it("does not call getChangeEnabledRepos when user lacks permission", async () => {
    const mockGetChangeEnabledRepos = vi.fn(() => []);
    const deps = makeDeps({
      canRequestChanges: vi.fn(() => false),
      getChangeEnabledRepos: mockGetChangeEnabledRepos,
    });

    await getClaudeOptions("U001", "mentions", undefined, deps);

    assert.equal(mockGetChangeEnabledRepos.mock.calls.length, 0);
  });
});
