import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { SessionContext } from "../../sessions.js";
import type { SessionInfo } from "../activeSessions.js";
import type { AskClaudeOptions } from "../../claude/index.js";
import { registerFollowupHandler, type FollowupDeps } from "./followup.js";

// ============================================================================
// Helpers
// ============================================================================

const mockGetSession = mock.fn<(id: string) => Promise<SessionContext | null>>();
const mockAddRefinement = mock.fn<(id: string, text: string) => Promise<SessionContext | null>>(
  async () => null,
);

const mockDecodeActionValue = mock.fn<(v: string) => { sessionId: string; prompt?: string }>();
const mockRestoreSessionInfo = mock.fn<(id: string) => Promise<SessionInfo | undefined>>();

const mockExecuteAndDeliver = mock.fn<(...args: never[]) => Promise<void>>(async () => {});
const mockGetHandlerClaudeOptions = mock.fn<(info: SessionInfo) => Promise<AskClaudeOptions>>();

function makeDeps(): FollowupDeps {
  return {
    getSession: mockGetSession,
    addRefinement: mockAddRefinement,
    decodeActionValue: mockDecodeActionValue as never,
    restoreSession: mockRestoreSessionInfo,
    executeAndDeliver: mockExecuteAndDeliver as never,
    getHandlerClaudeOptions: mockGetHandlerClaudeOptions,
  };
}

type ActionHandler = (args: {
  ack: () => Promise<void>;
  body: { actions: Array<{ value: string }> };
  client: App["client"];
}) => Promise<void>;

let capturedHandler: ActionHandler;

function makeApp(): App {
  return {
    action: (_pattern: never, handler: ActionHandler) => {
      capturedHandler = handler;
    },
  } as App;
}

function makeClient(): App["client"] {
  return {} as App["client"];
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

  // Defaults
  mockGetHandlerClaudeOptions.mock.mockImplementation(async () => ({
    role: "dev",
    changesWorkflowEnabled: false,
  }));

  // Register handler
  const app = makeApp();
  registerFollowupHandler(app, makeDeps());
});

// ============================================================================
// Tests
// ============================================================================

describe("registerFollowupHandler", () => {
  it("registers an action handler on the app", () => {
    assert.ok(capturedHandler, "handler should have been registered");
  });

  it("returns early when prompt is missing", async () => {
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
      prompt: "tell me more",
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
      prompt: "tell me more",
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

  it("adds the prompt as a refinement and calls executeAndDeliver", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo();
    const updatedSession = makeSession({ refinements: ["tell me more"] });
    const claudeOptions: AskClaudeOptions = { role: "dev", changesWorkflowEnabled: false };

    mockDecodeActionValue.mock.mockImplementation(() => ({
      sessionId: "sess-1",
      prompt: "tell me more",
    }));
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);
    // First call returns original, second returns updated
    let callCount = 0;
    mockGetSession.mock.mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? session : updatedSession;
    });
    mockGetHandlerClaudeOptions.mock.mockImplementation(async () => claudeOptions);

    const client = makeClient();
    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "raw" }] },
      client,
    });

    // Check addRefinement was called with the prompt text
    assert.equal(mockAddRefinement.mock.callCount(), 1);
    assert.equal(mockAddRefinement.mock.calls[0]!.arguments[0], "sess-1");
    assert.equal(mockAddRefinement.mock.calls[0]!.arguments[1], "tell me more");

    // Check executeAndDeliver was called with updated session
    assert.equal(mockExecuteAndDeliver.mock.callCount(), 1);
    interface DeliverCallArgs {
      client: App["client"];
      session: SessionContext;
      sessionInfo: SessionInfo;
      claudeOptions: AskClaudeOptions;
    }
    const deliverArgs = mockExecuteAndDeliver.mock.calls[0]!.arguments[0] as DeliverCallArgs;
    assert.equal(deliverArgs.client, client);
    assert.equal(deliverArgs.session, updatedSession);
    assert.equal(deliverArgs.sessionInfo, sessionInfo);
    assert.equal(deliverArgs.claudeOptions, claudeOptions);
  });

  it("calls ack immediately", async () => {
    mockDecodeActionValue.mock.mockImplementation(() => ({ sessionId: "sess-1" }));
    let acked = false;

    await capturedHandler({
      ack: async () => {
        acked = true;
      },
      body: { actions: [{ value: "raw" }] },
      client: makeClient(),
    });

    assert.equal(acked, true);
  });

  it("decodes the raw value from body.actions[0]", async () => {
    mockDecodeActionValue.mock.mockImplementation(() => ({ sessionId: "sess-1" }));

    await capturedHandler({
      ack: async () => {},
      body: { actions: [{ value: "encoded-json-payload" }] },
      client: makeClient(),
    });

    assert.equal(mockDecodeActionValue.mock.callCount(), 1);
    assert.equal(mockDecodeActionValue.mock.calls[0]!.arguments[0], "encoded-json-payload");
  });
});
