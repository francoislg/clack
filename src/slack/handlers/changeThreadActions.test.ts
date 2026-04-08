import { describe, it, mock, beforeEach, type Mock } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { UserRole } from "../../roles.js";
import type { StagedIntent, StagedUpdateIntent } from "../../tools/types.js";
import type { SessionInfo } from "../activeSessions.js";
import type { SessionContext } from "../../sessions.js";
import type { ChangeResult, FollowUpCommand } from "../../changes/types.js";
import {
  registerChangeThreadActionHandlers,
  triggerFollowUp,
  type ChangeThreadActionsDeps,
} from "./changeThreadActions.js";

// ============================================================================
// Mocks
// ============================================================================

const mockGetRole = mock.fn<(userId: string) => Promise<UserRole>>(async () => "dev");
const mockGetStagedIntent = mock.fn<
  (sessionId: string, ref: string) => Promise<StagedIntent | null>
>(async () => null);
const mockFindSessionByThread = mock.fn<
  (channelId: string, threadTs: string) => Promise<SessionContext | null>
>(async () => null);
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
const mockCanRequestChanges = mock.fn<(role: UserRole) => boolean>(
  (role) => role === "dev" || role === "admin" || role === "owner",
);
const mockHandleFollowUp = mock.fn<ChangeThreadActionsDeps["handleFollowUp"]>(async () => ({
  success: true,
}));
const mockErrorMessage = mock.fn<ChangeThreadActionsDeps["errorMessage"]>((err) =>
  err instanceof Error ? err.message : String(err),
);

// SlackStreamer mock
const mockStreamerStart = mock.fn(async () => true);
const mockStreamerStop = mock.fn(async () => {});
const mockStreamerHandleEvent = mock.fn();
const mockCreateStreamer = mock.fn(() => ({
  start: mockStreamerStart,
  stop: mockStreamerStop,
  handleEvent: mockStreamerHandleEvent,
  hasFailed: false,
}));
const mockFinalizeStreamedWorkflow = mock.fn<ChangeThreadActionsDeps["finalizeStreamedWorkflow"]>(
  async () => {},
);

const mockPostEphemeralFn = mock.fn<
  (args: {
    channel: string;
    user?: string;
    text: string;
    thread_ts?: string;
  }) => Promise<{ ok: boolean }>
>(async () => ({ ok: true }));
const mockPostMessageFn = mock.fn<
  (args: { channel: string; thread_ts: string; text: string }) => Promise<{ ok: boolean }>
>(async () => ({ ok: true }));

function makeDeps(): ChangeThreadActionsDeps {
  return {
    getRole: mockGetRole,
    canRequestChanges: mockCanRequestChanges,
    decodeActionValue: mockDecodeActionValue,
    restoreSession: mockRestoreSessionInfo,
    getStagedIntent: mockGetStagedIntent,
    findSessionByThread: mockFindSessionByThread,
    handleFollowUp: mockHandleFollowUp,
    errorMessage: mockErrorMessage,
    createStreamer: mockCreateStreamer,
    finalizeStreamedWorkflow: mockFinalizeStreamedWorkflow,
  };
}

// ============================================================================
// Helpers
// ============================================================================

interface HandlerArgs {
  ack: Mock<() => Promise<void>>;
  body: { actions: Array<{ value: string }>; user: { id: string }; channel?: { id: string } };
  client: App["client"];
  respond: Mock<(args: object) => Promise<void>>;
}

type ActionHandler = (args: HandlerArgs) => Promise<void>;

const registeredHandlers = new Map<string, ActionHandler>();

function makeApp(deps: ChangeThreadActionsDeps): App {
  registeredHandlers.clear();
  const app = {
    action: (_pattern: RegExp, handler: ActionHandler) => {
      registeredHandlers.set(_pattern.source, handler);
    },
  } as object as App;
  registerChangeThreadActionHandlers(app, deps);
  return app;
}

function makeClient(): App["client"] {
  return {
    chat: {
      postEphemeral: mockPostEphemeralFn,
      postMessage: mockPostMessageFn,
    },
  } as object as App["client"];
}

/** Get a specific handler by its action ID prefix */
function getHandler(prefix: string): ActionHandler {
  for (const [source, handler] of registeredHandlers) {
    if (source.includes(prefix)) {
      return handler;
    }
  }
  throw new Error(`No handler found for prefix: ${prefix}`);
}

function makeHandlerArgs(overrides: Partial<HandlerArgs> = {}): HandlerArgs {
  const client = makeClient();
  const respondFn = mock.fn(async () => {});
  const body = {
    user: { id: "U001" },
    channel: { id: "C001" },
    actions: [{ value: "encoded-value" }],
    ...overrides.body,
  };
  return {
    ack: mock.fn(async () => {}),
    body,
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
  mockCanRequestChanges.mock.resetCalls();
  mockHandleFollowUp.mock.resetCalls();
  mockErrorMessage.mock.resetCalls();
  mockStreamerStart.mock.resetCalls();
  mockStreamerStop.mock.resetCalls();
  mockStreamerHandleEvent.mock.resetCalls();
  mockCreateStreamer.mock.resetCalls();
  mockFinalizeStreamedWorkflow.mock.resetCalls();
  mockPostEphemeralFn.mock.resetCalls();
  mockPostMessageFn.mock.resetCalls();

  // Reset to defaults
  mockGetRole.mock.mockImplementation(async () => "dev");
  mockCanRequestChanges.mock.mockImplementation(
    (role) => role === "dev" || role === "admin" || role === "owner",
  );
  mockDecodeActionValue.mock.mockImplementation(() => ({ sessionId: "session-1", ref: "r1" }));
  mockRestoreSessionInfo.mock.mockImplementation(async () => ({
    channelId: "C001",
    threadTs: "1700000000.000001",
    userId: "U001",
  }));
  mockHandleFollowUp.mock.mockImplementation(async () => ({ success: true }));
  mockFindSessionByThread.mock.mockImplementation(async () => makeSession());
  mockErrorMessage.mock.mockImplementation((err) =>
    err instanceof Error ? err.message : String(err),
  );
  mockStreamerStart.mock.mockImplementation(async () => true);
  mockStreamerStop.mock.mockImplementation(async () => {});
  mockCreateStreamer.mock.mockImplementation(() => ({
    start: mockStreamerStart,
    stop: mockStreamerStop,
    handleEvent: mockStreamerHandleEvent,
    hasFailed: false,
  }));
  mockFinalizeStreamedWorkflow.mock.mockImplementation(async () => {});

  // Register handlers
  makeApp(makeDeps());
});

// ============================================================================
// Registration
// ============================================================================

describe("registerChangeThreadActionHandlers — registration", () => {
  it("registers four action handlers", () => {
    assert.equal(registeredHandlers.size, 4, "should register exactly four action handlers");
  });

  it("registers handlers for review, merge, update, and close", () => {
    const patterns = Array.from(registeredHandlers.keys());
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
    mockCanRequestChanges.mock.mockImplementation(
      (role) => role === "dev" || role === "admin" || role === "owner",
    );
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.ack.mock.callCount(), 1);
    assert.equal(mockPostEphemeralFn.mock.callCount(), 1);
    const msgArg = mockPostEphemeralFn.mock.calls[0].arguments[0];
    assert.ok(
      msgArg &&
        typeof msgArg === "object" &&
        "text" in msgArg &&
        typeof msgArg.text === "string" &&
        msgArg.text.includes("permission"),
    );
  });

  it("allows dev role (merge handler)", async () => {
    const handler = getHandler("clack_merge");
    mockGetRole.mock.mockImplementation(async () => "dev");

    const intent: StagedIntent = { type: "merge", sessionId: "s", instructions: "" };
    mockGetStagedIntent.mock.mockImplementation(async () => intent);

    const args = makeHandlerArgs();
    await handler(args);

    // Should not get a permission error
    for (const call of mockPostEphemeralFn.mock.calls) {
      const callArg = call.arguments[0];
      if (
        callArg &&
        typeof callArg === "object" &&
        "text" in callArg &&
        typeof callArg.text === "string"
      ) {
        assert.ok(!callArg.text.includes("permission"));
      }
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

    assert.equal(mockPostEphemeralFn.mock.callCount(), 1);
    const msgArg = mockPostEphemeralFn.mock.calls[0].arguments[0];
    assert.ok(
      msgArg &&
        typeof msgArg === "object" &&
        "text" in msgArg &&
        typeof msgArg.text === "string" &&
        msgArg.text.includes("expired"),
    );
  });

  it("posts ephemeral when intent type does not match expected type", async () => {
    const handler = getHandler("clack_review");
    // review handler expects type "review", but we provide "change"
    mockGetStagedIntent.mock.mockImplementation(async () => {
      const intent: StagedIntent = {
        type: "change",
        branch: "feat/x",
        description: "d",
        repo: "r",
      };
      return intent;
    });
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(mockPostEphemeralFn.mock.callCount(), 1);
    const msgArg = mockPostEphemeralFn.mock.calls[0].arguments[0];
    assert.ok(
      msgArg &&
        typeof msgArg === "object" &&
        "text" in msgArg &&
        typeof msgArg.text === "string" &&
        msgArg.text.includes("expired"),
    );
  });
});

// ============================================================================
// No active change
// ============================================================================

describe("registerChangeThreadActionHandlers — no active change", () => {
  it("posts ephemeral when session has no active change", async () => {
    const handler = getHandler("clack_review");
    // Return a valid intent so we get past the intent check
    const intent: StagedIntent = {
      type: "review",
      sessionId: "s1",
      instructions: "",
    };
    mockGetStagedIntent.mock.mockImplementation(async () => intent);
    // Session with no activeChange
    mockFindSessionByThread.mock.mockImplementation(async () =>
      makeSession({ activeChange: undefined }),
    );
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(mockPostEphemeralFn.mock.callCount(), 1);
    const msgArg = mockPostEphemeralFn.mock.calls[0].arguments[0];
    assert.ok(
      msgArg &&
        typeof msgArg === "object" &&
        "text" in msgArg &&
        typeof msgArg.text === "string" &&
        msgArg.text.includes("No active change"),
    );
  });

  it("posts ephemeral when findSessionByThread returns null", async () => {
    const handler = getHandler("clack_merge");
    const intent: StagedIntent = {
      type: "merge",
      sessionId: "s1",
      instructions: "",
    };
    mockGetStagedIntent.mock.mockImplementation(async () => intent);
    mockFindSessionByThread.mock.mockImplementation(async () => null);
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(mockPostEphemeralFn.mock.callCount(), 1);
    const msgArg = mockPostEphemeralFn.mock.calls[0].arguments[0];
    assert.ok(
      msgArg &&
        typeof msgArg === "object" &&
        "text" in msgArg &&
        typeof msgArg.text === "string" &&
        msgArg.text.includes("No active change"),
    );
  });
});

// ============================================================================
// Successful follow-up — review
// ============================================================================

describe("registerChangeThreadActionHandlers — successful review", () => {
  it("deletes original message, calls handleFollowUp with review command", async () => {
    const handler = getHandler("clack_review");
    const session = makeSession();

    const intent: StagedIntent = {
      type: "review",
      sessionId: "s1",
      instructions: "",
    };
    mockGetStagedIntent.mock.mockImplementation(async () => intent);
    mockFindSessionByThread.mock.mockImplementation(async () => session);

    const args = makeHandlerArgs();
    await handler(args);

    assert.equal(args.ack.mock.callCount(), 1);
    assert.equal(args.respond.mock.callCount(), 1);
    const respondCall = args.respond.mock.calls[0];
    const respondArg = respondCall.arguments[0];
    assert.ok(
      respondArg &&
        typeof respondArg === "object" &&
        "delete_original" in respondArg &&
        respondArg.delete_original === true,
    );

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

    const intent: StagedIntent = {
      type: "close",
      sessionId: "s1",
      instructions: "",
    };
    mockGetStagedIntent.mock.mockImplementation(async () => intent);
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

    await triggerFollowUp(
      session,
      "review",
      undefined,
      {
        channelId: "C001",
        threadTs: "1700000000.000001",
        userId: "U001",
        client,
      },
      makeDeps(),
    );

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

    await triggerFollowUp(
      session,
      "update",
      "fix the bug",
      {
        channelId: "C001",
        threadTs: "1700000000.000001",
        userId: "U001",
        client,
      },
      makeDeps(),
    );

    const followUpArgs = mockHandleFollowUp.mock.calls[0].arguments;
    assert.equal(followUpArgs[1], "update");
    assert.equal(followUpArgs[2], "fix the bug");
  });

  it("uses DM stream channel when provided", async () => {
    const session = makeSession();
    const client = makeClient();

    await triggerFollowUp(
      session,
      "merge",
      undefined,
      {
        channelId: "C001",
        threadTs: "1700000000.000001",
        userId: "U001",
        client,
        streamChannel: "D_DM",
        streamThreadTs: "1700000099.000001",
      },
      makeDeps(),
    );

    assert.equal(mockFinalizeStreamedWorkflow.mock.callCount(), 1);
    const finalizeCall = mockFinalizeStreamedWorkflow.mock.calls[0];
    const channel = finalizeCall.arguments[2];
    const threadTs = finalizeCall.arguments[3];
    assert.equal(channel, "D_DM");
    assert.equal(threadTs, "1700000099.000001");
  });

  it("falls back to channelId when streamChannel is not provided", async () => {
    const session = makeSession();
    const client = makeClient();

    await triggerFollowUp(
      session,
      "review",
      undefined,
      {
        channelId: "C001",
        threadTs: "1700000000.000001",
        userId: "U001",
        client,
      },
      makeDeps(),
    );

    const finalizeCall = mockFinalizeStreamedWorkflow.mock.calls[0];
    const channel = finalizeCall.arguments[2];
    const threadTs = finalizeCall.arguments[3];
    assert.equal(channel, "C001");
    assert.equal(threadTs, "1700000000.000001");
  });

  it("handles workflow error by stopping streamer and posting error message", async () => {
    mockHandleFollowUp.mock.mockImplementation(async () => {
      throw new Error("follow-up exploded");
    });

    const session = makeSession();
    const client = makeClient();

    await triggerFollowUp(
      session,
      "review",
      undefined,
      {
        channelId: "C001",
        threadTs: "1700000000.000001",
        userId: "U001",
        client,
      },
      makeDeps(),
    );

    assert.equal(mockStreamerStop.mock.callCount(), 1);
    assert.equal(mockPostMessageFn.mock.callCount(), 1);
    const msgArg = mockPostMessageFn.mock.calls[0].arguments[0];
    assert.ok(
      msgArg &&
        typeof msgArg === "object" &&
        "text" in msgArg &&
        typeof msgArg.text === "string" &&
        msgArg.text.includes("failed unexpectedly"),
    );
    assert.ok(
      msgArg &&
        typeof msgArg === "object" &&
        "text" in msgArg &&
        typeof msgArg.text === "string" &&
        msgArg.text.includes("follow-up exploded"),
    );
  });

  it("posts error to stream channel when DM context fails", async () => {
    mockHandleFollowUp.mock.mockImplementation(async () => {
      throw new Error("boom");
    });

    const session = makeSession();
    const client = makeClient();

    await triggerFollowUp(
      session,
      "review",
      undefined,
      {
        channelId: "C001",
        threadTs: "1700000000.000001",
        userId: "U001",
        client,
        streamChannel: "D_DM",
        streamThreadTs: "1700000099.000001",
      },
      makeDeps(),
    );

    const msgArg = mockPostMessageFn.mock.calls[0].arguments[0];
    if (msgArg && typeof msgArg === "object" && "channel" in msgArg && "thread_ts" in msgArg) {
      assert.equal(msgArg.channel, "D_DM");
      assert.equal(msgArg.thread_ts, "1700000099.000001");
    }
  });
});
