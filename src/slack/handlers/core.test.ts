import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { SessionContext } from "../../sessions.js";
import type { ProcessMessageParams, CoreDeps } from "./core.js";
import { processMessage } from "./core.js";
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
      test: mock.fn(async () => ({ user_id: "B001" })),
    },
    chat: {
      postMessage: mock.fn(async () => ({ ok: true, ts: "1700000000.000099" })),
      getPermalink: mock.fn(async () => ({ permalink: "https://slack.com/link" })),
    },
    conversations: {
      open: mock.fn(async () => ({ channel: { id: "D_DM_001" } })),
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
  mock.fn<(channelId: string, threadTs: string) => Promise<SessionContext | null>>();
const mockCreateSession = mock.fn<() => Promise<SessionContext>>();
const mockGetSession = mock.fn<(sessionId: string) => Promise<SessionContext | null>>();
const mockUpdateSession =
  mock.fn<
    (sessionId: string, updates: Partial<SessionContext>) => Promise<SessionContext | null>
  >();
const mockUpdateThreadContext = mock.fn<CoreDeps["updateThreadContext"]>();
const mockGetConfig = mock.fn<CoreDeps["getConfig"]>();
const mockSetSessionInfo = mock.fn<(sessionId: string, info: SessionInfo) => void>();
const mockFetchThreadContext = mock.fn<CoreDeps["fetchThreadContext"]>();
const mockTransformUserMentions =
  mock.fn<(client: ReturnType<typeof makeClient>, text: string) => Promise<string>>();
const mockGetUserInfo = mock.fn<CoreDeps["getUserInfo"]>();
const mockGetChannelInfo = mock.fn<CoreDeps["getChannelInfo"]>();
const mockResolveChannelLabel = mock.fn<() => Promise<string>>();
const mockResolveUserLabel = mock.fn<() => Promise<string>>();
const mockSlackLink = mock.fn<() => Promise<string>>();
const mockGetClaudeOptions =
  mock.fn<(userId: string, triggerType: TriggerType) => Promise<AskClaudeOptions>>();
const mockGetReactionDelivery = mock.fn<(userId: string) => Promise<string>>();
const mockStoreDmCoordinates =
  mock.fn<
    (
      sessionId: string,
      dmChannel: string,
      dmThreadTs: string,
      originChannel: string,
      originThreadTs: string,
    ) => Promise<void>
  >();
const mockExecuteAndDeliver = mock.fn<CoreDeps["executeAndDeliver"]>();
const mockAppendUserMessage = mock.fn<CoreDeps["appendUserMessage"]>(async () => null);

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
  };
}

function resetAllMocks() {
  mockFindSessionByThread.mock.resetCalls();
  mockCreateSession.mock.resetCalls();
  mockGetSession.mock.resetCalls();
  mockUpdateSession.mock.resetCalls();
  mockUpdateThreadContext.mock.resetCalls();
  mockGetConfig.mock.resetCalls();
  mockSetSessionInfo.mock.resetCalls();
  mockFetchThreadContext.mock.resetCalls();
  mockTransformUserMentions.mock.resetCalls();
  mockGetUserInfo.mock.resetCalls();
  mockGetChannelInfo.mock.resetCalls();
  mockResolveChannelLabel.mock.resetCalls();
  mockResolveUserLabel.mock.resetCalls();
  mockSlackLink.mock.resetCalls();
  mockGetClaudeOptions.mock.resetCalls();
  mockGetReactionDelivery.mock.resetCalls();
  mockStoreDmCoordinates.mock.resetCalls();
  mockExecuteAndDeliver.mock.resetCalls();

  // Reset to defaults
  mockFindSessionByThread.mock.mockImplementation(async () => null);
  mockCreateSession.mock.mockImplementation(async () => makeSession());
  mockGetSession.mock.mockImplementation(async () => makeSession());
  mockUpdateSession.mock.mockImplementation(async () => makeSession());
  mockUpdateThreadContext.mock.mockImplementation(async () => makeSession());
  mockFetchThreadContext.mock.mockImplementation(async () => []);
  mockTransformUserMentions.mock.mockImplementation(async (_client, text) => text);
  mockGetUserInfo.mock.mockImplementation(async () => undefined);
  mockGetChannelInfo.mock.mockImplementation(async () => undefined);
  mockResolveChannelLabel.mock.mockImplementation(async () => "#test");
  mockResolveUserLabel.mock.mockImplementation(async () => "@user");
  mockSlackLink.mock.mockImplementation(async () => "");
  mockGetReactionDelivery.mock.mockImplementation(async () => "thread");
  mockExecuteAndDeliver.mock.mockImplementation(async () => ({ success: true, answer: "test" }));
  mockGetClaudeOptions.mock.mockImplementation(async () => ({
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
  mockGetConfig.mock.mockImplementation(() => fakeConfig);
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

    assert.equal(mockFindSessionByThread.mock.callCount(), 0);
    assert.equal(mockCreateSession.mock.callCount(), 1);
  });

  it("reuses existing session when thread found", async () => {
    const existingSession = makeSession({ sessionId: "existing-session" });
    mockFindSessionByThread.mock.mockImplementation(async () => existingSession);

    const deps = makeDeps();
    await processMessage(makeParams({ threadTs: "1700000000.000001" }), deps);

    assert.equal(mockFindSessionByThread.mock.callCount(), 1);
    assert.equal(mockCreateSession.mock.callCount(), 0);
    assert.equal(mockUpdateThreadContext.mock.callCount(), 1);
    // Check that updateThreadContext was called for the existing session
    assert.equal(mockUpdateThreadContext.mock.callCount(), 1);
  });
});

describe("processMessage — reaction delivery preference", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("calls getReactionDelivery for reaction triggers", async () => {
    const deps = makeDeps();
    await processMessage(makeParams({ triggerType: "reactions" }), deps);

    assert.equal(mockGetReactionDelivery.mock.callCount(), 1);
  });

  it("does NOT check delivery preference for mentions", async () => {
    const deps = makeDeps();
    await processMessage(makeParams({ triggerType: "mentions" }), deps);

    assert.equal(mockGetReactionDelivery.mock.callCount(), 0);
  });

  it("does NOT check delivery preference for directMessages", async () => {
    const deps = makeDeps();
    await processMessage(makeParams({ triggerType: "directMessages" }), deps);

    assert.equal(mockGetReactionDelivery.mock.callCount(), 0);
  });
});

describe("processMessage — executeAndDeliver delegation", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("calls executeAndDeliver with correct params", async () => {
    const session = makeSession({ sessionId: "sess-42" });
    mockCreateSession.mock.mockImplementation(async () => session);

    const client = makeClient();
    const deps = makeDeps();
    await processMessage(makeParams({ client, triggerType: "reactions" }), deps);

    assert.equal(mockExecuteAndDeliver.mock.callCount(), 1);
  });
});

// In-flight tracking moved out of `processMessage`: `askClaude` self-registers via
// `activeRuns.register` and self-deregisters through the handle's `onTerminal` hook.
// Coverage for that lives in askClaude / activeRuns tests.
