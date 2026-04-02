import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { SessionContext } from "../../sessions.js";
import type { ProcessMessageParams } from "./core.js";

// ============================================================================
// Mocks — set up before importing the module under test
// ============================================================================

const mockFindSessionByThread = mock.fn<(...args: unknown[]) => Promise<SessionContext | null>>(
  async () => null,
);
const mockCreateSession = mock.fn<(...args: unknown[]) => Promise<SessionContext>>(async () =>
  makeSession(),
);
const mockGetSession = mock.fn<(...args: unknown[]) => Promise<SessionContext | null>>(async () =>
  makeSession(),
);
const mockUpdateSession = mock.fn<(...args: unknown[]) => Promise<SessionContext | null>>(
  async () => makeSession(),
);
const mockUpdateThreadContext = mock.fn<(...args: unknown[]) => Promise<SessionContext | null>>(
  async () => makeSession(),
);

mock.module("../../sessions.js", {
  namedExports: {
    findSessionByThread: mockFindSessionByThread,
    createSession: mockCreateSession,
    getSession: mockGetSession,
    updateSession: mockUpdateSession,
    updateThreadContext: mockUpdateThreadContext,
  },
});

const mockGetConfig = mock.fn(() => ({
  slack: { fetchAndStoreUsername: false },
  directMessages: { enabled: false },
  mentions: { enabled: false },
}));

mock.module("../../config.js", {
  namedExports: { getConfig: mockGetConfig },
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

const mockSetSessionInfo = mock.fn(() => {});

mock.module("../activeSessions.js", {
  namedExports: { activeSessions: { set: mockSetSessionInfo } },
});

const mockFetchThreadContext = mock.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []);

mock.module("../messagesApi.js", {
  namedExports: { fetchThreadContext: mockFetchThreadContext },
});

const mockTransformUserMentions = mock.fn(async (...args: unknown[]) => String(args[1]));

const mockGetUserInfo = mock.fn(async () => ({
  userId: "U001",
  username: "testuser",
  displayName: "Test User",
}));

mock.module("../userCache.js", {
  namedExports: { transformUserMentions: mockTransformUserMentions, getUserInfo: mockGetUserInfo },
});

const mockGetClaudeOptions = mock.fn(async () => ({
  role: "dev" as const,
  changesWorkflowEnabled: false,
}));

mock.module("./changeWorkflowHelper.js", {
  namedExports: { getClaudeOptions: mockGetClaudeOptions },
});

const mockGetReactionDelivery = mock.fn<(...args: unknown[]) => Promise<string>>(
  async () => "thread",
);

mock.module("../../userPreferences.js", {
  namedExports: { getReactionDelivery: mockGetReactionDelivery },
});

const mockRegisterInFlightRequest = mock.fn((..._args: unknown[]) => {});
const mockDeregisterInFlightRequest = mock.fn((..._args: unknown[]) => {});

mock.module("../inFlightRequests.js", {
  namedExports: {
    registerInFlightRequest: mockRegisterInFlightRequest,
    deregisterInFlightRequest: mockDeregisterInFlightRequest,
  },
});

const mockStoreDmCoordinates = mock.fn<(...args: unknown[]) => Promise<void>>(async () => {});

mock.module("../dmResponse.js", {
  namedExports: { storeDmCoordinates: mockStoreDmCoordinates },
});

const mockExecuteAndDeliver = mock.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
  success: true,
  answer: "test",
}));

mock.module("./handlerResponse.js", {
  namedExports: { executeAndDeliver: mockExecuteAndDeliver },
});

// Import after mocks
const { processMessage } = await import("./core.js");

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
    originalQuestion: "test question",
    threadContext: [],
    refinements: [],
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
  } as unknown as App["client"];
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
  mockGetClaudeOptions.mock.resetCalls();
  mockGetReactionDelivery.mock.resetCalls();
  mockRegisterInFlightRequest.mock.resetCalls();
  mockDeregisterInFlightRequest.mock.resetCalls();
  mockStoreDmCoordinates.mock.resetCalls();
  mockExecuteAndDeliver.mock.resetCalls();

  // Reset to defaults
  mockFindSessionByThread.mock.mockImplementation(async () => null);
  mockCreateSession.mock.mockImplementation(async () => makeSession());
  mockGetSession.mock.mockImplementation(async () => makeSession());
  mockUpdateSession.mock.mockImplementation(async () => makeSession());
  mockUpdateThreadContext.mock.mockImplementation(async () => makeSession());
  mockGetReactionDelivery.mock.mockImplementation(async () => "thread");
  mockExecuteAndDeliver.mock.mockImplementation(async () => ({ success: true, answer: "test" }));
  mockGetClaudeOptions.mock.mockImplementation(async () => ({
    role: "dev" as const,
    changesWorkflowEnabled: false,
  }));
  mockGetConfig.mock.mockImplementation(() => ({
    slack: { fetchAndStoreUsername: false },
    directMessages: { enabled: false },
    mentions: { enabled: false },
  }));
}

// ============================================================================
// Tests
// ============================================================================

describe("processMessage — session setup", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("creates a new session when no threadTs", async () => {
    await processMessage(makeParams({ threadTs: undefined }));

    assert.equal(mockFindSessionByThread.mock.callCount(), 0);
    assert.equal(mockCreateSession.mock.callCount(), 1);
  });

  it("reuses existing session when thread found", async () => {
    const existingSession = makeSession({ sessionId: "existing-session" });
    mockFindSessionByThread.mock.mockImplementation(async () => existingSession);

    await processMessage(makeParams({ threadTs: "1700000000.000001" }));

    assert.equal(mockFindSessionByThread.mock.callCount(), 1);
    assert.equal(mockCreateSession.mock.callCount(), 0);
    assert.equal(mockUpdateThreadContext.mock.callCount(), 1);
    assert.equal(mockUpdateThreadContext.mock.calls[0].arguments[0], "existing-session");
  });
});

describe("processMessage — reaction delivery preference", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("calls getReactionDelivery for reaction triggers", async () => {
    await processMessage(makeParams({ triggerType: "reactions" }));

    assert.equal(mockGetReactionDelivery.mock.callCount(), 1);
    assert.equal(mockGetReactionDelivery.mock.calls[0].arguments[0], "U001");
  });

  it("does NOT check delivery preference for mentions", async () => {
    await processMessage(makeParams({ triggerType: "mentions" }));

    assert.equal(mockGetReactionDelivery.mock.callCount(), 0);
  });

  it("does NOT check delivery preference for directMessages", async () => {
    await processMessage(makeParams({ triggerType: "directMessages" }));

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
    await processMessage(makeParams({ client, triggerType: "reactions" }));

    assert.equal(mockExecuteAndDeliver.mock.callCount(), 1);
    const args = mockExecuteAndDeliver.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(args.client, client);
    assert.ok(args.session);
    assert.ok(args.sessionInfo);
    assert.ok(args.claudeOptions);
    assert.ok(args.abortController instanceof AbortController);
  });
});

describe("processMessage — in-flight request registration", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("registers in-flight request for mentions", async () => {
    await processMessage(makeParams({ triggerType: "mentions" }));

    assert.equal(mockRegisterInFlightRequest.mock.callCount(), 1);
    const args = mockRegisterInFlightRequest.mock.calls[0].arguments;
    assert.equal(args[0], "C001");
    assert.equal(args[1], "1700000000.000001");
    const request = args[2] as { sessionId: string; triggerType: string };
    assert.equal(request.triggerType, "mentions");
  });

  it("registers in-flight request for directMessages", async () => {
    await processMessage(makeParams({ triggerType: "directMessages" }));

    assert.equal(mockRegisterInFlightRequest.mock.callCount(), 1);
    const request = mockRegisterInFlightRequest.mock.calls[0].arguments[2] as {
      triggerType: string;
    };
    assert.equal(request.triggerType, "directMessages");
  });

  it("does NOT register in-flight request for reactions", async () => {
    await processMessage(makeParams({ triggerType: "reactions" }));

    assert.equal(mockRegisterInFlightRequest.mock.callCount(), 0);
  });

  it("deregisters in-flight request after executeAndDeliver completes", async () => {
    await processMessage(makeParams({ triggerType: "mentions" }));

    assert.equal(mockDeregisterInFlightRequest.mock.callCount(), 1);
    assert.equal(mockDeregisterInFlightRequest.mock.calls[0].arguments[0], "C001");
    assert.equal(mockDeregisterInFlightRequest.mock.calls[0].arguments[1], "1700000000.000001");
  });

  it("deregisters in-flight request even if executeAndDeliver throws", async () => {
    mockExecuteAndDeliver.mock.mockImplementation(async () => {
      throw new Error("executeAndDeliver failed");
    });

    await assert.rejects(() => processMessage(makeParams({ triggerType: "mentions" })), {
      message: "executeAndDeliver failed",
    });

    assert.equal(mockDeregisterInFlightRequest.mock.callCount(), 1);
    assert.equal(mockDeregisterInFlightRequest.mock.calls[0].arguments[0], "C001");
    assert.equal(mockDeregisterInFlightRequest.mock.calls[0].arguments[1], "1700000000.000001");
  });

  it("does NOT deregister for reactions even if executeAndDeliver throws", async () => {
    mockExecuteAndDeliver.mock.mockImplementation(async () => {
      throw new Error("boom");
    });

    await assert.rejects(() => processMessage(makeParams({ triggerType: "reactions" })), {
      message: "boom",
    });

    assert.equal(mockDeregisterInFlightRequest.mock.callCount(), 0);
  });
});
