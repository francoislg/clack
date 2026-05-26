import { describe, it, vi, beforeEach } from "vitest";
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
  vi.fn<(userId: string, triggerType: TriggerType) => Promise<AskClaudeOptions>>();
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
});

// In-flight tracking moved out of `processMessage`: `askClaude` self-registers via
// `activeRuns.register` and self-deregisters through the handle's `onTerminal` hook.
// Coverage for that lives in askClaude / activeRuns tests.
