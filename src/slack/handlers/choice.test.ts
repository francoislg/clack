import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { SessionContext } from "../../sessions.js";
import type { SessionInfo } from "../activeSessions.js";
import type { AskClaudeOptions } from "../../claude/index.js";
import type { UserRole } from "../../roles.js";
import { registerChoiceHandler, type ChoiceDeps } from "./choice.js";
import { createSlackClientMock, type MockSlackClient } from "../testSlackClient.js";
import { createSlackAppMock, createBlockActionArgs } from "../testBoltApp.js";

// ============================================================================
// Mocks
// ============================================================================

const mockGetSession = vi.fn<(id: string) => Promise<SessionContext | null>>();
const mockAppendUserMessage = vi.fn<ChoiceDeps["appendUserMessage"]>(async () => null);

const mockDecodeActionValue =
  vi.fn<(v: string) => { sessionId: string; choiceValue?: string; workMode?: boolean }>();
const mockRestoreSessionInfo = vi.fn<(id: string) => Promise<SessionInfo | undefined>>();

const mockExecuteAndDeliver = vi.fn<ChoiceDeps["executeAndDeliver"]>();
const mockGetHandlerClaudeOptions = vi.fn<(info: SessionInfo) => Promise<AskClaudeOptions>>();
const mockCanRequestChanges = vi.fn<(role: UserRole) => boolean>();

function makeDeps(): ChoiceDeps {
  return {
    decodeActionValue: mockDecodeActionValue,
    restoreSession: mockRestoreSessionInfo,
    getSession: mockGetSession,
    appendUserMessage: mockAppendUserMessage,
    getHandlerClaudeOptions: mockGetHandlerClaudeOptions,
    canRequestChanges: mockCanRequestChanges,
    executeAndDeliver: mockExecuteAndDeliver,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function makeApp(deps: ChoiceDeps) {
  const app = createSlackAppMock();
  registerChoiceHandler(app, deps);
  return app;
}

function makeClient(): MockSlackClient {
  return createSlackClientMock();
}

function makeSession(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "sess-1",
    channelId: "C001",
    messageTs: "1700000000.000001",
    threadTs: "1700000000.000001",
    userId: "U001",
    trigger: { type: "mentions", userId: "U001", messageTs: "1700000000.000001", messageText: "q" },
    messages: [],
    threadContext: [],
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
  mockAppendUserMessage.mockClear();
  mockDecodeActionValue.mockClear();
  mockRestoreSessionInfo.mockClear();
  mockExecuteAndDeliver.mockClear();
  mockGetHandlerClaudeOptions.mockClear();
  mockCanRequestChanges.mockClear();

  // Defaults
  mockGetHandlerClaudeOptions.mockImplementation(async () => ({
    role: "dev",
    changesWorkflowEnabled: false,
  }));
  mockCanRequestChanges.mockImplementation(() => true);

  app = makeApp(makeDeps());
});

// ============================================================================
// Tests
// ============================================================================

describe("registerChoiceHandler", () => {
  it("registers an action handler on the app", () => {
    const [, handler] = app.action.mock.calls[0];
    assert.ok(handler, "handler should have been registered");
  });

  it("returns early when choiceValue is missing", async () => {
    mockDecodeActionValue.mockImplementation(() => ({ sessionId: "sess-1" }));

    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "raw", client: makeClient() });
    await handler(args);

    assert.equal(mockRestoreSessionInfo.mock.calls.length, 0);
    assert.equal(mockExecuteAndDeliver.mock.calls.length, 0);
  });

  it("returns early when session info cannot be restored", async () => {
    mockDecodeActionValue.mockImplementation(() => ({
      sessionId: "sess-1",
      choiceValue: "option-a",
    }));
    mockRestoreSessionInfo.mockImplementation(async () => undefined);

    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "raw", client: makeClient() });
    await handler(args);

    assert.equal(mockGetSession.mock.calls.length, 0);
    assert.equal(mockExecuteAndDeliver.mock.calls.length, 0);
  });

  it("returns early when session is not found", async () => {
    mockDecodeActionValue.mockImplementation(() => ({
      sessionId: "sess-1",
      choiceValue: "option-a",
    }));
    mockRestoreSessionInfo.mockImplementation(async () => makeSessionInfo());
    mockGetSession.mockImplementation(async () => null);

    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "raw", client: makeClient() });
    await handler(args);

    assert.equal(mockExecuteAndDeliver.mock.calls.length, 0);
  });

  it("adds a refinement with the choice value and calls executeAndDeliver", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo();
    const updatedSession = makeSession({
      messages: [{ role: "user", source: "choice", text: "option-a", value: "option-a", ts: 1 }],
    });

    mockDecodeActionValue.mockImplementation(() => ({
      sessionId: "sess-1",
      choiceValue: "option-a",
    }));
    mockRestoreSessionInfo.mockImplementation(async () => sessionInfo);
    // First call returns original, second returns updated
    let callCount = 0;
    mockGetSession.mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? session : updatedSession;
    });

    const client = makeClient();
    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "raw", client });
    await handler(args);

    // unified-conversation-log: choice presses now append a structured user message
    // with source: "choice". The dual-write inside appendUserMessage still produces
    // "The user chose: ${text}" in the legacy refinements[] for prompt-builder parity.
    assert.equal(mockAppendUserMessage.mock.calls.length, 1);
    assert.equal(mockAppendUserMessage.mock.calls[0][0], "sess-1");
    const appended = mockAppendUserMessage.mock.calls[0][1];
    assert.equal(appended.source, "choice");
    assert.equal(appended.text, "option-a");
    assert.equal(appended.value, "option-a");

    assert.equal(mockExecuteAndDeliver.mock.calls.length, 1);
    const deliverArgs = mockExecuteAndDeliver.mock.calls[0][0];
    assert.equal(deliverArgs.client, client);
    assert.equal(deliverArgs.session, updatedSession);
    assert.equal(deliverArgs.sessionInfo, sessionInfo);
  });

  it("sets workMode false when workMode is not in the decoded value", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo();

    mockDecodeActionValue.mockImplementation(() => ({
      sessionId: "sess-1",
      choiceValue: "option-a",
    }));
    mockRestoreSessionInfo.mockImplementation(async () => sessionInfo);
    mockGetSession.mockImplementation(async () => session);
    mockGetHandlerClaudeOptions.mockImplementation(async () => ({
      role: "dev",
      changesWorkflowEnabled: true,
    }));

    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "raw", client: makeClient() });
    await handler(args);

    const deliverArgs = mockExecuteAndDeliver.mock.calls[0][0];
    const opts = deliverArgs.claudeOptions;
    assert.equal(opts.workMode, false);
  });

  it("sets workMode true when workMode is true, changes enabled, and user can request changes", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo();

    mockDecodeActionValue.mockImplementation(() => ({
      sessionId: "sess-1",
      choiceValue: "option-a",
      workMode: true,
    }));
    mockRestoreSessionInfo.mockImplementation(async () => sessionInfo);
    mockGetSession.mockImplementation(async () => session);
    mockGetHandlerClaudeOptions.mockImplementation(async () => ({
      role: "dev",
      changesWorkflowEnabled: true,
    }));
    mockCanRequestChanges.mockImplementation(() => true);

    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "raw", client: makeClient() });
    await handler(args);

    const deliverArgs = mockExecuteAndDeliver.mock.calls[0][0];
    const opts = deliverArgs.claudeOptions;
    assert.equal(opts.workMode, true);
  });

  it("sets workMode false when workMode is true but changesWorkflow is disabled", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo();

    mockDecodeActionValue.mockImplementation(() => ({
      sessionId: "sess-1",
      choiceValue: "option-a",
      workMode: true,
    }));
    mockRestoreSessionInfo.mockImplementation(async () => sessionInfo);
    mockGetSession.mockImplementation(async () => session);
    mockGetHandlerClaudeOptions.mockImplementation(async () => ({
      role: "dev",
      changesWorkflowEnabled: false,
    }));

    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "raw", client: makeClient() });
    await handler(args);

    const deliverArgs = mockExecuteAndDeliver.mock.calls[0][0];
    const opts = deliverArgs.claudeOptions;
    assert.equal(opts.workMode, false);
  });

  it("sets workMode false when user cannot request changes", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo();

    mockDecodeActionValue.mockImplementation(() => ({
      sessionId: "sess-1",
      choiceValue: "option-a",
      workMode: true,
    }));
    mockRestoreSessionInfo.mockImplementation(async () => sessionInfo);
    mockGetSession.mockImplementation(async () => session);
    mockGetHandlerClaudeOptions.mockImplementation(async () => ({
      role: "member",
      changesWorkflowEnabled: true,
    }));
    mockCanRequestChanges.mockImplementation(() => false);

    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "raw", client: makeClient() });
    await handler(args);

    const deliverArgs = mockExecuteAndDeliver.mock.calls[0][0];
    const opts = deliverArgs.claudeOptions;
    assert.equal(opts.workMode, false);
  });

  it.each(["autoRespond", "threadReply", "channelReply"] as const)(
    "does not defer the progress surface when continuing a %s session",
    async (trigger) => {
      const session = makeSession();
      const sessionInfo = makeSessionInfo({ triggerType: trigger });

      mockDecodeActionValue.mockImplementation(() => ({
        sessionId: "sess-1",
        choiceValue: "option-a",
      }));
      mockRestoreSessionInfo.mockImplementation(async () => sessionInfo);
      mockGetSession.mockImplementation(async () => session);

      const [, handler] = app.action.mock.calls[0];
      const args = createBlockActionArgs({ value: "raw", client: makeClient() });
      await handler(args);

      assert.equal(mockExecuteAndDeliver.mock.calls.length, 1);
      const deliverArgs = mockExecuteAndDeliver.mock.calls[0][0];
      assert.equal(deliverArgs.deferProgress, undefined);
    },
  );
});
