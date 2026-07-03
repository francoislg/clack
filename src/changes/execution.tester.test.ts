import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKResultSuccess,
} from "@anthropic-ai/claude-agent-sdk";
import type { UUID } from "node:crypto";
import { createRunHandle } from "../claude/runHandle.js";
import type { ClackSessionRun } from "../claude/query.js";
import type { Config } from "../config.js";
import type { WorktreeInfo } from "../worktrees.js";
import type { ChangePlan, ChangeRequest } from "./types.js";
import { executeChange } from "./execution.js";
import type { LoadedSetupNotes } from "../memory/setupMemory.js";

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

const appendExecutionLogMock = vi.hoisted(() => vi.fn());
vi.mock("./persistence.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./persistence.js")>();
  return { ...original, appendExecutionLog: appendExecutionLogMock };
});

vi.mock("../skillPlugins.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../skillPlugins.js")>();
  return { ...original, discoverEagerSkillPlugins: vi.fn(() => []) };
});

const loadSetupNotesMock = vi.hoisted(() =>
  vi.fn(async (): Promise<LoadedSetupNotes | null> => null),
);
const setupEntryWasRewrittenMock = vi.hoisted(() => vi.fn(async () => false));
vi.mock("../memory/setupMemory.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../memory/setupMemory.js")>();
  return {
    ...original,
    loadSetupNotes: loadSetupNotesMock,
    setupEntryWasRewritten: setupEntryWasRewrittenMock,
  };
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

function assistantToolUse(toolName: string): SDKAssistantMessage {
  return {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: `tu-${toolName}`, name: toolName, input: {} }],
    } as SDKAssistantMessage["message"],
    parent_tool_use_id: null,
    uuid: "00000000-0000-0000-0000-000000000001" as UUID,
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
    // Default run reports status so the deliverable gate passes; gate-specific tests
    // override this with deliverable-free runs.
    clackSessionMock.mockImplementation(() =>
      makeRunFromMessages([assistantToolUse("mcp__clack__report_status"), successResult("done")]),
    );
    loadSetupNotesMock.mockResolvedValue(null);
    setupEntryWasRewrittenMock.mockResolvedValue(false);
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

  it("injects learned setup notes into the tester system prompt", async () => {
    const notes = "## Services\n- web: pnpm dev, port 3000";
    loadSetupNotesMock.mockResolvedValue({ notes, updatedAt: "2026-01-02T00:00:00.000Z" });

    await executeChange({
      plan: makeTestPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    assert.deepEqual(loadSetupNotesMock.mock.calls[0], ["tester", worktree.repoName]);
    const params = clackSessionMock.mock.calls[0][0];
    assert.ok(params.options.systemPrompt.includes("NOTES FROM PREVIOUS RUNS (advisory"));
    assert.ok(params.options.systemPrompt.includes("## Services\n- web: pnpm dev, port 3000"));
    assert.ok(params.options.systemPrompt.includes('"tester-setup:my-repo"'));
    const logLines = appendExecutionLogMock.mock.calls.map((call) => call[1]);
    assert.ok(
      logLines.includes(
        `Setup notes: injected (${notes.length} chars, updated 2026-01-02T00:00:00.000Z)`,
      ),
    );
  });

  it("logs the cold run when no setup notes exist", async () => {
    loadSetupNotesMock.mockResolvedValue(null);

    await executeChange({
      plan: makeTestPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    const logLines = appendExecutionLogMock.mock.calls.map((call) => call[1]);
    assert.ok(logLines.includes("Setup notes: none (cold run)"));
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

describe("executeChange — tester deliverable gate", () => {
  type ClackSessionParams = {
    prompt: string;
    onSessionId?: (id: string) => void;
    onResumeFallback?: () => void;
  };

  function deliverableFreeRun(params: ClackSessionParams): ClackSessionRun {
    params.onSessionId?.("sdk-session-1");
    return makeRunFromMessages([successResult("81% and climbing, let me wait")]);
  }

  function logLines(): string[] {
    return appendExecutionLogMock.mock.calls.map((call) => String(call[1]));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getConfigMock.mockReturnValue(testerConfig());
    loadSetupNotesMock.mockResolvedValue(null);
    setupEntryWasRewrittenMock.mockResolvedValue(false);
  });

  it("passes the gate on a report-only run without any corrective resume", async () => {
    clackSessionMock.mockImplementation(() =>
      makeRunFromMessages([assistantToolUse("mcp__clack__report_status"), successResult("done")]),
    );

    const result = await executeChange({
      plan: makeTestPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    assert.equal(result.success, true);
    assert.equal(clackSessionMock.mock.calls.length, 1);
    assert.ok(logLines().includes("Deliverable gate: passed"));
  });

  it("trips the gate and succeeds when the corrective resume delivers", async () => {
    clackSessionMock
      .mockImplementationOnce(deliverableFreeRun)
      .mockImplementationOnce((params: ClackSessionParams) => {
        params.onSessionId?.("sdk-session-1");
        return makeRunFromMessages([
          assistantToolUse("mcp__clack__record_and_upload"),
          successResult("delivered"),
        ]);
      });

    const result = await executeChange({
      plan: makeTestPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    assert.equal(result.success, true);
    assert.equal(result.summary, "Test run complete (after corrective resume)");
    assert.equal(clackSessionMock.mock.calls.length, 2);
    const resumeParams = clackSessionMock.mock.calls[1][0];
    assert.equal(resumeParams.resumeSessionId, "sdk-session-1");
    assert.ok(resumeParams.prompt.includes("record_and_upload"));
    assert.ok(logLines().some((line) => line.startsWith("Deliverable gate: tripped")));
    assert.ok(logLines().includes("Corrective resume: delivered"));
    assert.equal(teardownAppProcessMock.mock.calls.length, 1);
  });

  it("includes the setup rewrite in the corrective prompt only when the entry was not rewritten", async () => {
    setupEntryWasRewrittenMock.mockResolvedValue(false);
    clackSessionMock
      .mockImplementationOnce(deliverableFreeRun)
      .mockImplementationOnce((params: ClackSessionParams) => {
        params.onSessionId?.("sdk-session-1");
        return makeRunFromMessages([
          assistantToolUse("mcp__clack__report_status"),
          successResult("delivered"),
        ]);
      });

    await executeChange({
      plan: makeTestPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    const resumeParams = clackSessionMock.mock.calls[1][0];
    assert.ok(resumeParams.prompt.includes('"tester-setup:my-repo"'));
  });

  it("omits the setup rewrite from the corrective prompt when the entry was rewritten mid-run", async () => {
    setupEntryWasRewrittenMock.mockResolvedValue(true);
    clackSessionMock
      .mockImplementationOnce(deliverableFreeRun)
      .mockImplementationOnce((params: ClackSessionParams) => {
        params.onSessionId?.("sdk-session-1");
        return makeRunFromMessages([
          assistantToolUse("mcp__clack__report_status"),
          successResult("delivered"),
        ]);
      });

    await executeChange({
      plan: makeTestPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    const resumeParams = clackSessionMock.mock.calls[1][0];
    assert.ok(!resumeParams.prompt.includes("tester-setup:my-repo"));
  });

  it("fails loudly when the corrective resume also delivers nothing, with exactly one attempt", async () => {
    clackSessionMock
      .mockImplementationOnce(deliverableFreeRun)
      .mockImplementationOnce((params: ClackSessionParams) => {
        params.onSessionId?.("sdk-session-1");
        return makeRunFromMessages([successResult("still nothing")]);
      });

    const result = await executeChange({
      plan: makeTestPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("without delivering a recording or a status report"));
    assert.equal(clackSessionMock.mock.calls.length, 2);
    assert.ok(logLines().includes("Corrective resume: failed to deliver"));
    assert.equal(teardownAppProcessMock.mock.calls.length, 1);
  });

  it("fails loudly and aborts the attempt when the resume falls back to a fresh session", async () => {
    clackSessionMock
      .mockImplementationOnce(deliverableFreeRun)
      .mockImplementationOnce((params: ClackSessionParams) => {
        params.onResumeFallback?.();
        return makeRunFromMessages([
          assistantToolUse("mcp__clack__report_status"),
          successResult("context-free noise"),
        ]);
      });

    const result = await executeChange({
      plan: makeTestPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("without delivering a recording or a status report"));
    assert.ok(logLines().some((line) => line.startsWith("Corrective resume: fell back")));
  });

  it("skips the corrective resume and fails loudly when no SDK session id was captured", async () => {
    clackSessionMock.mockImplementation(() =>
      makeRunFromMessages([successResult("no init message ever arrived")]),
    );

    const result = await executeChange({
      plan: makeTestPlan(),
      worktree,
      request: makeRequest(),
      sessionId: "s1",
    });

    assert.equal(result.success, false);
    assert.equal(clackSessionMock.mock.calls.length, 1);
    assert.ok(logLines().includes("Corrective resume: skipped (no SDK session id)"));
    assert.equal(teardownAppProcessMock.mock.calls.length, 1);
  });
});
