import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { SessionInfo } from "../activeSessions.js";
import type { SessionContext } from "../../sessions.js";

// ============================================================================
// Mocks — set up before importing the module under test
// ============================================================================

const mockGetSession = mock.fn<(sessionId: string) => Promise<SessionContext | null>>(
  async () => null,
);
const mockUpdateThreadContext = mock.fn<(...args: unknown[]) => Promise<unknown>>(async () => null);
const mockRestoreSessionInfo = mock.fn<(sessionId: string) => Promise<SessionInfo | undefined>>(
  async () => undefined,
);
const mockFetchThreadContext = mock.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []);
const mockExecuteAndDeliver = mock.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
  success: true,
  answer: "done",
}));
const mockGetHandlerClaudeOptions = mock.fn<
  (...args: unknown[]) => Promise<Record<string, unknown>>
>(async () => ({}));

const mockConfig = {
  slack: {
    fetchAndStoreUsername: false,
  },
};
const mockGetConfig = mock.fn(() => mockConfig);

mock.module("../../sessions.js", {
  namedExports: {
    getSession: mockGetSession,
    updateThreadContext: mockUpdateThreadContext,
  },
});

mock.module("../activeSessions.js", {
  namedExports: {
    activeSessions: { restore: mockRestoreSessionInfo },
  },
});

mock.module("../messagesApi.js", {
  namedExports: {
    fetchThreadContext: mockFetchThreadContext,
  },
});

mock.module("./handlerResponse.js", {
  namedExports: {
    executeAndDeliver: mockExecuteAndDeliver,
    getHandlerClaudeOptions: mockGetHandlerClaudeOptions,
  },
});

mock.module("../../config.js", {
  namedExports: {
    getConfig: mockGetConfig,
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

// Import after mocks
const { registerRetryHandler } = await import("./retry.js");

// ============================================================================
// Helpers
// ============================================================================

type ActionHandler = (args: {
  ack: () => Promise<void>;
  body: { actions: Array<{ value: string }> };
  client: App["client"];
  respond: (msg: Record<string, unknown>) => Promise<void>;
}) => Promise<void>;

let capturedHandler: ActionHandler;
let capturedActionId: string;

function makeApp(): App {
  return {
    action: (actionId: string, handler: ActionHandler) => {
      capturedActionId = actionId;
      capturedHandler = handler;
    },
  } as unknown as App;
}

function makeClient(botUserId = "B001"): App["client"] {
  return {
    auth: {
      test: mock.fn(async () => ({ user_id: botUserId })),
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

beforeEach(() => {
  mockGetSession.mock.resetCalls();
  mockUpdateThreadContext.mock.resetCalls();
  mockRestoreSessionInfo.mock.resetCalls();
  mockFetchThreadContext.mock.resetCalls();
  mockExecuteAndDeliver.mock.resetCalls();
  mockGetHandlerClaudeOptions.mock.resetCalls();
  mockGetConfig.mock.resetCalls();

  // Default: getSession returns updated session after updateThreadContext
  mockGetSession.mock.mockImplementation(async () => null);

  const app = makeApp();
  registerRetryHandler(app);
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
    const mockRespond = mock.fn(async () => {});
    const mockAck = mock.fn(async () => {});

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }] },
      client: makeClient(),
      respond: mockRespond,
    });

    assert.equal(mockAck.mock.callCount(), 1);
    assert.equal(mockRespond.mock.callCount(), 1);
    const respondArgs = (
      mockRespond.mock.calls as unknown as Array<{ arguments: [Record<string, unknown>] }>
    )[0].arguments[0];
    assert.ok((respondArgs.text as string).includes("expired"));
    assert.equal(respondArgs.replace_original, true);
  });

  it("responds with expired message when sessionInfo is not found", async () => {
    mockGetSession.mock.mockImplementation(async () => makeSession());
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);
    const mockRespond = mock.fn(async () => {});
    const mockAck = mock.fn(async () => {});

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
    const claudeOptions = { model: "claude-test" };

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

    const mockAck = mock.fn(async () => {});
    const mockRespond = mock.fn(async () => {});
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
    const deliverArgs = mockExecuteAndDeliver.mock.calls[0].arguments[0] as Record<string, unknown>;
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
    mockGetHandlerClaudeOptions.mock.mockImplementation(async () => ({}));

    mockConfig.slack.fetchAndStoreUsername = true;

    const mockAck = mock.fn(async () => {});
    const mockRespond = mock.fn(async () => {});

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }] },
      client: makeClient(),
      respond: mockRespond,
    });

    const fetchArgs = mockFetchThreadContext.mock.calls[0].arguments;
    assert.deepEqual(fetchArgs[4], { fetchUserNames: true });

    // Reset config
    mockConfig.slack.fetchAndStoreUsername = false;
  });

  it("acknowledges the action before processing", async () => {
    mockGetSession.mock.mockImplementation(async () => null);
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);

    const callOrder: string[] = [];
    const mockAck = mock.fn(async () => {
      callOrder.push("ack");
    });
    const mockRespond = mock.fn(async () => {
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
    const sessionInfo = makeSessionInfo({ triggerType: "reactions" });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);
    mockFetchThreadContext.mock.mockImplementation(async () => []);
    mockGetHandlerClaudeOptions.mock.mockImplementation(async () => ({}));

    const mockAck = mock.fn(async () => {});
    const mockRespond = mock.fn(async () => {});

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
