import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { UserRole } from "../../roles.js";

// ============================================================================
// Mocks — set up before importing the module under test
// ============================================================================

const mockGetConfig = mock.fn<() => Record<string, unknown>>();
const mockGetRole = mock.fn<(userId: string) => Promise<UserRole>>();
const mockIsChangesEnabledForTrigger = mock.fn<(...args: unknown[]) => boolean>();
const mockGetChangeEnabledRepos = mock.fn<(...args: unknown[]) => Array<{ name: string; description: string }>>();
const mockCanRequestChanges = mock.fn<(role: UserRole) => boolean>();

mock.module("../../config.js", {
  namedExports: { getConfig: mockGetConfig },
});

mock.module("../../roles.js", {
  namedExports: { getRole: mockGetRole },
});

mock.module("../../permissions.js", {
  namedExports: { canRequestChanges: mockCanRequestChanges },
});

mock.module("../../changes/detection.js", {
  namedExports: {
    isChangesEnabledForTrigger: mockIsChangesEnabledForTrigger,
    getChangeEnabledRepos: mockGetChangeEnabledRepos,
  },
});

// Import after mocks
const { getClaudeOptions } = await import("./changeWorkflowHelper.js");

// ============================================================================
// Helpers
// ============================================================================

beforeEach(() => {
  mockGetConfig.mock.resetCalls();
  mockGetRole.mock.resetCalls();
  mockIsChangesEnabledForTrigger.mock.resetCalls();
  mockGetChangeEnabledRepos.mock.resetCalls();
  mockCanRequestChanges.mock.resetCalls();

  // Defaults
  mockGetConfig.mock.mockImplementation(() => ({}));
  mockGetRole.mock.mockImplementation(async () => "dev" as UserRole);
  mockIsChangesEnabledForTrigger.mock.mockImplementation(() => true);
  mockCanRequestChanges.mock.mockImplementation(() => true);
  mockGetChangeEnabledRepos.mock.mockImplementation(() => [{ name: "org/repo", description: "desc" }]);
});

// ============================================================================
// Tests
// ============================================================================

describe("getClaudeOptions", () => {
  it("returns changesWorkflowEnabled true when all conditions are met", async () => {
    const result = await getClaudeOptions("U001", "mentions");

    assert.equal(result.changesWorkflowEnabled, true);
    assert.equal(result.role, "dev");
  });

  it("returns changesWorkflowEnabled false when trigger is not enabled", async () => {
    mockIsChangesEnabledForTrigger.mock.mockImplementation(() => false);

    const result = await getClaudeOptions("U001", "mentions");

    assert.equal(result.changesWorkflowEnabled, false);
  });

  it("returns changesWorkflowEnabled false when user cannot request changes", async () => {
    mockCanRequestChanges.mock.mockImplementation(() => false);

    const result = await getClaudeOptions("U001", "mentions");

    assert.equal(result.changesWorkflowEnabled, false);
  });

  it("returns changesWorkflowEnabled false when no repos are available", async () => {
    mockGetChangeEnabledRepos.mock.mockImplementation(() => []);

    const result = await getClaudeOptions("U001", "mentions");

    assert.equal(result.changesWorkflowEnabled, false);
  });

  it("passes the config to isChangesEnabledForTrigger", async () => {
    const fakeConfig = { changesWorkflow: { enabled: true } };
    mockGetConfig.mock.mockImplementation(() => fakeConfig);

    await getClaudeOptions("U001", "directMessages");

    assert.equal(mockIsChangesEnabledForTrigger.mock.callCount(), 1);
    assert.equal(mockIsChangesEnabledForTrigger.mock.calls[0].arguments[0], "directMessages");
    assert.equal(mockIsChangesEnabledForTrigger.mock.calls[0].arguments[1], fakeConfig);
  });

  it("resolves the role for the given userId", async () => {
    mockGetRole.mock.mockImplementation(async () => "admin" as UserRole);

    const result = await getClaudeOptions("U_ADMIN", "reactions");

    assert.equal(result.role, "admin");
    assert.equal(mockGetRole.mock.callCount(), 1);
    assert.equal(mockGetRole.mock.calls[0].arguments[0], "U_ADMIN");
  });

  it("passes role and config to getChangeEnabledRepos", async () => {
    const fakeConfig = { repositories: [] };
    mockGetConfig.mock.mockImplementation(() => fakeConfig);
    mockGetRole.mock.mockImplementation(async () => "owner" as UserRole);

    await getClaudeOptions("U001", "mentions");

    assert.equal(mockGetChangeEnabledRepos.mock.callCount(), 1);
    assert.equal(mockGetChangeEnabledRepos.mock.calls[0].arguments[0], fakeConfig);
    assert.equal(mockGetChangeEnabledRepos.mock.calls[0].arguments[1], "owner");
  });

  it("does not call getChangeEnabledRepos when changes are disabled", async () => {
    mockIsChangesEnabledForTrigger.mock.mockImplementation(() => false);

    await getClaudeOptions("U001", "mentions");

    assert.equal(mockGetChangeEnabledRepos.mock.callCount(), 0);
  });

  it("does not call getChangeEnabledRepos when user lacks permission", async () => {
    mockCanRequestChanges.mock.mockImplementation(() => false);

    await getClaudeOptions("U001", "mentions");

    assert.equal(mockGetChangeEnabledRepos.mock.callCount(), 0);
  });
});
