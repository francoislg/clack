import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { SessionInfo } from "../activeSessions.js";
import type { SessionContext, ThreadMessage } from "../../sessions.js";
import { registerRetryHandler, type RetryDeps } from "./retry.js";
import { stub } from "../../testStubs.js";
import { createSlackClientMock, type MockSlackClient } from "../testSlackClient.js";
import { createSlackAppMock, createBlockActionArgs, respondedWith } from "../testBoltApp.js";
import type { AskClaudeOptions, ClaudeResponse } from "../../claude/index.js";
import type { Config } from "../../config.js";

// ============================================================================
// Mocks
// ============================================================================

const mockGetSession = vi.fn<(sessionId: string) => Promise<SessionContext | null>>();
const mockUpdateThreadContext =
  vi.fn<(sessionId: string, context: ThreadMessage[]) => Promise<SessionContext | null>>();
const mockRestoreSessionInfo = vi.fn<(sessionId: string) => Promise<SessionInfo | undefined>>();
const mockFetchThreadContext = vi.fn<RetryDeps["fetchThreadContext"]>();
const mockExecuteAndDeliver = vi.fn<RetryDeps["executeAndDeliver"]>();
const mockGetHandlerClaudeOptions = vi.fn<(info: SessionInfo) => Promise<AskClaudeOptions>>();
const mockGetConfig = vi.fn<() => Config>();

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

function makeApp(deps: RetryDeps) {
  const app = createSlackAppMock();
  registerRetryHandler(app, deps);
  return app;
}

function makeClient(botUserId: string = "B001"): MockSlackClient {
  const client = createSlackClientMock();
  client.auth.test.mockImplementation(async () => ({ ok: true, user_id: botUserId }));
  return client;
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

let app: ReturnType<typeof createSlackAppMock>;

beforeEach(() => {
  mockGetSession.mockClear();
  mockUpdateThreadContext.mockClear();
  mockRestoreSessionInfo.mockClear();
  mockFetchThreadContext.mockClear();
  mockExecuteAndDeliver.mockClear();
  mockGetHandlerClaudeOptions.mockClear();
  mockGetConfig.mockClear();

  // Default config (minimal mock)
  mockGetConfig.mockImplementation(() =>
    stub<Config>({
      slack: {
        fetchAndStoreUsername: false,
      },
    }),
  );

  app = makeApp(makeDeps());
});

// ============================================================================
// Tests
// ============================================================================

describe("registerRetryHandler", () => {
  it("registers a clack_retry action handler", () => {
    const [constraints, handler] = app.action.mock.calls[0];
    assert.equal(constraints, "clack_retry");
    assert.ok(handler, "handler should have been registered");
  });

  it("responds with expired message when session is not found", async () => {
    mockGetSession.mockImplementation(async () => null);
    mockRestoreSessionInfo.mockImplementation(async () => undefined);

    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "session-1", client: makeClient() });
    await handler(args);

    assert.equal(args.ack.mock.calls.length, 1);
    assert.equal(args.respond.mock.calls.length, 1);
    const responded = respondedWith(args);
    assert.ok(responded?.text?.includes("expired"));
    assert.equal(responded?.replace_original, true);
  });

  it("responds with expired message when sessionInfo is not found", async () => {
    mockGetSession.mockImplementation(async () => makeSession());
    mockRestoreSessionInfo.mockImplementation(async () => undefined);

    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "session-1", client: makeClient() });
    await handler(args);

    assert.equal(args.respond.mock.calls.length, 1);
  });

  it("re-fetches thread context and calls executeAndDeliver", async () => {
    const session = makeSession();
    const updatedSession = makeSession({
      threadContext: [{ text: "msg", userId: "U001", isBot: false, ts: "1" }],
    });
    const sessionInfo = makeSessionInfo();
    const claudeOptions: AskClaudeOptions = { model: "claude-test" } as AskClaudeOptions;
    const response: ClaudeResponse = { success: true, answer: "done" };

    let getSessionCallCount = 0;
    mockGetSession.mockImplementation(async () => {
      getSessionCallCount++;
      // First call returns original, second returns updated
      return getSessionCallCount === 1 ? session : updatedSession;
    });
    mockRestoreSessionInfo.mockImplementation(async () => sessionInfo);
    mockFetchThreadContext.mockImplementation(async () => [
      { text: "msg", userId: "U001", isBot: false, ts: "1" },
    ]);
    mockGetHandlerClaudeOptions.mockImplementation(async () => claudeOptions);
    mockExecuteAndDeliver.mockImplementation(async () => response);

    const client = makeClient("B001");
    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "session-1", client });

    await handler(args);

    // Should have fetched thread context
    assert.equal(mockFetchThreadContext.mock.calls.length, 1);
    const fetchArgs = mockFetchThreadContext.mock.calls[0];
    assert.equal(fetchArgs[0], client);
    assert.equal(fetchArgs[1], "C001");
    assert.equal(fetchArgs[2], "1700000000.000001");
    assert.equal(fetchArgs[3], "B001");

    // Should have updated thread context
    assert.equal(mockUpdateThreadContext.mock.calls.length, 1);

    // Should have called executeAndDeliver with updated session
    assert.equal(mockExecuteAndDeliver.mock.calls.length, 1);
    const deliverArgs = mockExecuteAndDeliver.mock.calls[0][0];
    assert.equal(deliverArgs.client, client);
    assert.equal(deliverArgs.session, updatedSession);
    assert.equal(deliverArgs.sessionInfo, sessionInfo);
    assert.equal(deliverArgs.claudeOptions, claudeOptions);
  });

  it("passes fetchAndStoreUsername config to fetchThreadContext", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo();
    mockGetSession.mockImplementation(async () => session);
    mockRestoreSessionInfo.mockImplementation(async () => sessionInfo);
    mockFetchThreadContext.mockImplementation(async () => []);
    mockGetHandlerClaudeOptions.mockImplementation(async () => ({}) as AskClaudeOptions);

    mockGetConfig.mockImplementation(() =>
      stub<Config>({
        slack: {
          fetchAndStoreUsername: true,
        },
      }),
    );

    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "session-1", client: makeClient() });
    await handler(args);

    const fetchArgs = mockFetchThreadContext.mock.calls[0];
    assert.deepEqual(fetchArgs[4], { fetchUserNames: true });

    // Reset config
    mockGetConfig.mockImplementation(() =>
      stub<Config>({
        slack: {
          fetchAndStoreUsername: false,
        },
      }),
    );
  });

  it("acknowledges the action before processing", async () => {
    mockGetSession.mockImplementation(async () => null);
    mockRestoreSessionInfo.mockImplementation(async () => undefined);

    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "session-1", client: makeClient() });
    await handler(args);

    const [ackOrder] = args.ack.mock.invocationCallOrder;
    const [respondOrder] = args.respond.mock.invocationCallOrder;
    assert.ok(ackOrder < respondOrder, "ack should be called before respond");
  });

  it("gets handler claude options from sessionInfo", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo({ triggerType: "reactions" });
    mockGetSession.mockImplementation(async () => session);
    mockRestoreSessionInfo.mockImplementation(async () => sessionInfo);
    mockFetchThreadContext.mockImplementation(async () => []);
    mockGetHandlerClaudeOptions.mockImplementation(async () => ({}) as AskClaudeOptions);

    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "session-1", client: makeClient() });
    await handler(args);

    assert.equal(mockGetHandlerClaudeOptions.mock.calls.length, 1);
    assert.equal(mockGetHandlerClaudeOptions.mock.calls[0][0], sessionInfo);
  });

  it.each(["autoRespond", "threadReply", "channelReply"] as const)(
    "does not defer the progress surface when continuing a %s session",
    async (trigger) => {
      const session = makeSession();
      const sessionInfo = makeSessionInfo({ triggerType: trigger });

      mockGetSession.mockImplementation(async () => session);
      mockRestoreSessionInfo.mockImplementation(async () => sessionInfo);
      mockFetchThreadContext.mockImplementation(async () => []);
      mockGetHandlerClaudeOptions.mockImplementation(async () => stub<AskClaudeOptions>({}));

      const [, handler] = app.action.mock.calls[0];
      const args = createBlockActionArgs({ value: "session-1", client: makeClient() });
      await handler(args);

      assert.equal(mockExecuteAndDeliver.mock.calls.length, 1);
      const deliverArgs = mockExecuteAndDeliver.mock.calls[0][0];
      assert.equal(deliverArgs.deferProgress, undefined);
    },
  );
});
