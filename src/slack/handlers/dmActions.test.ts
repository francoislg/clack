import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { App, BlockAction, ViewSubmitAction } from "@slack/bolt";
import type { SessionContext } from "../../sessions.js";
import type { ResponseSnapshot } from "../../tools/types.js";
import type { SessionInfo } from "../activeSessions.js";
import type { DmActionsDeps } from "./dmActions.js";
import { postAnswerToChannel, resolveOrigin, registerDmActionHandlers } from "./dmActions.js";

// ============================================================================
// Type definitions for mocks
// ============================================================================

interface DecodeResult {
  sessionId: string;
  ref?: string;
  snapshotId?: string;
  targetChannel?: string;
  targetThreadTs?: string;
}

interface BlockList {
  type: string;
  text?: { type: string; text: string };
}

// ============================================================================
// Mocks
// ============================================================================

const mockGetSession = mock.fn<(id: string) => Promise<SessionContext | null>>();
const mockUpdateSession =
  mock.fn<(id: string, updates: Partial<SessionContext>) => Promise<SessionContext | null>>();
const mockSetLastAnswer = mock.fn<(id: string, answer: string) => Promise<SessionContext | null>>();
const mockRestoreSession = mock.fn<(id: string) => Promise<SessionInfo | undefined>>();
const mockSetSessionInfo = mock.fn<(id: string, info: SessionInfo) => void>();
const mockDecodeActionValue = mock.fn<(v: string) => DecodeResult>();
const mockGetAcceptedBlocks = mock.fn<(text: string) => BlockList[]>();
const mockGetStructuredAcceptedBlocks =
  mock.fn<(sections: ResponseSnapshot["sections"]) => BlockList[]>();
const mockAsSlackBlocks = mock.fn<(blocks: BlockList[]) => BlockList[]>();

function makeDeps(): DmActionsDeps {
  return {
    getSession: mockGetSession,
    updateSession: mockUpdateSession as never,
    setLastAnswer: mockSetLastAnswer,
    restoreSession: mockRestoreSession,
    setSessionInfo: mockSetSessionInfo,
    decodeActionValue: mockDecodeActionValue as never,
    getAcceptedBlocks: mockGetAcceptedBlocks as never,
    getStructuredAcceptedBlocks: mockGetStructuredAcceptedBlocks as never,
    asSlackBlocks: mockAsSlackBlocks as never,
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

function makeChatApi(): App["client"]["chat"] {
  const postMessageFn = mock.fn<() => Promise<{ ts?: string }>>(async () => ({ ts: "1700.999" }));
  const postEphemeralFn = mock.fn<() => Promise<{ ok?: boolean }>>(async () => ({ ok: true }));
  const updateFn = mock.fn<() => Promise<{ ok?: boolean }>>(async () => ({ ok: true }));

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
    sections: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockGetSession.mock.resetCalls();
  mockUpdateSession.mock.resetCalls();
  mockSetLastAnswer.mock.resetCalls();
  mockRestoreSession.mock.resetCalls();
  mockSetSessionInfo.mock.resetCalls();
  mockDecodeActionValue.mock.resetCalls();
  mockGetAcceptedBlocks.mock.resetCalls();
  mockGetStructuredAcceptedBlocks.mock.resetCalls();
  mockAsSlackBlocks.mock.resetCalls();

  mockGetAcceptedBlocks.mock.mockImplementation(() => [
    { type: "section", text: { type: "mrkdwn", text: "answer" } },
  ]);
  mockGetStructuredAcceptedBlocks.mock.mockImplementation(() => [
    { type: "section", text: { type: "mrkdwn", text: "answer" } },
  ]);
  mockAsSlackBlocks.mock.mockImplementation((blocks) => blocks);
  mockDecodeActionValue.mock.mockImplementation((v) => ({ sessionId: v }));
});

// ============================================================================
// postAnswerToChannel
// ============================================================================

describe("postAnswerToChannel", () => {
  it("posts message with plain text snapshot", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const snapshot = makeSnapshot({ text: "My answer", sections: undefined });

    await postAnswerToChannel(client, snapshot, "C100", undefined, deps);

    assert.equal(mockGetAcceptedBlocks.mock.callCount(), 1);
  });

  it("posts message with structured snapshot sections", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const sections = [{ body: "Section 1" }];
    const snapshot = makeSnapshot({ text: "answer", sections });

    await postAnswerToChannel(client, snapshot, "C100", undefined, deps);

    assert.equal(mockGetStructuredAcceptedBlocks.mock.callCount(), 1);
  });

  it("returns ts from postMessage response", async () => {
    const deps = makeDeps();
    const client = makeClient();
    const snapshot = makeSnapshot();

    const result = await postAnswerToChannel(client, snapshot, "C100", undefined, deps);

    assert.equal(result.ok, true);
    assert.equal(result.ts, "1700.999");
  });
});

// ============================================================================
// resolveOrigin
// ============================================================================

describe("resolveOrigin", () => {
  it("returns originChannel and originThreadTs from session when available", () => {
    const session = makeSession({ originChannel: "C200", originThreadTs: "1700.002" });
    const sessionInfo = makeSessionInfo();

    const result = resolveOrigin(session, sessionInfo);

    assert.equal(result.originChannel, "C200");
    assert.equal(result.originThreadTs, "1700.002");
  });

  it("falls back to sessionInfo when session fields are undefined", () => {
    const session = makeSession({ originChannel: undefined, originThreadTs: undefined });
    const sessionInfo = makeSessionInfo({ originChannel: "C300", originThreadTs: "1700.003" });

    const result = resolveOrigin(session, sessionInfo);

    assert.equal(result.originChannel, "C300");
    assert.equal(result.originThreadTs, "1700.003");
  });

  it("prefers session over sessionInfo when both have values", () => {
    const session = makeSession({ originChannel: "C200", originThreadTs: "1700.002" });
    const sessionInfo = makeSessionInfo({ originChannel: "C300", originThreadTs: "1700.003" });

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
