import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { SessionContext } from "../../sessions.js";
import type { SessionInfo } from "../activeSessions.js";
import type { AskClaudeOptions, ClaudeResponse } from "../../claude/index.js";
import type { UserRole } from "../../roles.js";
import { registerChoiceHandler, type ChoiceDeps } from "./choice.js";

// ============================================================================
// Mocks
// ============================================================================

const mockGetSession = vi.fn<(id: string) => Promise<SessionContext | null>>();
const mockAppendUserMessage = vi.fn<ChoiceDeps["appendUserMessage"]>(async () => null);

const mockDecodeActionValue =
  vi.fn<(v: string) => { sessionId: string; choiceValue?: string; workMode?: boolean }>();
const mockRestoreSessionInfo = vi.fn<(id: string) => Promise<SessionInfo | undefined>>();

const mockExecuteAndDeliver =
  vi.fn<
    (params: {
      client: App["client"];
      session: SessionContext;
      sessionInfo: SessionInfo;
      claudeOptions: AskClaudeOptions;
    }) => Promise<ClaudeResponse>
  >();
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

type ActionHandler = (args: {
  ack: () => Promise<void>;
  body: { actions: Array<{ value: string }> };
  client: App["client"];
}) => Promise<void>;

let capturedHandler: ActionHandler;

function makeApp(deps: ChoiceDeps): App {
  const app = {
    action: (_pattern: unknown, handler: ActionHandler) => {
      capturedHandler = handler;
    },
  } as never as App;
  registerChoiceHandler(app, deps);
  return app;
}

function makeClient(): App["client"] {
  return {} as unknown as App["client"];
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

  // Register handler
  makeApp(makeDeps());
});

// ============================================================================
// Tests
// ============================================================================

describe("registerChoiceHandler", () => {
  it("registers an action handler on the app", () => {
    assert.ok(capturedHandler, "handler should have been registered");
  });

  it("returns early when choiceValue is missing", async () => {
    mockDecodeActionValue.mockImplementation(() => ({ sessionId: "sess-1" }));

    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client: makeClient(),
    });

    assert.equal(mockRestoreSessionInfo.mock.calls.length, 0);
    assert.equal(mockExecuteAndDeliver.mock.calls.length, 0);
  });

  it("returns early when session info cannot be restored", async () => {
    mockDecodeActionValue.mockImplementation(() => ({
      sessionId: "sess-1",
      choiceValue: "option-a",
    }));
    mockRestoreSessionInfo.mockImplementation(async () => undefined);

    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client: makeClient(),
    });

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

    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client: makeClient(),
    });

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
    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client,
    });

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
    const deliverArgs = mockExecuteAndDeliver.mock.calls[0][0] as Record<string, unknown>;
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

    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client: makeClient(),
    });

    const deliverArgs = mockExecuteAndDeliver.mock.calls[0][0] as Record<string, unknown>;
    const opts = deliverArgs.claudeOptions as AskClaudeOptions;
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

    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client: makeClient(),
    });

    const deliverArgs = mockExecuteAndDeliver.mock.calls[0][0] as Record<string, unknown>;
    const opts = deliverArgs.claudeOptions as AskClaudeOptions;
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

    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client: makeClient(),
    });

    const deliverArgs = mockExecuteAndDeliver.mock.calls[0][0] as Record<string, unknown>;
    const opts = deliverArgs.claudeOptions as AskClaudeOptions;
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

    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client: makeClient(),
    });

    const deliverArgs = mockExecuteAndDeliver.mock.calls[0][0] as Record<string, unknown>;
    const opts = deliverArgs.claudeOptions as AskClaudeOptions;
    assert.equal(opts.workMode, false);
  });
});
