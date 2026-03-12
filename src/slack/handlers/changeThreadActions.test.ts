import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App, BlockAction } from "@slack/bolt";
import type { UserRole } from "../../roles.js";
import type { StagedIntent, StagedUpdateIntent } from "../../tools/types.js";
import type { SessionInfo } from "../state.js";
import type { SessionContext } from "../../sessions.js";
import type { ChangeResult } from "../../changes/types.js";

// ============================================================================
// Mocks — set up before importing the module under test
// ============================================================================

const mockGetRole = mock.fn<(userId: string) => Promise<UserRole>>(async () => "dev");
const mockGetStagedIntent = mock.fn<(...args: unknown[]) => Promise<StagedIntent | null>>(async () => null);
const mockFindSessionByThread = mock.fn<(...args: unknown[]) => Promise<SessionContext | null>>(async () => null);
const mockDecodeActionValue = mock.fn<(value: string) => { sessionId: string; ref?: string }>(
  () => ({ sessionId: "session-1", ref: "r1" }),
);
const mockRestoreSessionInfo = mock.fn<(sessionId: string) => Promise<SessionInfo | undefined>>(
  async () => ({
    channelId: "C001",
    threadTs: "1700000000.000001",
    userId: "U001",
  }),
);
const mockHandleFollowUp = mock.fn<(...args: unknown[]) => Promise<ChangeResult>>(
  async () => ({ success: true }),
);

// SlackStreamer mock
const mockStreamerStart = mock.fn(async () => true);
const mockStreamerStop = mock.fn(async () => {});
const mockStreamerHandleEvent = mock.fn();
const mockFinalizeStreamedWorkflow = mock.fn(async () => {});

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

mock.module("../../errors.js", {
  namedExports: {
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  },
});

mock.module("../../roles.js", {
  namedExports: {
    getRole: mockGetRole,
  },
});

mock.module("../../permissions.js", {
  namedExports: {
    canRequestChanges: (role: UserRole) => role === "dev" || role === "admin" || role === "owner",
  },
});

mock.module("../../sessions.js", {
  namedExports: {
    getStagedIntent: mockGetStagedIntent,
    findSessionByThread: mockFindSessionByThread,
  },
});

mock.module("../blocks.js", {
  namedExports: {
    decodeActionValue: mockDecodeActionValue,
  },
});

mock.module("../state.js", {
  namedExports: {
    restoreSessionInfo: mockRestoreSessionInfo,
  },
});

mock.module("../../changes/workflow.js", {
  namedExports: {
    handleFollowUp: mockHandleFollowUp,
  },
});

mock.module("../../streaming/slackStreamer.js", {
  namedExports: {
    SlackStreamer: class {
      handleEvent = mockStreamerHandleEvent;
      start = mockStreamerStart;
      stop = mockStreamerStop;
      hasFailed = false;
    },
    finalizeStreamedWorkflow: mockFinalizeStreamedWorkflow,
  },
});

// changeAction exports SlackDeliveryContext type used by this module
mock.module("./changeAction.js", {
  namedExports: {},
});

// Import after mocks are configured
const { registerChangeThreadActionHandlers, triggerFollowUp } = await import("./changeThreadActions.js");

// ============================================================================
// Helpers
// ============================================================================

function makeClient(): App["client"] {
  return {
    chat: {
      postEphemeral: mock.fn(async () => ({ ok: true })),
      postMessage: mock.fn(async () => ({ ok: true })),
    },
  } as unknown as App["client"];
}

/**
 * Capture all registered action handlers.
 * Returns a map of action pattern string to handler function.
 */
function captureHandlers(): Map<string, (args: Record<string, unknown>) => Promise<void>> {
  const actionFn = mock.fn();
  const app = { action: actionFn } as unknown as App;
  registerChangeThreadActionHandlers(app);

  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<void>>();
  for (const call of actionFn.mock.calls) {
    const pattern = call.arguments[0] as RegExp;
    const handler = call.arguments[1] as (args: Record<string, unknown>) => Promise<void>;
    handlers.set(pattern.source, handler);
  }
  return handlers;
}

/** Get a specific handler by its action ID prefix */
function getHandler(prefix: string): (args: Record<string, unknown>) => Promise<void> {
  const handlers = captureHandlers();
  for (const [source, handler] of handlers) {
    if (source.includes(prefix)) {
      return handler;
    }
  }
  throw new Error(`No handler found for prefix: ${prefix}`);
}

function makeHandlerArgs(overrides: Record<string, unknown> = {}) {
  const client = makeClient();
  const respondFn = mock.fn(async () => {});
  return {
    ack: mock.fn(async () => {}),
    body: {
      user: { id: "U001" },
      channel: { id: "C001" },
      actions: [{ value: "encoded-value" }],
      ...(overrides.body as Record<string, unknown> ?? {}),
    },
    client,
    respond: respondFn,
    ...overrides,
  };
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
    activeChange: {
      branch: "feat/x",
      repo: "org/repo",
      description: "d",
      status: "pr_created" as const,
      startedAt: new Date(),
      lastActivityAt: new Date(),
    },
    ...overrides,
  } as SessionContext;
}

beforeEach(() => {
  mockGetRole.mock.resetCalls();
  mockGetStagedIntent.mock.resetCalls();
  mockFindSessionByThread.mock.resetCalls();
  mockDecodeActionValue.mock.resetCalls();
  mockRestoreSessionInfo.mock.resetCalls();
  mockHandleFollowUp.mock.resetCalls();
  mockStreamerStart.mock.resetCalls();
  mockStreamerStop.mock.resetCalls();
  mockStreamerHandleEvent.mock.resetCalls();
  mockFinalizeStreamedWorkflow.mock.resetCalls();

  // Reset to defaults
  mockGetRole.mock.mockImplementation(async () => "dev");
  mockDecodeActionValue.mock.mockImplementation(() => ({ sessionId: "session-1", ref: "r1" }));
  mockRestoreSessionInfo.mock.mockImplementation(async () => ({
    channelId: "C001",
    threadTs: "1700000000.000001",
    userId: "U001",
  }));
  mockHandleFollowUp.mock.mockImplementation(async () => ({ success: true }));
  mockFindSessionByThread.mock.mockImplementation(async () => makeSession());
  mockFinalizeStreamedWorkflow.mock.mockImplementation(async () => {});
});

// ============================================================================
// Registration
// ============================================================================

describe("registerChangeThreadActionHandlers — registration", () => {
  it("registers four action handlers", () => {
    const actionFn = mock.fn();
    const app = { action: actionFn } as unknown as App;
    registerChangeThreadActionHandlers(app);
    assert.equal(actionFn.mock.callCount(), 4);
  });

  it("registers handlers for review, merge, update, and close", () => {
    const actionFn = mock.fn();
    const app = { action: actionFn } as unknown as App;
    registerChangeThreadActionHandlers(app);

    const patterns = actionFn.mock.calls.map(
      (call) => (call.arguments[0] as RegExp).source,
    );
    assert.ok(patterns.some((p) => p.includes("clack_review")));
    assert.ok(patterns.some((p) => p.includes("clack_merge")));
    assert.ok(patterns.some((p) => p.includes("clack_update_change")));
    assert.ok(patterns.some((p) => p.includes("clack_close")));
  });
});

// ============================================================================
// Permission checks (shared across all follow-up handlers)
// ============================================================================

describe("registerChangeThreadActionHandlers — permissions", () => {
  it("blocks member role with ephemeral message (review handler)", async () => {
    const handler = getHandler("clack_review");
    mockGetRole.mock.mockImplementation(async () => "member");
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.ack.mock.callCount(), 1);
    const postEphemeral = args.client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postEphemeral.mock.callCount(), 1);
    const msgArgs = postEphemeral.mock.calls[0].arguments[0] as { text: string };
    assert.ok(msgArgs.text.includes("permission"));
  });

  it("allows dev role (merge handler)", async () => {
    const handler = getHandler("clack_merge");
    mockGetRole.mock.mockImplementation(async () => "dev");

    const intent = { type: "merge", sessionId: "s", instructions: "" } as unknown as StagedIntent;
    mockGetStagedIntent.mock.mockImplementation(async () => intent);

    const args = makeHandlerArgs();
    await handler(args);

    // Should not get a permission error
    const postEphemeral = args.client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    for (const call of postEphemeral.mock.calls) {
      const text = (call.arguments[0] as { text: string }).text;
      assert.ok(!text.includes("permission"));
    }
  });
});

// ============================================================================
// Missing ref
// ============================================================================

describe("registerChangeThreadActionHandlers — missing ref", () => {
  it("returns early when ref is missing (close handler)", async () => {
    const handler = getHandler("clack_close");
    mockDecodeActionValue.mock.mockImplementation(() => ({ sessionId: "session-1" }));
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.ack.mock.callCount(), 1);
    assert.equal(mockRestoreSessionInfo.mock.callCount(), 0);
  });
});

// ============================================================================
// Session restoration failure
// ============================================================================

describe("registerChangeThreadActionHandlers — session not found", () => {
  it("returns early when session info cannot be restored", async () => {
    const handler = getHandler("clack_review");
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.respond.mock.callCount(), 1);
    assert.equal(mockGetStagedIntent.mock.callCount(), 0);
  });
});

// ============================================================================
// Intent resolution failures
// ============================================================================

describe("registerChangeThreadActionHandlers — intent resolution", () => {
  it("posts ephemeral when intent is not found", async () => {
    const handler = getHandler("clack_review");
    mockGetStagedIntent.mock.mockImplementation(async () => null);
    const args = makeHandlerArgs();

    await handler(args);

    const postEphemeral = args.client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postEphemeral.mock.callCount(), 1);
    const msgArgs = postEphemeral.mock.calls[0].arguments[0] as { text: string };
    assert.ok(msgArgs.text.includes("expired"));
  });

  it("posts ephemeral when intent type does not match expected type", async () => {
    const handler = getHandler("clack_review");
    // review handler expects type "review", but we provide "change"
    mockGetStagedIntent.mock.mockImplementation(async () => ({
      type: "change",
      branch: "feat/x",
      description: "d",
      repo: "r",
    }));
    const args = makeHandlerArgs();

    await handler(args);

    const postEphemeral = args.client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postEphemeral.mock.callCount(), 1);
    const msgArgs = postEphemeral.mock.calls[0].arguments[0] as { text: string };
    assert.ok(msgArgs.text.includes("expired"));
  });
});

// ============================================================================
// No active change
// ============================================================================

describe("registerChangeThreadActionHandlers — no active change", () => {
  it("posts ephemeral when session has no active change", async () => {
    const handler = getHandler("clack_review");
    // Return a valid intent so we get past the intent check
    mockGetStagedIntent.mock.mockImplementation(async () => ({
      type: "review",
      sessionId: "s1",
      instructions: "",
    } as unknown as StagedIntent));
    // Session with no activeChange
    mockFindSessionByThread.mock.mockImplementation(async () =>
      makeSession({ activeChange: undefined }),
    );
    const args = makeHandlerArgs();

    await handler(args);

    const postEphemeral = args.client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postEphemeral.mock.callCount(), 1);
    const msgArgs = postEphemeral.mock.calls[0].arguments[0] as { text: string };
    assert.ok(msgArgs.text.includes("No active change"));
  });

  it("posts ephemeral when findSessionByThread returns null", async () => {
    const handler = getHandler("clack_merge");
    mockGetStagedIntent.mock.mockImplementation(async () => ({
      type: "merge",
      sessionId: "s1",
      instructions: "",
    } as unknown as StagedIntent));
    mockFindSessionByThread.mock.mockImplementation(async () => null);
    const args = makeHandlerArgs();

    await handler(args);

    const postEphemeral = args.client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postEphemeral.mock.callCount(), 1);
    const msgArgs = postEphemeral.mock.calls[0].arguments[0] as { text: string };
    assert.ok(msgArgs.text.includes("No active change"));
  });
});

// ============================================================================
// Successful follow-up — review
// ============================================================================

describe("registerChangeThreadActionHandlers — successful review", () => {
  it("deletes original message, calls handleFollowUp with review command", async () => {
    const handler = getHandler("clack_review");
    const session = makeSession();

    mockGetStagedIntent.mock.mockImplementation(async () => ({
      type: "review",
      sessionId: "s1",
      instructions: "",
    } as unknown as StagedIntent));
    mockFindSessionByThread.mock.mockImplementation(async () => session);

    const args = makeHandlerArgs();
    await handler(args);

    assert.equal(args.ack.mock.callCount(), 1);
    assert.equal(args.respond.mock.callCount(), 1);
    const respondCall = args.respond.mock.calls[0] as unknown as { arguments: [{ delete_original: boolean }] };
    assert.equal(respondCall.arguments[0].delete_original, true);

    assert.equal(mockHandleFollowUp.mock.callCount(), 1);
    const followUpArgs = mockHandleFollowUp.mock.calls[0].arguments;
    assert.equal(followUpArgs[0], session);
    assert.equal(followUpArgs[1], "review");
    assert.equal(followUpArgs[2], undefined);
  });
});

// ============================================================================
// Update handler passes additional instructions
// ============================================================================

describe("registerChangeThreadActionHandlers — update with instructions", () => {
  it("extracts additional instructions from update intent", async () => {
    const handler = getHandler("clack_update_change");
    const session = makeSession();
    const updateIntent: StagedUpdateIntent = {
      type: "update",
      sessionId: "s1",
      instructions: "fix the tests please",
    };

    mockGetStagedIntent.mock.mockImplementation(async () => updateIntent);
    mockFindSessionByThread.mock.mockImplementation(async () => session);

    const args = makeHandlerArgs();
    await handler(args);

    assert.equal(mockHandleFollowUp.mock.callCount(), 1);
    const followUpArgs = mockHandleFollowUp.mock.calls[0].arguments;
    assert.equal(followUpArgs[1], "update");
    assert.equal(followUpArgs[2], "fix the tests please");
  });
});

// ============================================================================
// Close handler
// ============================================================================

describe("registerChangeThreadActionHandlers — close", () => {
  it("triggers close follow-up with no additional instructions", async () => {
    const handler = getHandler("clack_close");
    const session = makeSession();

    mockGetStagedIntent.mock.mockImplementation(async () => ({
      type: "close",
      sessionId: "s1",
      instructions: "",
    } as unknown as StagedIntent));
    mockFindSessionByThread.mock.mockImplementation(async () => session);

    const args = makeHandlerArgs();
    await handler(args);

    assert.equal(mockHandleFollowUp.mock.callCount(), 1);
    const followUpArgs = mockHandleFollowUp.mock.calls[0].arguments;
    assert.equal(followUpArgs[1], "close");
    assert.equal(followUpArgs[2], undefined);
  });
});

// ============================================================================
// triggerFollowUp — shared logic
// ============================================================================

describe("triggerFollowUp", () => {
  it("starts streamer, calls handleFollowUp, and finalizes", async () => {
    const session = makeSession();
    const client = makeClient();

    await triggerFollowUp(session, "review", undefined, {
      channelId: "C001",
      threadTs: "1700000000.000001",
      userId: "U001",
      client,
    });

    assert.equal(mockStreamerStart.mock.callCount(), 1);
    assert.equal(mockHandleFollowUp.mock.callCount(), 1);

    const followUpArgs = mockHandleFollowUp.mock.calls[0].arguments;
    assert.equal(followUpArgs[0], session);
    assert.equal(followUpArgs[1], "review");
    assert.equal(followUpArgs[2], undefined);

    assert.equal(mockFinalizeStreamedWorkflow.mock.callCount(), 1);
  });

  it("passes additional instructions for update command", async () => {
    const session = makeSession();
    const client = makeClient();

    await triggerFollowUp(session, "update", "fix the bug", {
      channelId: "C001",
      threadTs: "1700000000.000001",
      userId: "U001",
      client,
    });

    const followUpArgs = mockHandleFollowUp.mock.calls[0].arguments;
    assert.equal(followUpArgs[1], "update");
    assert.equal(followUpArgs[2], "fix the bug");
  });

  it("uses DM stream channel when provided", async () => {
    const session = makeSession();
    const client = makeClient();

    await triggerFollowUp(session, "merge", undefined, {
      channelId: "C001",
      threadTs: "1700000000.000001",
      userId: "U001",
      client,
      streamChannel: "D_DM",
      streamThreadTs: "1700000099.000001",
    });

    assert.equal(mockFinalizeStreamedWorkflow.mock.callCount(), 1);
    const finalizeCall = mockFinalizeStreamedWorkflow.mock.calls[0] as unknown as { arguments: unknown[] };
    assert.equal(finalizeCall.arguments[2], "D_DM");
    assert.equal(finalizeCall.arguments[3], "1700000099.000001");
  });

  it("falls back to channelId when streamChannel is not provided", async () => {
    const session = makeSession();
    const client = makeClient();

    await triggerFollowUp(session, "review", undefined, {
      channelId: "C001",
      threadTs: "1700000000.000001",
      userId: "U001",
      client,
    });

    const finalizeCall = mockFinalizeStreamedWorkflow.mock.calls[0] as unknown as { arguments: unknown[] };
    assert.equal(finalizeCall.arguments[2], "C001");
    assert.equal(finalizeCall.arguments[3], "1700000000.000001");
  });

  it("handles workflow error by stopping streamer and posting error message", async () => {
    mockHandleFollowUp.mock.mockImplementation(async () => {
      throw new Error("follow-up exploded");
    });

    const session = makeSession();
    const client = makeClient();

    await triggerFollowUp(session, "review", undefined, {
      channelId: "C001",
      threadTs: "1700000000.000001",
      userId: "U001",
      client,
    });

    assert.equal(mockStreamerStop.mock.callCount(), 1);
    const postMessage = client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postMessage.mock.callCount(), 1);
    const msgArgs = postMessage.mock.calls[0].arguments[0] as { text: string };
    assert.ok(msgArgs.text.includes("failed unexpectedly"));
    assert.ok(msgArgs.text.includes("follow-up exploded"));
  });

  it("posts error to stream channel when DM context fails", async () => {
    mockHandleFollowUp.mock.mockImplementation(async () => {
      throw new Error("boom");
    });

    const session = makeSession();
    const client = makeClient();

    await triggerFollowUp(session, "review", undefined, {
      channelId: "C001",
      threadTs: "1700000000.000001",
      userId: "U001",
      client,
      streamChannel: "D_DM",
      streamThreadTs: "1700000099.000001",
    });

    const postMessage = client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
    const msgArgs = postMessage.mock.calls[0].arguments[0] as { channel: string; thread_ts: string };
    assert.equal(msgArgs.channel, "D_DM");
    assert.equal(msgArgs.thread_ts, "1700000099.000001");
  });
});
