import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { SessionContext } from "../../sessions.js";
import type { ProcessMessageParams, CoreDeps } from "./core.js";
import { processMessage } from "./core.js";
import type { GetClaudeOptionsArgs } from "./changeWorkflowHelper.js";
import {
  withThreadLock,
  register as registerActiveRun,
  _resetForTesting as resetActiveRuns,
} from "../activeRuns.js";
import type { ClaudeRunHandle } from "../../claude/runHandle.js";
import type { SessionInfo } from "../activeSessions.js";
import type { TriggerType } from "../../changes/types.js";
import type { AskClaudeOptions } from "../../claude/index.js";

// ============================================================================
// Helpers
// ============================================================================

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
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  } as SessionContext;
}

function makeClient(): App["client"] {
  return {
    auth: {
      test: vi.fn(async () => ({ user_id: "B001" })),
    },
    chat: {
      postMessage: vi.fn(async () => ({ ok: true, ts: "1700000000.000099" })),
      getPermalink: vi.fn(async () => ({ permalink: "https://slack.com/link" })),
    },
    conversations: {
      open: vi.fn(async () => ({ channel: { id: "D_DM_001" } })),
    },
  } as never;
}

function makeParams(overrides: Partial<ProcessMessageParams> = {}): ProcessMessageParams {
  return {
    client: makeClient(),
    userId: "U001",
    channelId: "C001",
    messageTs: "1700000000.000001",
    messageText: "What does this function do?",
    triggerType: "reactions",
    ...overrides,
  };
}

// ============================================================================
// Mock Functions
// ============================================================================

const mockFindSessionByThread =
  vi.fn<(channelId: string, threadTs: string) => Promise<SessionContext | null>>();
const mockCreateSession = vi.fn<() => Promise<SessionContext>>();
const mockGetSession = vi.fn<(sessionId: string) => Promise<SessionContext | null>>();
const mockUpdateSession =
  vi.fn<(sessionId: string, updates: Partial<SessionContext>) => Promise<SessionContext | null>>();
const mockUpdateThreadContext = vi.fn<CoreDeps["updateThreadContext"]>();
const mockGetConfig = vi.fn<CoreDeps["getConfig"]>();
const mockSetSessionInfo = vi.fn<(sessionId: string, info: SessionInfo) => void>();
const mockFetchThreadContext = vi.fn<CoreDeps["fetchThreadContext"]>();
const mockTransformUserMentions =
  vi.fn<(client: ReturnType<typeof makeClient>, text: string) => Promise<string>>();
const mockGetUserInfo = vi.fn<CoreDeps["getUserInfo"]>();
const mockGetChannelInfo = vi.fn<CoreDeps["getChannelInfo"]>();
const mockResolveChannelLabel = vi.fn<() => Promise<string>>();
const mockResolveUserLabel = vi.fn<() => Promise<string>>();
const mockSlackLink = vi.fn<() => Promise<string>>();
const mockGetClaudeOptions =
  vi.fn<
    (
      userId: string,
      triggerType: TriggerType,
      options?: GetClaudeOptionsArgs,
    ) => Promise<AskClaudeOptions>
  >();
const mockGetReactionDelivery = vi.fn<(userId: string) => Promise<string>>();
const mockStoreDmCoordinates =
  vi.fn<
    (
      sessionId: string,
      dmChannel: string,
      dmThreadTs: string,
      originChannel: string,
      originThreadTs: string,
    ) => Promise<void>
  >();
const mockExecuteAndDeliver = vi.fn<CoreDeps["executeAndDeliver"]>();
const mockAppendUserMessage = vi.fn<CoreDeps["appendUserMessage"]>(async () => null);

function makeDeps(): CoreDeps {
  return {
    findSessionByThread: mockFindSessionByThread,
    createSession: mockCreateSession,
    getSession: mockGetSession,
    updateSession: mockUpdateSession,
    updateThreadContext: mockUpdateThreadContext,
    getConfig: mockGetConfig,
    setSessionInfo: mockSetSessionInfo,
    fetchThreadContext: mockFetchThreadContext,
    transformUserMentions: mockTransformUserMentions,
    getUserInfo: mockGetUserInfo,
    getChannelInfo: mockGetChannelInfo,
    resolveChannelLabel: mockResolveChannelLabel,
    resolveUserLabel: mockResolveUserLabel,
    slackLink: mockSlackLink,
    getClaudeOptions: mockGetClaudeOptions,
    getReactionDelivery: mockGetReactionDelivery,
    storeDmCoordinates: mockStoreDmCoordinates,
    executeAndDeliver: mockExecuteAndDeliver,
    appendUserMessage: mockAppendUserMessage,
    withThreadLock,
  };
}

function resetAllMocks() {
  mockFindSessionByThread.mockClear();
  mockCreateSession.mockClear();
  mockGetSession.mockClear();
  mockUpdateSession.mockClear();
  mockUpdateThreadContext.mockClear();
  mockGetConfig.mockClear();
  mockSetSessionInfo.mockClear();
  mockFetchThreadContext.mockClear();
  mockTransformUserMentions.mockClear();
  mockGetUserInfo.mockClear();
  mockGetChannelInfo.mockClear();
  mockResolveChannelLabel.mockClear();
  mockResolveUserLabel.mockClear();
  mockSlackLink.mockClear();
  mockGetClaudeOptions.mockClear();
  mockGetReactionDelivery.mockClear();
  mockStoreDmCoordinates.mockClear();
  mockExecuteAndDeliver.mockClear();

  // Reset to defaults
  mockFindSessionByThread.mockImplementation(async () => null);
  mockCreateSession.mockImplementation(async () => makeSession());
  mockGetSession.mockImplementation(async () => makeSession());
  mockUpdateSession.mockImplementation(async () => makeSession());
  mockUpdateThreadContext.mockImplementation(async () => makeSession());
  mockFetchThreadContext.mockImplementation(async () => []);
  mockTransformUserMentions.mockImplementation(async (_client, text) => text);
  mockGetUserInfo.mockImplementation(async () => undefined);
  mockGetChannelInfo.mockImplementation(async () => undefined);
  mockResolveChannelLabel.mockImplementation(async () => "#test");
  mockResolveUserLabel.mockImplementation(async () => "@user");
  mockSlackLink.mockImplementation(async () => "");
  mockGetReactionDelivery.mockImplementation(async () => "thread");
  mockExecuteAndDeliver.mockImplementation(async () => ({ success: true, answer: "test" }));
  mockGetClaudeOptions.mockImplementation(async () => ({
    role: "dev" as const,
    changesWorkflowEnabled: false,
  }));
  // Test fixture: only the fields processMessage actually reads. Cast at the const so
  // the mock implementation can return it without an inline cast.
  type FakeConfig = ReturnType<CoreDeps["getConfig"]>;
  const fakeConfig: FakeConfig = {
    slack: { fetchAndStoreUsername: false },
    directMessages: { enabled: false },
    mentions: { enabled: false },
  } as FakeConfig;
  mockGetConfig.mockImplementation(() => fakeConfig);
}

// ============================================================================
// Tests
// ============================================================================

describe("processMessage — session setup", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("creates a new session when no threadTs", async () => {
    const deps = makeDeps();
    await processMessage(makeParams({ threadTs: undefined }), deps);

    assert.equal(mockFindSessionByThread.mock.calls.length, 0);
    assert.equal(mockCreateSession.mock.calls.length, 1);
  });

  it("reuses existing session when thread found", async () => {
    const existingSession = makeSession({ sessionId: "existing-session" });
    mockFindSessionByThread.mockImplementation(async () => existingSession);

    const deps = makeDeps();
    await processMessage(makeParams({ threadTs: "1700000000.000001" }), deps);

    assert.equal(mockFindSessionByThread.mock.calls.length, 1);
    assert.equal(mockCreateSession.mock.calls.length, 0);
    assert.equal(mockUpdateThreadContext.mock.calls.length, 1);
    // Check that updateThreadContext was called for the existing session
    assert.equal(mockUpdateThreadContext.mock.calls.length, 1);
  });
});

describe("processMessage — reaction delivery preference", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("calls getReactionDelivery for reaction triggers", async () => {
    const deps = makeDeps();
    await processMessage(makeParams({ triggerType: "reactions" }), deps);

    assert.equal(mockGetReactionDelivery.mock.calls.length, 1);
  });

  it("does NOT check delivery preference for mentions", async () => {
    const deps = makeDeps();
    await processMessage(makeParams({ triggerType: "mentions" }), deps);

    assert.equal(mockGetReactionDelivery.mock.calls.length, 0);
  });

  it("forwards the channelId to getClaudeOptions", async () => {
    const deps = makeDeps();
    await processMessage(makeParams({ triggerType: "mentions", channelId: "C123" }), deps);

    assert.equal(mockGetClaudeOptions.mock.calls[0]![2]?.channelId, "C123");
  });

  it("does NOT check delivery preference for directMessages", async () => {
    const deps = makeDeps();
    await processMessage(makeParams({ triggerType: "directMessages" }), deps);

    assert.equal(mockGetReactionDelivery.mock.calls.length, 0);
  });
});

describe("processMessage — executeAndDeliver delegation", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("calls executeAndDeliver with correct params", async () => {
    const session = makeSession({ sessionId: "sess-42" });
    mockCreateSession.mockImplementation(async () => session);

    const client = makeClient();
    const deps = makeDeps();
    await processMessage(makeParams({ client, triggerType: "reactions" }), deps);

    assert.equal(mockExecuteAndDeliver.mock.calls.length, 1);
  });

  it("runs silentThinking when the resolved session is deliveryMode 'invisible'", async () => {
    const invisible = makeSession({ sessionId: "inv-1", deliveryMode: "invisible" });
    mockFindSessionByThread.mockImplementation(async () => invisible);
    mockGetSession.mockImplementation(async () => invisible);

    const deps = makeDeps();
    await processMessage(makeParams({ triggerType: "directMessages", threadTs: "1700.001" }), deps);

    assert.equal(mockExecuteAndDeliver.mock.calls[0]![0].silentThinking, true);
  });

  it("does NOT run silentThinking when the resolved session is deliveryMode 'streamer'", async () => {
    const visible = makeSession({ sessionId: "vis-1", deliveryMode: "streamer" });
    mockFindSessionByThread.mockImplementation(async () => visible);
    mockGetSession.mockImplementation(async () => visible);

    const deps = makeDeps();
    await processMessage(makeParams({ triggerType: "directMessages", threadTs: "1700.002" }), deps);

    assert.equal(mockExecuteAndDeliver.mock.calls[0]![0].silentThinking, false);
  });

  it("keeps an explicit silentThinking (cron) true even when the session mode is 'streamer'", async () => {
    const visible = makeSession({ sessionId: "vis-2", deliveryMode: "streamer" });
    mockFindSessionByThread.mockImplementation(async () => visible);
    mockGetSession.mockImplementation(async () => visible);

    const deps = makeDeps();
    await processMessage(
      makeParams({ triggerType: "directMessages", threadTs: "1700.003", silentThinking: true }),
      deps,
    );

    assert.equal(mockExecuteAndDeliver.mock.calls[0]![0].silentThinking, true);
  });
});

// In-flight tracking moved out of `processMessage`: `askClaude` self-registers via
// `activeRuns.register` and self-deregisters through the handle's `onTerminal` hook.
// Coverage for that lives in askClaude / activeRuns tests.

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeRunHandle(sendUpdate: (text: string) => Promise<void>): ClaudeRunHandle {
  return {
    sendUpdate,
    stop: async () => {},
    futureResponse: Promise.resolve({ success: true, answer: "" }),
    status: "running",
    hasPendingInput: () => false,
    consumePendingPushedTexts: () => [],
    hasDelivered: () => false,
  };
}

describe("processMessage — concurrent same-thread dedup", () => {
  const THREAD = "1700000000.000111";

  beforeEach(() => {
    resetAllMocks();
    resetActiveRuns();
  });

  it("routes to an already-registered run via sendUpdate instead of spawning", async () => {
    const sendUpdate = vi.fn<(text: string) => Promise<void>>(async () => {});
    registerActiveRun({ channelId: "C001", threadTs: THREAD }, fakeRunHandle(sendUpdate));

    const deps = makeDeps();
    const result = await processMessage(
      makeParams({
        triggerType: "directMessages",
        threadTs: THREAD,
        messageTs: "1700000000.000112",
        messageText: "follow-up",
      }),
      deps,
    );

    assert.equal(result.skipped, true);
    assert.equal(sendUpdate.mock.calls.length, 1);
    assert.equal(sendUpdate.mock.calls[0]![0], "follow-up");
    // Must NOT spawn a parallel run/streamer.
    assert.equal(mockExecuteAndDeliver.mock.calls.length, 0);
  });

  it("spawns a fresh run when the registered run rejects sendUpdate (already delivered)", async () => {
    // Mirrors the real bug: the previous run already delivered its response (the run handle
    // rejects sendUpdate), so the follow-up must NOT be absorbed-and-acked — it must spawn a
    // fresh run with its own streamer/delivery context.
    const sendUpdate = vi.fn<(text: string) => Promise<void>>(async () => {
      throw new Error("Cannot sendUpdate: run already delivered a response");
    });
    registerActiveRun({ channelId: "C001", threadTs: THREAD }, fakeRunHandle(sendUpdate));

    const deps = makeDeps();
    const result = await processMessage(
      makeParams({
        triggerType: "directMessages",
        threadTs: THREAD,
        messageTs: "1700000000.000113",
        messageText: "the button choice",
      }),
      deps,
    );

    assert.equal(sendUpdate.mock.calls.length, 1, "attempted the fast path once");
    assert.notEqual(result.skipped, true, "did not short-circuit as a queued follow-up");
    assert.equal(mockExecuteAndDeliver.mock.calls.length, 1, "fell through to a fresh spawn");
  });

  it("serializes two concurrent triggers: exactly one spawn, the other sendUpdate", async () => {
    const sendUpdate = vi.fn<(text: string) => Promise<void>>(async () => {});
    const runGate = deferred();

    // Model askClaude: claim the slot + release the per-thread lock at registration, then
    // keep the run "alive" until we let it finish.
    mockExecuteAndDeliver.mockImplementation(async (params) => {
      registerActiveRun(
        { channelId: params.sessionInfo.channelId, threadTs: params.sessionInfo.threadTs },
        fakeRunHandle(sendUpdate),
      );
      params.claudeOptions.onRegistered?.();
      await runGate.promise;
      return { success: true, answer: "done" };
    });

    const deps = makeDeps();
    const p1 = processMessage(
      makeParams({
        triggerType: "directMessages",
        threadTs: THREAD,
        messageTs: "a",
        messageText: "first",
      }),
      deps,
    );
    const p2 = processMessage(
      makeParams({
        triggerType: "directMessages",
        threadTs: THREAD,
        messageTs: "b",
        messageText: "second",
      }),
      deps,
    );

    // p2 can only resolve once p1 released the lock at registration; it then finds the
    // registered run and routes via sendUpdate. It must not wait for the run to finish.
    const r2 = await p2;
    assert.equal(r2.skipped, true);
    assert.equal(mockExecuteAndDeliver.mock.calls.length, 1);
    assert.equal(sendUpdate.mock.calls.length, 1);
    assert.equal(sendUpdate.mock.calls[0]![0], "second");

    runGate.resolve();
    await p1;
  });

  it("a second trigger during the first's slow setup does not spawn a parallel run", async () => {
    const setupGate = deferred();
    let firstSetupStarted = false;
    // Make the first invocation's session setup slow so the second arrives mid-gap.
    mockCreateSession.mockImplementation(async () => {
      firstSetupStarted = true;
      await setupGate.promise;
      return makeSession();
    });

    const sendUpdate = vi.fn<(text: string) => Promise<void>>(async () => {});
    const runGate = deferred();
    mockExecuteAndDeliver.mockImplementation(async (params) => {
      registerActiveRun(
        { channelId: params.sessionInfo.channelId, threadTs: params.sessionInfo.threadTs },
        fakeRunHandle(sendUpdate),
      );
      params.claudeOptions.onRegistered?.();
      await runGate.promise;
      return { success: true, answer: "done" };
    });

    const deps = makeDeps();
    const p1 = processMessage(
      makeParams({
        triggerType: "directMessages",
        threadTs: THREAD,
        messageTs: "a",
        messageText: "first",
      }),
      deps,
    );
    // Let p1 enter the lock and reach the slow setup.
    while (!firstSetupStarted) await Promise.resolve();

    const p2 = processMessage(
      makeParams({
        triggerType: "directMessages",
        threadTs: THREAD,
        messageTs: "b",
        messageText: "second",
      }),
      deps,
    );

    // p2 is blocked behind p1's lock — it cannot spawn while p1 is still in setup.
    await Promise.resolve();
    assert.equal(mockExecuteAndDeliver.mock.calls.length, 0);

    // Release p1's setup → it spawns, registers, releases the lock; p2 then routes to sendUpdate.
    setupGate.resolve();
    const r2 = await p2;
    assert.equal(r2.skipped, true);
    assert.equal(mockExecuteAndDeliver.mock.calls.length, 1);
    assert.equal(sendUpdate.mock.calls.length, 1);

    runGate.resolve();
    await p1;
  });
});
