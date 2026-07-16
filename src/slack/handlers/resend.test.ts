import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { SessionInfo } from "../activeSessions.js";
import type { SessionContext } from "../../sessions.js";
import { registerResendHandler, type ResendDeps } from "./resend.js";
import type { SlackBlocks, asSlackBlocks } from "../blocks.js";
import type { SubmitResponsePayload } from "../../tools/types.js";

// ============================================================================
// Mocks
// ============================================================================

const mockGetSession = vi.fn<(sessionId: string) => Promise<SessionContext | null>>();
const mockRestoreSessionInfo = vi.fn<(sessionId: string) => Promise<SessionInfo | undefined>>();
const mockPostResponse =
  vi.fn<
    (
      client: App["client"],
      sessionInfo: SessionInfo,
      options: { blocks?: SlackBlocks; text: string },
    ) => Promise<void>
  >();
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

type ActionHandler = (args: {
  ack: () => Promise<void>;
  body: { actions: Array<{ value: string }>; channel?: { id: string } };
  client: App["client"];
  respond: (msg: { replace_original?: boolean; text: string }) => Promise<void>;
}) => Promise<void>;

let capturedHandler: ActionHandler;
let capturedActionId: string;

function makeApp(deps: ResendDeps): App {
  const app = {
    action: (actionId: string, handler: ActionHandler) => {
      capturedActionId = actionId;
      capturedHandler = handler;
    },
  } as never as App;
  registerResendHandler(app, deps);
  return app;
}

function makeClient(): App["client"] {
  const postMessageFn = vi.fn(async () => ({ ok: true }));
  return {
    chat: {
      postMessage: postMessageFn,
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

beforeEach(() => {
  mockGetSession.mockClear();
  mockRestoreSessionInfo.mockClear();
  mockPostResponse.mockClear();
  mockGetStructuredResponseBlocks.mockClear();
  mockAsSlackBlocks.mockClear();

  makeApp(makeDeps());
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
    mockGetSession.mockImplementation(async () => null);
    mockRestoreSessionInfo.mockImplementation(async () => undefined);
    const mockRespond = vi.fn<(msg: { replace_original?: boolean; text: string }) => Promise<void>>(
      async () => {},
    );
    const mockAck = vi.fn<() => Promise<void>>(async () => {});

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }], channel: { id: "C001" } },
      client: makeClient(),
      respond: mockRespond,
    });

    assert.equal(mockAck.mock.calls.length, 1);
    assert.equal(mockRespond.mock.calls.length, 1);
    const respondArgs = mockRespond.mock.calls[0][0];
    assert.ok(respondArgs.text.includes("expired"));
    assert.equal(respondArgs.replace_original, true);
  });

  it("responds with expired message when sessionInfo is not found", async () => {
    mockGetSession.mockImplementation(async () => makeSession());
    mockRestoreSessionInfo.mockImplementation(async () => undefined);
    const mockRespond = vi.fn<(msg: { replace_original?: boolean; text: string }) => Promise<void>>(
      async () => {},
    );
    const mockAck = vi.fn<() => Promise<void>>(async () => {});

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }], channel: { id: "C001" } },
      client: makeClient(),
      respond: mockRespond,
    });

    assert.equal(mockRespond.mock.calls.length, 1);
    const respondArgs = mockRespond.mock.calls[0][0];
    assert.ok(respondArgs.text.includes("expired"));
  });

  it("responds with expired message when session has no lastAnswer", async () => {
    // Session with no assistant turn — latestAssistantText returns undefined.
    mockGetSession.mockImplementation(async () =>
      makeSession({
        messages: [],
      }),
    );
    mockRestoreSessionInfo.mockImplementation(async () => makeSessionInfo());
    const mockRespond = vi.fn<(msg: { replace_original?: boolean; text: string }) => Promise<void>>(
      async () => {},
    );
    const mockAck = vi.fn<() => Promise<void>>(async () => {});

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }], channel: { id: "C001" } },
      client: makeClient(),
      respond: mockRespond,
    });

    assert.equal(mockRespond.mock.calls.length, 1);
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

    const mockAck = vi.fn<() => Promise<void>>(async () => {});
    const mockRespond = vi.fn<(msg: { replace_original?: boolean; text: string }) => Promise<void>>(
      async () => {},
    );
    const client = makeClient();

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }], channel: { id: "C001" } },
      client,
      respond: mockRespond,
    });

    assert.equal(mockPostResponse.mock.calls.length, 1);
    const postArgs = mockPostResponse.mock.calls[0];
    assert.equal(postArgs[0], client);
    assert.equal(postArgs[1], sessionInfo);
    const options = postArgs[2];
    assert.ok(options.blocks);
    assert.equal(options.text, "plain answer");

    // Also posts confirmation message
    const postMessage = client.chat.postMessage as never as ReturnType<
      typeof vi.fn<(...args: any[]) => any>
    >;
    assert.equal(postMessage.mock.calls.length, 1);
    const msgArgs = postMessage.mock.calls[0][0] as { channel: string; text: string };
    assert.equal(msgArgs.channel, "C001");
    assert.ok(msgArgs.text.includes("sent again"));
  });

  it("posts plain text when lastResponse is not present", async () => {
    const session = makeSession({
      messages: [{ role: "assistant", ts: 1, text: "just text" }],
    });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mockImplementation(async () => session);
    mockRestoreSessionInfo.mockImplementation(async () => sessionInfo);

    const mockAck = vi.fn<() => Promise<void>>(async () => {});
    const mockRespond = vi.fn<(msg: { replace_original?: boolean; text: string }) => Promise<void>>(
      async () => {},
    );
    const client = makeClient();

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }], channel: { id: "C001" } },
      client,
      respond: mockRespond,
    });

    assert.equal(mockPostResponse.mock.calls.length, 1);
    const options = mockPostResponse.mock.calls[0][2];
    assert.equal(options.text, "just text");
    assert.equal(options.blocks, undefined);
  });

  it("acknowledges the action before processing", async () => {
    mockGetSession.mockImplementation(async () => null);
    mockRestoreSessionInfo.mockImplementation(async () => undefined);

    const callOrder: string[] = [];
    const mockAck = vi.fn<() => Promise<void>>(async () => {
      callOrder.push("ack");
    });
    const mockRespond = vi.fn<(msg: { replace_original?: boolean; text: string }) => Promise<void>>(
      async () => {
        callOrder.push("respond");
      },
    );

    await capturedHandler({
      ack: mockAck,
      body: { actions: [{ value: "session-1" }], channel: { id: "C001" } },
      client: makeClient(),
      respond: mockRespond,
    });

    assert.equal(callOrder[0], "ack");
  });
});
