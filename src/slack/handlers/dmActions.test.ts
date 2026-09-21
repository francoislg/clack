import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { SessionContext } from "../../sessions.js";
import type { ResponseSnapshot } from "../../tools/types.js";
import type { SessionInfo } from "../activeSessions.js";
import type { DmActionsDeps } from "./dmActions.js";
import { postAnswerToChannel, resolveOrigin, registerDmActionHandlers } from "./dmActions.js";
import { createSlackClientMock, type MockSlackClient } from "../testSlackClient.js";
import { createBlockActionArgs, createSlackAppMock, type MockSlackApp } from "../testBoltApp.js";

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

function makeApp(deps: DmActionsDeps): MockSlackApp {
  const app = createSlackAppMock();
  registerDmActionHandlers(app, deps);
  return app;
}

/** Find a registered `app.action(...)` call by its pattern (string, or a regex's `.source`). */
function findAction(app: MockSlackApp, key: string) {
  return app.action.mock.calls.find(([pattern]) => {
    if (typeof pattern === "string") return pattern === key;
    if (pattern instanceof RegExp) return pattern.source === key;
    return false;
  });
}

/** Find a registered `app.view(...)` call by its callback ID. */
function findView(app: MockSlackApp, callbackId: string) {
  return app.view.mock.calls.find(([id]) => id === callbackId);
}

function makeClient(): MockSlackClient {
  const client = createSlackClientMock();
  client.chat.postMessage.mockResolvedValue({ ok: true, ts: "1700.999", channel: "C100" });
  client.chat.postEphemeral.mockResolvedValue({ ok: true });
  client.chat.update.mockResolvedValue({ ok: true });
  return client;
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

    const callArgs = client.chat.postMessage.mock.calls[0]![0];
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

    const callArgs = client.chat.postMessage.mock.calls[0]![0];
    assert.equal(callArgs.unfurl_links, false);
    assert.equal(callArgs.unfurl_media, false);
  });

  it("sets unfurl flags to false when snapshot.suppressUnfurls is true (deferred button-click path)", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const snapshot = makeSnapshot({ suppressUnfurls: true });

    await postAnswerToChannel(client, snapshot, "C100", undefined, deps);

    const callArgs = client.chat.postMessage.mock.calls[0]![0];
    assert.equal(callArgs.unfurl_links, false);
    assert.equal(callArgs.unfurl_media, false);
  });

  // -------------------------------------------------------------------------
  // post_to message-content parity: actions + reactions on cross-posted messages
  // -------------------------------------------------------------------------

  function attachReactionsMock(client: MockSlackClient): {
    calls: { channel: string; timestamp: string; name: string }[];
  } {
    const calls: { channel: string; timestamp: string; name: string }[] = [];
    client.reactions.add.mockImplementation(async (args) => {
      calls.push({ channel: args.channel, timestamp: args.timestamp, name: args.name });
      return { ok: true };
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
    assert.equal(client.chat.postMessage.mock.calls.length, 1);
    const postArgs = client.chat.postMessage.mock.calls[0][0];
    if (!("blocks" in postArgs)) throw new Error("expected a blocks-based postMessage call");
    const actionsBlock = postArgs.blocks.find((b) => b.type === "actions");
    assert.ok(actionsBlock, "expected an actions block on the cross-posted message");
    const firstElement =
      actionsBlock && "elements" in actionsBlock ? actionsBlock.elements[0] : undefined;
    const value = firstElement && "value" in firstElement ? firstElement.value : undefined;
    assert.ok(
      value?.includes("sess-99"),
      `expected button value to encode session ID, got: ${JSON.stringify(actionsBlock && "elements" in actionsBlock ? actionsBlock.elements : undefined)}`,
    );
  });

  it("does not append action buttons when actions are absent", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const snapshot = makeSnapshot();

    await postAnswerToChannel(client, snapshot, "C100", undefined, deps, {
      sessionId: "sess-99",
    });

    const postArgs = client.chat.postMessage.mock.calls[0][0];
    if (!("blocks" in postArgs)) throw new Error("expected a blocks-based postMessage call");
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
    const app = makeApp(makeDeps());

    assert.ok(findAction(app, "^clack_post_to_\\d+$"));
  });

  it("registers backward compat handler with old action ID", () => {
    const app = makeApp(makeDeps());

    assert.ok(findAction(app, "^clack_dm_send_to_thread_\\d+$"));
  });

  it("registers dm_accept_synthesis handler", () => {
    const app = makeApp(makeDeps());

    assert.ok(findAction(app, "clack_dm_accept_synthesis"));
  });

  it("registers dm_edit_synthesis handler", () => {
    const app = makeApp(makeDeps());

    assert.ok(findAction(app, "clack_dm_edit_synthesis"));
  });

  it("registers dm_edit_synthesis_modal view handler", () => {
    const app = makeApp(makeDeps());

    assert.ok(findView(app, "dm_edit_synthesis_modal"));
  });

  it("registers dm_reject handler", () => {
    const app = makeApp(makeDeps());

    assert.ok(findAction(app, "clack_dm_reject"));
  });

  it("registers dm_update_post handler", () => {
    const app = makeApp(makeDeps());

    assert.ok(findAction(app, "clack_dm_update_post"));
  });

  it("registers dm_post_new handler", () => {
    const app = makeApp(makeDeps());

    assert.ok(findAction(app, "clack_dm_post_new"));
  });
});

// ============================================================================
// handlePostTo — legacy snapshot guard
// ============================================================================

describe("handlePostTo — legacy snapshot guard", () => {
  /** Read the `^clack_post_to_\d+$` handler back off the mocked app. */
  function getPostToHandler(app: MockSlackApp) {
    const found = findAction(app, "^clack_post_to_\\d+$");
    assert.ok(found, "expected the post_to handler to be registered");
    const [, handler] = found;
    return handler;
  }

  it("sends expiration DM when snapshot has legacy sections shape (no blocks)", async () => {
    const app = makeApp(makeDeps());

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
    const handler = getPostToHandler(app);
    const args = createBlockActionArgs({
      value: "sess-1",
      actionId: "clack_post_to_0",
      userId: "U001",
      channelId: "C001",
      client,
    });
    await handler(args);

    // Should NOT have called getStructuredAcceptedBlocks (no post attempted)
    assert.equal(mockGetStructuredAcceptedBlocks.mock.calls.length, 0);

    // Should have sent the expiration DM via postMessage (confirmInDm path)
    const postCalls = client.chat.postMessage.mock.calls;
    assert.ok(postCalls.length >= 1, "expected at least one postMessage call");
    const lastCallArgs = postCalls[postCalls.length - 1][0];
    const text = "text" in lastCallArgs ? lastCallArgs.text : undefined;
    assert.ok(text?.includes("older response"), `expected expiration message, got: ${text}`);
  });

  it("proceeds normally when snapshot has current blocks shape", async () => {
    const app = makeApp(makeDeps());

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
    const handler = getPostToHandler(app);
    const args = createBlockActionArgs({
      value: "sess-1",
      actionId: "clack_post_to_0",
      userId: "U001",
      channelId: "C001",
      client,
    });
    await handler(args);

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
