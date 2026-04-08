import { describe, it, mock, beforeEach } from "node:test";
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

const mockGetSession = mock.fn<(id: string) => Promise<SessionContext | null>>();
const mockAddRefinement = mock.fn<(id: string, text: string) => Promise<SessionContext | null>>(
  async () => null,
);

const mockDecodeActionValue =
  mock.fn<(v: string) => { sessionId: string; choiceValue?: string; workMode?: boolean }>();
const mockRestoreSessionInfo = mock.fn<(id: string) => Promise<SessionInfo | undefined>>();

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
const mockCanRequestChanges = mock.fn<(role: UserRole) => boolean>();

function makeDeps(): ChoiceDeps {
  return {
    decodeActionValue: mockDecodeActionValue,
    restoreSession: mockRestoreSessionInfo,
    getSession: mockGetSession,
    addRefinement: mockAddRefinement,
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
    originalQuestion: "q",
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
  mockAddRefinement.mock.resetCalls();
  mockDecodeActionValue.mock.resetCalls();
  mockRestoreSessionInfo.mock.resetCalls();
  mockExecuteAndDeliver.mock.resetCalls();
  mockGetHandlerClaudeOptions.mock.resetCalls();
  mockCanRequestChanges.mock.resetCalls();

  // Defaults
  mockGetHandlerClaudeOptions.mock.mockImplementation(async () => ({
    role: "dev",
    changesWorkflowEnabled: false,
  }));
  mockCanRequestChanges.mock.mockImplementation(() => true);

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
    mockDecodeActionValue.mock.mockImplementation(() => ({ sessionId: "sess-1" }));

    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client: makeClient(),
    });

    assert.equal(mockRestoreSessionInfo.mock.callCount(), 0);
    assert.equal(mockExecuteAndDeliver.mock.callCount(), 0);
  });

  it("returns early when session info cannot be restored", async () => {
    mockDecodeActionValue.mock.mockImplementation(() => ({
      sessionId: "sess-1",
      choiceValue: "option-a",
    }));
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);

    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client: makeClient(),
    });

    assert.equal(mockGetSession.mock.callCount(), 0);
    assert.equal(mockExecuteAndDeliver.mock.callCount(), 0);
  });

  it("returns early when session is not found", async () => {
    mockDecodeActionValue.mock.mockImplementation(() => ({
      sessionId: "sess-1",
      choiceValue: "option-a",
    }));
    mockRestoreSessionInfo.mock.mockImplementation(async () => makeSessionInfo());
    mockGetSession.mock.mockImplementation(async () => null);

    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client: makeClient(),
    });

    assert.equal(mockExecuteAndDeliver.mock.callCount(), 0);
  });

  it("adds a refinement with the choice value and calls executeAndDeliver", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo();
    const updatedSession = makeSession({ refinements: ["The user chose: option-a"] });

    mockDecodeActionValue.mock.mockImplementation(() => ({
      sessionId: "sess-1",
      choiceValue: "option-a",
    }));
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);
    // First call returns original, second returns updated
    let callCount = 0;
    mockGetSession.mock.mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? session : updatedSession;
    });

    const client = makeClient();
    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client,
    });

    assert.equal(mockAddRefinement.mock.callCount(), 1);
    assert.equal(mockAddRefinement.mock.calls[0].arguments[0], "sess-1");
    assert.equal(mockAddRefinement.mock.calls[0].arguments[1], "The user chose: option-a");

    assert.equal(mockExecuteAndDeliver.mock.callCount(), 1);
    const deliverArgs = mockExecuteAndDeliver.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(deliverArgs.client, client);
    assert.equal(deliverArgs.session, updatedSession);
    assert.equal(deliverArgs.sessionInfo, sessionInfo);
  });

  it("sets workMode false when workMode is not in the decoded value", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo();

    mockDecodeActionValue.mock.mockImplementation(() => ({
      sessionId: "sess-1",
      choiceValue: "option-a",
    }));
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);
    mockGetSession.mock.mockImplementation(async () => session);
    mockGetHandlerClaudeOptions.mock.mockImplementation(async () => ({
      role: "dev",
      changesWorkflowEnabled: true,
    }));

    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client: makeClient(),
    });

    const deliverArgs = mockExecuteAndDeliver.mock.calls[0].arguments[0] as Record<string, unknown>;
    const opts = deliverArgs.claudeOptions as AskClaudeOptions;
    assert.equal(opts.workMode, false);
  });

  it("sets workMode true when workMode is true, changes enabled, and user can request changes", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo();

    mockDecodeActionValue.mock.mockImplementation(() => ({
      sessionId: "sess-1",
      choiceValue: "option-a",
      workMode: true,
    }));
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);
    mockGetSession.mock.mockImplementation(async () => session);
    mockGetHandlerClaudeOptions.mock.mockImplementation(async () => ({
      role: "dev",
      changesWorkflowEnabled: true,
    }));
    mockCanRequestChanges.mock.mockImplementation(() => true);

    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client: makeClient(),
    });

    const deliverArgs = mockExecuteAndDeliver.mock.calls[0].arguments[0] as Record<string, unknown>;
    const opts = deliverArgs.claudeOptions as AskClaudeOptions;
    assert.equal(opts.workMode, true);
  });

  it("sets workMode false when workMode is true but changesWorkflow is disabled", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo();

    mockDecodeActionValue.mock.mockImplementation(() => ({
      sessionId: "sess-1",
      choiceValue: "option-a",
      workMode: true,
    }));
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);
    mockGetSession.mock.mockImplementation(async () => session);
    mockGetHandlerClaudeOptions.mock.mockImplementation(async () => ({
      role: "dev",
      changesWorkflowEnabled: false,
    }));

    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client: makeClient(),
    });

    const deliverArgs = mockExecuteAndDeliver.mock.calls[0].arguments[0] as Record<string, unknown>;
    const opts = deliverArgs.claudeOptions as AskClaudeOptions;
    assert.equal(opts.workMode, false);
  });

  it("sets workMode false when user cannot request changes", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo();

    mockDecodeActionValue.mock.mockImplementation(() => ({
      sessionId: "sess-1",
      choiceValue: "option-a",
      workMode: true,
    }));
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);
    mockGetSession.mock.mockImplementation(async () => session);
    mockGetHandlerClaudeOptions.mock.mockImplementation(async () => ({
      role: "member",
      changesWorkflowEnabled: true,
    }));
    mockCanRequestChanges.mock.mockImplementation(() => false);

    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client: makeClient(),
    });

    const deliverArgs = mockExecuteAndDeliver.mock.calls[0].arguments[0] as Record<string, unknown>;
    const opts = deliverArgs.claudeOptions as AskClaudeOptions;
    assert.equal(opts.workMode, false);
  });
});
