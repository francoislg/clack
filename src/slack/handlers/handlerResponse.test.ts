import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { ClaudeResponse, AskClaudeOptions } from "../../claude/index.js";
import type { ClaudeRunHandle } from "../../claude/runHandle.js";
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

type AskClaudeArgs = Parameters<HandlerResponseDeps["askClaude"]>;

const mockAskClaude = vi.fn<(...args: AskClaudeArgs) => Promise<ClaudeResponse>>(async () => ({
  success: true,
  answer: "test answer",
}));

/**
 * Wraps `mockAskClaude` to satisfy `askClaude`'s real signature (returns a `ClaudeRunHandle`).
 * Each test still configures `mockAskClaude` to return a `ClaudeResponse`; this adapter
 * packages it into a fake handle whose `futureResponse` resolves immediately. Rejections
 * from `mockAskClaude` propagate as-is.
 */
function fakeHandleFromResponse(response: ClaudeResponse): ClaudeRunHandle {
  return {
    sendUpdate: async () => {},
    stop: async () => {},
    futureResponse: Promise.resolve(response),
    status: "settled",
    hasPendingInput: () => false,
    consumePendingPushedTexts: () => [],
    hasDelivered: () => false,
  };
}

async function askClaudeAdapter(...args: AskClaudeArgs): Promise<ClaudeRunHandle> {
  const response = await mockAskClaude(...args);
  return fakeHandleFromResponse(response);
}

const mockAppendAssistantMessage = vi.fn<
  NonNullable<HandlerResponseDeps["appendAssistantMessage"]>
>(async () => null);

const mockAppendStagedIntents = vi.fn<HandlerResponseDeps["appendStagedIntents"]>(async () => {});

const mockUpdateSession = vi.fn<HandlerResponseDeps["updateSession"]>(async () => null);
const mockAddError = vi.fn<HandlerResponseDeps["addError"]>(async () => null);
const mockSetAttentionLevel = vi.fn<HandlerResponseDeps["setAttentionLevel"]>(async () => {});
const mockSetDeliveryMode = vi.fn<HandlerResponseDeps["setDeliveryMode"]>(async () => {});

const mockGetErrorBlocksWithRetry = vi.fn(() => [{ type: "section" }]);
const mockGetUsageLimitBlocks = vi.fn<HandlerResponseDeps["getUsageLimitBlocks"]>(() => [
  { type: "section", text: { type: "mrkdwn", text: "usage limit" } },
]);
const mockAsSlackBlocks = vi.fn((blocks: never) => blocks);

const mockSendErrorReport = vi.fn<(...args: never[]) => Promise<void>>(async () => {});
const mockAnalyzeError = vi.fn<HandlerResponseDeps["analyzeError"]>(async () => "error analysis");

const mockGetConfig = vi.fn(() => ({
  slack: { sendErrorsAsDM: false },
}));

const mockGetClaudeOptions = vi.fn<(...args: never[]) => Promise<AskClaudeOptions>>(async () => ({
  role: "dev" as const,
  changesWorkflowEnabled: false,
}));

const mockHandleAutoExecuteActions = vi.fn<(...args: never[]) => Promise<void>>(async () => {});

const mockGetUserPreference = vi.fn<(...args: never[]) => Promise<boolean>>(async () => false);

// Track SlackStreamer instances for inspection
let streamerHasFailed = false;
let streamerMessageTs: string | undefined;
let streamerAllMessageTss: string[] = [];
let mockStreamerStart: ReturnType<typeof vi.fn<(...args: any[]) => any>>;
let mockStreamerStop: ReturnType<typeof vi.fn<(...args: any[]) => any>>;
let mockStreamerHandleEvent: ReturnType<typeof vi.fn<(...args: any[]) => any>>;
let mockStreamerGetMessageTs: ReturnType<typeof vi.fn<(...args: any[]) => any>>;
let mockStreamerGetAllMessageTss: ReturnType<typeof vi.fn<(...args: any[]) => any>>;

function resetStreamerInstance(overrides?: {
  hasFailed?: boolean;
  startReturns?: boolean;
  messageTs?: string;
  /** Override the full list returned by getAllMessageTss. If omitted, defaults to
   *  `[messageTs]` (or `[]` when messageTs is also undefined) so existing single-block tests work. */
  allMessageTss?: string[];
}) {
  streamerHasFailed = overrides?.hasFailed ?? false;
  streamerMessageTs = overrides?.messageTs;
  streamerAllMessageTss =
    overrides?.allMessageTss ?? (streamerMessageTs ? [streamerMessageTs] : []);
  mockStreamerStart = vi.fn(async () => overrides?.startReturns ?? true);
  mockStreamerStop = vi.fn(async () => {});
  mockStreamerHandleEvent = vi.fn();
  mockStreamerGetMessageTs = vi.fn(() => streamerMessageTs);
  mockStreamerGetAllMessageTss = vi.fn(() => streamerAllMessageTss);
}

const mockRegisterThreadSession = vi.fn<HandlerResponseDeps["registerThreadSession"]>(
  async () => null,
);
const mockAppendSessionToEphemeralRule = vi.fn<HandlerResponseDeps["appendSessionToEphemeralRule"]>(
  async () => null,
);
const mockGetOwnerUserId = vi.fn<HandlerResponseDeps["getOwnerUserId"]>(async () => "U_OWNER");
const mockSendOwnerDm = vi.fn<HandlerResponseDeps["sendOwnerDm"]>(async () => true);
const mockWriteErrorReport = vi.fn<HandlerResponseDeps["writeErrorReport"]>(
  async () => "report.json",
);
const mockCreateSession = vi.fn<NonNullable<HandlerResponseDeps["createSession"]>>(async () =>
  makeSession({ sessionId: "follow-up-session" }),
);

function makeDeps(): HandlerResponseDeps {
  return {
    askClaude: askClaudeAdapter,
    appendStagedIntents: mockAppendStagedIntents,
    analyzeError: mockAnalyzeError,
    updateSession: mockUpdateSession,
    addError: mockAddError,
    setAttentionLevel: mockSetAttentionLevel,
    setDeliveryMode: mockSetDeliveryMode,
    createSession: mockCreateSession as HandlerResponseDeps["createSession"],
    registerThreadSession: mockRegisterThreadSession,
    appendSessionToEphemeralRule: mockAppendSessionToEphemeralRule,
    getUsageLimitBlocks: mockGetUsageLimitBlocks,
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
        getAllMessageTss: () => mockStreamerGetAllMessageTss(),
        get hasFailed() {
          return streamerHasFailed;
        },
      }) as never,
    getUserPreference: mockGetUserPreference as never,
    writeErrorReport: mockWriteErrorReport,
    getOwnerUserId: mockGetOwnerUserId,
    sendOwnerDm: mockSendOwnerDm,
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

let mockPostMessage: ReturnType<typeof vi.fn<(...args: any[]) => any>>;
let mockChatDelete: ReturnType<typeof vi.fn<(...args: any[]) => any>>;
let mockReactionsAdd: ReturnType<typeof vi.fn<(...args: any[]) => any>>;

function makeClient(): App["client"] {
  mockPostMessage = vi.fn(async () => ({ ok: true }));
  mockChatDelete = vi.fn(async () => ({ ok: true }));
  mockReactionsAdd = vi.fn(async () => ({ ok: true }));
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
  mockAskClaude.mockClear();
  mockAppendStagedIntents.mockClear();
  mockUpdateSession.mockClear();
  mockAddError.mockClear();
  mockGetErrorBlocksWithRetry.mockClear();
  mockGetUsageLimitBlocks.mockClear();
  mockAsSlackBlocks.mockClear();
  mockSendErrorReport.mockClear();
  mockAnalyzeError.mockClear();
  mockGetConfig.mockClear();
  mockGetClaudeOptions.mockClear();
  mockHandleAutoExecuteActions.mockClear();
  mockGetUserPreference.mockClear();
  mockGetOwnerUserId.mockClear();
  mockGetOwnerUserId.mockImplementation(async () => "U_OWNER");
  mockSendOwnerDm.mockClear();
  mockSendOwnerDm.mockImplementation(async () => true);
  mockWriteErrorReport.mockClear();
  mockWriteErrorReport.mockImplementation(async () => "report.json");
  mockCreateSession.mockClear();
  mockCreateSession.mockImplementation(async () => makeSession({ sessionId: "follow-up-session" }));

  // Reset mockAskClaude to default implementation
  mockAskClaude.mockImplementation(async () => ({
    success: true,
    answer: "test answer",
  }));

  // Reset config to default
  mockGetConfig.mockImplementation(() => ({
    slack: { sendErrorsAsDM: false },
  }));

  // Reset user preference
  mockGetUserPreference.mockImplementation(async () => false);

  // Reset streamer
  resetStreamerInstance();

  // Create fresh deps
  deps = makeDeps();
  deps.appendAssistantMessage = mockAppendAssistantMessage;
  mockAppendAssistantMessage.mockClear();
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

    assert.equal(mockStreamerStart.mock.calls.length, 1);
    assert.equal(mockAskClaude.mock.calls.length, 1);
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
    assert.equal(mockStreamerStart.mock.calls.length, 1);
    assert.equal(mockAskClaude.mock.calls.length, 1);
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
    assert.equal(mockAskClaude.mock.calls.length, 1);
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
    assert.ok(mockStreamerStop.mock.calls.length >= 1);
  });

  it("stops the streamer even when askClaude throws", async () => {
    mockAskClaude.mockImplementation(async () => {
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

    assert.ok(mockStreamerStop.mock.calls.length >= 1);
  });
});

// ============================================================================
// executeAndDeliver — success handling
// ============================================================================

describe("executeAndDeliver — success handling", () => {
  it("persists response state on success", async () => {
    mockAskClaude.mockImplementation(async () => ({
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
    // stagedIntents flows through appendStagedIntents (merge semantics — see
    // persistResponseState).
    assert.equal(mockAppendAssistantMessage.mock.calls.length, 1);
    assert.equal(mockAppendAssistantMessage.mock.calls[0][0], "session-1");
    const appended = mockAppendAssistantMessage.mock.calls[0][1];
    assert.equal(appended.text, "the answer");
    assert.ok(appended.payload);
    assert.ok(appended.toolCalls);
    assert.equal(mockAppendStagedIntents.mock.calls.length, 1);
    assert.equal(mockAppendStagedIntents.mock.calls[0][0], "session-1");
    const persistedIntents = mockAppendStagedIntents.mock.calls[0][1];
    assert.ok(persistedIntents.r1);
  });

  it("does not call updateSession when there are no extra fields", async () => {
    mockAskClaude.mockImplementation(async () => ({
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

    assert.equal(mockAppendAssistantMessage.mock.calls.length, 1);
    assert.equal(mockUpdateSession.mock.calls.length, 0);
  });

  it("does not call appendStagedIntents for empty stagedIntents", async () => {
    mockAskClaude.mockImplementation(async () => ({
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

    assert.equal(mockAppendStagedIntents.mock.calls.length, 0);
  });

  it("does not call updateSession for empty toolCallHistory", async () => {
    mockAskClaude.mockImplementation(async () => ({
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

    assert.equal(mockUpdateSession.mock.calls.length, 0);
  });

  it("calls handleAutoExecuteActions on success", async () => {
    mockAskClaude.mockImplementation(async () => ({
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

    assert.equal(mockHandleAutoExecuteActions.mock.calls.length, 1);
    const args = mockHandleAutoExecuteActions.mock.calls[0][0] as Record<string, unknown>;
    assert.equal(args.channelId, "C001");
    assert.equal(args.threadTs, "1700000000.000001");
    assert.equal(args.userId, "U001");
    assert.equal(args.role, "admin");
    assert.equal(args.dmChannel, "D_DM");
    assert.equal(args.dmThreadTs, "17.99");
    assert.equal(args.triggerType, "mentions");
  });

  it("delivers via streamer fallback when submit_response was not called", async () => {
    mockAskClaude.mockImplementation(async () => ({
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
        c[0] && typeof c[0] === "object" && "markdownText" in (c[0] as { markdownText?: string }),
    );
    assert.ok(deliveryStopCall, "streamer.stop should be called with markdownText (fallback path)");
    assert.equal((deliveryStopCall[0] as { markdownText: string }).markdownText, "raw answer text");
  });

  it("falls back to chat.postMessage when streamer has failed", async () => {
    resetStreamerInstance({ hasFailed: true });

    mockAskClaude.mockImplementation(async () => ({
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
    assert.ok(postMessage.mock.calls.length >= 1);
    const call = postMessage.mock.calls[0][0] as {
      channel: string;
      thread_ts: string;
      text: string;
    };
    assert.equal(call.text, "fallback text");
    assert.equal(call.channel, "C001");
    assert.equal(call.thread_ts, "1700000000.000001");
  });

  it("warns when actionable intents are staged but submit_response was not called", async () => {
    mockAskClaude.mockImplementation(async () => ({
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
      .map((c) => c[0] as { text?: string })
      .find((m) => m.text?.includes("didn't deliver"));
    assert.ok(warning, "expected an orphan-intent warning to be posted");
    assert.match(warning!.text!, /update/);
  });

  it("does not warn when no actionable intents are staged", async () => {
    mockAskClaude.mockImplementation(async () => ({
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
      .map((c) => c[0] as { text?: string })
      .find((m) => m.text?.includes("didn't deliver"));
    assert.equal(warning, undefined);
  });
});

// ============================================================================
// executeAndDeliver — cancellation
// ============================================================================

describe("executeAndDeliver — cancellation", () => {
  it("returns the cancelled response without auto-executing", async () => {
    mockAskClaude.mockImplementation(async () => ({
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
    assert.equal(mockHandleAutoExecuteActions.mock.calls.length, 0);
    assert.equal(mockAppendAssistantMessage.mock.calls.length, 0);
  });

  it("deletes the streamer message when cancelled instead of posting a cancellation notice", async () => {
    resetStreamerInstance({ messageTs: "1700000000.000002" });
    deps = makeDeps();
    deps.appendAssistantMessage = mockAppendAssistantMessage;

    mockAskClaude.mockImplementation(async () => ({
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
      const arg = call[0];
      if (arg != null && typeof arg === "object" && "markdownText" in arg) {
        textualStopCalls += 1;
      }
    }
    assert.equal(textualStopCalls, 0, "streamer.stop should not be called with any text");

    // The streamer's Slack message should be deleted.
    assert.equal(mockChatDelete.mock.calls.length, 1);
    assert.deepEqual(mockChatDelete.mock.calls[0][0], {
      channel: "C001",
      ts: "1700000000.000002",
    });

    // No fallback chat.postMessage either.
    assert.equal(mockPostMessage.mock.calls.length, 0);
  });

  it("skips delete when the streamer never posted a message", async () => {
    resetStreamerInstance({ messageTs: undefined });
    deps = makeDeps();
    deps.appendAssistantMessage = mockAppendAssistantMessage;

    mockAskClaude.mockImplementation(async () => ({
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

    assert.equal(mockChatDelete.mock.calls.length, 0);
    assert.equal(mockPostMessage.mock.calls.length, 0);
  });
});

// ============================================================================
// executeAndDeliver — error handling
// ============================================================================

describe("executeAndDeliver — error handling", () => {
  it("posts error blocks on Claude failure", async () => {
    mockAskClaude.mockImplementation(async () => ({
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

    assert.equal(mockAddError.mock.calls.length, 1);
    assert.equal(mockAddError.mock.calls[0][0], "session-1");
    assert.equal(mockAddError.mock.calls[0][1], "Something broke");

    assert.equal(mockGetErrorBlocksWithRetry.mock.calls.length, 1);
    assert.equal(mockAsSlackBlocks.mock.calls.length, 1);

    const postMessage = getPostMessageMock(client);
    assert.ok(postMessage.mock.calls.length >= 1);
    const call = postMessage.mock.calls[0][0] as { text: string };
    assert.ok(call.text.includes("session-1"));
    assert.ok(call.text.includes("crashed"));
  });

  it("renders usage-limit blocks with the reset time for platform limit errors", async () => {
    mockAskClaude.mockImplementation(async () => ({
      success: false,
      answer: "",
      error: "Claude usage limit reached (five_hour) — resets at 2026-07-03T19:00:00.000Z.",
      platformLimit: { kind: "usage_limit", resetsAt: 1783105200, rateLimitType: "five_hour" },
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

    assert.equal(mockGetUsageLimitBlocks.mock.calls.length, 1);
    assert.equal(mockGetUsageLimitBlocks.mock.calls[0][0], 1783105200);
    assert.equal(mockGetErrorBlocksWithRetry.mock.calls.length, 0);

    const postMessage = getPostMessageMock(client);
    const call = postMessage.mock.calls[0][0] as { text: string };
    assert.ok(call.text.includes("<!date^1783105200^{time}"));
    assert.ok(!call.text.includes("crashed"));
  });

  it("renders the no-reset usage-limit message when resetsAt is absent", async () => {
    mockAskClaude.mockImplementation(async () => ({
      success: false,
      answer: "",
      error: "Claude usage limit reached. The limit resets automatically — please try again later.",
      platformLimit: { kind: "usage_limit" },
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

    assert.equal(mockGetUsageLimitBlocks.mock.calls.length, 1);
    assert.equal(mockGetUsageLimitBlocks.mock.calls[0][0], undefined);

    const postMessage = getPostMessageMock(client);
    const call = postMessage.mock.calls[0][0] as { text: string };
    assert.ok(call.text.includes("try again later"));
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
    mockAskClaude.mockImplementation(async () => ({
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
    assert.ok(mockAppendAssistantMessage.mock.calls.length >= 1);
    const appended = mockAppendAssistantMessage.mock.calls[0][1];
    assert.deepEqual(appended.toolCalls, history);
    assert.ok(appended.error);
  });

  it("omits toolCalls on the error assistant message when toolCallHistory is empty", async () => {
    mockAskClaude.mockImplementation(async () => ({
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

    assert.ok(mockAppendAssistantMessage.mock.calls.length >= 1);
    const appended = mockAppendAssistantMessage.mock.calls[0][1];
    assert.equal(appended.toolCalls, undefined);
  });

  it("uses 'Unknown error' when error field is empty", async () => {
    mockAskClaude.mockImplementation(async () => ({
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

    assert.equal(mockAddError.mock.calls[0][1], "Unknown error");
  });

  it("sends error report DM when configured", async () => {
    mockGetConfig.mockImplementation(() => ({
      slack: { sendErrorsAsDM: true },
    }));

    mockAskClaude.mockImplementation(async () => ({
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

    assert.equal(mockAnalyzeError.mock.calls.length, 1);
    assert.equal(mockSendErrorReport.mock.calls.length, 1);
  });

  it("does not send error report DM when not configured", async () => {
    mockGetConfig.mockImplementation(() => ({
      slack: { sendErrorsAsDM: false },
    }));

    mockAskClaude.mockImplementation(async () => ({
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

    assert.equal(mockAnalyzeError.mock.calls.length, 1); // always called for disk persistence
    assert.equal(mockSendErrorReport.mock.calls.length, 0);
  });

  it("does not crash when error report DM fails", async () => {
    mockGetConfig.mockImplementation(() => ({
      slack: { sendErrorsAsDM: true },
    }));

    mockAnalyzeError.mockImplementation(async () => {
      throw new Error("analyze failed");
    });

    mockAskClaude.mockImplementation(async () => ({
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
    mockAskClaude.mockImplementation(async () => ({
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
    const call = postMessage.mock.calls[0][0] as {
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
    mockAskClaude.mockImplementation(async () => {
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
      (c: unknown[]) =>
        c[0] && typeof c[0] === "object" && "markdownText" in (c[0] as Record<string, unknown>),
    );
    assert.ok(fallbackCall, "should have attempted fallback delivery via streamer");
    assert.ok(
      (fallbackCall[0] as { markdownText: string }).markdownText.includes("Something went wrong"),
    );
  });

  it("does not throw when fallback delivery itself fails", async () => {
    resetStreamerInstance({ hasFailed: true });

    mockAskClaude.mockImplementation(async () => {
      throw new Error("unexpected boom");
    });

    const client = makeClient();
    mockPostMessage.mockImplementation(async () => {
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
  it("sends notification when user has notifyOnResponse enabled and delivered via streamer", async () => {
    mockGetUserPreference.mockImplementation(async () => true);

    // Mock Date so we can advance time past the 60s notification threshold
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });

    // Simulate the deliver function being called (submit_response was called)
    mockAskClaude.mockImplementation(async (...args: unknown[]) => {
      const opts = args[1] as Record<string, unknown>;
      const deliver = opts.deliver as (opts: { blocks: object[] }) => Promise<{ ok: boolean }>;
      // Advance time by 61s before deliver — sendResponseNotification checks elapsed time
      vi.advanceTimersByTime(61_000);
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
    const notifCall = postMessage.mock.calls.find((c: unknown[]) =>
      (c[0] as { text: string }).text.includes("Response ready"),
    );
    assert.ok(notifCall, "should post notification message");
  });

  it("does not send notification when user has notifyOnResponse disabled", async () => {
    mockGetUserPreference.mockImplementation(async () => false);

    mockAskClaude.mockImplementation(async (...args: unknown[]) => {
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
    const notifCall = postMessage.mock.calls.find((c: unknown[]) =>
      (c[0] as { text: string }).text.includes("Response ready"),
    );
    assert.equal(notifCall, undefined, "should not post notification message");
  });
});

// ============================================================================
// buildDeliverFn (tested indirectly via executeAndDeliver)
// ============================================================================

describe("executeAndDeliver — deliver function", () => {
  it("prevents double delivery", async () => {
    mockAskClaude.mockImplementation(async (...args: unknown[]) => {
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
      (c) => c[0] && typeof c[0] === "object" && "blocks" in (c[0] as { blocks?: object[] }),
    );
    // Only one content delivery via streamer (the first call)
    assert.equal(contentStops.length, 1);
    assert.equal(response.success, true);
  });

  it("falls back to chat.postMessage when streamer has failed", async () => {
    resetStreamerInstance({ hasFailed: true });

    mockAskClaude.mockImplementation(async (...args: unknown[]) => {
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
      (c: unknown[]) => (c[0] as { text: string }).text === "fallback content",
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
    mockPostMessage.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("slack is down");
      }
      return { ok: true };
    });

    mockAskClaude.mockImplementation(async (...args: unknown[]) => {
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

type DeliverOpts = {
  blocks: object[];
  reactions?: string[];
  postTopLevel?: boolean;
  suppressUnfurls?: boolean;
  threadTs?: string;
};
type DeliverResult = Promise<{ ok: true; ts?: string } | { ok: false; error: string }>;

async function waitForReactionAddCalls(
  fn: { mock: { calls: { length: number } } },
  expected: number,
): Promise<void> {
  await vi.waitFor(() => assert.ok(fn.mock.calls.length >= expected));
}

describe("executeAndDeliver — delivery reactions", () => {
  it("adds reactions after successful delivery via streamer", async () => {
    resetStreamerInstance({ messageTs: "1700000000.000100" });

    mockAskClaude.mockImplementation(async (...args: Parameters<typeof mockAskClaude>) => {
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
    await waitForReactionAddCalls(reactionsAdd, 2);
    assert.equal(reactionsAdd.mock.calls.length, 2);
    const firstCall = reactionsAdd.mock.calls[0][0] as {
      name: string;
    };
    assert.equal(firstCall.name, "thumbsup");
    const secondCall = reactionsAdd.mock.calls[1][0] as {
      name: string;
    };
    assert.equal(secondCall.name, "eyes");
  });

  it("adds reactions after fallback delivery via chat.postMessage", async () => {
    resetStreamerInstance({ hasFailed: true });

    mockAskClaude.mockImplementation(async (...args: Parameters<typeof mockAskClaude>) => {
      const opts = args[1] as { deliver: (o: DeliverOpts) => DeliverResult };
      await opts.deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "content" } }],
        reactions: ["white_check_mark"],
      });
      return { success: true, answer: "done" };
    });

    const client = makeClient();
    // Ensure postMessage returns a ts so reactions can target the message
    mockPostMessage.mockImplementation(async () => ({
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
    await waitForReactionAddCalls(reactionsAdd, 1);
    assert.equal(reactionsAdd.mock.calls.length, 1);
    const call = reactionsAdd.mock.calls[0][0] as { name: string };
    assert.equal(call.name, "white_check_mark");
  });

  it("does not fail delivery when reaction add throws", async () => {
    mockAskClaude.mockImplementation(async (...args: Parameters<typeof mockAskClaude>) => {
      const opts = args[1] as { deliver: (o: DeliverOpts) => DeliverResult };
      const result = await opts.deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "content" } }],
        reactions: ["invalid_emoji"],
      });
      return { success: true, answer: "done", deliverOk: result.ok };
    });

    const client = makeClient();
    mockReactionsAdd.mockImplementation(async () => {
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
    mockAskClaude.mockImplementation(async (...args: Parameters<typeof mockAskClaude>) => {
      const opts = args[1] as { deliver: (o: DeliverOpts) => DeliverResult };
      await opts.deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "content" } }],
        reactions: ["thumbsup"],
      });
      return { success: true, answer: "done" };
    });

    const client = makeClient();
    mockReactionsAdd.mockImplementation(async () => {
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
    mockAskClaude.mockImplementation(async (...args: Parameters<typeof mockAskClaude>) => {
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
    assert.equal(reactionsAdd.mock.calls.length, 0);
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
    assert.equal(postMessage.mock.calls.length, 1);
    const call = postMessage.mock.calls[0][0] as {
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
    const call = postMessage.mock.calls[0][0] as {
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
    const call = postMessage.mock.calls[0][0] as {
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
    const call = postMessage.mock.calls[0][0] as Record<string, unknown>;
    assert.equal("blocks" in call, false);
  });
});

// ============================================================================
// getHandlerClaudeOptions
// ============================================================================

describe("getHandlerClaudeOptions", () => {
  it("delegates to getClaudeOptions with userId, triggerType, and channelId", async () => {
    const sessionInfo = makeSessionInfo({ triggerType: "mentions" });

    await getHandlerClaudeOptions(sessionInfo, deps);

    assert.equal(mockGetClaudeOptions.mock.calls.length, 1);
    assert.equal(mockGetClaudeOptions.mock.calls[0][0], "U001");
    assert.equal(mockGetClaudeOptions.mock.calls[0][1], "mentions");
    assert.deepEqual(mockGetClaudeOptions.mock.calls[0][2], { channelId: "C001" });
  });

  it("defaults triggerType to directMessages when not set", async () => {
    const sessionInfo = makeSessionInfo();

    await getHandlerClaudeOptions(sessionInfo, deps);

    assert.equal(mockGetClaudeOptions.mock.calls[0][1], "directMessages");
  });

  it("returns the options from getClaudeOptions", async () => {
    mockGetClaudeOptions.mockImplementation(async () => ({
      role: "admin" as const,
      changesWorkflowEnabled: true,
    }));

    const result = await getHandlerClaudeOptions(makeSessionInfo(), deps);

    assert.equal(result.role, "admin");
    assert.equal(result.changesWorkflowEnabled, true);
  });
});

describe("delivery switching via deliveryControl", () => {
  beforeEach(() => {
    resetStreamerInstance({ messageTs: "switch.1" });
    mockAskClaude.mockClear();
    mockSetDeliveryMode.mockClear();
    mockStreamerStart.mockClear();
  });

  it("an invisible turn that switches to streamer mid-run opens a card and persists the mode", async () => {
    mockAskClaude.mockImplementationOnce(async (_session, options) => {
      await options?.deliveryControl?.switchTo("streamer");
      return { success: true, answer: "now working" };
    });

    const client = makeClient();
    await executeAndDeliver({
      client,
      session: makeSession({ deliveryMode: "invisible" }),
      sessionInfo: makeSessionInfo(),
      claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
      silentThinking: true,
      deps,
    });

    // The switch wound up a streaming surface mid-run (silent turns open no card on their own)...
    assert.equal(mockStreamerStart.mock.calls.length, 1);
    // ...and persisted the new mode so future turns follow it.
    assert.deepEqual(mockSetDeliveryMode.mock.calls[0], ["session-1", "streamer"]);
  });

  it("a streamer turn that switches to invisible mid-run discards the card and persists the mode", async () => {
    mockAskClaude.mockImplementationOnce(async (_session, options) => {
      await options?.deliveryControl?.switchTo("invisible");
      return { success: true, answer: "casual now" };
    });

    const client = makeClient();
    await executeAndDeliver({
      client,
      session: makeSession({ deliveryMode: "streamer" }),
      sessionInfo: makeSessionInfo(),
      claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
      // streamer turn (silentThinking false)
      deps,
    });

    // The streaming card was wound up at turn start, then torn down on the switch...
    assert.equal(mockStreamerStart.mock.calls.length, 1);
    // ...and the new mode persisted.
    assert.deepEqual(mockSetDeliveryMode.mock.calls[0], ["session-1", "invisible"]);
  });

  it("ignores a switch attempted after the turn already delivered (no persist, no new card)", async () => {
    mockAskClaude.mockImplementationOnce(async (_session, options) => {
      // Deliver first (sets alreadyDelivered), then attempt a switch — must be a no-op.
      await options?.deliver?.({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "answer" } }],
      });
      await options?.deliveryControl?.switchTo("invisible");
      return { success: true, answer: "answer" };
    });

    const client = makeClient();
    await executeAndDeliver({
      client,
      session: makeSession({ deliveryMode: "streamer" }),
      sessionInfo: makeSessionInfo(),
      claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
      deps,
    });

    // The post-delivery switch was guarded out — no mode persisted.
    assert.equal(mockSetDeliveryMode.mock.calls.length, 0);
  });

  it("does not expose deliveryControl on a channelless run (nothing to switch)", async () => {
    mockAskClaude.mockImplementationOnce(async () => ({ success: true, answer: "x" }));
    const client = makeClient();
    await executeAndDeliver({
      client,
      session: makeSession({ channelId: "channelless:job-1" }),
      sessionInfo: makeSessionInfo({ channelId: "channelless:job-1" }),
      claudeOptions: { role: "system" as const, changesWorkflowEnabled: false },
      silentThinking: true,
      deps,
    });

    const callArgs = mockAskClaude.mock.calls[0][1] as { deliveryControl?: unknown };
    assert.equal(callArgs.deliveryControl, undefined);
  });
});

describe("silentThinking mode", () => {
  beforeEach(() => {
    resetStreamerInstance();
    mockAskClaude.mockClear();
    mockAskClaude.mockImplementation(async () => ({
      success: true,
      answer: "silent answer",
    }));
  });

  it("does not create a SlackStreamer when silentThinking is true", async () => {
    const client = makeClient();
    mockStreamerStart.mockClear();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
      silentThinking: true,
      deps,
    });

    // Streamer should never have been started
    assert.equal(mockStreamerStart.mock.calls.length, 0);
  });

  it("delivers the silent answer INTO the session thread, not top-level", async () => {
    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo({ threadTs: "1700000000.000001" }),
      claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
      silentThinking: true,
      deps,
    });

    const primary = mockPostMessage.mock.calls.find(
      (c) => (c[0] as { channel?: string }).channel === "C001",
    );
    assert.ok(primary, "expected a primary post to the channel");
    assert.equal((primary![0] as { thread_ts?: string }).thread_ts, "1700000000.000001");
  });

  it("does not post a primary to the channelless sentinel on success", async () => {
    // Regression: a channelless cron (e.g. casual-talk) delivers via `deliver_to` inside
    // submit_response (to real channels), so the streamer `deliver` is never called and
    // `alreadyDelivered` stays false on success. Without the channelless guard, handleSuccess
    // would post the raw answer to the synthetic `channelless:<id>` channel and crash the job
    // with channel_not_found.
    const client = makeClient();

    await executeAndDeliver({
      client,
      session: makeSession({ channelId: "channelless:job-1" }),
      sessionInfo: makeSessionInfo({ channelId: "channelless:job-1" }),
      claudeOptions: { role: "system" as const, changesWorkflowEnabled: false },
      silentThinking: true,
      deps,
    });

    const postedToSentinel = mockPostMessage.mock.calls.some(
      (c) => (c[0] as { channel?: string }).channel === "channelless:job-1",
    );
    assert.equal(postedToSentinel, false);
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
    const callArgs = mockAskClaude.mock.calls[0][1] as Record<string, unknown>;
    assert.equal(typeof callArgs.onEvent, "function");
  });

  it("creates SlackStreamer when silentThinking is false", async () => {
    const client = makeClient();
    mockStreamerStart.mockClear();

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
      silentThinking: false,
      deps,
    });

    // Streamer should have been started
    assert.equal(mockStreamerStart.mock.calls.length, 1);
  });

  describe("skip handling", () => {
    it("deletes the streamer message and skips persistence when response is skipped", async () => {
      resetStreamerInstance({ messageTs: "1234.5678" });
      mockAskClaude.mockImplementationOnce(async () => ({
        success: true,
        skipped: true,
        answer: "",
      }));
      mockAppendAssistantMessage.mockClear();
      mockUpdateSession.mockClear();
      mockHandleAutoExecuteActions.mockClear();

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
      assert.deepStrictEqual(deleteCall[0], {
        channel: "C001",
        ts: "1234.5678",
      });

      // Session persistence and auto-execute should NOT have been called
      assert.equal(mockAppendAssistantMessage.mock.calls.length, 0);
      assert.equal(mockHandleAutoExecuteActions.mock.calls.length, 0);
    });

    it("persists skipped+disengaged turn and attentionLevel:off in a single updateSession call", async () => {
      resetStreamerInstance({ messageTs: "1234.5678" });
      mockAskClaude.mockImplementationOnce(async () => ({
        success: true,
        skipped: true,
        attentionLevel: "off",
        answer: "",
      }));
      mockUpdateSession.mockClear();

      const client = makeClient();
      const response = await executeAndDeliver({
        client,
        session: makeSession(),
        sessionInfo: makeSessionInfo(),
        claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
        deps,
      });

      assert.equal(response.skipped, true);
      assert.equal(response.attentionLevel, "off");
      // unified-conversation-log: both the appended skipped+disengaged message AND
      // attentionLevel: "off" are persisted in the same updateSession call.
      assert.equal(mockUpdateSession.mock.calls.length, 1);
      const updates = mockUpdateSession.mock.calls[0][1] as Partial<SessionContext>;
      assert.equal(updates.attentionLevel, "off");
      assert.ok(Array.isArray(updates.messages));
      const last = updates.messages![updates.messages!.length - 1];
      assert.equal(last.role, "assistant");
      const lastAssistant = last as { skipped?: true; disengaged?: true; payload?: unknown };
      assert.equal(lastAssistant.skipped, true);
      assert.equal(lastAssistant.disengaged, true);
      assert.equal(lastAssistant.payload, undefined);
    });

    it("persists a skipped turn and a deliveryMode switch in a single updateSession call", async () => {
      resetStreamerInstance({ messageTs: "1234.5678" });
      mockAskClaude.mockImplementationOnce(async () => ({
        success: true,
        skipped: true,
        deliveryMode: "invisible",
        answer: "",
      }));
      mockUpdateSession.mockClear();

      const client = makeClient();
      const response = await executeAndDeliver({
        client,
        session: makeSession(),
        sessionInfo: makeSessionInfo(),
        claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
        deps,
      });

      assert.equal(response.skipped, true);
      assert.equal(response.deliveryMode, "invisible");
      // Both the appended skipped message AND the deliveryMode switch ride the same write.
      assert.equal(mockUpdateSession.mock.calls.length, 1);
      const updates = mockUpdateSession.mock.calls[0][1] as Partial<SessionContext>;
      assert.equal(updates.deliveryMode, "invisible");
      assert.ok(Array.isArray(updates.messages));
    });

    it("skip without disengage: appended message has no disengaged flag and attentionLevel unchanged", async () => {
      resetStreamerInstance({ messageTs: "1234.5678" });
      mockAskClaude.mockImplementationOnce(async () => ({
        success: true,
        skipped: true,
        answer: "",
      }));
      mockSetAttentionLevel.mockClear();
      mockUpdateSession.mockClear();

      const client = makeClient();
      await executeAndDeliver({
        client,
        session: makeSession(),
        sessionInfo: makeSessionInfo(),
        claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
        deps,
      });

      assert.equal(mockSetAttentionLevel.mock.calls.length, 0);
      // Single updateSession for the skipped-turn append; attentionLevel not touched.
      assert.equal(mockUpdateSession.mock.calls.length, 1);
      const updates = mockUpdateSession.mock.calls[0][1] as Partial<SessionContext>;
      assert.equal(updates.attentionLevel, undefined);
      const last = updates.messages![updates.messages!.length - 1];
      const lastAssistant = last as { skipped?: true; disengaged?: true };
      assert.equal(lastAssistant.skipped, true);
      assert.equal(lastAssistant.disengaged, undefined);
    });

    it("calls setAttentionLevel when normal response has attention_level: off", async () => {
      resetStreamerInstance({ messageTs: "1234.5678" });
      mockAskClaude.mockImplementationOnce(async () => ({
        success: true,
        attentionLevel: "off",
        answer: "You're welcome!",
      }));
      mockSetAttentionLevel.mockClear();

      const client = makeClient();
      const response = await executeAndDeliver({
        client,
        session: makeSession(),
        sessionInfo: makeSessionInfo(),
        claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
        deps,
      });

      assert.equal(response.success, true);
      assert.equal(response.attentionLevel, "off");
      assert.equal(mockSetAttentionLevel.mock.calls.length, 1);
      assert.equal(mockSetAttentionLevel.mock.calls[0][0], "session-1");
      assert.equal(mockSetAttentionLevel.mock.calls[0][1], "off");
    });

    it("does NOT call setAttentionLevel on success without an attention_level", async () => {
      resetStreamerInstance({ messageTs: "1234.5678" });
      mockAskClaude.mockImplementationOnce(async () => ({
        success: true,
        answer: "regular answer",
      }));
      mockSetAttentionLevel.mockClear();

      const client = makeClient();
      await executeAndDeliver({
        client,
        session: makeSession(),
        sessionInfo: makeSessionInfo(),
        claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
        deps,
      });

      assert.equal(mockSetAttentionLevel.mock.calls.length, 0);
    });

    it("calls setDeliveryMode when a success response switches the mode", async () => {
      resetStreamerInstance({ messageTs: "1234.5678" });
      mockAskClaude.mockImplementationOnce(async () => ({
        success: true,
        deliveryMode: "streamer",
        answer: "Let's get to work.",
      }));
      mockSetDeliveryMode.mockClear();

      const client = makeClient();
      const response = await executeAndDeliver({
        client,
        session: makeSession(),
        sessionInfo: makeSessionInfo(),
        claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
        deps,
      });

      assert.equal(response.success, true);
      assert.equal(response.deliveryMode, "streamer");
      assert.equal(mockSetDeliveryMode.mock.calls.length, 1);
      assert.equal(mockSetDeliveryMode.mock.calls[0][0], "session-1");
      assert.equal(mockSetDeliveryMode.mock.calls[0][1], "streamer");
    });

    it("does NOT call setDeliveryMode on success without a default_delivery_mode", async () => {
      resetStreamerInstance({ messageTs: "1234.5678" });
      mockAskClaude.mockImplementationOnce(async () => ({
        success: true,
        answer: "regular answer",
      }));
      mockSetDeliveryMode.mockClear();

      const client = makeClient();
      await executeAndDeliver({
        client,
        session: makeSession(),
        sessionInfo: makeSessionInfo(),
        claudeOptions: { role: "dev" as const, changesWorkflowEnabled: false },
        deps,
      });

      assert.equal(mockSetDeliveryMode.mock.calls.length, 0);
    });

    it("handles skip gracefully when streamer has no messageTs", async () => {
      resetStreamerInstance({ messageTs: undefined });
      mockAskClaude.mockImplementationOnce(async () => ({
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
      assert.equal(mockChatDelete.mock.calls.length, 0);
    });
  });
});

// ============================================================================
// Multi-block iteration (rollover): skip/cancel/postTopLevel must delete every
// block the streamer opened, not just the latest one.
// ============================================================================

describe("executeAndDeliver — multi-block iteration", () => {
  it("handleSkip iterates getAllMessageTss and deletes every block", async () => {
    resetStreamerInstance({
      messageTs: "3.3",
      allMessageTss: ["1.1", "2.2", "3.3"],
    });
    deps = makeDeps();
    deps.appendAssistantMessage = mockAppendAssistantMessage;
    mockAskClaude.mockImplementationOnce(async () => ({
      success: true,
      skipped: true,
      answer: "",
    }));

    const client = makeClient();
    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.equal(mockChatDelete.mock.calls.length, 3);
    assert.deepStrictEqual(mockChatDelete.mock.calls[0][0], {
      channel: "C001",
      ts: "1.1",
    });
    assert.deepStrictEqual(mockChatDelete.mock.calls[1][0], {
      channel: "C001",
      ts: "2.2",
    });
    assert.deepStrictEqual(mockChatDelete.mock.calls[2][0], {
      channel: "C001",
      ts: "3.3",
    });
  });

  it("handleCancellation iterates getAllMessageTss and deletes every block", async () => {
    resetStreamerInstance({
      messageTs: "3.3",
      allMessageTss: ["1.1", "2.2", "3.3"],
    });
    deps = makeDeps();
    deps.appendAssistantMessage = mockAppendAssistantMessage;
    mockAskClaude.mockImplementation(async () => ({
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

    assert.equal(mockChatDelete.mock.calls.length, 3);
    const tss = mockChatDelete.mock.calls.map((c) => {
      const arg = c[0] as { ts: string };
      return arg.ts;
    });
    assert.deepStrictEqual(tss, ["1.1", "2.2", "3.3"]);
  });

  it("postTopLevel iterates getAllMessageTss before posting top-level", async () => {
    resetStreamerInstance({
      messageTs: "3.3",
      allMessageTss: ["1.1", "2.2", "3.3"],
    });
    deps = makeDeps();
    deps.appendAssistantMessage = mockAppendAssistantMessage;
    mockAskClaude.mockImplementationOnce(async (_session, options) => {
      // Trigger the postTopLevel deliver branch by invoking the deliver fn with postTopLevel.
      await options?.deliver?.({ blocks: [], postTopLevel: true });
      return { success: true, answer: "delivered top-level" };
    });

    const client = makeClient();
    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    // 3 deletes for the streamer's blocks, then 1 postMessage for the top-level repost.
    assert.equal(mockChatDelete.mock.calls.length, 3);
    const tss = mockChatDelete.mock.calls.map((c) => {
      const arg = c[0] as { ts: string };
      return arg.ts;
    });
    assert.deepStrictEqual(tss, ["1.1", "2.2", "3.3"]);
    assert.ok(mockPostMessage.mock.calls.length >= 1, "top-level postMessage should have fired");
  });

  it("iteration continues when one chat.delete throws", async () => {
    resetStreamerInstance({
      messageTs: "3.3",
      allMessageTss: ["1.1", "2.2", "3.3"],
    });
    deps = makeDeps();
    deps.appendAssistantMessage = mockAppendAssistantMessage;
    mockAskClaude.mockImplementationOnce(async () => ({
      success: true,
      skipped: true,
      answer: "",
    }));

    const client = makeClient();
    // Override chat.delete to throw on the middle ts ("2.2"), succeed on others.
    let deleteCallCount = 0;
    mockChatDelete.mockImplementation(async () => {
      deleteCallCount++;
      if (deleteCallCount === 2) throw new Error("delete failed for 2.2");
      return { ok: true };
    });

    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    // All three deletes were attempted — the throw on 2.2 did not halt the loop.
    assert.equal(mockChatDelete.mock.calls.length, 3);
  });
});

// ============================================================================
// executeAndDeliver — owner escalation (escalate_to_owner)
// ============================================================================

describe("executeAndDeliver — owner escalation", () => {
  const DIAGNOSTIC = "TOOL get_widget failed: ECONNREFUSED while calling the widget service";

  it("DMs the owner the diagnostic and writes a report, keeping it out of the user message", async () => {
    mockAskClaude.mockImplementation(async () => ({
      success: true,
      answer: "I hit a problem on my end — I've notified the owner.",
      escalateToOwner: DIAGNOSTIC,
    }));

    const client = makeClient();
    await executeAndDeliver({
      client,
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.equal(mockSendOwnerDm.mock.calls.length, 1);
    const [owner, text, options] = mockSendOwnerDm.mock.calls[0];
    assert.equal(owner, "U_OWNER");
    assert.match(text, /ECONNREFUSED/);
    assert.deepEqual(options, { suppressUnfurls: true });

    assert.equal(mockWriteErrorReport.mock.calls.length, 1);
    const report = mockWriteErrorReport.mock.calls[0][0];
    assert.equal(report.errorMessage, DIAGNOSTIC);
    assert.equal(report.sessionId, "session-1");

    // The diagnostic must never reach the user-facing channel.
    for (const call of mockPostMessage.mock.calls) {
      assert.ok(!JSON.stringify(call[0]).includes("ECONNREFUSED"));
    }
  });

  it("still writes a report (and does not DM) when no owner is configured", async () => {
    mockGetOwnerUserId.mockImplementation(async () => null);
    mockAskClaude.mockImplementation(async () => ({
      success: true,
      answer: "I hit a problem on my end — I've notified the owner.",
      escalateToOwner: DIAGNOSTIC,
    }));

    await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.equal(mockSendOwnerDm.mock.calls.length, 0);
    assert.equal(mockWriteErrorReport.mock.calls.length, 1);
  });

  it("still writes a report (and does not throw) when the owner DM fails", async () => {
    mockSendOwnerDm.mockImplementation(async () => false);
    mockAskClaude.mockImplementation(async () => ({
      success: true,
      answer: "I hit a problem on my end — I've notified the owner.",
      escalateToOwner: DIAGNOSTIC,
    }));

    await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.equal(mockSendOwnerDm.mock.calls.length, 1);
    assert.equal(mockWriteErrorReport.mock.calls.length, 1);
  });

  it("escalates on a skipped turn (channelless decline + escalate)", async () => {
    mockAskClaude.mockImplementation(async () => ({
      success: true,
      skipped: true,
      answer: "",
      escalateToOwner: DIAGNOSTIC,
    }));

    await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.equal(mockSendOwnerDm.mock.calls.length, 1);
    assert.equal(mockWriteErrorReport.mock.calls.length, 1);
  });

  it("does nothing when escalate_to_owner is absent", async () => {
    // default mockAskClaude returns a plain success with no escalateToOwner
    await executeAndDeliver({
      client: makeClient(),
      session: makeSession(),
      sessionInfo: makeSessionInfo(),
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.equal(mockSendOwnerDm.mock.calls.length, 0);
    assert.equal(mockWriteErrorReport.mock.calls.length, 0);
  });
});

// ============================================================================
// seedChannelReplyThreadHandoff
// ============================================================================

describe("executeAndDeliver — seedChannelReplyThreadHandoff", () => {
  beforeEach(() => {
    mockRegisterThreadSession.mockClear();
    mockAppendSessionToEphemeralRule.mockClear();
    resetStreamerInstance();
    mockAskClaude.mockClear();
    mockAskClaude.mockImplementation(async () => ({
      success: true,
      answer: "test answer",
    }));
  });

  it("calls registerThreadSession and appendSessionToEphemeralRule when triggerType==='channelReply'", async () => {
    const seededSession = makeSession({ sessionId: "thread-session-1" });
    mockRegisterThreadSession.mockImplementation(async () => seededSession);

    mockAskClaude.mockImplementationOnce(async (...args: Parameters<typeof mockAskClaude>) => {
      const opts = args[1] as { deliver: (o: DeliverOpts) => DeliverResult };
      await opts.deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "answer" } }],
      });
      return { success: true, answer: "answer" };
    });

    const client = makeClient();
    const session = makeSession();
    const sessionInfo = makeSessionInfo({ triggerType: "channelReply" });

    await executeAndDeliver({
      client,
      session,
      sessionInfo,
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.equal(mockRegisterThreadSession.mock.calls.length, 1);
    const registerArgs = mockRegisterThreadSession.mock.calls[0] as Parameters<
      typeof mockRegisterThreadSession
    >;
    assert.equal(registerArgs[0], "C001");
    assert.equal(registerArgs[1], "1700000000.000001");
    assert.ok(registerArgs[2]);
    assert.equal((registerArgs[2] as { attentionLevel: string }).attentionLevel, "medium");

    assert.equal(mockAppendSessionToEphemeralRule.mock.calls.length, 1);
    const appendArgs = mockAppendSessionToEphemeralRule.mock.calls[0] as Parameters<
      typeof mockAppendSessionToEphemeralRule
    >;
    assert.equal(appendArgs[0], "C001");
    assert.equal(appendArgs[1], "thread-session-1");
  });

  it("does not call registerThreadSession when triggerType is NOT 'channelReply'", async () => {
    mockAskClaude.mockImplementationOnce(async (...args: Parameters<typeof mockAskClaude>) => {
      const opts = args[1] as { deliver: (o: DeliverOpts) => DeliverResult };
      await opts.deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "answer" } }],
      });
      return { success: true, answer: "answer" };
    });

    const client = makeClient();
    const session = makeSession();
    const sessionInfo = makeSessionInfo({ triggerType: "mentions" });

    await executeAndDeliver({
      client,
      session,
      sessionInfo,
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.equal(mockRegisterThreadSession.mock.calls.length, 0);
    assert.equal(mockAppendSessionToEphemeralRule.mock.calls.length, 0);
  });

  it("logs registerThreadSession failure as warning and does NOT fail delivery", async () => {
    mockRegisterThreadSession.mockImplementation(async () => {
      throw new Error("registerThreadSession failed");
    });

    mockAskClaude.mockImplementationOnce(async (...args: Parameters<typeof mockAskClaude>) => {
      const opts = args[1] as { deliver: (o: DeliverOpts) => DeliverResult };
      await opts.deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "answer" } }],
      });
      return { success: true, answer: "answer" };
    });

    const client = makeClient();
    const session = makeSession();
    const sessionInfo = makeSessionInfo({ triggerType: "channelReply" });

    const response = await executeAndDeliver({
      client,
      session,
      sessionInfo,
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.equal(response.success, true);
  });

  it("appends follow-up session to conversation ledger when postTopLevel with channelReply", async () => {
    mockAskClaude.mockImplementationOnce(async (...args: Parameters<typeof mockAskClaude>) => {
      const opts = args[1] as { deliver: (o: DeliverOpts) => DeliverResult };
      await opts.deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "answer" } }],
        postTopLevel: true,
      });
      return { success: true, answer: "answer" };
    });

    const client = makeClient();
    mockPostMessage.mockImplementation(async () => ({
      ok: true,
      ts: "1700000000.000200",
    }));

    const session = makeSession();
    const sessionInfo = makeSessionInfo({ triggerType: "channelReply" });

    await executeAndDeliver({
      client,
      session,
      sessionInfo,
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.equal(mockAppendSessionToEphemeralRule.mock.calls.length, 1);
  });

  it("does NOT append when postTopLevel and triggerType is not channelReply", async () => {
    mockAskClaude.mockImplementationOnce(async (...args: Parameters<typeof mockAskClaude>) => {
      const opts = args[1] as { deliver: (o: DeliverOpts) => DeliverResult };
      await opts.deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "answer" } }],
        postTopLevel: true,
      });
      return { success: true, answer: "answer" };
    });

    const client = makeClient();
    mockPostMessage.mockImplementation(async () => ({
      ok: true,
      ts: "1700000000.000200",
    }));

    const session = makeSession();
    const sessionInfo = makeSessionInfo({ triggerType: "reactions" });

    await executeAndDeliver({
      client,
      session,
      sessionInfo,
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.equal(mockAppendSessionToEphemeralRule.mock.calls.length, 0);
  });

  it("includes additionalSystemPrompt in registerThreadSession when present", async () => {
    const seededSession = makeSession({ sessionId: "thread-session-2" });
    mockRegisterThreadSession.mockImplementation(async () => seededSession);

    mockAskClaude.mockImplementationOnce(async (...args: Parameters<typeof mockAskClaude>) => {
      const opts = args[1] as { deliver: (o: DeliverOpts) => DeliverResult };
      await opts.deliver({
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "answer" } }],
      });
      return { success: true, answer: "answer" };
    });

    const client = makeClient();
    const session = makeSession({ additionalSystemPrompt: "extra context here" });
    const sessionInfo = makeSessionInfo({ triggerType: "channelReply" });

    await executeAndDeliver({
      client,
      session,
      sessionInfo,
      claudeOptions: makeClaudeOptions(),
      deps,
    });

    assert.equal(mockRegisterThreadSession.mock.calls.length, 1);
    const registerArgs = mockRegisterThreadSession.mock.calls[0] as Parameters<
      typeof mockRegisterThreadSession
    >;
    const options = registerArgs[2] as { attentionLevel: string; creationContext?: string };
    assert.equal(options.creationContext, "extra context here");
  });
});
