import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { SDKMessage, SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import type { UUID } from "node:crypto";
import { createRunHandle } from "../claude/runHandle.js";
import type { ClackSessionRun } from "../claude/query.js";
import type { Config } from "../config.js";
import type { WorktreeInfo } from "../worktrees.js";
import type { ChangePlan, ChangeRequest } from "./types.js";
import { executeChange } from "./execution.js";

const clackSessionMock = vi.hoisted(() => vi.fn());
vi.mock("../claude/query.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../claude/query.js")>();
  return { ...original, clackSession: clackSessionMock };
});

const getConfigMock = vi.hoisted(() => vi.fn());
vi.mock("../config.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../config.js")>();
  return { ...original, getConfig: () => getConfigMock() };
});

const teardownAppProcessMock = vi.hoisted(() => vi.fn(async (_worktreePath: string) => {}));
vi.mock("../tester/processTeardown.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tester/processTeardown.js")>();
  return { ...original, teardownAppProcess: teardownAppProcessMock };
});

const addSessionUsageMock = vi.hoisted(() =>
  vi.fn(async (_sessionId: string, _usage: object) => {}),
);
vi.mock("../sessions.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../sessions.js")>();
  return { ...original, addSessionUsage: addSessionUsageMock };
});

vi.mock("../instructions.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../instructions.js")>();
  return { ...original, resolveInstructionFile: vi.fn(() => null) };
});

vi.mock("./persistence.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./persistence.js")>();
  return { ...original, appendExecutionLog: vi.fn() };
});

vi.mock("../skillPlugins.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../skillPlugins.js")>();
  return { ...original, discoverEagerSkillPlugins: vi.fn(() => []) };
});

// ============================================================================
// Helpers
// ============================================================================

function makeRunFromMessages(messages: SDKMessage[]): ClackSessionRun {
  const driver = createRunHandle({ push: () => {}, closeInput: () => {} });
  const iterable: AsyncIterable<SDKMessage> = {
    async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage> {
      for (const m of messages) yield m;
    },
  };
  return Object.assign(driver, { messages: iterable });
}

function successResult(text: string): SDKResultSuccess {
  return {
    type: "result",
    subtype: "success",
    result: text,
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0.1,
    usage: { input_tokens: 10, output_tokens: 5 } as SDKResultSuccess["usage"],
    modelUsage: {},
    permission_denials: [],
    uuid: "00000000-0000-0000-0000-000000000000" as UUID,
    session_id: "test",
  };
}

function makeFailingRun(): ClackSessionRun {
  const driver = createRunHandle({ push: () => {}, closeInput: () => {} });
  const iterable: AsyncIterable<SDKMessage> = {
    [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
      return {
        next(): Promise<IteratorResult<SDKMessage>> {
          return Promise.reject(new Error("sdk exploded"));
        },
      };
    },
  };
  return Object.assign(driver, { messages: iterable });
}

function testerConfig(overrides: Partial<Config> = {}): Config {
  return {
    repositories: [],
    tester: {
      enabled: true,
      sidecarUrl: "http://clack-playwright:8931/mcp",
      recordingsDir: "/recordings",
    },
    ...overrides,
  } as Config;
}

const worktree: WorktreeInfo = {
  repoName: "my-repo",
  branchName: "feature/login",
  worktreePath: "/tmp/worktrees/my-repo/w1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function makeTestPlan(): ChangePlan {
  return {
    branchName: "feature/login",
    description: "Test the login flow",
    targetRepo: "my-repo",
    kind: "test",
    resumeRemoteBranch: true,
  };
}

function makeRequest(): ChangeRequest {
  return {
    userId: "U001",
    userDisplayName: "Frank",
    message: "test this PR",
    triggerType: "mentions",
    channel: "C001",
    messageTs: "1.0",
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("executeChange — tester runs (kind: 'test')", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConfigMock.mockReturnValue(testerConfig());
    clackSessionMock.mockImplementation(() => makeRunFromMessages([successResult("done")]));
  });

  it("succeeds without any commit or PR (no no-op check) and tears down the app", async () => {
    const result = await executeChange({
      plan: makeTestPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    assert.equal(result.success, true);
    assert.equal(result.summary, "Test run complete");
    assert.deepEqual(teardownAppProcessMock.mock.calls[0], [worktree.worktreePath]);
  });

  it("attaches both the clack and playwright MCP servers and disallows Write/Edit", async () => {
    await executeChange({
      plan: makeTestPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    const params = clackSessionMock.mock.calls[0][0];
    const serverNames = Object.keys(params.options.mcpServers);
    assert.ok(serverNames.includes("clack"));
    assert.ok(serverNames.includes("playwright"));
    assert.deepEqual(params.options.mcpServers.playwright, {
      type: "http",
      url: "http://clack-playwright:8931/mcp",
    });
    assert.ok(params.options.disallowedTools.includes("Write"));
    assert.ok(params.options.disallowedTools.includes("Edit"));
    assert.ok(!params.options.allowedTools.includes("Write"));
  });

  it("folds the run's usage back onto the originating session", async () => {
    await executeChange({
      plan: makeTestPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    assert.equal(addSessionUsageMock.mock.calls.length, 1);
    assert.equal(addSessionUsageMock.mock.calls[0][0], "s1");
  });

  it("reports failure and still tears down the app when the run errors", async () => {
    clackSessionMock.mockImplementation(() => makeFailingRun());

    const result = await executeChange({
      plan: makeTestPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("sdk exploded"));
    assert.equal(teardownAppProcessMock.mock.calls.length, 1);
  });

  it("aborts before running Claude when the tester config is incomplete", async () => {
    getConfigMock.mockReturnValue(testerConfig({ tester: { enabled: false } }));

    const result = await executeChange({
      plan: makeTestPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("not enabled"));
    assert.equal(clackSessionMock.mock.calls.length, 0);
    assert.equal(teardownAppProcessMock.mock.calls.length, 0);
  });
});
