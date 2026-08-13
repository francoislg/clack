import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { SessionContext } from "../sessions.js";
import type { AskClaudeOptions } from "./index.js";
import { buildQueryContext } from "../tools/context.js";
import type { BuildQueryContextParams } from "../tools/context.js";
import type { QueryToolContext } from "../tools/types.js";

// Mock buildQueryContext at the boundary to capture what userId is passed.
vi.mock("../tools/context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tools/context.js")>();
  return {
    ...actual,
    buildQueryContext: vi.fn(actual.buildQueryContext),
  };
});

// Mock other dependencies that buildQuerySetup needs.
vi.mock("../config.js", () => ({
  getConfig: vi.fn(() => ({
    repositories: [],
    cron: { userSchedules: false },
    submitResponse: {},
    claudeCode: { model: "claude-3-5-sonnet-20241022" },
  })),
  getRepositoriesDir: vi.fn(() => "/tmp/repos"),
  getWorktreeSessionsDir: vi.fn(() => "/tmp/sessions"),
  getStateDir: vi.fn(() => "/tmp/state"),
}));

vi.mock("../memory/trackedKinds.js", () => ({
  trackedMemoryKindsForRole: vi.fn(async () => []),
}));

vi.mock("./promptBuilder.js", () => ({
  buildSystemPrompt: vi.fn(() => "system prompt"),
  buildPrompt: vi.fn(() => "user prompt"),
  shouldOmitSkillCatalogs: vi.fn(() => false),
}));

vi.mock("./mcpServerManager.js", () => ({
  prepareMcpSession: vi.fn(async () => ({
    registry: {},
    manager: {
      bind: vi.fn(),
    },
  })),
  completeSessionStart: vi.fn(() => ({})),
}));

vi.mock("../skillPlugins.js", () => ({
  discoverEagerSkillPlugins: vi.fn(() => []),
  discoverSkillPluginInfo: vi.fn(() => []),
}));

vi.mock("./skillsManager.js", () => ({
  prepareSkillsSession: vi.fn(() => ({
    loadedSkills: new Set(),
  })),
}));

vi.mock("../userSkills.js", () => ({
  discoverUserSkills: vi.fn(() => []),
}));

vi.mock("../tools/server.js", () => ({
  buildClackTools: vi.fn(() => ({
    mcpServers: {},
    getStagedIntents: () => new Map(),
  })),
}));

import { buildQuerySetup } from "./index.js";

describe("buildQuerySetup userId sourcing", () => {
  let mockBuildQueryContext: ReturnType<typeof vi.fn<typeof buildQueryContext>>;

  function makeSession(overrides: Partial<SessionContext> = {}): SessionContext {
    return {
      sessionId: "sess-123",
      channelId: "C123",
      messageTs: "1.0",
      threadTs: "1.0",
      userId: "U_CREATOR",
      trigger: { type: "mentions", userId: "U_CREATOR", messageTs: "1.0", messageText: "test" },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildQueryContext = vi.mocked(buildQueryContext);
    // Make buildQueryContext return a minimal QueryToolContext
    mockBuildQueryContext.mockImplementation(
      (params: BuildQueryContextParams): QueryToolContext => {
        return {
          mode: "query",
          userId: params.userId,
          role: params.role,
          session: params.session,
          config: params.config,
          changesWorkflowEnabled: params.changesWorkflowEnabled,
          cronUserSchedules: params.cronUserSchedules ?? false,
        };
      },
    );
  });

  it("uses requester userId when options.requester is provided", async () => {
    const session = makeSession({ userId: "U_CREATOR" });
    const options: AskClaudeOptions = {
      requester: {
        userId: "U_SPEAKER",
        username: "speaker",
      },
    };

    await buildQuerySetup(
      session,
      options,
      () => false,
      () => [],
      () => {},
    );

    const call = mockBuildQueryContext.mock.calls[0];
    assert.ok(call, "buildQueryContext should be called");
    const params = call[0];
    assert.ok(params && "userId" in params, "params should have userId");
    assert.equal(params.userId, "U_SPEAKER", "should use requester userId");
  });

  it("falls back to session userId when options has no requester", async () => {
    const session = makeSession({ userId: "U_CREATOR" });
    const options: AskClaudeOptions = {
      role: "member",
      // No requester — typical for scheduled cron jobs
    };

    await buildQuerySetup(
      session,
      options,
      () => false,
      () => [],
      () => {},
    );

    const call = mockBuildQueryContext.mock.calls[0];
    assert.ok(call, "buildQueryContext should be called");
    const params = call[0];
    assert.ok(params && "userId" in params, "params should have userId");
    assert.equal(params.userId, "U_CREATOR", "should fall back to session userId");
  });

  it("falls back to session userId when options is undefined", async () => {
    const session = makeSession({ userId: "U_CREATOR" });

    await buildQuerySetup(
      session,
      undefined,
      () => false,
      () => [],
      () => {},
    );

    const call = mockBuildQueryContext.mock.calls[0];
    assert.ok(call, "buildQueryContext should be called");
    const params = call[0];
    assert.ok(params && "userId" in params, "params should have userId");
    assert.equal(params.userId, "U_CREATOR", "should fall back to session userId");
  });
});
