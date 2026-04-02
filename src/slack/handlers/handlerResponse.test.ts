import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { ClaudeResponse, AskClaudeOptions } from "../../claude/index.js";
import type { SessionContext } from "../../sessions.js";
import type { SessionInfo } from "../activeSessions.js";

// ============================================================================
// Mocks — set up before importing the module under test
// ============================================================================

const mockAskClaude = mock.fn<(...args: unknown[]) => Promise<ClaudeResponse>>(
  async () => ({ success: true, answer: "test answer" }),
);

const mockSetLastAnswer = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const mockUpdateSession = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const mockAddError = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});

const mockGetErrorBlocksWithRetry = mock.fn(() => [{ type: "section" }]);
const mockAsSlackBlocks = mock.fn((blocks: unknown) => blocks);

const mockSendErrorReport = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const mockAnalyzeError = mock.fn<(...args: unknown[]) => Promise<string>>(async () => "error analysis");

const mockGetConfig = mock.fn(() => ({
  slack: { sendErrorsAsDM: false },
}));

const mockGetClaudeOptions = mock.fn<(...args: unknown[]) => Promise<AskClaudeOptions>>(
  async () => ({ role: "dev" as const, changesWorkflowEnabled: false }),
);

const mockHandleAutoExecuteActions = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});

const mockGetUserPreference = mock.fn<(...args: unknown[]) => Promise<unknown>>(async () => false);

// Track SlackStreamer instances for inspection
let streamerHasFailed = false;
let streamerMessageTs: string | undefined;
let mockStreamerStart: ReturnType<typeof mock.fn>;
let mockStreamerStop: ReturnType<typeof mock.fn>;
let mockStreamerHandleEvent: ReturnType<typeof mock.fn>;
let mockStreamerGetMessageTs: ReturnType<typeof mock.fn>;

function resetStreamerInstance(overrides?: { hasFailed?: boolean; startReturns?: boolean; messageTs?: string }) {
  streamerHasFailed = overrides?.hasFailed ?? false;
  streamerMessageTs = overrides?.messageTs;
  mockStreamerStart = mock.fn(async () => overrides?.startReturns ?? true);
  mockStreamerStop = mock.fn(async () => {});
  mockStreamerHandleEvent = mock.fn();
  mockStreamerGetMessageTs = mock.fn(() => streamerMessageTs);
}

mock.module("../../claude/index.js", {
  namedExports: {
    askClaude: mockAskClaude,
  },
});

mock.module("../../claude/utilities.js", {
  namedExports: {
    analyzeError: mockAnalyzeError,
  },
});

mock.module("../../sessions.js", {
  namedExports: {
    setLastAnswer: mockSetLastAnswer,
    updateSession: mockUpdateSession,
    addError: mockAddError,
  },
});

mock.module("../blocks.js", {
  namedExports: {
    getErrorBlocksWithRetry: mockGetErrorBlocksWithRetry,
    asSlackBlocks: mockAsSlackBlocks,
  },
});

mock.module("../messagesApi.js", {
  namedExports: {
    sendErrorReport: mockSendErrorReport,
  },
});

mock.module("../../config.js", {
  namedExports: {
    getConfig: mockGetConfig,
  },
});

mock.module("./changeWorkflowHelper.js", {
  namedExports: {
    getClaudeOptions: mockGetClaudeOptions,
  },
});

mock.module("./autoExecute.js", {
  namedExports: {
    handleAutoExecuteActions: mockHandleAutoExecuteActions,
  },
});

mock.module("../../streaming/slackStreamer.js", {
  namedExports: {
    SlackStreamer: class MockSlackStreamer {
      start(...args: unknown[]) { return mockStreamerStart(...args); }
      stop(...args: unknown[]) { return mockStreamerStop(...args); }
      handleEvent(...args: unknown[]) { return mockStreamerHandleEvent(...args); }
      getMessageTs() { return mockStreamerGetMessageTs(); }
      get hasFailed() { return streamerHasFailed; }
    },
  },
});

mock.module("../../userPreferences.js", {
  namedExports: {
    getUserPreference: mockGetUserPreference,
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

mock.module("../../errors.js", {
  namedExports: {
    errorMessage: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  },
});

// Import after mocks are configured
const { executeAndDeliver, postResponse, getHandlerClaudeOptions } =
  await import("./handlerResponse.js");

// ============================================================================
// Helpers
// ============================================================================

function makeClient(): App["client"] {
  const postMessageFn = mock.fn(async () => ({ ok: true }));
  const deleteFn = mock.fn(async () => ({ ok: true }));
  return {
    chat: {
      postMessage: postMessageFn,
      delete: deleteFn,
    },
  } as unknown as App["client"];
}

function makeSession(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "session-1",
    channelId: "C001",
    messageTs: "1700000000.000001",
    threadTs: "1700000000.000001",
    userId: "U001",
    originalQuestion: "test question",
    threadContext: [],
    refinements: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  } as SessionContext;
}

function makeSessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    channelId: "C001",
    threadTs: "1700000000.000001",
    userId: "U001",
    ...overrides,
  };
}

function makeClaudeOptions(overrides: Partial<AskClaudeOptions> = {}): AskClaudeOptions {
  return {
    role: "dev",
    changesWorkflowEnabled: false,
    ...overrides,
  };
}

function getPostMessageMock(client: App["client"]) {
  return client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
}

beforeEach(() => {
  mockAskClaude.mock.resetCalls();
  mockSetLastAnswer.mock.resetCalls();
  mockUpdateSession.mock.resetCalls();
  mockAddError.mock.resetCalls();
  mockGetErrorBlocksWithRetry.mock.resetCalls();
  mockAsSlackBlocks.mock.resetCalls();
  mockSendErrorReport.mock.resetCalls();
  mockAnalyzeError.mock.resetCalls();
  mockGetConfig.mock.resetCalls();
  mockGetClaudeOptions.mock.resetCalls();
  mockHandleAutoExecuteActions.mock.resetCalls();
  mockGetUserPreference.mock.resetCalls();

  // Reset mockAskClaude to default implementation
  mockAskClaude.mock.mockImplementation(async () => ({
    success: true,
    answer: "test answer",
  }));

  // Reset config to default
  mockGetConfig.mock.mockImplementation(() => ({
    slack: { sendErrorsAsDM: false },
  }));

  // Reset user preference
  mockGetUserPreference.mock.mockImplementation(async () => false);

  // Reset streamer
  resetStreamerInstance();
});

// ============================================================================
// executeAndDeliver — streaming setup
// ============================================================================

describe("executeAndDeliver — streaming setup", () => {
  it("starts the streamer and calls askClaude", async () => {
    const client = makeClient();
    const session = makeSession();
    const sessionInfo = makeSessionInfo();

    await executeAndDeliver({
      client,
      session,
      sessionInfo,
      claudeOptions: makeClaudeOptions(),
    });

    assert.equal(mockStreamerStart.mock.callCount(), 1);
    assert.equal(mockAskClaude.mock.callCount(), 1);
  });

  it("derives target from dmChannel/dmThreadTs when present", async () => {
    const client = makeClient();
    const session = makeSession();
    const sessionInfo = makeSessionInfo({
      dmChannel: "D_DM_CHANNEL",
      dmThreadTs: "1700099.000001",
    });

    await executeAndDeliver({
      client,
      session,
      sessionInfo,
      claudeOptions: makeClaudeOptions(),
    });

    // Streamer should have been created with DM channel/thread
    assert.equal(mockStreamerStart.mock.callCount(), 1);
    assert.equal(mockAskClaude.mock.callCount(), 1);
  });

  it("continues even when stream fails to start", async () => {
    resetStreamerInstance({ startReturns: false });

    const client = makeClient();
    const session = makeSession();
    const sessionInfo = makeSessionInfo();

    const response = await executeAndDeliver({
      client,
      session,
      sessionInfo,
      claudeOptions: makeClaudeOptions(),
    });

    assert.equal(response.success, true);
    assert.equal(mockAskClaude.mock.callCount(), 1);
  });

  it("stops the streamer in finally block", async () => {
    const client = makeClient();
    const session = makeSession();
    const sessionInfo = makeSessionInfo();

    await executeAndDeliver({
      client,
      session,
      sessionInfo,
      claudeOptions: makeClaudeOptions(),
    });

    // stop() is called at least once (in finally block)
    assert.ok(mockStreamerStop.mock.callCount() >= 1);
  });

  it("stops the streamer even when askClaude throws", async () => {
    mockAskClaude.mock.mockImplementation(async () => {
      throw new Error("askClaude exploded");
    });

    const client = makeClient();
    const session = makeSession();
    const sessionInfo = makeSessionInfo();

    await assert.rejects(
      () =>
        executeAndDeliver({
          client,
          session,
          sessionInfo,
          claudeOptions: makeClaudeOptions(),
        }),
      { message: "askClaude exploded" },
    );

    assert.ok(mockStreamerStop.mock.callCount() >= 1);
  });
});

// ============================================================================
// executeAndDeliver — success handling
// ============================================================================

describe("executeAndDeliver — success handling", () => {
  it("persists response state on success", async () => {
    mockAskClaude.mock.mockImplementation(async () => ({
      success: true,
      answer: "the answer",
      response: { sections: [], actions: [] },
      stagedIntents: { r1: { type: "change" as const, branch: "b", description: "d", repo: "r" } },
      toolCallHistory: [{ tool: "list_repositories", args: {}, result: {}, timestamp: 1 }],
    }));

    const session = makeSession();

    await executeAndDeliver({
      client: makeClient(),
      session,
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    assert.equal(mockSetLastAnswer.mock.callCount(), 1);
    assert.equal(mockSetLastAnswer.mock.calls[0].arguments[0], "session-1");
    assert.equal(mockSetLastAnswer.mock.calls[0].arguments[1], "the answer");

    assert.equal(mockUpdateSession.mock.callCount(), 1);
    const updates = mockUpdateSession.mock.calls[0].arguments[1] as Partial<SessionContext>;
    assert.ok(updates.lastResponse);
    assert.ok(updates.stagedIntents);
    assert.ok(updates.toolCallHistory);
  });

  it("does not call updateSession when there are no extra fields", async () => {
    mockAskClaude.mock.mockImplementation(async () => ({
      success: true,
      answer: "simple answer",
    }));

    await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    assert.equal(mockSetLastAnswer.mock.callCount(), 1);
    assert.equal(mockUpdateSession.mock.callCount(), 0);
  });

  it("does not call updateSession for empty stagedIntents", async () => {
    mockAskClaude.mock.mockImplementation(async () => ({
      success: true,
      answer: "answer",
      stagedIntents: {},
    }));

    await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    assert.equal(mockUpdateSession.mock.callCount(), 0);
  });

  it("does not call updateSession for empty toolCallHistory", async () => {
    mockAskClaude.mock.mockImplementation(async () => ({
      success: true,
      answer: "answer",
      toolCallHistory: [],
    }));

    await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    assert.equal(mockUpdateSession.mock.callCount(), 0);
  });

  it("calls handleAutoExecuteActions on success", async () => {
    mockAskClaude.mock.mockImplementation(async () => ({
      success: true,
      answer: "done",
    }));

    const sessionInfo = makeSessionInfo({
      triggerType: "mentions",
      dmChannel: "D_DM",
      dmThreadTs: "17.99",
    });

    await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo,
      claudeOptions: makeClaudeOptions({ role: "admin" }),
    });

    assert.equal(mockHandleAutoExecuteActions.mock.callCount(), 1);
    const args = mockHandleAutoExecuteActions.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(args.channelId, "C001");
    assert.equal(args.threadTs, "1700000000.000001");
    assert.equal(args.userId, "U001");
    assert.equal(args.role, "admin");
    assert.equal(args.dmChannel, "D_DM");
    assert.equal(args.dmThreadTs, "17.99");
    assert.equal(args.triggerType, "mentions");
  });

  it("delivers via streamer fallback when submit_response was not called", async () => {
    mockAskClaude.mock.mockImplementation(async () => ({
      success: true,
      answer: "raw answer text",
    }));

    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    // The streamer.stop should be called with the answer text
    const stopCalls = mockStreamerStop.mock.calls;
    // At least one stop call should have markdownText
    const deliveryStopCall = stopCalls.find(
      (c: { arguments: unknown[] }) => c.arguments[0] && typeof c.arguments[0] === "object" && "markdownText" in (c.arguments[0] as Record<string, unknown>),
    );
    assert.ok(deliveryStopCall, "streamer.stop should be called with markdownText");
    assert.equal(
      (deliveryStopCall.arguments[0] as { markdownText: string }).markdownText,
      "raw answer text",
    );
  });

  it("falls back to chat.postMessage when streamer has failed", async () => {
    resetStreamerInstance({ hasFailed: true });

    mockAskClaude.mock.mockImplementation(async () => ({
      success: true,
      answer: "fallback text",
    }));

    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    const postMessage = getPostMessageMock(client);
    assert.ok(postMessage.mock.callCount() >= 1);
    const call = postMessage.mock.calls[0].arguments[0] as {
      channel: string;
      thread_ts: string;
      text: string;
    };
    assert.equal(call.text, "fallback text");
    assert.equal(call.channel, "C001");
    assert.equal(call.thread_ts, "1700000000.000001");
  });
});

// ============================================================================
// executeAndDeliver — cancellation
// ============================================================================

describe("executeAndDeliver — cancellation", () => {
  it("returns the cancelled response without auto-executing", async () => {
    mockAskClaude.mock.mockImplementation(async () => ({
      success: false,
      answer: "",
      cancelled: true,
    }));

    const response = await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    assert.equal(response.cancelled, true);
    assert.equal(mockHandleAutoExecuteActions.mock.callCount(), 0);
    assert.equal(mockSetLastAnswer.mock.callCount(), 0);
  });

  it("delivers cancellation message when not already delivered", async () => {
    mockAskClaude.mock.mockImplementation(async () => ({
      success: false,
      answer: "",
      cancelled: true,
    }));

    await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    // streamer.stop should be called with the cancellation text
    const stopCalls = mockStreamerStop.mock.calls;
    const cancelStopCall = stopCalls.find(
      (c: { arguments: unknown[] }) =>
        c.arguments[0] &&
        typeof c.arguments[0] === "object" &&
        "markdownText" in (c.arguments[0] as Record<string, unknown>),
    );
    assert.ok(cancelStopCall, "streamer.stop should be called with cancellation text");
    assert.ok(
      (cancelStopCall.arguments[0] as { markdownText: string }).markdownText.includes("cancelled"),
    );
  });
});

// ============================================================================
// executeAndDeliver — error handling
// ============================================================================

describe("executeAndDeliver — error handling", () => {
  it("posts error blocks on Claude failure", async () => {
    mockAskClaude.mock.mockImplementation(async () => ({
      success: false,
      answer: "",
      error: "Something broke",
      conversationTrace: [],
    }));

    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    assert.equal(mockAddError.mock.callCount(), 1);
    assert.equal(mockAddError.mock.calls[0].arguments[0], "session-1");
    assert.equal(mockAddError.mock.calls[0].arguments[1], "Something broke");

    assert.equal(mockGetErrorBlocksWithRetry.mock.callCount(), 1);
    assert.equal(mockAsSlackBlocks.mock.callCount(), 1);

    const postMessage = getPostMessageMock(client);
    assert.ok(postMessage.mock.callCount() >= 1);
    const call = postMessage.mock.calls[0].arguments[0] as { text: string };
    assert.ok(call.text.includes("session-1"));
    assert.ok(call.text.includes("crashed"));
  });

  it("uses error message directly for platform limit errors", async () => {
    mockAskClaude.mock.mockImplementation(async () => ({
      success: false,
      answer: "",
      error: "Usage limit reached for this account",
      conversationTrace: [],
    }));

    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    const postMessage = getPostMessageMock(client);
    const call = postMessage.mock.calls[0].arguments[0] as { text: string };
    assert.ok(call.text.includes("Usage limit reached"));
    assert.ok(!call.text.includes("crashed"));
  });

  it("uses 'Unknown error' when error field is empty", async () => {
    mockAskClaude.mock.mockImplementation(async () => ({
      success: false,
      answer: "",
      error: "",
      conversationTrace: [],
    }));

    await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    assert.equal(mockAddError.mock.calls[0].arguments[1], "Unknown error");
  });

  it("sends error report DM when configured", async () => {
    mockGetConfig.mock.mockImplementation(() => ({
      slack: { sendErrorsAsDM: true },
    }));

    mockAskClaude.mock.mockImplementation(async () => ({
      success: false,
      answer: "",
      error: "crash",
      conversationTrace: [{ type: "user", content: "help", timestamp: 1 }],
    }));

    await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    assert.equal(mockAnalyzeError.mock.callCount(), 1);
    assert.equal(mockSendErrorReport.mock.callCount(), 1);
  });

  it("does not send error report DM when not configured", async () => {
    mockGetConfig.mock.mockImplementation(() => ({
      slack: { sendErrorsAsDM: false },
    }));

    mockAskClaude.mock.mockImplementation(async () => ({
      success: false,
      answer: "",
      error: "crash",
      conversationTrace: [],
    }));

    await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    assert.equal(mockAnalyzeError.mock.callCount(), 0);
    assert.equal(mockSendErrorReport.mock.callCount(), 0);
  });

  it("does not crash when error report DM fails", async () => {
    mockGetConfig.mock.mockImplementation(() => ({
      slack: { sendErrorsAsDM: true },
    }));

    mockAnalyzeError.mock.mockImplementation(async () => {
      throw new Error("analyze failed");
    });

    mockAskClaude.mock.mockImplementation(async () => ({
      success: false,
      answer: "",
      error: "crash",
      conversationTrace: [],
    }));

    // Should not throw
    await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });
  });

  it("posts error to DM channel when sessionInfo has dmChannel", async () => {
    mockAskClaude.mock.mockImplementation(async () => ({
      success: false,
      answer: "",
      error: "broken",
      conversationTrace: [],
    }));

    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo({
        dmChannel: "D_DM_ERR",
        dmThreadTs: "17.111",
      }),
      claudeOptions: makeClaudeOptions(),
    });

    const postMessage = getPostMessageMock(client);
    const call = postMessage.mock.calls[0].arguments[0] as {
      channel: string;
      thread_ts: string;
    };
    assert.equal(call.channel, "D_DM_ERR");
    assert.equal(call.thread_ts, "17.111");
  });
});

// ============================================================================
// executeAndDeliver — unexpected errors
// ============================================================================

describe("executeAndDeliver — unexpected errors", () => {
  it("delivers fallback message and re-throws", async () => {
    mockAskClaude.mock.mockImplementation(async () => {
      throw new Error("unexpected boom");
    });

    const client = makeClient();

    await assert.rejects(
      () =>
        executeAndDeliver({
          client,
          session: makeSession(),
          sessionInfo: makeSessionInfo(),
          claudeOptions: makeClaudeOptions(),
        }),
      { message: "unexpected boom" },
    );

    // Should have tried to post a fallback message via streamer or chat.postMessage
    const stopCalls = mockStreamerStop.mock.calls;
    const fallbackCall = stopCalls.find(
      (c: { arguments: unknown[] }) =>
        c.arguments[0] &&
        typeof c.arguments[0] === "object" &&
        "markdownText" in (c.arguments[0] as Record<string, unknown>),
    );
    assert.ok(fallbackCall, "should have attempted fallback delivery via streamer");
    assert.ok(
      (fallbackCall.arguments[0] as { markdownText: string }).markdownText.includes(
        "Something went wrong",
      ),
    );
  });

  it("does not throw when fallback delivery itself fails", async () => {
    resetStreamerInstance({ hasFailed: true });

    mockAskClaude.mock.mockImplementation(async () => {
      throw new Error("unexpected boom");
    });

    const client = makeClient();
    (client.chat.postMessage as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(
      async () => {
        throw new Error("slack also down");
      },
    );

    // The original error should still be thrown, not the fallback error
    await assert.rejects(
      () =>
        executeAndDeliver({
          client,
          session: makeSession(),
          sessionInfo: makeSessionInfo(),
          claudeOptions: makeClaudeOptions(),
        }),
      { message: "unexpected boom" },
    );
  });
});

// ============================================================================
// executeAndDeliver — notification preference
// ============================================================================

describe("executeAndDeliver — response notification", () => {
  it("sends notification when user has notifyOnResponse enabled and delivered via streamer", async (t) => {
    mockGetUserPreference.mock.mockImplementation(async () => true);

    // Mock Date so we can advance time past the 60s notification threshold
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });

    // Simulate the deliver function being called (submit_response was called)
    mockAskClaude.mock.mockImplementation(async (...args: unknown[]) => {
      const opts = args[1] as Record<string, unknown>;
      const deliver = opts.deliver as (opts: { markdownText: string }) => Promise<{ ok: boolean }>;
      // Advance time by 61s before deliver — sendResponseNotification checks elapsed time
      t.mock.timers.tick(61_000);
      await deliver({ markdownText: "delivered answer" });
      return { success: true, answer: "delivered answer" };
    });

    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    const postMessage = getPostMessageMock(client);
    // Should have posted a notification
    const notifCall = postMessage.mock.calls.find(
      (c: { arguments: unknown[] }) =>
        (c.arguments[0] as { text: string }).text.includes("Response ready"),
    );
    assert.ok(notifCall, "should post notification message");
  });

  it("does not send notification when user has notifyOnResponse disabled", async () => {
    mockGetUserPreference.mock.mockImplementation(async () => false);

    mockAskClaude.mock.mockImplementation(async (...args: unknown[]) => {
      const opts = args[1] as Record<string, unknown>;
      const deliver = opts.deliver as (opts: { markdownText: string }) => Promise<{ ok: boolean }>;
      await deliver({ markdownText: "delivered answer" });
      return { success: true, answer: "delivered answer" };
    });

    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    const postMessage = getPostMessageMock(client);
    const notifCall = postMessage.mock.calls.find(
      (c: { arguments: unknown[] }) =>
        (c.arguments[0] as { text: string }).text.includes("Response ready"),
    );
    assert.equal(notifCall, undefined, "should not post notification message");
  });
});

// ============================================================================
// buildDeliverFn (tested indirectly via executeAndDeliver)
// ============================================================================

describe("executeAndDeliver — deliver function", () => {
  it("prevents double delivery", async () => {
    mockAskClaude.mock.mockImplementation(async (...args: unknown[]) => {
      const opts = args[1] as Record<string, unknown>;
      const deliver = opts.deliver as (opts: { markdownText: string }) => Promise<{ ok: boolean; error?: string }>;
      await deliver({ markdownText: "first" });
      await deliver({ markdownText: "second" });
      return { success: true, answer: "done" };
    });

    const response = await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    // Can't directly inspect deliver results, but we can verify the streamer was only stopped once with content
    const stopCalls = mockStreamerStop.mock.calls;
    const contentStops = stopCalls.filter(
      (c: { arguments: unknown[] }) =>
        c.arguments[0] &&
        typeof c.arguments[0] === "object" &&
        "markdownText" in (c.arguments[0] as Record<string, unknown>),
    );
    // Only one content delivery via streamer (the first call)
    assert.equal(contentStops.length, 1);
    assert.equal(response.success, true);
  });

  it("falls back to chat.postMessage when streamer has failed", async () => {
    resetStreamerInstance({ hasFailed: true });

    mockAskClaude.mock.mockImplementation(async (...args: unknown[]) => {
      const opts = args[1] as Record<string, unknown>;
      const deliver = opts.deliver as (opts: { markdownText: string }) => Promise<{ ok: boolean }>;
      await deliver({ markdownText: "fallback content" });
      return { success: true, answer: "fallback content" };
    });

    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    const postMessage = getPostMessageMock(client);
    const call = postMessage.mock.calls.find(
      (c: { arguments: unknown[] }) =>
        (c.arguments[0] as { text: string }).text === "fallback content",
    );
    assert.ok(call, "should fall back to chat.postMessage");
  });

  it("returns error result when delivery throws", async () => {
    resetStreamerInstance({ hasFailed: true });

    let deliverResult: { ok: boolean; error?: string } | undefined;

    // Make chat.postMessage throw only on the first call (the deliver call),
    // then succeed on subsequent calls (fallback delivery in handleSuccess)
    let callCount = 0;
    const client = makeClient();
    (client.chat.postMessage as unknown as ReturnType<typeof mock.fn>).mock.mockImplementation(
      async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("slack is down");
        }
        return { ok: true };
      },
    );

    mockAskClaude.mock.mockImplementation(async (...args: unknown[]) => {
      const opts = args[1] as Record<string, unknown>;
      const deliver = opts.deliver as (opts: { markdownText: string }) => Promise<{ ok: boolean; error?: string }>;
      deliverResult = await deliver({ markdownText: "will fail" });
      return { success: true, answer: "done" };
    });

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
    });

    assert.ok(deliverResult);
    assert.equal(deliverResult!.ok, false);
    assert.ok(deliverResult!.error?.includes("slack is down"));
  });
});

// ============================================================================
// postResponse
// ============================================================================

describe("postResponse", () => {
  it("posts to the session channel and thread", async () => {
    const client = makeClient();
    const sessionInfo = makeSessionInfo();

    await postResponse(client, sessionInfo, { text: "hello" });

    const postMessage = getPostMessageMock(client);
    assert.equal(postMessage.mock.callCount(), 1);
    const call = postMessage.mock.calls[0].arguments[0] as {
      channel: string;
      thread_ts: string;
      text: string;
    };
    assert.equal(call.channel, "C001");
    assert.equal(call.thread_ts, "1700000000.000001");
    assert.equal(call.text, "hello");
  });

  it("posts to DM channel when dmChannel is set", async () => {
    const client = makeClient();
    const sessionInfo = makeSessionInfo({
      dmChannel: "D_DM",
      dmThreadTs: "17.99",
    });

    await postResponse(client, sessionInfo, { text: "dm reply" });

    const postMessage = getPostMessageMock(client);
    const call = postMessage.mock.calls[0].arguments[0] as {
      channel: string;
      thread_ts: string;
    };
    assert.equal(call.channel, "D_DM");
    assert.equal(call.thread_ts, "17.99");
  });

  it("includes blocks when provided", async () => {
    const client = makeClient();
    const sessionInfo = makeSessionInfo();
    const blocks = [{ type: "section" as const, text: { type: "mrkdwn" as const, text: "block text" } }];

    await postResponse(client, sessionInfo, { text: "fallback", blocks: blocks as unknown[] as import("../blocks.js").SlackBlocks });

    const postMessage = getPostMessageMock(client);
    const call = postMessage.mock.calls[0].arguments[0] as { blocks?: unknown[] };
    assert.ok(call.blocks);
    assert.equal(call.blocks.length, 1);
  });

  it("does not include blocks key when not provided", async () => {
    const client = makeClient();
    const sessionInfo = makeSessionInfo();

    await postResponse(client, sessionInfo, { text: "no blocks" });

    const postMessage = getPostMessageMock(client);
    const call = postMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal("blocks" in call, false);
  });
});

// ============================================================================
// getHandlerClaudeOptions
// ============================================================================

describe("getHandlerClaudeOptions", () => {
  it("delegates to getClaudeOptions with userId and triggerType", async () => {
    const sessionInfo = makeSessionInfo({ triggerType: "mentions" });

    await getHandlerClaudeOptions(sessionInfo);

    assert.equal(mockGetClaudeOptions.mock.callCount(), 1);
    assert.equal(mockGetClaudeOptions.mock.calls[0].arguments[0], "U001");
    assert.equal(mockGetClaudeOptions.mock.calls[0].arguments[1], "mentions");
  });

  it("defaults triggerType to directMessages when not set", async () => {
    const sessionInfo = makeSessionInfo();

    await getHandlerClaudeOptions(sessionInfo);

    assert.equal(mockGetClaudeOptions.mock.calls[0].arguments[1], "directMessages");
  });

  it("returns the options from getClaudeOptions", async () => {
    mockGetClaudeOptions.mock.mockImplementation(async () => ({
      role: "admin" as const,
      changesWorkflowEnabled: true,
    }));

    const result = await getHandlerClaudeOptions(makeSessionInfo());

    assert.equal(result.role, "admin");
    assert.equal(result.changesWorkflowEnabled, true);
  });
});

describe("silentThinking mode", () => {
  beforeEach(() => {
    resetStreamerInstance();
    mockAskClaude.mock.resetCalls();
    mockAskClaude.mock.mockImplementation(async () => ({
      success: true,
      answer: "silent answer",
    }));
  });

  it("does not create a SlackStreamer when silentThinking is true", async () => {
    const client = makeClient();
    mockStreamerStart.mock.resetCalls();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
      silentThinking: true,
    });

    // Streamer should never have been started
    assert.equal(mockStreamerStart.mock.callCount(), 0);
  });

  it("passes no-op onEvent when silentThinking", async () => {
    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
      silentThinking: true,
    });

    // askClaude should have been called with a no-op event handler
    const callArgs = mockAskClaude.mock.calls[0].arguments[1] as Record<string, unknown>;
    assert.equal(typeof callArgs.onEvent, "function");
  });

  it("creates SlackStreamer when silentThinking is false", async () => {
    const client = makeClient();
    mockStreamerStart.mock.resetCalls();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
      silentThinking: false,
    });

    // Streamer should have been started
    assert.equal(mockStreamerStart.mock.callCount(), 1);
  });

  describe("skip handling", () => {
    it("deletes the streamer message and skips persistence when response is skipped", async () => {
      resetStreamerInstance({ messageTs: "1234.5678" });
      mockAskClaude.mock.mockImplementationOnce(async () => ({
        success: true,
        skipped: true,
        answer: "",
      }));
      mockSetLastAnswer.mock.resetCalls();
      mockUpdateSession.mock.resetCalls();
      mockHandleAutoExecuteActions.mock.resetCalls();

      const client = makeClient();
      const response = await executeAndDeliver({
        client,
        session: makeSession(),
        sessionInfo: makeSessionInfo(),
        claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
      });

      assert.equal(response.skipped, true);

      // chat.delete should have been called with the streamer's ts
      const deleteCall = (client.chat.delete as unknown as ReturnType<typeof mock.fn>).mock.calls[0];
      assert.ok(deleteCall);
      assert.deepStrictEqual(deleteCall.arguments[0], { channel: "C001", ts: "1234.5678" });

      // Session persistence and auto-execute should NOT have been called
      assert.equal(mockSetLastAnswer.mock.callCount(), 0);
      assert.equal(mockHandleAutoExecuteActions.mock.callCount(), 0);
    });

    it("handles skip gracefully when streamer has no messageTs", async () => {
      resetStreamerInstance({ messageTs: undefined });
      mockAskClaude.mock.mockImplementationOnce(async () => ({
        success: true,
        skipped: true,
        answer: "",
      }));

      const client = makeClient();
      const response = await executeAndDeliver({
        client,
        session: makeSession(),
        sessionInfo: makeSessionInfo(),
        claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
      });

      assert.equal(response.skipped, true);
      // chat.delete should NOT have been called
      assert.equal((client.chat.delete as unknown as ReturnType<typeof mock.fn>).mock.callCount(), 0);
    });
  });
});
