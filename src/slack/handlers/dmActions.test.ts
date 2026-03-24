import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import type { SessionContext } from "../../sessions.js";
import type { SessionInfo } from "../activeSessions.js";

// ============================================================================
// Mocks — set up before importing the module under test
// ============================================================================

const mockGetSession = mock.fn<(id: string) => Promise<SessionContext | null>>(async () => null);
const mockUpdateSession = mock.fn<(id: string, updates: Partial<SessionContext>) => Promise<SessionContext | null>>(async () => null);
const mockSetLastAnswer = mock.fn<(id: string, answer: string) => Promise<SessionContext | null>>(async () => null);

const mockRestoreSessionInfo = mock.fn<(id: string) => Promise<SessionInfo | undefined>>(async () => undefined);
const mockSetSessionInfo = mock.fn<(id: string, info: SessionInfo) => void>();

mock.module("../../sessions.js", {
  namedExports: {
    getSession: mockGetSession,
    updateSession: mockUpdateSession,
    setLastAnswer: mockSetLastAnswer,
  },
});

mock.module("../activeSessions.js", {
  namedExports: {
    activeSessions: { restore: mockRestoreSessionInfo, set: mockSetSessionInfo },
  },
});

mock.module("../blocks.js", {
  namedExports: {
    decodeActionValue: (value: string) => {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === "object" && parsed.s) {
          return {
            sessionId: parsed.s,
            ref: parsed.r,
            targetChannel: parsed.c,
            targetThreadTs: parsed.t,
            snapshotId: parsed.sn,
          };
        }
      } catch {
        // plain string fallback
      }
      return { sessionId: value };
    },
    getAcceptedBlocks: (answer: string) => [{ type: "section", text: { type: "mrkdwn", text: answer } }],
    getStructuredAcceptedBlocks: (sections: Array<{ title?: string; body: string }>) =>
      sections.map((s) => ({ type: "section", text: { type: "mrkdwn", text: s.body } })),
    asSlackBlocks: (blocks: unknown[]) => blocks,
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

// Import after mocks are configured
const { registerDmActionHandlers } = await import("./dmActions.js");

// ============================================================================
// Helpers
// ============================================================================

function makeClient(): App["client"] {
  return {
    chat: {
      postMessage: mock.fn(async () => ({ ok: true, ts: "1700000001.000001" })),
      postEphemeral: mock.fn(async () => ({ ok: true })),
      update: mock.fn(async () => ({ ok: true })),
    },
    views: {
      open: mock.fn(async () => ({ ok: true })),
    },
  } as unknown as App["client"];
}

function mockPostMessage(client: App["client"]) {
  return client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
}

function mockPostEphemeral(client: App["client"]) {
  return client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
}

function mockChatUpdate(client: App["client"]) {
  return client.chat.update as unknown as ReturnType<typeof mock.fn>;
}

function mockViewsOpen(client: App["client"]) {
  return (client as unknown as { views: { open: ReturnType<typeof mock.fn> } }).views.open;
}

/** Encode an action value the same way blocks.ts does */
function encodeValue(sessionId: string, extras?: Record<string, unknown>): string {
  return JSON.stringify({ s: sessionId, ...extras });
}

function makeSession(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: "session-1",
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
    lastAnswer: "The answer is 42.",
    ...overrides,
  };
}

function makeSessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    channelId: "C001",
    threadTs: "1700000000.000001",
    userId: "U001",
    originChannel: "C_ORIGIN",
    originThreadTs: "1700000000.000099",
    ...overrides,
  };
}

/**
 * Capture registered action/view handlers by calling registerDmActionHandlers
 * with a fake App. Returns a map of actionId -> handler.
 */
type ActionHandler = (ctx: { ack: () => Promise<void>; body: BlockAction; client: App["client"] }) => Promise<void>;
type ViewHandler = (ctx: { ack: () => Promise<void>; view: ViewSubmitAction["view"]; client: App["client"] }) => Promise<void>;

function captureHandlers() {
  const actionHandlers = new Map<string | RegExp, ActionHandler>();
  const viewHandlers = new Map<string, ViewHandler>();

  const fakeApp = {
    action: mock.fn((actionIdOrPattern: string | RegExp, handler: ActionHandler) => {
      actionHandlers.set(actionIdOrPattern instanceof RegExp ? actionIdOrPattern : actionIdOrPattern, handler);
    }),
    view: mock.fn((callbackId: string, handler: ViewHandler) => {
      viewHandlers.set(callbackId, handler);
    }),
  } as unknown as App;

  registerDmActionHandlers(fakeApp);

  return { actionHandlers, viewHandlers };
}

function findHandler(handlers: Map<string | RegExp, ActionHandler>, actionId: string): ActionHandler {
  // Try exact match first
  const exact = handlers.get(actionId);
  if (exact) return exact;

  // Try regex match
  for (const [key, handler] of handlers) {
    if (key instanceof RegExp && key.test(actionId)) return handler;
  }
  throw new Error(`No handler found for action: ${actionId}`);
}

function makeBlockAction(actionId: string, value: string, overrides: Partial<BlockAction> = {}): BlockAction {
  return {
    type: "block_actions",
    trigger_id: "trigger-123",
    user: { id: "U001", username: "testuser", name: "Test User", team_id: "T001" },
    channel: { id: "C_DM", name: "dm" },
    actions: [{ action_id: actionId, value, type: "button" }],
    ...overrides,
  } as unknown as BlockAction;
}

const { actionHandlers, viewHandlers } = captureHandlers();

beforeEach(() => {
  mockGetSession.mock.resetCalls();
  mockUpdateSession.mock.resetCalls();
  mockSetLastAnswer.mock.resetCalls();
  mockRestoreSessionInfo.mock.resetCalls();
  mockSetSessionInfo.mock.resetCalls();

  // Reset implementations to defaults
  mockGetSession.mock.mockImplementation(async () => null);
  mockUpdateSession.mock.mockImplementation(async () => null);
  mockSetLastAnswer.mock.mockImplementation(async () => null);
  mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);
});

// ============================================================================
// Registration
// ============================================================================

describe("registerDmActionHandlers — registration", () => {
  it("registers all expected action handlers", () => {
    const actionKeys = [...actionHandlers.keys()];
    // Check for regex handler for send_to_thread
    const hasRegex = actionKeys.some((k) => k instanceof RegExp && k.test("clack_dm_send_to_thread_0"));
    assert.ok(hasRegex, "should register a regex handler for clack_dm_send_to_thread_N");

    // Check string-based handlers
    const stringKeys = actionKeys.filter((k) => typeof k === "string") as string[];
    assert.ok(stringKeys.includes("clack_dm_accept_synthesis"));
    assert.ok(stringKeys.includes("clack_dm_edit_synthesis"));
    assert.ok(stringKeys.includes("clack_dm_reject"));
    assert.ok(stringKeys.includes("clack_dm_update_post"));
    assert.ok(stringKeys.includes("clack_dm_post_new"));
  });

  it("registers the edit synthesis modal view handler", () => {
    assert.ok(viewHandlers.has("dm_edit_synthesis_modal"));
  });
});

// ============================================================================
// resolveActionSession (tested through handlers)
// ============================================================================

describe("resolveActionSession — missing session", () => {
  it("posts ephemeral error when session is not found", async () => {
    mockGetSession.mock.mockImplementation(async () => null);
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_accept_synthesis");
    const body = makeBlockAction("clack_dm_accept_synthesis", encodeValue("missing-session"));

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockPostEphemeral(client).mock.callCount(), 1);
    const args = mockPostEphemeral(client).mock.calls[0].arguments[0] as Record<string, string>;
    assert.equal(args.user, "U001");
    assert.ok(args.text.includes("expired"));
  });

  it("skips ephemeral error when channel is missing", async () => {
    mockGetSession.mock.mockImplementation(async () => null);
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_accept_synthesis");
    const body = makeBlockAction("clack_dm_accept_synthesis", encodeValue("missing-session"), {
      channel: undefined,
    } as unknown as Partial<BlockAction>);

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockPostEphemeral(client).mock.callCount(), 0);
  });
});

// ============================================================================
// handleSendToThread
// ============================================================================

describe("handleSendToThread", () => {
  it("posts answer to the target channel with snapshot content", async () => {
    const session = makeSession({
      snapshots: {
        "snap-1": { text: "snapshot answer", sections: [{ body: "snapshot body" }] },
      },
    });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_send_to_thread_0");
    const value = encodeValue("session-1", { c: "C_TARGET", t: "17.001", sn: "snap-1" });
    const body = makeBlockAction("clack_dm_send_to_thread_0", value);

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockPostMessage(client).mock.callCount(), 2); // postAnswerToChannel + confirmInDm
    const postArgs = mockPostMessage(client).mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(postArgs.channel, "C_TARGET");
    assert.equal(postArgs.thread_ts, "17.001");
    assert.equal(postArgs.text, "snapshot answer");
  });

  it("returns early when snapshot not found (no fallback to lastAnswer)", async () => {
    const session = makeSession({ lastAnswer: "fallback answer" });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_send_to_thread_0");
    const value = encodeValue("session-1"); // no snapshotId → no snapshot found
    const body = makeBlockAction("clack_dm_send_to_thread_0", value);

    await handler({ ack: async () => {}, body, client });

    // Should NOT post anything — no fallback to lastAnswer
    assert.equal(mockPostMessage(client).mock.callCount(), 0);
  });

  it("resolves target channel from origin when not in button value", async () => {
    const session = makeSession({
      snapshots: {
        "snap-1": { text: "the answer", sections: [{ body: "the answer" }] },
      },
    });
    const sessionInfo = makeSessionInfo({ originChannel: "C_ORIGIN_CHAN", originThreadTs: "17.orig" });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_send_to_thread_0");
    const value = encodeValue("session-1", { sn: "snap-1" }); // no targetChannel, has snapshot
    const body = makeBlockAction("clack_dm_send_to_thread_0", value);

    await handler({ ack: async () => {}, body, client });

    const postArgs = mockPostMessage(client).mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(postArgs.channel, "C_ORIGIN_CHAN");
    assert.equal(postArgs.thread_ts, "17.orig");
  });

  it("persists channelPostTs after successful post", async () => {
    const session = makeSession({
      snapshots: {
        "snap-1": { text: "the answer", sections: [{ body: "the answer" }] },
      },
    });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_send_to_thread_0");
    const value = encodeValue("session-1", { c: "C_TARGET", sn: "snap-1" });
    const body = makeBlockAction("clack_dm_send_to_thread_0", value);

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockUpdateSession.mock.callCount(), 1);
    const updateArgs = mockUpdateSession.mock.calls[0].arguments;
    assert.equal(updateArgs[0], "session-1");
    assert.deepEqual(updateArgs[1], { channelPostTs: "1700000001.000001" });

    assert.equal(mockSetSessionInfo.mock.callCount(), 1);
  });

  it("sends confirmation in DM after posting", async () => {
    const session = makeSession({
      dmChannel: "D_DM",
      dmThreadTs: "17.dm",
      snapshots: {
        "snap-1": { text: "the answer", sections: [{ body: "the answer" }] },
      },
    });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_send_to_thread_0");
    const value = encodeValue("session-1", { c: "C_TARGET", sn: "snap-1" });
    const body = makeBlockAction("clack_dm_send_to_thread_0", value);

    await handler({ ack: async () => {}, body, client });

    // Second postMessage call is the DM confirmation
    const confirmArgs = mockPostMessage(client).mock.calls[1].arguments[0] as Record<string, unknown>;
    assert.equal(confirmArgs.channel, "D_DM");
    assert.equal(confirmArgs.thread_ts, "17.dm");
    assert.ok((confirmArgs.text as string).includes("shared"));
  });

  it("returns early when no target channel", async () => {
    const session = makeSession({
      channelId: undefined as unknown as string,
      assistantCurrentChannelId: undefined,
      snapshots: {
        "snap-1": { text: "the answer", sections: [{ body: "the answer" }] },
      },
    });
    const sessionInfo = makeSessionInfo({
      originChannel: undefined,
      originThreadTs: undefined,
    });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_send_to_thread_0");
    const value = encodeValue("session-1", { sn: "snap-1" });
    const body = makeBlockAction("clack_dm_send_to_thread_0", value);

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockPostMessage(client).mock.callCount(), 0);
  });

  it("posts error message on failure", async () => {
    const session = makeSession({
      dmChannel: "D_DM",
      dmThreadTs: "17.dm",
      snapshots: {
        "snap-1": { text: "the answer", sections: [{ body: "the answer" }] },
      },
    });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    // Make the first postMessage (to channel) throw, but allow subsequent calls
    let callCount = 0;
    mockPostMessage(client).mock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("channel_not_found");
      return { ok: true };
    });

    const handler = findHandler(actionHandlers, "clack_dm_send_to_thread_0");
    const value = encodeValue("session-1", { c: "C_TARGET", sn: "snap-1" });
    const body = makeBlockAction("clack_dm_send_to_thread_0", value);

    await handler({ ack: async () => {}, body, client });

    // Second call is the error message in DM
    assert.ok(mockPostMessage(client).mock.callCount() >= 2);
    const errorArgs = mockPostMessage(client).mock.calls[1].arguments[0] as Record<string, unknown>;
    assert.equal(errorArgs.channel, "D_DM");
    assert.ok((errorArgs.text as string).includes("Failed to post"));
  });
});

// ============================================================================
// handleAcceptSynthesis
// ============================================================================

describe("handleAcceptSynthesis", () => {
  it("posts answer to the origin channel", async () => {
    const session = makeSession({ lastAnswer: "Final answer" });
    const sessionInfo = makeSessionInfo({ originChannel: "C_ORIGIN", originThreadTs: "17.orig" });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_accept_synthesis");
    const body = makeBlockAction("clack_dm_accept_synthesis", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    const postArgs = mockPostMessage(client).mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(postArgs.channel, "C_ORIGIN");
    assert.equal(postArgs.thread_ts, "17.orig");
    assert.equal(postArgs.text, "Final answer");
  });

  it("falls back to assistantCurrentChannelId when no origin channel", async () => {
    const session = makeSession({
      lastAnswer: "Final answer",
      assistantCurrentChannelId: "C_ASSIST",
    });
    const sessionInfo = makeSessionInfo({ originChannel: undefined, originThreadTs: undefined });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_accept_synthesis");
    const body = makeBlockAction("clack_dm_accept_synthesis", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    const postArgs = mockPostMessage(client).mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(postArgs.channel, "C_ASSIST");
  });

  it("persists channelPostTs on success", async () => {
    const session = makeSession({ lastAnswer: "answer" });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_accept_synthesis");
    const body = makeBlockAction("clack_dm_accept_synthesis", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockUpdateSession.mock.callCount(), 1);
  });

  it("sends DM confirmation after posting", async () => {
    const session = makeSession({
      lastAnswer: "answer",
      dmChannel: "D_DM",
      dmThreadTs: "17.dm",
    });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_accept_synthesis");
    const body = makeBlockAction("clack_dm_accept_synthesis", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    const confirmArgs = mockPostMessage(client).mock.calls[1].arguments[0] as Record<string, unknown>;
    assert.equal(confirmArgs.channel, "D_DM");
    assert.ok((confirmArgs.text as string).includes("posted to the channel"));
  });

  it("returns early when answer is missing", async () => {
    const session = makeSession({ lastAnswer: undefined });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_accept_synthesis");
    const body = makeBlockAction("clack_dm_accept_synthesis", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockPostMessage(client).mock.callCount(), 0);
  });

  it("returns early when no target channel", async () => {
    const session = makeSession({
      lastAnswer: "answer",
      assistantCurrentChannelId: undefined,
    });
    const sessionInfo = makeSessionInfo({ originChannel: undefined });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_accept_synthesis");
    const body = makeBlockAction("clack_dm_accept_synthesis", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockPostMessage(client).mock.callCount(), 0);
  });
});

// ============================================================================
// handleEditSynthesis
// ============================================================================

describe("handleEditSynthesis", () => {
  it("opens edit modal with session lastAnswer as initial value", async () => {
    const session = makeSession({ lastAnswer: "Editable answer" });
    mockGetSession.mock.mockImplementation(async () => session);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_edit_synthesis");
    // edit_synthesis uses plain sessionId as value (not encoded JSON)
    const body = makeBlockAction("clack_dm_edit_synthesis", "session-1");

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockViewsOpen(client).mock.callCount(), 1);
    const viewArgs = mockViewsOpen(client).mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(viewArgs.trigger_id, "trigger-123");

    const view = viewArgs.view as Record<string, unknown>;
    assert.equal(view.callback_id, "dm_edit_synthesis_modal");
    assert.equal(view.private_metadata, "session-1");

    const blocks = view.blocks as Array<Record<string, unknown>>;
    const inputBlock = blocks[0] as Record<string, unknown>;
    const element = inputBlock.element as Record<string, string>;
    assert.equal(element.initial_value, "Editable answer");
  });

  it("posts ephemeral error when session has no answer", async () => {
    const session = makeSession({ lastAnswer: undefined });
    mockGetSession.mock.mockImplementation(async () => session);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_edit_synthesis");
    const body = makeBlockAction("clack_dm_edit_synthesis", "session-1");

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockViewsOpen(client).mock.callCount(), 0);
    assert.equal(mockPostEphemeral(client).mock.callCount(), 1);
    const args = mockPostEphemeral(client).mock.calls[0].arguments[0] as Record<string, string>;
    assert.ok(args.text.includes("expired"));
  });

  it("posts ephemeral error when session not found", async () => {
    mockGetSession.mock.mockImplementation(async () => null);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_edit_synthesis");
    const body = makeBlockAction("clack_dm_edit_synthesis", "session-1");

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockViewsOpen(client).mock.callCount(), 0);
    assert.equal(mockPostEphemeral(client).mock.callCount(), 1);
  });

  it("skips ephemeral error when channel is missing", async () => {
    mockGetSession.mock.mockImplementation(async () => null);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_edit_synthesis");
    const body = makeBlockAction("clack_dm_edit_synthesis", "session-1", {
      channel: undefined,
    } as unknown as Partial<BlockAction>);

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockPostEphemeral(client).mock.callCount(), 0);
  });
});

// ============================================================================
// handleEditSynthesisSubmit (view handler)
// ============================================================================

describe("handleEditSynthesisSubmit", () => {
  it("posts edited answer to original channel", async () => {
    const session = makeSession({
      dmChannel: "D_DM",
      dmThreadTs: "17.dm",
    });
    const sessionInfo = makeSessionInfo({ originChannel: "C_ORIGIN", originThreadTs: "17.orig" });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const viewHandler = viewHandlers.get("dm_edit_synthesis_modal")!;
    const view = {
      private_metadata: "session-1",
      state: {
        values: {
          synthesis_content_block: {
            synthesis_content: { value: "Edited text" },
          },
        },
      },
    } as unknown as ViewSubmitAction["view"];

    await viewHandler({ ack: async () => {}, view, client });

    // Should call setLastAnswer
    assert.equal(mockSetLastAnswer.mock.callCount(), 1);
    assert.equal(mockSetLastAnswer.mock.calls[0].arguments[0], "session-1");
    assert.equal(mockSetLastAnswer.mock.calls[0].arguments[1], "Edited text");

    // Should post to original channel
    const postArgs = mockPostMessage(client).mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(postArgs.channel, "C_ORIGIN");
    assert.equal(postArgs.thread_ts, "17.orig");
    assert.equal(postArgs.text, "Edited text");
  });

  it("persists channelPostTs after posting", async () => {
    const session = makeSession({ dmChannel: "D_DM", dmThreadTs: "17.dm" });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const viewHandler = viewHandlers.get("dm_edit_synthesis_modal")!;
    const view = {
      private_metadata: "session-1",
      state: {
        values: {
          synthesis_content_block: {
            synthesis_content: { value: "Edited" },
          },
        },
      },
    } as unknown as ViewSubmitAction["view"];

    await viewHandler({ ack: async () => {}, view, client });

    assert.equal(mockUpdateSession.mock.callCount(), 1);
    assert.equal(mockSetSessionInfo.mock.callCount(), 1);
  });

  it("sends DM confirmation after posting edited answer", async () => {
    const session = makeSession({ dmChannel: "D_DM", dmThreadTs: "17.dm" });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const viewHandler = viewHandlers.get("dm_edit_synthesis_modal")!;
    const view = {
      private_metadata: "session-1",
      state: {
        values: {
          synthesis_content_block: {
            synthesis_content: { value: "Edited" },
          },
        },
      },
    } as unknown as ViewSubmitAction["view"];

    await viewHandler({ ack: async () => {}, view, client });

    // Second call is DM confirmation
    const confirmArgs = mockPostMessage(client).mock.calls[1].arguments[0] as Record<string, unknown>;
    assert.equal(confirmArgs.channel, "D_DM");
    assert.ok((confirmArgs.text as string).includes("Edited answer posted"));
  });

  it("returns early when session is missing", async () => {
    mockGetSession.mock.mockImplementation(async () => null);
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);

    const client = makeClient();
    const viewHandler = viewHandlers.get("dm_edit_synthesis_modal")!;
    const view = {
      private_metadata: "session-1",
      state: {
        values: {
          synthesis_content_block: {
            synthesis_content: { value: "Edited" },
          },
        },
      },
    } as unknown as ViewSubmitAction["view"];

    await viewHandler({ ack: async () => {}, view, client });

    assert.equal(mockPostMessage(client).mock.callCount(), 0);
    assert.equal(mockSetLastAnswer.mock.callCount(), 0);
  });

  it("returns early when edited answer is null", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const viewHandler = viewHandlers.get("dm_edit_synthesis_modal")!;
    const view = {
      private_metadata: "session-1",
      state: {
        values: {
          synthesis_content_block: {
            synthesis_content: { value: null },
          },
        },
      },
    } as unknown as ViewSubmitAction["view"];

    await viewHandler({ ack: async () => {}, view, client });

    assert.equal(mockPostMessage(client).mock.callCount(), 0);
  });

  it("returns early when origin info is missing", async () => {
    const session = makeSession();
    const sessionInfo = makeSessionInfo({ originChannel: undefined, originThreadTs: undefined });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const viewHandler = viewHandlers.get("dm_edit_synthesis_modal")!;
    const view = {
      private_metadata: "session-1",
      state: {
        values: {
          synthesis_content_block: {
            synthesis_content: { value: "Edited" },
          },
        },
      },
    } as unknown as ViewSubmitAction["view"];

    await viewHandler({ ack: async () => {}, view, client });

    // setLastAnswer should not be called since origin check happens before
    assert.equal(mockPostMessage(client).mock.callCount(), 0);
  });
});

// ============================================================================
// handleReject
// ============================================================================

describe("handleReject", () => {
  it("posts discard confirmation in DM", async () => {
    const session = makeSession({ dmChannel: "D_DM", dmThreadTs: "17.dm" });
    mockGetSession.mock.mockImplementation(async () => session);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_reject");
    const body = makeBlockAction("clack_dm_reject", "session-1");

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockPostMessage(client).mock.callCount(), 1);
    const msgArgs = mockPostMessage(client).mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(msgArgs.channel, "D_DM");
    assert.equal(msgArgs.thread_ts, "17.dm");
    assert.ok((msgArgs.text as string).includes("discarded"));
  });

  it("does not post when dmChannel is missing", async () => {
    const session = makeSession({ dmChannel: undefined, dmThreadTs: undefined });
    mockGetSession.mock.mockImplementation(async () => session);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_reject");
    const body = makeBlockAction("clack_dm_reject", "session-1");

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockPostMessage(client).mock.callCount(), 0);
  });

  it("does not crash when session is null", async () => {
    mockGetSession.mock.mockImplementation(async () => null);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_reject");
    const body = makeBlockAction("clack_dm_reject", "session-1");

    // Should not throw
    await handler({ ack: async () => {}, body, client });

    assert.equal(mockPostMessage(client).mock.callCount(), 0);
  });
});

// ============================================================================
// handleUpdatePost
// ============================================================================

describe("handleUpdatePost", () => {
  it("updates existing channel message with latest answer", async () => {
    const session = makeSession({
      lastAnswer: "Updated answer",
      channelPostTs: "17.posted",
    });
    const sessionInfo = makeSessionInfo({ originChannel: "C_ORIGIN" });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_update_post");
    const body = makeBlockAction("clack_dm_update_post", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockChatUpdate(client).mock.callCount(), 1);
    const updateArgs = mockChatUpdate(client).mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(updateArgs.channel, "C_ORIGIN");
    assert.equal(updateArgs.ts, "17.posted");
    assert.equal(updateArgs.text, "Updated answer");
  });

  it("sends DM confirmation after updating", async () => {
    const session = makeSession({
      lastAnswer: "Updated",
      channelPostTs: "17.posted",
      dmChannel: "D_DM",
      dmThreadTs: "17.dm",
    });
    const sessionInfo = makeSessionInfo({ originChannel: "C_ORIGIN" });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_update_post");
    const body = makeBlockAction("clack_dm_update_post", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    const confirmArgs = mockPostMessage(client).mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(confirmArgs.channel, "D_DM");
    assert.ok((confirmArgs.text as string).includes("updated"));
  });

  it("returns early when answer is missing", async () => {
    const session = makeSession({ lastAnswer: undefined, channelPostTs: "17.posted" });
    const sessionInfo = makeSessionInfo({ originChannel: "C_ORIGIN" });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_update_post");
    const body = makeBlockAction("clack_dm_update_post", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockChatUpdate(client).mock.callCount(), 0);
  });

  it("returns early when channelPostTs is missing", async () => {
    const session = makeSession({ lastAnswer: "answer", channelPostTs: undefined });
    const sessionInfo = makeSessionInfo({ originChannel: "C_ORIGIN", channelPostTs: undefined });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_update_post");
    const body = makeBlockAction("clack_dm_update_post", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockChatUpdate(client).mock.callCount(), 0);
  });

  it("returns early when origin channel is missing", async () => {
    const session = makeSession({ lastAnswer: "answer", channelPostTs: "17.posted" });
    const sessionInfo = makeSessionInfo({ originChannel: undefined });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_update_post");
    const body = makeBlockAction("clack_dm_update_post", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockChatUpdate(client).mock.callCount(), 0);
  });

  it("uses session channelPostTs when sessionInfo has none", async () => {
    const session = makeSession({
      lastAnswer: "Updated",
      channelPostTs: "17.from-session",
    });
    const sessionInfo = makeSessionInfo({ originChannel: "C_ORIGIN", channelPostTs: undefined });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_update_post");
    const body = makeBlockAction("clack_dm_update_post", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    const updateArgs = mockChatUpdate(client).mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(updateArgs.ts, "17.from-session");
  });
});

// ============================================================================
// handlePostNew
// ============================================================================

describe("handlePostNew", () => {
  it("posts new reply to original thread", async () => {
    const session = makeSession({ lastAnswer: "New reply" });
    const sessionInfo = makeSessionInfo({ originChannel: "C_ORIGIN", originThreadTs: "17.orig" });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_post_new");
    const body = makeBlockAction("clack_dm_post_new", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    const postArgs = mockPostMessage(client).mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(postArgs.channel, "C_ORIGIN");
    assert.equal(postArgs.thread_ts, "17.orig");
    assert.equal(postArgs.text, "New reply");
    assert.equal(postArgs.unfurl_links, false);
  });

  it("persists channelPostTs on success", async () => {
    const session = makeSession({ lastAnswer: "Reply" });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_post_new");
    const body = makeBlockAction("clack_dm_post_new", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockUpdateSession.mock.callCount(), 1);
  });

  it("sends DM confirmation after posting new reply", async () => {
    const session = makeSession({
      lastAnswer: "Reply",
      dmChannel: "D_DM",
      dmThreadTs: "17.dm",
    });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_post_new");
    const body = makeBlockAction("clack_dm_post_new", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    const confirmArgs = mockPostMessage(client).mock.calls[1].arguments[0] as Record<string, unknown>;
    assert.equal(confirmArgs.channel, "D_DM");
    assert.ok((confirmArgs.text as string).includes("New reply posted"));
  });

  it("returns early when answer is missing", async () => {
    const session = makeSession({ lastAnswer: undefined });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_post_new");
    const body = makeBlockAction("clack_dm_post_new", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockPostMessage(client).mock.callCount(), 0);
  });

  it("returns early when origin channel is missing", async () => {
    const session = makeSession({ lastAnswer: "answer" });
    const sessionInfo = makeSessionInfo({ originChannel: undefined, originThreadTs: undefined });
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_post_new");
    const body = makeBlockAction("clack_dm_post_new", encodeValue("session-1"));

    await handler({ ack: async () => {}, body, client });

    assert.equal(mockPostMessage(client).mock.callCount(), 0);
  });
});

// ============================================================================
// postAnswerToChannel — structured sections via snapshot
// ============================================================================

describe("postAnswerToChannel — structured sections", () => {
  it("uses structured blocks when snapshot has sections", async () => {
    const session = makeSession({
      snapshots: {
        "snap-struct": {
          text: "The answer",
          sections: [{ title: "Summary", body: "Structured body" }],
        },
      },
    });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_send_to_thread_0");
    const value = encodeValue("session-1", { c: "C_TARGET", sn: "snap-struct" });
    const body = makeBlockAction("clack_dm_send_to_thread_0", value);

    await handler({ ack: async () => {}, body, client });

    assert.ok(mockPostMessage(client).mock.callCount() >= 1);
    const postArgs = mockPostMessage(client).mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(postArgs.channel, "C_TARGET");
    assert.equal(postArgs.text, "The answer");
    // blocks should come from snapshot.sections via getStructuredAcceptedBlocks
    const blocks = postArgs.blocks as Array<Record<string, unknown>>;
    assert.ok(blocks.length > 0);
  });

  it("uses snapshot sections for blocks when snapshot is provided", async () => {
    const session = makeSession({
      snapshots: {
        "snap-2": {
          text: "snapshot text",
          sections: [{ body: "Snap section content" }],
        },
      },
    });
    const sessionInfo = makeSessionInfo();
    mockGetSession.mock.mockImplementation(async () => session);
    mockRestoreSessionInfo.mock.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = findHandler(actionHandlers, "clack_dm_send_to_thread_0");
    const value = encodeValue("session-1", { c: "C_TARGET", sn: "snap-2" });
    const body = makeBlockAction("clack_dm_send_to_thread_0", value);

    await handler({ ack: async () => {}, body, client });

    const postArgs = mockPostMessage(client).mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(postArgs.text, "snapshot text");
    // blocks should come from snapshot.sections via getStructuredAcceptedBlocks
    const blocks = postArgs.blocks as Array<Record<string, unknown>>;
    assert.ok(blocks.length > 0);
  });
});
