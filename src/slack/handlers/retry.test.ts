import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { SessionInfo } from "../activeSessions.js";
import type { SessionContext, ThreadMessage } from "../../sessions.js";
import { registerRetryHandler, type RetryDeps } from "./retry.js";
import type { FetchThreadContextOptions } from "../messagesApi.js";
import type { AskClaudeOptions, ClaudeResponse } from "../../claude/index.js";
import type { Config } from "../../config.js";

// ============================================================================
// Mocks
// ============================================================================

const mockGetSession = mock.fn<(sessionId: string) => Promise<SessionContext | null>>();
const mockUpdateThreadContext =
  mock.fn<(sessionId: string, context: ThreadMessage[]) => Promise<SessionContext | null>>();
const mockRestoreSessionInfo = mock.fn<(sessionId: string) => Promise<SessionInfo | undefined>>();
const mockFetchThreadContext =
  mock.fn<
    (
      client: App["client"],
      channelId: string,
      threadTs: string,
      botUserId: string,
      opts?: FetchThreadContextOptions,
    ) => Promise<ThreadMessage[]>
  >();
const mockExecuteAndDeliver =
  mock.fn<
    (params: {
      client: App["client"];
      session: SessionContext;
      sessionInfo: SessionInfo;
      claudeOptions: AskClaudeOptions;
    }) => Promise<ClaudeResponse>
  >();
const mockGetHandlerClaudeOptions = mock.fn<(info: SessionInfo) => Promise<AskClaudeOptions>>();
const mockGetConfig = mock.fn<() => Config>();

function makeDeps(): RetryDeps {
  return {
    getSession: mockGetSession,
    updateThreadContext: mockUpdateThreadContext,
    restoreSession: mockRestoreSessionInfo,
    fetchThreadContext: mockFetchThreadContext,
    executeAndDeliver: mockExecuteAndDeliver,
    getHandlerClaudeOptions: mockGetHandlerClaudeOptions,
    getConfig: mockGetConfig,
  };
}

// ============================================================================
// Helpers
// ============================================================================

type ActionHandler = (args: {
  ack: () => Promise<void>;
  body: { actions: Array<{ value: string }> };
  client: App["client"];
  respond: (msg: { replace_original?: boolean; text: string }) => Promise<void>;
}) => Promise<void>;

let capturedHandler: ActionHandler;
let capturedActionId: string;

function makeApp(deps: RetryDeps): App {
  const app = {
    action: (actionId: string, handler: ActionHandler) => {
      capturedActionId = actionId;
      capturedHandler = handler;
    },
  } as never as App;
  registerRetryHandler(app, deps);
  return app;
}

function makeClient(botUserId: string = "B001"): App["client"] {
  return {
    auth: {
      test: mock.fn(async () => ({ user_id: botUserId })),
    },
  } as never as App["client"];
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

beforeEach(() => {
  mockGetSession.mock.resetCalls();
  mockUpdateThreadContext.mock.resetCalls();
  mockRestoreSessionInfo.mock.resetCalls();
  mockFetchThreadContext.mock.resetCalls();
  mockExecuteAndDeliver.mock.resetCalls();
  mockGetHandlerClaudeOptions.mock.resetCalls();
  mockGetConfig.mock.resetCalls();

  // Default config (minimal mock)
  mockGetConfig.mock.mockImplementation(
    () =>
      ({
        slack: {
          fetchAndStoreUsername: false,
        },
      }) as never as Config,
  );

  const app = makeApp(makeDeps());
});

// ============================================================================
// Tests
// ============================================================================

describe("registerRetryHandler", () => {
  it("registers a clack_retry action handler", () => {
    assert.equal(capturedActionId, "clack_retry");
    assert.ok(capturedHandler, "handler should have been registered");
  });

  it("responds with expired message when session is not found", async () => {
    mockGetSession.mock.mockImplementation(async () => null);
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);
    const mockRespond = mock.fn<
      (msg: { replace_original?: boolean; text: string }) => Promise<void>
    >(async () => {});
    const mockAck = mock.fn<() => Promise<void>>(async () => {});

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }] },
      client: makeClient(),
      respond: mockRespond,
    });

    assert.equal(mockAck.mock.callCount(), 1);
    assert.equal(mockRespond.mock.callCount(), 1);
    const respondArgs = mockRespond.mock.calls[0].arguments[0];
    assert.ok(respondArgs.text.includes("expired"));
    assert.equal(respondArgs.replace_original, true);
  });

  it("responds with expired message when sessionInfo is not found", async () => {
    mockGetSession.mock.mockImplementation(async () => makeSession());
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);
    const mockRespond = mock.fn<
      (msg: { replace_original?: boolean; text: string }) => Promise<void>
    >(async () => {});
    const mockAck = mock.fn<() => Promise<void>>(async () => {});

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }] },
      client: makeClient(),
      respond: mockRespond,
    });

    assert.equal(mockRespond.mock.callCount(), 1);
  });

  it("re-fetches thread context and calls executeAndDeliver", async () => {
    const session = makeSession();
    const updatedSession = makeSession({
      threadContext: [{ text: "msg", userId: "U001", isBot: false, ts: "1" }],
    });
    const sessionInfo = makeSessionInfo();
    const claudeOptions: AskClaudeOptions = { model: "claude-test" } as never;
    const response: ClaudeResponse = { success: true, answer: "done" };

    let getSessionCallCount = 0;
    mockGetSession.mock.mockImplementation(async () => {
      getSessionCallCount++;
      // First call returns original, second returns updated
      return getSessionCallCount === 1 ? session : updatedSession;
    });
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);
    mockFetchThreadContext.mock.mockImplementation(async () => [
      { text: "msg", userId: "U001", isBot: false, ts: "1" },
    ]);
    mockGetHandlerClaudeOptions.mock.mockImplementation(async () => claudeOptions);
    mockExecuteAndDeliver.mock.mockImplementation(async () => response);

    const mockAck = mock.fn<() => Promise<void>>(async () => {});
    const mockRespond = mock.fn<
      (msg: { replace_original?: boolean; text: string }) => Promise<void>
    >(async () => {});
    const client = makeClient("B001");

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }] },
      client,
      respond: mockRespond,
    });

    // Should have fetched thread context
    assert.equal(mockFetchThreadContext.mock.callCount(), 1);
    const fetchArgs = mockFetchThreadContext.mock.calls[0].arguments;
    assert.equal(fetchArgs[0], client);
    assert.equal(fetchArgs[1], "C001");
    assert.equal(fetchArgs[2], "1700000000.000001");
    assert.equal(fetchArgs[3], "B001");

    // Should have updated thread context
    assert.equal(mockUpdateThreadContext.mock.callCount(), 1);

    // Should have called executeAndDeliver with updated session
    assert.equal(mockExecuteAndDeliver.mock.callCount(), 1);
    const deliverArgs = mockExecuteAndDeliver.mock.calls[0].arguments[0];
    assert.equal(deliverArgs.client, client);
    assert.equal(deliverArgs.session, updatedSession);
    assert.equal(deliverArgs.sessionInfo, sessionInfo);
    assert.equal(deliverArgs.claudeOptions, claudeOptions);
  });

  it("passes fetchAndStoreUsername config to fetchThreadContext", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);
    mockFetchThreadContext.mock.mockImplementation(async () => []);
    mockGetHandlerClaudeOptions.mock.mockImplementation(async () => ({}) as AskClaudeOptions);

    mockGetConfig.mock.mockImplementation(
      () =>
        ({
          slack: {
            fetchAndStoreUsername: true,
          },
        }) as never as Config,
    );

    const mockAck = mock.fn<() => Promise<void>>(async () => {});
    const mockRespond = mock.fn<
      (msg: { replace_original?: boolean; text: string }) => Promise<void>
    >(async () => {});

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }] },
      client: makeClient(),
      respond: mockRespond,
    });

    const fetchArgs = mockFetchThreadContext.mock.calls[0].arguments;
    assert.deepEqual(fetchArgs[4], { fetchUserNames: true });

    // Reset config
    mockGetConfig.mock.mockImplementation(
      () =>
        ({
          slack: {
            fetchAndStoreUsername: false,
          },
        }) as never as Config,
    );
  });

  it("acknowledges the action before processing", async () => {
    mockGetSession.mock.mockImplementation(async () => null);
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);

    const callOrder: string[] = [];
    const mockAck = mock.fn<() => Promise<void>>(async () => {
      callOrder.push("ack");
    });
    const mockRespond = mock.fn<
      (msg: { replace_original?: boolean; text: string }) => Promise<void>
    >(async () => {
      callOrder.push("respond");
    });

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }] },
      client: makeClient(),
      respond: mockRespond,
    });

    assert.equal(callOrder[0], "ack");
  });

  it("gets handler claude options from sessionInfo", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo({ triggerType: "reactions" } as never);
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);
    mockFetchThreadContext.mock.mockImplementation(async () => []);
    mockGetHandlerClaudeOptions.mock.mockImplementation(async () => ({}) as AskClaudeOptions);

    const mockAck = mock.fn<() => Promise<void>>(async () => {});
    const mockRespond = mock.fn<
      (msg: { replace_original?: boolean; text: string }) => Promise<void>
    >(async () => {});

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }] },
      client: makeClient(),
      respond: mockRespond,
    });

    assert.equal(mockGetHandlerClaudeOptions.mock.callCount(), 1);
    assert.equal(mockGetHandlerClaudeOptions.mock.calls[0].arguments[0], sessionInfo);
  });
});
