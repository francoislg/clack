import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { SessionInfo } from "../activeSessions.js";
import type { SessionContext } from "../../sessions.js";
import { registerResendHandler, type ResendDeps } from "./resend.js";
import type { asSlackBlocks } from "../blocks.js";
import type { SubmitResponsePayload } from "../../tools/types.js";
import { createSlackClientMock, type MockSlackClient } from "../testSlackClient.js";
import { createSlackAppMock, createBlockActionArgs, respondedWith } from "../testBoltApp.js";

// ============================================================================
// Mocks
// ============================================================================

const mockGetSession = vi.fn<(sessionId: string) => Promise<SessionContext | null>>();
const mockRestoreSessionInfo = vi.fn<(sessionId: string) => Promise<SessionInfo | undefined>>();
const mockPostResponse = vi.fn<ResendDeps["postResponse"]>();
const mockGetStructuredResponseBlocks =
  vi.fn<(payload: SubmitResponsePayload, sessionId: string) => Array<{ type: string }>>();
const mockAsSlackBlocks = vi.fn<typeof asSlackBlocks>();

function makeDeps(): ResendDeps {
  return {
    getSession: mockGetSession,
    restoreSession: mockRestoreSessionInfo,
    postResponse: mockPostResponse,
    getStructuredResponseBlocks: mockGetStructuredResponseBlocks,
    asSlackBlocks: mockAsSlackBlocks,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function makeApp(deps: ResendDeps) {
  const app = createSlackAppMock();
  registerResendHandler(app, deps);
  return app;
}

function makeClient(): MockSlackClient {
  const client = createSlackClientMock();
  client.chat.postMessage.mockResolvedValue({ ok: true });
  return client;
}

function makeSession(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "session-1",
    channelId: "C001",
    messageTs: "1700000000.000001",
    threadTs: "1700000000.000001",
    userId: "U001",
    trigger: {
      type: "mentions",
      userId: "U001",
      messageTs: "1700000000.000001",
      messageText: "test question",
    },
    messages: [{ role: "assistant", ts: 1, text: "past answer" }],
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
  mockRestoreSessionInfo.mockClear();
  mockPostResponse.mockClear();
  mockGetStructuredResponseBlocks.mockClear();
  mockAsSlackBlocks.mockClear();

  app = makeApp(makeDeps());
});

// ============================================================================
// Tests
// ============================================================================

describe("registerResendHandler", () => {
  it("registers a clack_resend action handler", () => {
    const [constraints, handler] = app.action.mock.calls[0];
    assert.equal(constraints, "clack_resend");
    assert.ok(handler, "handler should have been registered");
  });

  it("responds with expired message when session is not found", async () => {
    mockGetSession.mockImplementation(async () => null);
    mockRestoreSessionInfo.mockImplementation(async () => undefined);

    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({
      value: "session-1",
      channelId: "C001",
      client: makeClient(),
    });
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
    const args = createBlockActionArgs({
      value: "session-1",
      channelId: "C001",
      client: makeClient(),
    });
    await handler(args);

    assert.equal(args.respond.mock.calls.length, 1);
    const responded = respondedWith(args);
    assert.ok(responded?.text?.includes("expired"));
  });

  it("responds with expired message when session has no lastAnswer", async () => {
    // Session with no assistant turn — latestAssistantText returns undefined.
    mockGetSession.mockImplementation(async () =>
      makeSession({
        messages: [],
      }),
    );
    mockRestoreSessionInfo.mockImplementation(async () => makeSessionInfo());

    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({
      value: "session-1",
      channelId: "C001",
      client: makeClient(),
    });
    await handler(args);

    assert.equal(args.respond.mock.calls.length, 1);
  });

  it("posts structured response with blocks when lastResponse exists", async () => {
    const session = makeSession({
      messages: [
        { role: "assistant", ts: 1, text: "plain answer", payload: { blocks: [], actions: [] } },
      ],
    });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mockImplementation(async () => session);
    mockRestoreSessionInfo.mockImplementation(async () => sessionInfo);
    mockGetStructuredResponseBlocks.mockImplementation(() => [{ type: "section" }]);
    mockAsSlackBlocks.mockImplementation(() => []);

    const client = makeClient();
    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "session-1", channelId: "C001", client });

    await handler(args);

    assert.equal(mockPostResponse.mock.calls.length, 1);
    const postArgs = mockPostResponse.mock.calls[0];
    assert.equal(postArgs[0], client);
    assert.equal(postArgs[1], sessionInfo);
    const options = postArgs[2];
    assert.ok(options.blocks);
    assert.equal(options.text, "plain answer");

    // Also posts confirmation message
    assert.equal(client.chat.postMessage.mock.calls.length, 1);
    const msgArgs = client.chat.postMessage.mock.calls[0][0];
    assert.equal(msgArgs.channel, "C001");
    assert.ok("text" in msgArgs && msgArgs.text?.includes("sent again"));
  });

  it("posts plain text when lastResponse is not present", async () => {
    const session = makeSession({
      messages: [{ role: "assistant", ts: 1, text: "just text" }],
    });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mockImplementation(async () => session);
    mockRestoreSessionInfo.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({ value: "session-1", channelId: "C001", client });

    await handler(args);

    assert.equal(mockPostResponse.mock.calls.length, 1);
    const options = mockPostResponse.mock.calls[0][2];
    assert.equal(options.text, "just text");
    assert.equal(options.blocks, undefined);
  });

  it("acknowledges the action before processing", async () => {
    mockGetSession.mockImplementation(async () => null);
    mockRestoreSessionInfo.mockImplementation(async () => undefined);

    const [, handler] = app.action.mock.calls[0];
    const args = createBlockActionArgs({
      value: "session-1",
      channelId: "C001",
      client: makeClient(),
    });
    await handler(args);

    const [ackOrder] = args.ack.mock.invocationCallOrder;
    const [respondOrder] = args.respond.mock.invocationCallOrder;
    assert.ok(ackOrder < respondOrder, "ack should be called before respond");
  });
});
