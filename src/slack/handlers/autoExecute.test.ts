import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { ClaudeResponse } from "../../claude/index.js";
import type { Action, StagedIntent, StagedChangeIntent, StagedConfigUpdateIntent, StagedUpdateIntent } from "../../tools/types.js";
import type { UserRole } from "../../roles.js";
import type { SessionContext } from "../../sessions.js";

// ============================================================================
// Mocks — set up before importing the module under test
// ============================================================================

const mockWriteInstructionFile = mock.fn<(filename: string, content: string) => void>();
const mockTriggerChangeWorkflow = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const mockTriggerFollowUp = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const mockFindSessionByThread = mock.fn<(...args: unknown[]) => Promise<SessionContext | null>>(async () => null);

mock.module("../../configurationFiles.js", {
  namedExports: {
    writeInstructionFile: mockWriteInstructionFile,
  },
});

mock.module("./changeAction.js", {
  namedExports: {
    triggerChangeWorkflow: mockTriggerChangeWorkflow,
  },
});

mock.module("./changeThreadActions.js", {
  namedExports: {
    triggerFollowUp: mockTriggerFollowUp,
  },
});

mock.module("../../sessions.js", {
  namedExports: {
    findSessionByThread: mockFindSessionByThread,
  },
});

mock.module("../../logger.js", {
  namedExports: {
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  },
});

// Import after mocks are configured
const { handleAutoExecuteActions } = await import("./autoExecute.js");

// ============================================================================
// Helpers
// ============================================================================

function makeClient(): App["client"] {
  const postMessageFn = mock.fn(async () => ({ ok: true }));
  return {
    chat: {
      postMessage: postMessageFn,
    },
  } as unknown as App["client"];
}

function makeBaseParams(overrides: Partial<Parameters<typeof handleAutoExecuteActions>[0]> = {}) {
  return {
    client: makeClient(),
    channelId: "C001",
    threadTs: "1700000000.000001",
    userId: "U001",
    sessionId: "session-1",
    role: "dev" as UserRole,
    response: {
      success: true,
      answer: "test",
    } as ClaudeResponse,
    ...overrides,
  };
}

function makeResponseWithActions(
  actions: ClaudeResponse["response"],
  stagedIntents?: Record<string, StagedIntent>,
): ClaudeResponse {
  return {
    success: true,
    answer: "test",
    response: actions,
    stagedIntents,
  };
}

beforeEach(() => {
  mockWriteInstructionFile.mock.resetCalls();
  mockTriggerChangeWorkflow.mock.resetCalls();
  mockTriggerFollowUp.mock.resetCalls();
  mockFindSessionByThread.mock.resetCalls();
});

// ============================================================================
// Early returns — no actions to auto-execute
// ============================================================================

describe("handleAutoExecuteActions — early returns", () => {
  it("returns immediately when response has no actions", async () => {
    const params = makeBaseParams({
      response: { success: true, answer: "hello" },
    });

    await handleAutoExecuteActions(params);
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 0);
    assert.equal(mockWriteInstructionFile.mock.callCount(), 0);
  });

  it("returns immediately when response has no stagedIntents", async () => {
    const params = makeBaseParams({
      response: {
        success: true,
        answer: "hello",
        response: {
          sections: [],
          actions: [{ type: "change", ref: "r1", auto: true }],
        },
        // no stagedIntents
      },
    });

    await handleAutoExecuteActions(params);
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 0);
  });

  it("returns immediately when response.response is undefined", async () => {
    const params = makeBaseParams({
      response: {
        success: true,
        answer: "hello",
        stagedIntents: { r1: { type: "change", branch: "b", description: "d", repo: "r" } },
      },
    });

    await handleAutoExecuteActions(params);
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 0);
  });

  it("returns immediately when there are no auto-flagged actions", async () => {
    const changeIntent: StagedChangeIntent = { type: "change", branch: "feat/x", description: "desc", repo: "org/repo" };
    const params = makeBaseParams({
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "change", ref: "r1" }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params);
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 0);
  });

  it("returns immediately when auto action has no ref", async () => {
    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          sections: [],
          actions: [
            // send_to_thread with auto but no ref
            { type: "send_to_thread", auto: true, content: "auto content" },
          ],
        },
        {},
      ),
    });

    await handleAutoExecuteActions(params);
    // send_to_thread doesn't have a ref property in its type, so it should be filtered out
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 0);
    assert.equal(mockWriteInstructionFile.mock.callCount(), 0);
  });
});

// ============================================================================
// Permission checks
// ============================================================================

describe("handleAutoExecuteActions — permission checks", () => {
  it("blocks auto-execute for member role", async () => {
    const changeIntent: StagedChangeIntent = { type: "change", branch: "feat/x", description: "desc", repo: "org/repo" };
    const params = makeBaseParams({
      role: "member",
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params);
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 0);
  });

  it("allows auto-execute for dev role", async () => {
    const changeIntent: StagedChangeIntent = { type: "change", branch: "feat/x", description: "desc", repo: "org/repo" };
    const params = makeBaseParams({
      role: "dev",
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params);
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 1);
  });

  it("allows auto-execute for admin role", async () => {
    const changeIntent: StagedChangeIntent = { type: "change", branch: "feat/x", description: "desc", repo: "org/repo" };
    const params = makeBaseParams({
      role: "admin",
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params);
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 1);
  });

  it("allows auto-execute for owner role", async () => {
    const changeIntent: StagedChangeIntent = { type: "change", branch: "feat/x", description: "desc", repo: "org/repo" };
    const params = makeBaseParams({
      role: "owner",
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params);
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 1);
  });
});

// ============================================================================
// Intent resolution
// ============================================================================

describe("handleAutoExecuteActions — intent resolution", () => {
  it("skips action when intent ref cannot be resolved", async () => {
    const params = makeBaseParams({
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "change", ref: "missing-ref", auto: true }] },
        { "other-ref": { type: "change", branch: "b", description: "d", repo: "r" } },
      ),
    });

    await handleAutoExecuteActions(params);
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 0);
  });
});

// ============================================================================
// config_update intent
// ============================================================================

describe("handleAutoExecuteActions — config_update", () => {
  it("writes the instruction file and posts a success message", async () => {
    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      file: "instructions.md",
      content: "new content",
    };
    const client = makeClient();
    const params = makeBaseParams({
      client,
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "config_update", ref: "c1", auto: true } as unknown as Action] },
        { c1: configIntent },
      ),
    });

    await handleAutoExecuteActions(params);

    assert.equal(mockWriteInstructionFile.mock.callCount(), 1);
    const writeArgs = mockWriteInstructionFile.mock.calls[0].arguments;
    assert.equal(writeArgs[0], "instructions.md");
    assert.equal(writeArgs[1], "new content");

    const postMessage = client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postMessage.mock.callCount(), 1);
    const msgArgs = postMessage.mock.calls[0].arguments[0] as { channel: string; thread_ts: string; text: string };
    assert.equal(msgArgs.channel, "C001");
    assert.ok(msgArgs.text.includes("instructions.md"));
    assert.ok(msgArgs.text.includes("updated"));
  });

  it("posts an error message when writeInstructionFile throws", async () => {
    mockWriteInstructionFile.mock.mockImplementation(() => {
      throw new Error("write failed");
    });

    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      file: "broken.md",
      content: "data",
    };
    const client = makeClient();
    const params = makeBaseParams({
      client,
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "config_update", ref: "c1", auto: true } as unknown as Action] },
        { c1: configIntent },
      ),
    });

    await handleAutoExecuteActions(params);

    const postMessage = client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postMessage.mock.callCount(), 1);
    const msgArgs = postMessage.mock.calls[0].arguments[0] as { text: string };
    assert.ok(msgArgs.text.includes("Failed to update"));
    assert.ok(msgArgs.text.includes("broken.md"));
    assert.ok(msgArgs.text.includes("write failed"));
  });
});

// ============================================================================
// change intent
// ============================================================================

describe("handleAutoExecuteActions — change intent", () => {
  it("triggers the change workflow with correct parameters", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/auto",
      description: "Auto change",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params);

    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 1);
    const args = mockTriggerChangeWorkflow.mock.calls[0].arguments;
    assert.deepEqual(args[0], changeIntent);
    const slackCtx = args[1] as Record<string, unknown>;
    assert.equal(slackCtx.channelId, "C001");
    assert.equal(slackCtx.threadTs, "1700000000.000001");
    assert.equal(slackCtx.userId, "U001");
  });

  it("propagates triggerType to the change workflow", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/auto",
      description: "desc",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      triggerType: "mentions",
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params);

    const slackCtx = mockTriggerChangeWorkflow.mock.calls[0].arguments[1] as Record<string, unknown>;
    assert.equal(slackCtx.triggerType, "mentions");
  });

  it("passes DM channel and thread when provided", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/auto",
      description: "desc",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      dmChannel: "D_DM",
      dmThreadTs: "1700000099.000001",
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params);

    const slackCtx = mockTriggerChangeWorkflow.mock.calls[0].arguments[1] as Record<string, unknown>;
    assert.equal(slackCtx.streamChannel, "D_DM");
    assert.equal(slackCtx.streamThreadTs, "1700000099.000001");
  });

  it("does not include stream fields when dmChannel is not provided", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/auto",
      description: "desc",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params);

    const slackCtx = mockTriggerChangeWorkflow.mock.calls[0].arguments[1] as Record<string, unknown>;
    assert.equal("streamChannel" in slackCtx, false);
    assert.equal("streamThreadTs" in slackCtx, false);
  });
});

// ============================================================================
// update intent
// ============================================================================

describe("handleAutoExecuteActions — update intent", () => {
  it("triggers follow-up when active change exists", async () => {
    const updateIntent: StagedUpdateIntent = {
      type: "update",
      sessionId: "session-1",
      instructions: "fix the tests",
    };
    const fakeSession = {
      sessionId: "session-1",
      channelId: "C001",
      messageTs: "1700000000.000001",
      threadTs: "1700000000.000001",
      userId: "U001",
      originalQuestion: "q",
      threadContext: [],
      refinements: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      activeChange: {
        branch: "feat/x",
        repo: "org/repo",
        description: "d",
        status: "pr_created" as const,
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    } as SessionContext;

    mockFindSessionByThread.mock.mockImplementation(async () => fakeSession);

    const params = makeBaseParams({
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "update", ref: "u1", auto: true }] },
        { u1: updateIntent },
      ),
    });

    await handleAutoExecuteActions(params);

    assert.equal(mockTriggerFollowUp.mock.callCount(), 1);
    const args = mockTriggerFollowUp.mock.calls[0].arguments;
    assert.equal(args[0], fakeSession);
    assert.equal(args[1], "update");
    assert.equal(args[2], "fix the tests");
  });

  it("skips when no active change exists in thread", async () => {
    const updateIntent: StagedUpdateIntent = {
      type: "update",
      sessionId: "session-1",
      instructions: "fix the tests",
    };

    mockFindSessionByThread.mock.mockImplementation(async () => null);

    const params = makeBaseParams({
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "update", ref: "u1", auto: true }] },
        { u1: updateIntent },
      ),
    });

    await handleAutoExecuteActions(params);

    assert.equal(mockTriggerFollowUp.mock.callCount(), 0);
  });

  it("skips when session exists but has no activeChange", async () => {
    const updateIntent: StagedUpdateIntent = {
      type: "update",
      sessionId: "session-1",
      instructions: "fix",
    };
    const fakeSession = {
      sessionId: "session-1",
      channelId: "C001",
      messageTs: "1700000000.000001",
      threadTs: "1700000000.000001",
      userId: "U001",
      originalQuestion: "q",
      threadContext: [],
      refinements: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      // no activeChange
    } as SessionContext;

    mockFindSessionByThread.mock.mockImplementation(async () => fakeSession);

    const params = makeBaseParams({
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "update", ref: "u1", auto: true }] },
        { u1: updateIntent },
      ),
    });

    await handleAutoExecuteActions(params);

    assert.equal(mockTriggerFollowUp.mock.callCount(), 0);
  });

  it("passes DM stream fields for update follow-up", async () => {
    const updateIntent: StagedUpdateIntent = {
      type: "update",
      sessionId: "session-1",
      instructions: "fix it",
    };
    const fakeSession = {
      sessionId: "session-1",
      channelId: "C001",
      messageTs: "1700000000.000001",
      threadTs: "1700000000.000001",
      userId: "U001",
      originalQuestion: "q",
      threadContext: [],
      refinements: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      activeChange: {
        branch: "feat/x",
        repo: "org/repo",
        description: "d",
        status: "pr_created" as const,
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    } as SessionContext;

    mockFindSessionByThread.mock.mockImplementation(async () => fakeSession);

    const params = makeBaseParams({
      dmChannel: "D_DM",
      dmThreadTs: "17.99",
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "update", ref: "u1", auto: true }] },
        { u1: updateIntent },
      ),
    });

    await handleAutoExecuteActions(params);

    const slackCtx = mockTriggerFollowUp.mock.calls[0].arguments[3] as Record<string, unknown>;
    assert.equal(slackCtx.streamChannel, "D_DM");
    assert.equal(slackCtx.streamThreadTs, "17.99");
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe("handleAutoExecuteActions — error handling", () => {
  it("posts error to thread when triggerChangeWorkflow throws", async () => {
    mockTriggerChangeWorkflow.mock.mockImplementation(async () => {
      throw new Error("workflow exploded");
    });

    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/auto",
      description: "desc",
      repo: "org/repo",
    };
    const client = makeClient();
    const params = makeBaseParams({
      client,
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    // Should not throw
    await handleAutoExecuteActions(params);

    const postMessage = client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postMessage.mock.callCount(), 1);
    const msgArgs = postMessage.mock.calls[0].arguments[0] as { text: string };
    assert.ok(msgArgs.text.includes("Auto-execute failed"));
    assert.ok(msgArgs.text.includes("workflow exploded"));
  });

  it("does not crash when error reporting itself fails", async () => {
    mockTriggerChangeWorkflow.mock.mockImplementation(async () => {
      throw new Error("workflow exploded");
    });

    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/auto",
      description: "desc",
      repo: "org/repo",
    };
    const client = makeClient();
    // Make postMessage also throw
    (client.chat.postMessage as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => {
      throw new Error("slack down");
    });

    const params = makeBaseParams({
      client,
      response: makeResponseWithActions(
        { sections: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    // Should not throw — best-effort error reporting
    await handleAutoExecuteActions(params);
  });
});

// ============================================================================
// Multiple auto actions
// ============================================================================

describe("handleAutoExecuteActions — multiple actions", () => {
  it("processes multiple auto actions sequentially", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/first",
      description: "first",
      repo: "org/repo",
    };
    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      file: "settings.md",
      content: "new settings",
    };
    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          sections: [],
          actions: [
            { type: "change", ref: "r1", auto: true },
            { type: "config_update", ref: "c1", auto: true } as unknown as Action,
          ],
        },
        { r1: changeIntent, c1: configIntent },
      ),
    });

    await handleAutoExecuteActions(params);

    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 1);
    assert.equal(mockWriteInstructionFile.mock.callCount(), 1);
  });

  it("skips non-auto actions and processes auto ones", async () => {
    const changeIntent1: StagedChangeIntent = {
      type: "change",
      branch: "feat/manual",
      description: "manual",
      repo: "org/repo",
    };
    const changeIntent2: StagedChangeIntent = {
      type: "change",
      branch: "feat/auto",
      description: "auto",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          sections: [],
          actions: [
            { type: "change", ref: "r1" },             // no auto
            { type: "change", ref: "r2", auto: true },  // auto
          ],
        },
        { r1: changeIntent1, r2: changeIntent2 },
      ),
    });

    await handleAutoExecuteActions(params);

    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 1);
    const calledIntent = mockTriggerChangeWorkflow.mock.calls[0].arguments[0] as StagedChangeIntent;
    assert.equal(calledIntent.branch, "feat/auto");
  });
});
