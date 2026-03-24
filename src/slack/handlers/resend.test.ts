import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { SessionInfo } from "../activeSessions.js";
import type { SessionContext } from "../../sessions.js";

// ============================================================================
// Mocks — set up before importing the module under test
// ============================================================================

const mockGetSession = mock.fn<(sessionId: string) => Promise<SessionContext | null>>(async () => null);
const mockRestoreSessionInfo = mock.fn<(sessionId: string) => Promise<SessionInfo | undefined>>(async () => undefined);
const mockPostResponse = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const mockGetStructuredResponseBlocks = mock.fn<(...args: unknown[]) => Record<string, unknown>[]>(() => []);
const mockAsSlackBlocks = mock.fn<(blocks: Record<string, unknown>[]) => unknown[]>((blocks) => blocks);

mock.module("../../sessions.js", {
  namedExports: {
    getSession: mockGetSession,
  },
});

mock.module("../activeSessions.js", {
  namedExports: {
    activeSessions: { restore: mockRestoreSessionInfo },
  },
});

mock.module("./handlerResponse.js", {
  namedExports: {
    postResponse: mockPostResponse,
  },
});

mock.module("../blocks.js", {
  namedExports: {
    getStructuredResponseBlocks: mockGetStructuredResponseBlocks,
    asSlackBlocks: mockAsSlackBlocks,
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
const { registerResendHandler } = await import("./resend.js");

// ============================================================================
// Helpers
// ============================================================================

type ActionHandler = (args: {
  ack: () => Promise<void>;
  body: { actions: Array<{ value: string }>; channel?: { id: string } };
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

function makeClient(): App["client"] {
  const postMessageFn = mock.fn(async () => ({ ok: true }));
  return {
    chat: {
      postMessage: postMessageFn,
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
  mockRestoreSessionInfo.mock.resetCalls();
  mockPostResponse.mock.resetCalls();
  mockGetStructuredResponseBlocks.mock.resetCalls();
  mockAsSlackBlocks.mock.resetCalls();

  const app = makeApp();
  registerResendHandler(app);
});

// ============================================================================
// Tests
// ============================================================================

describe("registerResendHandler", () => {
  it("registers a clack_resend action handler", () => {
    assert.equal(capturedActionId, "clack_resend");
    assert.ok(capturedHandler, "handler should have been registered");
  });

  it("responds with expired message when session is not found", async () => {
    mockGetSession.mock.mockImplementation(async () => null);
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);
    const mockRespond = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const mockAck = mock.fn<() => Promise<void>>(async () => {});

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }], channel: { id: "C001" } },
      client: makeClient(),
      respond: mockRespond,
    });

    assert.equal(mockAck.mock.callCount(), 1);
    assert.equal(mockRespond.mock.callCount(), 1);
    const respondArgs = mockRespond.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.ok((respondArgs.text as string).includes("expired"));
    assert.equal(respondArgs.replace_original, true);
  });

  it("responds with expired message when sessionInfo is not found", async () => {
    mockGetSession.mock.mockImplementation(async () => makeSession());
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);
    const mockRespond = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const mockAck = mock.fn<() => Promise<void>>(async () => {});

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }], channel: { id: "C001" } },
      client: makeClient(),
      respond: mockRespond,
    });

    assert.equal(mockRespond.mock.callCount(), 1);
    const respondArgs = mockRespond.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.ok((respondArgs.text as string).includes("expired"));
  });

  it("responds with expired message when session has no lastAnswer", async () => {
    mockGetSession.mock.mockImplementation(async () => makeSession({ lastAnswer: undefined }));
    mockRestoreSessionInfo.mock.mockImplementation(async () => makeSessionInfo());
    const mockRespond = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const mockAck = mock.fn<() => Promise<void>>(async () => {});

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }], channel: { id: "C001" } },
      client: makeClient(),
      respond: mockRespond,
    });

    assert.equal(mockRespond.mock.callCount(), 1);
  });

  it("posts structured response with blocks when lastResponse exists", async () => {
    const session = makeSession({ lastAnswer: "plain answer", lastResponse: { sections: [], actions: [] } as unknown as SessionContext["lastResponse"] });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);
    mockGetStructuredResponseBlocks.mock.mockImplementation(() => [{ type: "section" }]);
    mockAsSlackBlocks.mock.mockImplementation((blocks) => blocks);

    const mockAck = mock.fn<() => Promise<void>>(async () => {});
    const mockRespond = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const client = makeClient();

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }], channel: { id: "C001" } },
      client,
      respond: mockRespond,
    });

    assert.equal(mockPostResponse.mock.callCount(), 1);
    const postArgs = mockPostResponse.mock.calls[0].arguments;
    assert.equal(postArgs[0], client);
    assert.equal(postArgs[1], sessionInfo);
    const options = postArgs[2] as { blocks: unknown[]; text: string };
    assert.ok(options.blocks);
    assert.equal(options.text, "plain answer");

    // Also posts confirmation message
    const postMessage = client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postMessage.mock.callCount(), 1);
    const msgArgs = postMessage.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(msgArgs.channel, "C001");
    assert.ok((msgArgs.text as string).includes("sent again"));
  });

  it("posts plain text when lastResponse is not present", async () => {
    const session = makeSession({ lastAnswer: "just text" });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const mockAck = mock.fn<() => Promise<void>>(async () => {});
    const mockRespond = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});
    const client = makeClient();

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }], channel: { id: "C001" } },
      client,
      respond: mockRespond,
    });

    assert.equal(mockPostResponse.mock.callCount(), 1);
    const options = mockPostResponse.mock.calls[0].arguments[2] as { blocks?: unknown[]; text: string };
    assert.equal(options.text, "just text");
    assert.equal(options.blocks, undefined);
  });

  it("acknowledges the action before processing", async () => {
    mockGetSession.mock.mockImplementation(async () => null);
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);

    const callOrder: string[] = [];
    const mockAck = mock.fn<() => Promise<void>>(async () => { callOrder.push("ack"); });
    const mockRespond = mock.fn<(...args: unknown[]) => Promise<void>>(async () => { callOrder.push("respond"); });

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }], channel: { id: "C001" } },
      client: makeClient(),
      respond: mockRespond,
    });

    assert.equal(callOrder[0], "ack");
  });
});
