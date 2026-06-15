import { describe, it, vi, beforeEach, type Mock } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { UserRole } from "../../roles.js";
import type { StagedIntent, StagedUpdateIntent } from "../../tools/types.js";
import type { SessionInfo } from "../activeSessions.js";
import type { SessionContext } from "../../sessions.js";
import type { ActiveChangeState } from "../../changes/activeState.js";
import {
  maybeOfferRecovery,
  registerChangeThreadActionHandlers,
  triggerFollowUp,
  type ChangeThreadActionsDeps,
} from "./changeThreadActions.js";

// ============================================================================
// Mocks
// ============================================================================

const mockGetRole = vi.fn<(userId: string) => Promise<UserRole>>(async () => "dev");
const mockGetStagedIntent = vi.fn<(sessionId: string, ref: string) => Promise<StagedIntent | null>>(
  async () => null,
);
const mockFindSessionByThread = vi.fn<
  (channelId: string, threadTs: string) => Promise<SessionContext | null>
>(async () => null);
const mockDecodeActionValue = vi.fn<(value: string) => { sessionId: string; ref?: string }>(() => ({
  sessionId: "session-1",
  ref: "r1",
}));
const mockRestoreSessionInfo = vi.fn<(sessionId: string) => Promise<SessionInfo | undefined>>(
  async () => ({
    channelId: "C001",
    threadTs: "1700000000.000001",
    userId: "U001",
  }),
);
const mockCanRequestChanges = vi.fn<(role: UserRole) => boolean>(
  (role) => role === "dev" || role === "admin" || role === "owner",
);
const mockHandleFollowUp = vi.fn<ChangeThreadActionsDeps["handleFollowUp"]>(async () => ({
  success: true,
}));
const mockErrorMessage = vi.fn<ChangeThreadActionsDeps["errorMessage"]>((err) =>
  err instanceof Error ? err.message : String(err),
);

// SlackStreamer mock
const mockStreamerStart = vi.fn(async () => true);
const mockStreamerStop = vi.fn(async () => {});
const mockStreamerHandleEvent = vi.fn();
const mockCreateStreamer = vi.fn(() => ({
  start: mockStreamerStart,
  stop: mockStreamerStop,
  handleEvent: mockStreamerHandleEvent,
  hasFailed: false,
}));
const mockFinalizeStreamedWorkflow = vi.fn<ChangeThreadActionsDeps["finalizeStreamedWorkflow"]>(
  async () => {},
);
const mockSetAttentionLevel = vi.fn<ChangeThreadActionsDeps["setAttentionLevel"]>(async () => {});
const mockGetActiveChange = vi.fn<ChangeThreadActionsDeps["getActiveChange"]>(() => undefined);

const mockPostEphemeralFn = vi.fn<
  (args: {
    channel: string;
    user?: string;
    text: string;
    thread_ts?: string;
  }) => Promise<{ ok: boolean }>
>(async () => ({ ok: true }));
const mockPostMessageFn = vi.fn<
  (args: {
    channel: string;
    thread_ts: string;
    text: string;
    blocks?: Array<{ type: string }>;
  }) => Promise<{ ok: boolean }>
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
    setAttentionLevel: mockSetAttentionLevel,
    getActiveChange: mockGetActiveChange,
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
  const respondFn = vi.fn(async () => {});
  const body = {
    user: { id: "U001" },
    channel: { id: "C001" },
    actions: [{ value: "encoded-value" }],
    ...overrides.body,
  };
  return {
    ack: vi.fn(async () => {}),
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
  mockGetRole.mockClear();
  mockGetStagedIntent.mockClear();
  mockFindSessionByThread.mockClear();
  mockDecodeActionValue.mockClear();
  mockRestoreSessionInfo.mockClear();
  mockCanRequestChanges.mockClear();
  mockHandleFollowUp.mockClear();
  mockErrorMessage.mockClear();
  mockStreamerStart.mockClear();
  mockStreamerStop.mockClear();
  mockStreamerHandleEvent.mockClear();
  mockCreateStreamer.mockClear();
  mockFinalizeStreamedWorkflow.mockClear();
  mockPostEphemeralFn.mockClear();
  mockPostMessageFn.mockClear();
  mockSetAttentionLevel.mockClear();
  mockGetActiveChange.mockClear();
  mockGetActiveChange.mockImplementation(() => undefined);

  // Reset to defaults
  mockGetRole.mockImplementation(async () => "dev");
  mockCanRequestChanges.mockImplementation(
    (role) => role === "dev" || role === "admin" || role === "owner",
  );
  mockDecodeActionValue.mockImplementation(() => ({ sessionId: "session-1", ref: "r1" }));
  mockRestoreSessionInfo.mockImplementation(async () => ({
    channelId: "C001",
    threadTs: "1700000000.000001",
    userId: "U001",
  }));
  mockHandleFollowUp.mockImplementation(async () => ({ success: true }));
  mockFindSessionByThread.mockImplementation(async () => makeSession());
  mockErrorMessage.mockImplementation((err) => (err instanceof Error ? err.message : String(err)));
  mockStreamerStart.mockImplementation(async () => true);
  mockStreamerStop.mockImplementation(async () => {});
  mockCreateStreamer.mockImplementation(() => ({
    start: mockStreamerStart,
    stop: mockStreamerStop,
    handleEvent: mockStreamerHandleEvent,
    hasFailed: false,
  }));
  mockFinalizeStreamedWorkflow.mockImplementation(async () => {});

  // Register handlers
  makeApp(makeDeps());
});

// ============================================================================
// Registration
// ============================================================================

describe("registerChangeThreadActionHandlers — registration", () => {
  it("registers seven action handlers", () => {
    assert.equal(registeredHandlers.size, 7, "should register exactly seven action handlers");
  });

  it("registers handlers for review, merge, update, and close", () => {
    const patterns = Array.from(registeredHandlers.keys());
    assert.ok(patterns.some((p) => p.includes("clack_review")));
    assert.ok(patterns.some((p) => p.includes("clack_merge")));
    assert.ok(patterns.some((p) => p.includes("clack_update_change")));
    assert.ok(patterns.some((p) => p.includes("clack_close")));
  });

  it("registers handlers for the recovery actions", () => {
    const patterns = Array.from(registeredHandlers.keys());
    assert.ok(patterns.some((p) => p.includes("clack_continue_change")));
    assert.ok(patterns.some((p) => p.includes("clack_restart_change")));
    assert.ok(patterns.some((p) => p.includes("clack_discard_change")));
  });
});

// ============================================================================
// Permission checks (shared across all follow-up handlers)
// ============================================================================

describe("registerChangeThreadActionHandlers — permissions", () => {
  it("blocks member role with ephemeral message (review handler)", async () => {
    const handler = getHandler("clack_review");
    mockGetRole.mockImplementation(async () => "member");
    mockCanRequestChanges.mockImplementation(
      (role) => role === "dev" || role === "admin" || role === "owner",
    );
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.ack.mock.calls.length, 1);
    assert.equal(mockPostEphemeralFn.mock.calls.length, 1);
    const msgArg = mockPostEphemeralFn.mock.calls[0][0];
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
    mockGetRole.mockImplementation(async () => "dev");

    const intent: StagedIntent = { type: "merge", sessionId: "s", instructions: "" };
    mockGetStagedIntent.mockImplementation(async () => intent);

    const args = makeHandlerArgs();
    await handler(args);

    // Should not get a permission error
    for (const call of mockPostEphemeralFn.mock.calls) {
      const callArg = call[0];
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
    mockDecodeActionValue.mockImplementation(() => ({ sessionId: "session-1" }));
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.ack.mock.calls.length, 1);
    assert.equal(mockRestoreSessionInfo.mock.calls.length, 0);
  });
});

// ============================================================================
// Session restoration failure
// ============================================================================

describe("registerChangeThreadActionHandlers — session not found", () => {
  it("returns early when session info cannot be restored", async () => {
    const handler = getHandler("clack_review");
    mockRestoreSessionInfo.mockImplementation(async () => undefined);
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.respond.mock.calls.length, 1);
    assert.equal(mockGetStagedIntent.mock.calls.length, 0);
  });
});

// ============================================================================
// Intent resolution failures
// ============================================================================

describe("registerChangeThreadActionHandlers — intent resolution", () => {
  it("posts ephemeral when intent is not found", async () => {
    const handler = getHandler("clack_review");
    mockGetStagedIntent.mockImplementation(async () => null);
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(mockPostEphemeralFn.mock.calls.length, 1);
    const msgArg = mockPostEphemeralFn.mock.calls[0][0];
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
    mockGetStagedIntent.mockImplementation(async () => {
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

    assert.equal(mockPostEphemeralFn.mock.calls.length, 1);
    const msgArg = mockPostEphemeralFn.mock.calls[0][0];
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
    mockGetStagedIntent.mockImplementation(async () => intent);
    // Session with no activeChange
    mockFindSessionByThread.mockImplementation(async () =>
      makeSession({ activeChange: undefined }),
    );
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(mockPostEphemeralFn.mock.calls.length, 1);
    const msgArg = mockPostEphemeralFn.mock.calls[0][0];
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
    mockGetStagedIntent.mockImplementation(async () => intent);
    mockFindSessionByThread.mockImplementation(async () => null);
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(mockPostEphemeralFn.mock.calls.length, 1);
    const msgArg = mockPostEphemeralFn.mock.calls[0][0];
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
    mockGetStagedIntent.mockImplementation(async () => intent);
    mockFindSessionByThread.mockImplementation(async () => session);

    const args = makeHandlerArgs();
    await handler(args);

    assert.equal(args.ack.mock.calls.length, 1);
    assert.equal(args.respond.mock.calls.length, 1);
    const respondCall = args.respond.mock.calls[0];
    const respondArg = respondCall[0];
    assert.ok(
      respondArg &&
        typeof respondArg === "object" &&
        "delete_original" in respondArg &&
        respondArg.delete_original === true,
    );

    assert.equal(mockHandleFollowUp.mock.calls.length, 1);
    const followUpArgs = mockHandleFollowUp.mock.calls[0];
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

    mockGetStagedIntent.mockImplementation(async () => updateIntent);
    mockFindSessionByThread.mockImplementation(async () => session);

    const args = makeHandlerArgs();
    await handler(args);

    assert.equal(mockHandleFollowUp.mock.calls.length, 1);
    const followUpArgs = mockHandleFollowUp.mock.calls[0];
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
    mockGetStagedIntent.mockImplementation(async () => intent);
    mockFindSessionByThread.mockImplementation(async () => session);

    const args = makeHandlerArgs();
    await handler(args);

    assert.equal(mockHandleFollowUp.mock.calls.length, 1);
    const followUpArgs = mockHandleFollowUp.mock.calls[0];
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

    assert.equal(mockStreamerStart.mock.calls.length, 1);
    assert.equal(mockHandleFollowUp.mock.calls.length, 1);

    const followUpArgs = mockHandleFollowUp.mock.calls[0];
    assert.equal(followUpArgs[0], session);
    assert.equal(followUpArgs[1], "review");
    assert.equal(followUpArgs[2], undefined);

    assert.equal(mockFinalizeStreamedWorkflow.mock.calls.length, 1);
  });

  it("re-engages a disengaged thread before running the follow-up", async () => {
    const session = makeSession({ attentionLevel: "off" });
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

    assert.equal(mockSetAttentionLevel.mock.calls.length, 1);
    const args = mockSetAttentionLevel.mock.calls[0];
    assert.equal(args[0], "session-1");
    assert.equal(args[1], "medium");
    assert.equal(mockHandleFollowUp.mock.calls.length, 1);
  });

  it("does NOT re-engage a thread that is already active", async () => {
    const session = makeSession({ attentionLevel: "medium" });
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

    assert.equal(mockSetAttentionLevel.mock.calls.length, 0);
  });

  it("does NOT re-engage when attentionLevel is undefined", async () => {
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
      },
      makeDeps(),
    );

    assert.equal(mockSetAttentionLevel.mock.calls.length, 0);
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

    const followUpArgs = mockHandleFollowUp.mock.calls[0];
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

    assert.equal(mockFinalizeStreamedWorkflow.mock.calls.length, 1);
    const finalizeCall = mockFinalizeStreamedWorkflow.mock.calls[0];
    const channel = finalizeCall[2];
    const threadTs = finalizeCall[3];
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
    const channel = finalizeCall[2];
    const threadTs = finalizeCall[3];
    assert.equal(channel, "C001");
    assert.equal(threadTs, "1700000000.000001");
  });

  it("handles workflow error by stopping streamer and posting error message", async () => {
    mockHandleFollowUp.mockImplementation(async () => {
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

    assert.equal(mockStreamerStop.mock.calls.length, 1);
    assert.equal(mockPostMessageFn.mock.calls.length, 1);
    const msgArg = mockPostMessageFn.mock.calls[0][0];
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
    mockHandleFollowUp.mockImplementation(async () => {
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

    const msgArg = mockPostMessageFn.mock.calls[0][0];
    if (msgArg && typeof msgArg === "object" && "channel" in msgArg && "thread_ts" in msgArg) {
      assert.equal(msgArg.channel, "D_DM");
      assert.equal(msgArg.thread_ts, "1700000099.000001");
    }
  });

  it("offers the recovery actions when the change ends up failed", async () => {
    mockGetActiveChange.mockImplementation(() => makeActiveChangeForRecovery("failed"));
    const session = makeSession();
    const client = makeClient();

    await triggerFollowUp(
      session,
      "continue",
      undefined,
      {
        channelId: "C001",
        threadTs: "1700000000.000001",
        userId: "U001",
        client,
      },
      makeDeps(),
    );

    assert.equal(mockPostMessageFn.mock.calls.length, 1);
    const msgArg = mockPostMessageFn.mock.calls[0][0];
    assert.ok(Array.isArray(msgArg.blocks) && msgArg.blocks.length === 2);
  });

  it("does not offer recovery actions when the change is not failed", async () => {
    mockGetActiveChange.mockImplementation(() => makeActiveChangeForRecovery("pr_created"));
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

    assert.equal(mockPostMessageFn.mock.calls.length, 0);
  });
});

// ============================================================================
// Recovery button handlers
// ============================================================================

function makeActiveChangeForRecovery(status: ActiveChangeState["status"]): ActiveChangeState {
  return {
    branch: "feat/x",
    repo: "org/repo",
    description: "d",
    status,
    startedAt: new Date(),
    lastActivityAt: new Date(),
  };
}

describe("registerChangeThreadActionHandlers — recovery buttons", () => {
  it("continue button triggers the continue follow-up without a staged intent", async () => {
    const handler = getHandler("clack_continue_change");
    const session = makeSession();
    mockFindSessionByThread.mockImplementation(async () => session);

    const args = makeHandlerArgs();
    await handler(args);

    assert.equal(mockGetStagedIntent.mock.calls.length, 0, "no intent resolution");
    assert.equal(mockHandleFollowUp.mock.calls.length, 1);
    const followUpArgs = mockHandleFollowUp.mock.calls[0];
    assert.equal(followUpArgs[0], session);
    assert.equal(followUpArgs[1], "continue");
    assert.equal(followUpArgs[2], undefined);
  });

  it("restart and discard buttons map to their commands", async () => {
    for (const [prefix, command] of [
      ["clack_restart_change", "restart"],
      ["clack_discard_change", "discard"],
    ] as const) {
      mockHandleFollowUp.mockClear();
      const handler = getHandler(prefix);

      await handler(makeHandlerArgs());

      assert.equal(mockHandleFollowUp.mock.calls.length, 1);
      assert.equal(mockHandleFollowUp.mock.calls[0][1], command);
    }
  });

  it("deletes the buttons message after validation", async () => {
    const handler = getHandler("clack_continue_change");
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.respond.mock.calls.length, 1);
    const respondArg = args.respond.mock.calls[0][0];
    assert.ok(
      respondArg &&
        typeof respondArg === "object" &&
        "delete_original" in respondArg &&
        respondArg.delete_original === true,
    );
  });

  it("blocks member role with an ephemeral message and keeps the buttons", async () => {
    const handler = getHandler("clack_restart_change");
    mockGetRole.mockImplementation(async () => "member");
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(mockHandleFollowUp.mock.calls.length, 0);
    assert.equal(args.respond.mock.calls.length, 0, "buttons stay for an authorized dev");
    assert.equal(mockPostEphemeralFn.mock.calls.length, 1);
    const msgArg = mockPostEphemeralFn.mock.calls[0][0];
    assert.ok(typeof msgArg.text === "string" && msgArg.text.includes("permission"));
  });

  it("any dev can recover another dev's change (no requester gate)", async () => {
    const handler = getHandler("clack_continue_change");
    const session = makeSession({ userId: "U_ORIGINAL_REQUESTER" });
    mockFindSessionByThread.mockImplementation(async () => session);

    const args = makeHandlerArgs({
      body: {
        user: { id: "U_ANOTHER_DEV" },
        channel: { id: "C001" },
        actions: [{ value: "encoded-value" }],
      },
    });
    await handler(args);

    assert.equal(mockHandleFollowUp.mock.calls.length, 1);
  });

  it("posts ephemeral when the thread has no active change", async () => {
    const handler = getHandler("clack_discard_change");
    mockFindSessionByThread.mockImplementation(async () =>
      makeSession({ activeChange: undefined }),
    );
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(mockHandleFollowUp.mock.calls.length, 0);
    assert.equal(mockPostEphemeralFn.mock.calls.length, 1);
    const msgArg = mockPostEphemeralFn.mock.calls[0][0];
    assert.ok(typeof msgArg.text === "string" && msgArg.text.includes("No active change"));
  });

  it("re-engages a disengaged thread on recovery click", async () => {
    const handler = getHandler("clack_continue_change");
    mockFindSessionByThread.mockImplementation(async () => makeSession({ attentionLevel: "off" }));
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(mockSetAttentionLevel.mock.calls.length, 1);
    assert.equal(mockSetAttentionLevel.mock.calls[0][1], "medium");
  });
});

// ============================================================================
// maybeOfferRecovery
// ============================================================================

describe("maybeOfferRecovery", () => {
  it("posts the recovery buttons when the change is failed", async () => {
    mockGetActiveChange.mockImplementation(() => makeActiveChangeForRecovery("failed"));
    const client = makeClient();

    await maybeOfferRecovery("session-1", client, "C001", "1700000000.000001", makeDeps());

    assert.equal(mockPostMessageFn.mock.calls.length, 1);
    const msgArg = mockPostMessageFn.mock.calls[0][0];
    assert.equal(msgArg.channel, "C001");
    assert.equal(msgArg.thread_ts, "1700000000.000001");
    assert.equal(msgArg.blocks?.[1]?.type, "actions");
  });

  it("does nothing when the change is missing or not failed", async () => {
    const client = makeClient();

    await maybeOfferRecovery("session-1", client, "C001", "1700000000.000001", makeDeps());

    mockGetActiveChange.mockImplementation(() => makeActiveChangeForRecovery("cancelled"));
    await maybeOfferRecovery("session-1", client, "C001", "1700000000.000001", makeDeps());

    assert.equal(mockPostMessageFn.mock.calls.length, 0);
  });
});
