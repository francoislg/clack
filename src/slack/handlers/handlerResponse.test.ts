import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { ClaudeResponse, AskClaudeOptions } from "../../claude/index.js";
import type { SessionContext } from "../../sessions.js";
import type { SessionInfo } from "../activeSessions.js";
import type { SlackBlocks } from "../blocks.js";
import {
  executeAndDeliver,
  postResponse,
  getHandlerClaudeOptions,
  type HandlerResponseDeps,
} from "./handlerResponse.js";

// ============================================================================
// Mocks
// ============================================================================

const mockAskClaude = mock.fn<(...args: never[]) => Promise<ClaudeResponse>>(async () => ({
  success: true,
  answer: "test answer",
}));

const mockAppendAssistantMessage = mock.fn<
  NonNullable<HandlerResponseDeps["appendAssistantMessage"]>
>(async () => null);

const mockUpdateSession = mock.fn<(...args: never[]) => Promise<void>>(async () => {});
const mockAddError = mock.fn<(...args: never[]) => Promise<void>>(async () => {});
const mockSetAutoResponseActive = mock.fn<(...args: never[]) => Promise<void>>(async () => {});

const mockGetErrorBlocksWithRetry = mock.fn(() => [{ type: "section" }]);
const mockAsSlackBlocks = mock.fn((blocks: never) => blocks);

const mockSendErrorReport = mock.fn<(...args: never[]) => Promise<void>>(async () => {});
const mockAnalyzeError = mock.fn<(...args: never[]) => Promise<string>>(
  async () => "error analysis",
);

const mockGetConfig = mock.fn(() => ({
  slack: { sendErrorsAsDM: false },
}));

const mockGetClaudeOptions = mock.fn<(...args: never[]) => Promise<AskClaudeOptions>>(async () => ({
  role: "dev" as const,
  changesWorkflowEnabled: false,
}));

const mockHandleAutoExecuteActions = mock.fn<(...args: never[]) => Promise<void>>(async () => {});

const mockGetUserPreference = mock.fn<(...args: never[]) => Promise<boolean>>(async () => false);

// Track SlackStreamer instances for inspection
let streamerHasFailed = false;
let streamerMessageTs: string | undefined;
let mockStreamerStart: ReturnType<typeof mock.fn>;
let mockStreamerStop: ReturnType<typeof mock.fn>;
let mockStreamerHandleEvent: ReturnType<typeof mock.fn>;
let mockStreamerGetMessageTs: ReturnType<typeof mock.fn>;

function resetStreamerInstance(overrides?: {
  hasFailed?: boolean;
  startReturns?: boolean;
  messageTs?: string;
}) {
  streamerHasFailed = overrides?.hasFailed ?? false;
  streamerMessageTs = overrides?.messageTs;
  mockStreamerStart = mock.fn(async () => overrides?.startReturns ?? true);
  mockStreamerStop = mock.fn(async () => {});
  mockStreamerHandleEvent = mock.fn();
  mockStreamerGetMessageTs = mock.fn(() => streamerMessageTs);
}

function makeDeps(): HandlerResponseDeps {
  return {
    askClaude: mockAskClaude as never,
    analyzeError: mockAnalyzeError as never,
    updateSession: mockUpdateSession as never,
    addError: mockAddError as never,
    setAutoResponseActive: mockSetAutoResponseActive as never,
    getErrorBlocksWithRetry: mockGetErrorBlocksWithRetry as never,
    asSlackBlocks: mockAsSlackBlocks as never,
    sendErrorReport: mockSendErrorReport as never,
    getConfig: mockGetConfig as never,
    getClaudeOptions: mockGetClaudeOptions as never,
    handleAutoExecuteActions: mockHandleAutoExecuteActions as never,
    createStreamer: () =>
      ({
        start: (...args: never[]) => mockStreamerStart(...args),
        stop: (...args: never[]) => mockStreamerStop(...args),
        handleEvent: (...args: never[]) => mockStreamerHandleEvent(...args),
        getMessageTs: () => mockStreamerGetMessageTs(),
        get hasFailed() {
          return streamerHasFailed;
        },
      }) as never,
    getUserPreference: mockGetUserPreference as never,
    writeErrorReport: mock.fn(async () => {}) as never,
    toErrorMessage: ((error: unknown) =>
      error instanceof Error ? error.message : String(error)) as never,
    getUserInfo: (async () => ({
      displayName: "TestUser",
      username: "testuser",
    })) as never,
    resolveChannelLabel: (async () => "#test") as never,
    slackLink: (async () => "") as never,
  };
}

let deps: HandlerResponseDeps;

// ============================================================================
// Helpers
// ============================================================================

let mockPostMessage: ReturnType<typeof mock.fn>;
let mockChatDelete: ReturnType<typeof mock.fn>;
let mockReactionsAdd: ReturnType<typeof mock.fn>;

function makeClient(): App["client"] {
  mockPostMessage = mock.fn(async () => ({ ok: true }));
  mockChatDelete = mock.fn(async () => ({ ok: true }));
  mockReactionsAdd = mock.fn(async () => ({ ok: true }));
  return Object.assign(Object.create(null), {
    chat: { postMessage: mockPostMessage, delete: mockChatDelete },
    reactions: { add: mockReactionsAdd },
  });
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

function getPostMessageMock(_client: App["client"]) {
  return mockPostMessage;
}

beforeEach(() => {
  mockAskClaude.mock.resetCalls();
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

  // Create fresh deps
  deps = makeDeps();
  deps.appendAssistantMessage = mockAppendAssistantMessage;
  mockAppendAssistantMessage.mock.resetCalls();
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
      deps,
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
      deps,
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
      deps,
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
      deps,
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
          deps,
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
      response: { blocks: [], actions: [] },
      stagedIntents: {
        r1: {
          type: "change" as const,
          branch: "b",
          description: "d",
          repo: "r",
        },
      },
      toolCallHistory: [{ tool: "list_repositories", args: {}, result: {}, timestamp: 1 }],
    }));

    const session = makeSession();

    await executeAndDeliver({
      client: makeClient(),
      session,
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    // answer + lastResponse + toolCalls now flow through appendAssistantMessage.
    // stagedIntents still goes through updateSession (per-turn ephemeral, not part of the log).
    assert.equal(mockAppendAssistantMessage.mock.callCount(), 1);
    assert.equal(mockAppendAssistantMessage.mock.calls[0].arguments[0], "session-1");
    const appended = mockAppendAssistantMessage.mock.calls[0].arguments[1];
    assert.equal(appended.text, "the answer");
    assert.ok(appended.payload);
    assert.ok(appended.toolCalls);
    assert.equal(mockUpdateSession.mock.callCount(), 1);
    const updates = mockUpdateSession.mock.calls[0].arguments[1] as Partial<SessionContext>;
    assert.ok(updates.stagedIntents);
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
      deps,
    });

    assert.equal(mockAppendAssistantMessage.mock.callCount(), 1);
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
      deps,
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
      deps,
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
      deps,
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
      deps,
    });

    // When submit_response wasn't called, the internal fallback uses markdownText
    const stopCalls = mockStreamerStop.mock.calls;
    const deliveryStopCall = stopCalls.find(
      (c) =>
        c.arguments[0] &&
        typeof c.arguments[0] === "object" &&
        "markdownText" in (c.arguments[0] as { markdownText?: string }),
    );
    assert.ok(deliveryStopCall, "streamer.stop should be called with markdownText (fallback path)");
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
      deps,
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

  it("warns when actionable intents are staged but submit_response was not called", async () => {
    mockAskClaude.mock.mockImplementation(async () => ({
      success: true,
      answer: "I've submitted the update request",
      stagedIntents: {
        r1: {
          type: "update" as const,
          sessionId: "session-1",
          instructions: "do the thing",
        },
      },
    }));

    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    const postMessage = getPostMessageMock(client);
    const warning = postMessage.mock.calls
      .map((c) => c.arguments[0] as { text?: string })
      .find((m) => m.text?.includes("didn't deliver"));
    assert.ok(warning, "expected an orphan-intent warning to be posted");
    assert.match(warning!.text!, /update/);
  });

  it("does not warn when no actionable intents are staged", async () => {
    mockAskClaude.mock.mockImplementation(async () => ({
      success: true,
      answer: "plain answer",
      stagedIntents: {},
    }));

    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    const postMessage = getPostMessageMock(client);
    const warning = postMessage.mock.calls
      .map((c) => c.arguments[0] as { text?: string })
      .find((m) => m.text?.includes("didn't deliver"));
    assert.equal(warning, undefined);
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
      deps,
    });

    assert.equal(response.cancelled, true);
    assert.equal(mockHandleAutoExecuteActions.mock.callCount(), 0);
    assert.equal(mockAppendAssistantMessage.mock.callCount(), 0);
  });

  it("deletes the streamer message when cancelled instead of posting a cancellation notice", async () => {
    resetStreamerInstance({ messageTs: "1700000000.000002" });
    deps = makeDeps();
    deps.appendAssistantMessage = mockAppendAssistantMessage;

    mockAskClaude.mock.mockImplementation(async () => ({
      success: false,
      answer: "",
      cancelled: true,
    }));

    const client = makeClient();
    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    // No "_Request cancelled._" (or any other markdownText) should be posted via the streamer.
    let textualStopCalls = 0;
    for (const call of mockStreamerStop.mock.calls) {
      const arg = call.arguments[0];
      if (arg != null && typeof arg === "object" && "markdownText" in arg) {
        textualStopCalls += 1;
      }
    }
    assert.equal(textualStopCalls, 0, "streamer.stop should not be called with any text");

    // The streamer's Slack message should be deleted.
    assert.equal(mockChatDelete.mock.callCount(), 1);
    assert.deepEqual(mockChatDelete.mock.calls[0].arguments[0], {
      channel: "C001",
      ts: "1700000000.000002",
    });

    // No fallback chat.postMessage either.
    assert.equal(mockPostMessage.mock.callCount(), 0);
  });

  it("skips delete when the streamer never posted a message", async () => {
    resetStreamerInstance({ messageTs: undefined });
    deps = makeDeps();
    deps.appendAssistantMessage = mockAppendAssistantMessage;

    mockAskClaude.mock.mockImplementation(async () => ({
      success: false,
      answer: "",
      cancelled: true,
    }));

    const client = makeClient();
    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.equal(mockChatDelete.mock.callCount(), 0);
    assert.equal(mockPostMessage.mock.callCount(), 0);
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
      deps,
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
      deps,
    });

    const postMessage = getPostMessageMock(client);
    const call = postMessage.mock.calls[0].arguments[0] as { text: string };
    assert.ok(call.text.includes("Usage limit reached"));
    assert.ok(!call.text.includes("crashed"));
  });

  it("appends toolCalls onto the error assistant message on Claude failure", async () => {
    const history = [
      {
        tool: "mcp__trivia__submit_answers",
        args: { n: 1 },
        result: { ok: true },
        timestamp: 1,
      },
    ];
    mockAskClaude.mock.mockImplementation(async () => ({
      success: false,
      answer: "",
      error: "boom",
      conversationTrace: [],
      toolCallHistory: history,
    }));

    await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    // The error path appends a SessionAssistantMessage carrying the failure + toolCalls.
    assert.ok(mockAppendAssistantMessage.mock.callCount() >= 1);
    const appended = mockAppendAssistantMessage.mock.calls[0].arguments[1];
    assert.deepEqual(appended.toolCalls, history);
    assert.ok(appended.error);
  });

  it("omits toolCalls on the error assistant message when toolCallHistory is empty", async () => {
    mockAskClaude.mock.mockImplementation(async () => ({
      success: false,
      answer: "",
      error: "boom",
      conversationTrace: [],
      toolCallHistory: [],
    }));

    await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.ok(mockAppendAssistantMessage.mock.callCount() >= 1);
    const appended = mockAppendAssistantMessage.mock.calls[0].arguments[1];
    assert.equal(appended.toolCalls, undefined);
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
      deps,
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
      deps,
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
      deps,
    });

    assert.equal(mockAnalyzeError.mock.callCount(), 1); // always called for disk persistence
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
      deps,
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
      deps,
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
          deps,
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
    mockPostMessage.mock.mockImplementation(async () => {
      throw new Error("slack also down");
    });

    // The original error should still be thrown, not the fallback error
    await assert.rejects(
      () =>
        executeAndDeliver({
          client,
          session: makeSession(),
          sessionInfo: makeSessionInfo(),
          claudeOptions: makeClaudeOptions(),
          deps,
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
      const deliver = opts.deliver as (opts: { blocks: object[] }) => Promise<{ ok: boolean }>;
      // Advance time by 61s before deliver — sendResponseNotification checks elapsed time
      t.mock.timers.tick(61_000);
      await deliver({
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "delivered answer" },
          },
        ],
      });
      return { success: true, answer: "delivered answer" };
    });

    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    const postMessage = getPostMessageMock(client);
    // Should have posted a notification
    const notifCall = postMessage.mock.calls.find((c: { arguments: unknown[] }) =>
      (c.arguments[0] as { text: string }).text.includes("Response ready"),
    );
    assert.ok(notifCall, "should post notification message");
  });

  it("does not send notification when user has notifyOnResponse disabled", async () => {
    mockGetUserPreference.mock.mockImplementation(async () => false);

    mockAskClaude.mock.mockImplementation(async (...args: unknown[]) => {
      const opts = args[1] as Record<string, unknown>;
      const deliver = opts.deliver as (opts: { blocks: object[] }) => Promise<{ ok: boolean }>;
      await deliver({
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "delivered answer" },
          },
        ],
      });
      return { success: true, answer: "delivered answer" };
    });

    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    const postMessage = getPostMessageMock(client);
    const notifCall = postMessage.mock.calls.find((c: { arguments: unknown[] }) =>
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
      const deliver = opts.deliver as (opts: {
        blocks: object[];
      }) => Promise<{ ok: boolean; error?: string }>;
      await deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "first" } }],
      });
      await deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "second" } }],
      });
      return { success: true, answer: "done" };
    });

    const response = await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    // Verify the streamer was only stopped once with blocks content
    const stopCalls = mockStreamerStop.mock.calls;
    const contentStops = stopCalls.filter(
      (c) =>
        c.arguments[0] &&
        typeof c.arguments[0] === "object" &&
        "blocks" in (c.arguments[0] as { blocks?: object[] }),
    );
    // Only one content delivery via streamer (the first call)
    assert.equal(contentStops.length, 1);
    assert.equal(response.success, true);
  });

  it("falls back to chat.postMessage when streamer has failed", async () => {
    resetStreamerInstance({ hasFailed: true });

    mockAskClaude.mock.mockImplementation(async (...args: unknown[]) => {
      const opts = args[1] as Record<string, unknown>;
      const deliver = opts.deliver as (opts: { blocks: object[] }) => Promise<{ ok: boolean }>;
      await deliver({
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "fallback content" },
          },
        ],
      });
      return { success: true, answer: "fallback content" };
    });

    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
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
    mockPostMessage.mock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("slack is down");
      }
      return { ok: true };
    });

    mockAskClaude.mock.mockImplementation(async (...args: unknown[]) => {
      const opts = args[1] as Record<string, unknown>;
      const deliver = opts.deliver as (opts: {
        blocks: object[];
      }) => Promise<{ ok: boolean; error?: string }>;
      deliverResult = await deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "will fail" } }],
      });
      return { success: true, answer: "done" };
    });

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.ok(deliverResult);
    assert.equal(deliverResult!.ok, false);
    assert.ok(deliverResult!.error?.includes("slack is down"));
  });
});

type DeliverOpts = { blocks: object[]; reactions?: string[] };
type DeliverResult = Promise<{ ok: true; ts?: string } | { ok: false; error: string }>;

describe("executeAndDeliver — delivery reactions", () => {
  it("adds reactions after successful delivery via streamer", async () => {
    resetStreamerInstance({ messageTs: "1700000000.000100" });

    mockAskClaude.mock.mockImplementation(async (...args: Parameters<typeof mockAskClaude>) => {
      const opts = args[1] as { deliver: (o: DeliverOpts) => DeliverResult };
      await opts.deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "content" } }],
        reactions: ["thumbsup", "eyes"],
      });
      return { success: true, answer: "done" };
    });

    const client = makeClient();
    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    const reactionsAdd = mockReactionsAdd;
    assert.equal(reactionsAdd.mock.callCount(), 2);
    const firstCall = reactionsAdd.mock.calls[0].arguments[0] as {
      name: string;
    };
    assert.equal(firstCall.name, "thumbsup");
    const secondCall = reactionsAdd.mock.calls[1].arguments[0] as {
      name: string;
    };
    assert.equal(secondCall.name, "eyes");
  });

  it("adds reactions after fallback delivery via chat.postMessage", async () => {
    resetStreamerInstance({ hasFailed: true });

    mockAskClaude.mock.mockImplementation(async (...args: Parameters<typeof mockAskClaude>) => {
      const opts = args[1] as { deliver: (o: DeliverOpts) => DeliverResult };
      await opts.deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "content" } }],
        reactions: ["white_check_mark"],
      });
      return { success: true, answer: "done" };
    });

    const client = makeClient();
    // Ensure postMessage returns a ts so reactions can target the message
    mockPostMessage.mock.mockImplementation(async () => ({
      ok: true,
      ts: "1700000000.000200",
    }));

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    const reactionsAdd = mockReactionsAdd;
    assert.equal(reactionsAdd.mock.callCount(), 1);
    const call = reactionsAdd.mock.calls[0].arguments[0] as { name: string };
    assert.equal(call.name, "white_check_mark");
  });

  it("does not fail delivery when reaction add throws", async () => {
    mockAskClaude.mock.mockImplementation(async (...args: Parameters<typeof mockAskClaude>) => {
      const opts = args[1] as { deliver: (o: DeliverOpts) => DeliverResult };
      const result = await opts.deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "content" } }],
        reactions: ["invalid_emoji"],
      });
      return { success: true, answer: "done", deliverOk: result.ok };
    });

    const client = makeClient();
    mockReactionsAdd.mock.mockImplementation(async () => {
      throw new Error("invalid_name");
    });

    const response = await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.equal(response.success, true);
  });

  it("silently ignores already_reacted errors", async () => {
    mockAskClaude.mock.mockImplementation(async (...args: Parameters<typeof mockAskClaude>) => {
      const opts = args[1] as { deliver: (o: DeliverOpts) => DeliverResult };
      await opts.deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "content" } }],
        reactions: ["thumbsup"],
      });
      return { success: true, answer: "done" };
    });

    const client = makeClient();
    mockReactionsAdd.mock.mockImplementation(async () => {
      throw new Error("already_reacted");
    });

    const response = await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.equal(response.success, true);
  });

  it("does not call reactions.add when reactions array is empty", async () => {
    mockAskClaude.mock.mockImplementation(async (...args: Parameters<typeof mockAskClaude>) => {
      const opts = args[1] as { deliver: (o: DeliverOpts) => DeliverResult };
      await opts.deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "content" } }],
        reactions: [],
      });
      return { success: true, answer: "done" };
    });

    const client = makeClient();
    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    const reactionsAdd = mockReactionsAdd;
    assert.equal(reactionsAdd.mock.callCount(), 0);
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
    const blocks = [
      {
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: "block text" },
      },
    ];

    await postResponse(client, sessionInfo, {
      text: "fallback",
      blocks: blocks satisfies SlackBlocks,
    });

    const postMessage = getPostMessageMock(client);
    const call = postMessage.mock.calls[0].arguments[0] as {
      blocks?: unknown[];
    };
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

    await getHandlerClaudeOptions(sessionInfo, deps);

    assert.equal(mockGetClaudeOptions.mock.callCount(), 1);
    assert.equal(mockGetClaudeOptions.mock.calls[0].arguments[0], "U001");
    assert.equal(mockGetClaudeOptions.mock.calls[0].arguments[1], "mentions");
  });

  it("defaults triggerType to directMessages when not set", async () => {
    const sessionInfo = makeSessionInfo();

    await getHandlerClaudeOptions(sessionInfo, deps);

    assert.equal(mockGetClaudeOptions.mock.calls[0].arguments[1], "directMessages");
  });

  it("returns the options from getClaudeOptions", async () => {
    mockGetClaudeOptions.mock.mockImplementation(async () => ({
      role: "admin" as const,
      changesWorkflowEnabled: true,
    }));

    const result = await getHandlerClaudeOptions(makeSessionInfo(), deps);

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
      deps,
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
      deps,
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
      deps,
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
      mockAppendAssistantMessage.mock.resetCalls();
      mockUpdateSession.mock.resetCalls();
      mockHandleAutoExecuteActions.mock.resetCalls();

      const client = makeClient();
      const response = await executeAndDeliver({
        client,
        session: makeSession(),
        sessionInfo: makeSessionInfo(),
        claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
        deps,
      });

      assert.equal(response.skipped, true);

      // chat.delete should have been called with the streamer's ts
      const deleteCall = mockChatDelete.mock.calls[0];
      assert.ok(deleteCall);
      assert.deepStrictEqual(deleteCall.arguments[0], {
        channel: "C001",
        ts: "1234.5678",
      });

      // Session persistence and auto-execute should NOT have been called
      assert.equal(mockAppendAssistantMessage.mock.callCount(), 0);
      assert.equal(mockHandleAutoExecuteActions.mock.callCount(), 0);
    });

    it("persists skipped+disengaged turn and autoResponseActive:false in a single updateSession call", async () => {
      resetStreamerInstance({ messageTs: "1234.5678" });
      mockAskClaude.mock.mockImplementationOnce(async () => ({
        success: true,
        skipped: true,
        disengaged: true,
        answer: "",
      }));
      mockUpdateSession.mock.resetCalls();

      const client = makeClient();
      const response = await executeAndDeliver({
        client,
        session: makeSession(),
        sessionInfo: makeSessionInfo(),
        claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
        deps,
      });

      assert.equal(response.skipped, true);
      assert.equal(response.disengaged, true);
      // unified-conversation-log: both the appended skipped+disengaged message AND
      // autoResponseActive: false are persisted in the same updateSession call.
      assert.equal(mockUpdateSession.mock.callCount(), 1);
      const updates = mockUpdateSession.mock.calls[0].arguments[1] as Partial<SessionContext>;
      assert.equal(updates.autoResponseActive, false);
      assert.ok(Array.isArray(updates.messages));
      const last = updates.messages![updates.messages!.length - 1];
      assert.equal(last.role, "assistant");
      const lastAssistant = last as { skipped?: true; disengaged?: true; payload?: unknown };
      assert.equal(lastAssistant.skipped, true);
      assert.equal(lastAssistant.disengaged, true);
      assert.equal(lastAssistant.payload, undefined);
    });

    it("skip without disengage: appended message has no disengaged flag and autoResponseActive unchanged", async () => {
      resetStreamerInstance({ messageTs: "1234.5678" });
      mockAskClaude.mock.mockImplementationOnce(async () => ({
        success: true,
        skipped: true,
        answer: "",
      }));
      mockSetAutoResponseActive.mock.resetCalls();
      mockUpdateSession.mock.resetCalls();

      const client = makeClient();
      await executeAndDeliver({
        client,
        session: makeSession(),
        sessionInfo: makeSessionInfo(),
        claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
        deps,
      });

      assert.equal(mockSetAutoResponseActive.mock.callCount(), 0);
      // Single updateSession for the skipped-turn append; autoResponseActive not touched.
      assert.equal(mockUpdateSession.mock.callCount(), 1);
      const updates = mockUpdateSession.mock.calls[0].arguments[1] as Partial<SessionContext>;
      assert.equal(updates.autoResponseActive, undefined);
      const last = updates.messages![updates.messages!.length - 1];
      const lastAssistant = last as { skipped?: true; disengaged?: true };
      assert.equal(lastAssistant.skipped, true);
      assert.equal(lastAssistant.disengaged, undefined);
    });

    it("calls setAutoResponseActive when normal response has disengaged: true", async () => {
      resetStreamerInstance({ messageTs: "1234.5678" });
      mockAskClaude.mock.mockImplementationOnce(async () => ({
        success: true,
        disengaged: true,
        answer: "You're welcome!",
      }));
      mockSetAutoResponseActive.mock.resetCalls();

      const client = makeClient();
      const response = await executeAndDeliver({
        client,
        session: makeSession(),
        sessionInfo: makeSessionInfo(),
        claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
        deps,
      });

      assert.equal(response.success, true);
      assert.equal(response.disengaged, true);
      assert.equal(mockSetAutoResponseActive.mock.callCount(), 1);
      assert.equal(mockSetAutoResponseActive.mock.calls[0].arguments[0], "session-1");
      assert.equal(mockSetAutoResponseActive.mock.calls[0].arguments[1], false);
    });

    it("does NOT call setAutoResponseActive on success without disengaged", async () => {
      resetStreamerInstance({ messageTs: "1234.5678" });
      mockAskClaude.mock.mockImplementationOnce(async () => ({
        success: true,
        answer: "regular answer",
      }));
      mockSetAutoResponseActive.mock.resetCalls();

      const client = makeClient();
      await executeAndDeliver({
        client,
        session: makeSession(),
        sessionInfo: makeSessionInfo(),
        claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
        deps,
      });

      assert.equal(mockSetAutoResponseActive.mock.callCount(), 0);
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
        deps,
      });

      assert.equal(response.skipped, true);
      // chat.delete should NOT have been called
      assert.equal(mockChatDelete.mock.callCount(), 0);
    });
  });
});
