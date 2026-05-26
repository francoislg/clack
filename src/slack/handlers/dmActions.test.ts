import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import type { SessionContext } from "../../sessions.js";
import type { ResponseSnapshot } from "../../tools/types.js";
import type { SessionInfo } from "../activeSessions.js";
import type { DmActionsDeps } from "./dmActions.js";
import { postAnswerToChannel, resolveOrigin, registerDmActionHandlers } from "./dmActions.js";

/**
 * Polls `calls.length` until it reaches `expected`. Used by tests covering
 * fire-and-forget `addDeliveryReactions` — the helper has a 150ms delay between
 * adds, so tests can't assert call count synchronously.
 */
async function waitForReactionCalls(calls: { name: string }[], expected: number): Promise<void> {
  await vi.waitFor(() => assert.ok(calls.length >= expected));
}

// ============================================================================
// Type definitions for mocks
// ============================================================================

// ============================================================================
// Mocks
// ============================================================================

const mockGetSession = vi.fn<DmActionsDeps["getSession"]>();
const mockUpdateSession = vi.fn<DmActionsDeps["updateSession"]>();
const mockAppendAssistantMessage = vi.fn<DmActionsDeps["appendAssistantMessage"]>();
const mockRestoreSession = vi.fn<DmActionsDeps["restoreSession"]>();
const mockSetSessionInfo = vi.fn<DmActionsDeps["setSessionInfo"]>();
const mockDecodeActionValue = vi.fn<DmActionsDeps["decodeActionValue"]>();
const mockGetStructuredAcceptedBlocks = vi.fn<DmActionsDeps["getStructuredAcceptedBlocks"]>();
const mockAsSlackBlocks = vi.fn<DmActionsDeps["asSlackBlocks"]>();

function makeDeps(): DmActionsDeps {
  return {
    getSession: mockGetSession,
    updateSession: mockUpdateSession,
    appendAssistantMessage: mockAppendAssistantMessage,
    restoreSession: mockRestoreSession,
    setSessionInfo: mockSetSessionInfo,
    decodeActionValue: mockDecodeActionValue,
    getStructuredAcceptedBlocks: mockGetStructuredAcceptedBlocks,
    asSlackBlocks: mockAsSlackBlocks,
  };
}

// ============================================================================
// Helpers
// ============================================================================

type BlockActionHandler = (args: {
  ack: () => Promise<void>;
  body: BlockAction;
  client: App["client"];
}) => Promise<void>;

type ViewSubmitHandler = (args: {
  ack: () => Promise<void>;
  view: ViewSubmitAction["view"];
  client: App["client"];
}) => Promise<void>;

let capturedBlockHandlers: Map<string, BlockActionHandler> = new Map();
let capturedViewHandlers: Map<string, ViewSubmitHandler> = new Map();

function makeApp(deps: DmActionsDeps): App {
  capturedBlockHandlers.clear();
  capturedViewHandlers.clear();

  const app = {
    action: (pattern: string | RegExp, handler: BlockActionHandler) => {
      const key = typeof pattern === "string" ? pattern : pattern.source;
      capturedBlockHandlers.set(key, handler);
    },
    view: (id: string, handler: ViewSubmitHandler) => {
      capturedViewHandlers.set(id, handler);
    },
  } as never as App;

  registerDmActionHandlers(app, deps);
  return app;
}

let mockPostMessage: ReturnType<typeof vi.fn<(...args: any[]) => any>>;

function makeChatApi(): App["client"]["chat"] {
  const postMessageFn = vi.fn<() => Promise<{ ts?: string }>>(async () => ({
    ts: "1700.999",
  }));
  mockPostMessage = postMessageFn;
  const postEphemeralFn = vi.fn<() => Promise<{ ok?: boolean }>>(async () => ({ ok: true }));
  const updateFn = vi.fn<() => Promise<{ ok?: boolean }>>(async () => ({
    ok: true,
  }));

  return {
    postMessage: postMessageFn,
    postEphemeral: postEphemeralFn,
    update: updateFn,
  } as never as App["client"]["chat"];
}

function makeClient(): App["client"] {
  return {
    chat: makeChatApi(),
  } as never as App["client"];
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
    lastAnswer: "Test answer",
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

function makeSnapshot(overrides: Partial<ResponseSnapshot> = {}): ResponseSnapshot {
  return {
    text: "Answer text",
    blocks: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockGetSession.mockClear();
  mockUpdateSession.mockClear();
  mockAppendAssistantMessage.mockClear();
  mockRestoreSession.mockClear();
  mockSetSessionInfo.mockClear();
  mockDecodeActionValue.mockClear();
  mockGetStructuredAcceptedBlocks.mockClear();
  mockAsSlackBlocks.mockClear();

  mockGetStructuredAcceptedBlocks.mockImplementation(() => [
    { type: "section", text: { type: "mrkdwn", text: "answer" } },
  ]);
  mockAsSlackBlocks.mockImplementation((blocks) => blocks);
  mockDecodeActionValue.mockImplementation((v) => ({ sessionId: v }));
});

// ============================================================================
// postAnswerToChannel
// ============================================================================

describe("postAnswerToChannel", () => {
  it("posts message with empty-blocks snapshot", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const snapshot = makeSnapshot({ text: "My answer", blocks: [] });

    await postAnswerToChannel(client, snapshot, "C100", undefined, deps);

    assert.equal(mockGetStructuredAcceptedBlocks.mock.calls.length, 1);
  });

  it("posts message with structured snapshot blocks", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const blocks = [
      {
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: "Section 1" },
      },
    ];
    const snapshot = makeSnapshot({ text: "answer", blocks });

    await postAnswerToChannel(client, snapshot, "C100", undefined, deps);

    assert.equal(mockGetStructuredAcceptedBlocks.mock.calls.length, 1);
  });

  it("returns ts from postMessage response", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const snapshot = makeSnapshot();

    const result = await postAnswerToChannel(client, snapshot, "C100", undefined, deps);

    assert.equal(result.ok, true);
    assert.equal(result.ts, "1700.999");
  });

  it("omits unfurl flags when neither opts.suppressUnfurls nor snapshot.suppressUnfurls is set", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const snapshot = makeSnapshot();

    await postAnswerToChannel(client, snapshot, "C100", undefined, deps);

    const callArgs = mockPostMessage.mock.calls[0]![0] as {
      unfurl_links?: false;
      unfurl_media?: false;
    };
    assert.equal("unfurl_links" in callArgs, false);
    assert.equal("unfurl_media" in callArgs, false);
  });

  it("sets unfurl flags to false when opts.suppressUnfurls is true", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const snapshot = makeSnapshot();

    await postAnswerToChannel(client, snapshot, "C100", undefined, deps, {
      suppressUnfurls: true,
    });

    const callArgs = mockPostMessage.mock.calls[0]![0] as {
      unfurl_links?: false;
      unfurl_media?: false;
    };
    assert.equal(callArgs.unfurl_links, false);
    assert.equal(callArgs.unfurl_media, false);
  });

  it("sets unfurl flags to false when snapshot.suppressUnfurls is true (deferred button-click path)", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const snapshot = makeSnapshot({ suppressUnfurls: true });

    await postAnswerToChannel(client, snapshot, "C100", undefined, deps);

    const callArgs = mockPostMessage.mock.calls[0]![0] as {
      unfurl_links?: false;
      unfurl_media?: false;
    };
    assert.equal(callArgs.unfurl_links, false);
    assert.equal(callArgs.unfurl_media, false);
  });

  // -------------------------------------------------------------------------
  // post_to message-content parity: actions + reactions on cross-posted messages
  // -------------------------------------------------------------------------

  function attachReactionsMock(client: App["client"]): {
    calls: { channel: string; timestamp: string; name: string }[];
  } {
    const calls: { channel: string; timestamp: string; name: string }[] = [];
    const addFn = vi.fn(async (args: { channel: string; timestamp: string; name: string }) => {
      calls.push(args);
      return { ok: true as const };
    });
    // The fake client from makeClient() doesn't have `reactions` set, so attach
    // the full surface here. Real `App["client"]` has it; this mirrors that.
    Object.defineProperty(client, "reactions", {
      configurable: true,
      value: { add: addFn },
    });
    return { calls };
  }

  it("calls reactions.add once per emoji when opts.reactions is provided", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const { calls } = attachReactionsMock(client);

    const snapshot = makeSnapshot();
    await postAnswerToChannel(client, snapshot, "C100", undefined, deps, {
      reactions: ["white_check_mark", "thumbsup"],
    });

    // addDeliveryReactions is fire-and-forget with a 150ms delay between calls.
    await waitForReactionCalls(calls, 2);

    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((c) => c.name),
      ["white_check_mark", "thumbsup"],
    );
    assert.equal(calls[0].channel, "C100");
    assert.equal(calls[0].timestamp, "1700.999");
  });

  it("falls back to snapshot.reactions when opts.reactions is omitted", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const { calls } = attachReactionsMock(client);

    const snapshot = makeSnapshot({ reactions: ["eyes"] });
    await postAnswerToChannel(client, snapshot, "C100", undefined, deps);

    await waitForReactionCalls(calls, 1);

    assert.deepEqual(
      calls.map((c) => c.name),
      ["eyes"],
    );
  });

  it("does not call reactions.add when neither opts nor snapshot has reactions", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const { calls } = attachReactionsMock(client);

    const snapshot = makeSnapshot();
    await postAnswerToChannel(client, snapshot, "C100", undefined, deps);

    assert.equal(calls.length, 0);
  });

  it("appends rendered action buttons when opts.actions and sessionId are provided", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const snapshot = makeSnapshot();

    await postAnswerToChannel(client, snapshot, "C100", undefined, deps, {
      sessionId: "sess-99",
      actions: [{ type: "followup", label: "More?", prompt: "Tell me more" }],
    });

    // The postMessage call should have been invoked once with blocks containing
    // both the content blocks AND a rendered actions block whose button value
    // encodes the original session ID.
    assert.equal(mockPostMessage.mock.calls.length, 1);
    const postArgs = mockPostMessage.mock.calls[0][0] as {
      blocks: { type: string; elements?: { value?: string }[] }[];
    };
    const actionsBlock = postArgs.blocks.find((b) => b.type === "actions");
    assert.ok(actionsBlock, "expected an actions block on the cross-posted message");
    assert.ok(
      actionsBlock?.elements?.[0]?.value?.includes("sess-99"),
      `expected button value to encode session ID, got: ${JSON.stringify(actionsBlock?.elements)}`,
    );
  });

  it("does not append action buttons when actions are absent", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const snapshot = makeSnapshot();

    await postAnswerToChannel(client, snapshot, "C100", undefined, deps, {
      sessionId: "sess-99",
    });

    const postArgs = mockPostMessage.mock.calls[0][0] as {
      blocks: { type: string }[];
    };
    const actionsBlock = postArgs.blocks.find((b) => b.type === "actions");
    assert.equal(actionsBlock, undefined);
  });
});

// ============================================================================
// resolveOrigin
// ============================================================================

describe("resolveOrigin", () => {
  it("returns originChannel and originThreadTs from session when available", () => {
    const session = makeSession({
      originChannel: "C200",
      originThreadTs: "1700.002",
    });
    const sessionInfo = makeSessionInfo();

    const result = resolveOrigin(session, sessionInfo);

    assert.equal(result.originChannel, "C200");
    assert.equal(result.originThreadTs, "1700.002");
  });

  it("falls back to sessionInfo when session fields are undefined", () => {
    const session = makeSession({
      originChannel: undefined,
      originThreadTs: undefined,
    });
    const sessionInfo = makeSessionInfo({
      originChannel: "C300",
      originThreadTs: "1700.003",
    });

    const result = resolveOrigin(session, sessionInfo);

    assert.equal(result.originChannel, "C300");
    assert.equal(result.originThreadTs, "1700.003");
  });

  it("prefers session over sessionInfo when both have values", () => {
    const session = makeSession({
      originChannel: "C200",
      originThreadTs: "1700.002",
    });
    const sessionInfo = makeSessionInfo({
      originChannel: "C300",
      originThreadTs: "1700.003",
    });

    const result = resolveOrigin(session, sessionInfo);

    assert.equal(result.originChannel, "C200");
    assert.equal(result.originThreadTs, "1700.002");
  });
});

// ============================================================================
// registerDmActionHandlers
// ============================================================================

describe("registerDmActionHandlers", () => {
  it("registers post_to handler with regex pattern", () => {
    const deps = makeDeps();
    makeApp(deps);

    assert.ok(capturedBlockHandlers.has("^clack_post_to_\\d+$"));
  });

  it("registers backward compat handler with old action ID", () => {
    const deps = makeDeps();
    makeApp(deps);

    assert.ok(capturedBlockHandlers.has("^clack_dm_send_to_thread_\\d+$"));
  });

  it("registers dm_accept_synthesis handler", () => {
    const deps = makeDeps();
    makeApp(deps);

    assert.ok(capturedBlockHandlers.has("clack_dm_accept_synthesis"));
  });

  it("registers dm_edit_synthesis handler", () => {
    const deps = makeDeps();
    makeApp(deps);

    assert.ok(capturedBlockHandlers.has("clack_dm_edit_synthesis"));
  });

  it("registers dm_edit_synthesis_modal view handler", () => {
    const deps = makeDeps();
    makeApp(deps);

    assert.ok(capturedViewHandlers.has("dm_edit_synthesis_modal"));
  });

  it("registers dm_reject handler", () => {
    const deps = makeDeps();
    makeApp(deps);

    assert.ok(capturedBlockHandlers.has("clack_dm_reject"));
  });

  it("registers dm_update_post handler", () => {
    const deps = makeDeps();
    makeApp(deps);

    assert.ok(capturedBlockHandlers.has("clack_dm_update_post"));
  });

  it("registers dm_post_new handler", () => {
    const deps = makeDeps();
    makeApp(deps);

    assert.ok(capturedBlockHandlers.has("clack_dm_post_new"));
  });
});

// ============================================================================
// handlePostTo — legacy snapshot guard
// ============================================================================

describe("handlePostTo — legacy snapshot guard", () => {
  function makeBlockAction(value: string): BlockAction {
    return {
      type: "block_actions",
      trigger_id: "t1",
      user: { id: "U001", username: "user", name: "user", team_id: "T1" },
      channel: { id: "C001", name: "general" },
      actions: [
        {
          type: "button",
          action_id: "clack_post_to_0",
          value,
          block_id: "b",
          action_ts: "1",
        },
      ],
    } as BlockAction;
  }

  it("sends expiration DM when snapshot has legacy sections shape (no blocks)", async () => {
    const deps = makeDeps();
    makeApp(deps);

    // Simulate legacy persisted data: snapshots saved before the Block Kit
    // migration have { text, sections } but no `blocks` field. At runtime the
    // JSON loader returns whatever was on disk, so `blocks` is absent.
    const session = makeSession({ dmChannel: "D_DM", dmThreadTs: "17.01" });
    Object.assign(session, { snapshots: { snap1: { text: "old answer" } } });
    const sessionInfo = makeSessionInfo();

    mockDecodeActionValue.mockImplementation(() => ({
      sessionId: "sess-1",
      snapshotId: "snap1",
    }));
    mockGetSession.mockImplementation(async () => session);
    mockRestoreSession.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = capturedBlockHandlers.get("^clack_post_to_\\d+$")!;
    await handler({
      ack: async () => {},
      body: makeBlockAction("sess-1"),
      client,
    });

    // Should NOT have called getStructuredAcceptedBlocks (no post attempted)
    assert.equal(mockGetStructuredAcceptedBlocks.mock.calls.length, 0);

    // Should have sent the expiration DM via postMessage (confirmInDm path)
    const postCalls = mockPostMessage.mock.calls;
    assert.ok(postCalls.length >= 1, "expected at least one postMessage call");
    const lastCall = postCalls[postCalls.length - 1][0] as {
      text: string;
    };
    assert.ok(
      lastCall.text.includes("older response"),
      `expected expiration message, got: ${lastCall.text}`,
    );
  });

  it("proceeds normally when snapshot has current blocks shape", async () => {
    const deps = makeDeps();
    makeApp(deps);

    const currentSnapshot = makeSnapshot({
      text: "current answer",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "current answer" } }],
    });
    const session = makeSession({
      snapshots: { snap1: currentSnapshot },
      originChannel: "C100",
      originThreadTs: "17.02",
    } as Partial<SessionContext>);
    const sessionInfo = makeSessionInfo();

    mockDecodeActionValue.mockImplementation(() => ({
      sessionId: "sess-1",
      snapshotId: "snap1",
    }));
    mockGetSession.mockImplementation(async () => session);
    mockRestoreSession.mockImplementation(async () => sessionInfo);

    const client = makeClient();
    const handler = capturedBlockHandlers.get("^clack_post_to_\\d+$")!;
    await handler({
      ack: async () => {},
      body: makeBlockAction("sess-1"),
      client,
    });

    // Should have called getStructuredAcceptedBlocks (post went through)
    assert.equal(mockGetStructuredAcceptedBlocks.mock.calls.length, 1);
  });
});

// ============================================================================
// isCurrentSnapshot
// ============================================================================

describe("isCurrentSnapshot (via postAnswerToChannel)", () => {
  it("treats a snapshot with blocks as current", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const snapshot = makeSnapshot({
      text: "answer",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "answer" } }],
    });

    await postAnswerToChannel(client, snapshot, "C100", undefined, deps);

    assert.equal(mockGetStructuredAcceptedBlocks.mock.calls.length, 1);
  });
});
