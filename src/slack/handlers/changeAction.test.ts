import { describe, it, vi, beforeEach, type Mock } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { UserRole } from "../../roles.js";
import type { StagedChangeIntent, StagedIntent } from "../../tools/types.js";
import type { SessionInfo } from "../activeSessions.js";
import type { SessionContext } from "../../sessions.js";
import {
  registerChangeActionHandler,
  triggerChangeWorkflow,
  type ChangeActionDeps,
} from "./changeAction.js";

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
const mockStartChangeWorkflow = vi.fn<ChangeActionDeps["startChangeWorkflow"]>(async () => ({
  success: true,
}));
const mockErrorMessage = vi.fn<ChangeActionDeps["errorMessage"]>((err) =>
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
const mockFinalizeStreamedWorkflow = vi.fn<ChangeActionDeps["finalizeStreamedWorkflow"]>(
  async () => {},
);
const mockSetAttentionLevel = vi.fn<ChangeActionDeps["setAttentionLevel"]>(async () => {});
const mockPostEphemeralFn = vi.fn<
  (args: { channel: string; user: string; text: string }) => Promise<{ ok: boolean }>
>(async () => ({ ok: true }));
const mockPostMessageFn = vi.fn<
  (args: { channel: string; thread_ts: string; text: string }) => Promise<{ ok: boolean }>
>(async () => ({ ok: true }));

function makeDeps(): ChangeActionDeps {
  return {
    getRole: mockGetRole,
    canRequestChanges: mockCanRequestChanges,
    decodeActionValue: mockDecodeActionValue,
    restoreSession: mockRestoreSessionInfo,
    getStagedIntent: mockGetStagedIntent,
    findSessionByThread: mockFindSessionByThread,
    startChangeWorkflow: mockStartChangeWorkflow,
    errorMessage: mockErrorMessage,
    createStreamer: mockCreateStreamer,
    finalizeStreamedWorkflow: mockFinalizeStreamedWorkflow,
    setAttentionLevel: mockSetAttentionLevel,
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

let capturedHandler: ActionHandler;

function makeApp(deps: ChangeActionDeps): App {
  const app = {
    action: (_pattern: RegExp, handler: ActionHandler) => {
      capturedHandler = handler;
    },
  } as object as App;
  registerChangeActionHandler(app, deps);
  return app;
}

function makeClient(): App["client"] {
  return {
    chat: {
      postEphemeral: mockPostEphemeralFn,
      postMessage: mockPostMessageFn,
    },
    users: {
      info: async () => ({
        ok: true,
        user: { name: "alice", profile: { display_name: "Alice", real_name: "Alice Smith" } },
      }),
    },
  } as object as App["client"];
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
  mockStartChangeWorkflow.mockClear();
  mockErrorMessage.mockClear();
  mockStreamerStart.mockClear();
  mockStreamerStop.mockClear();
  mockStreamerHandleEvent.mockClear();
  mockCreateStreamer.mockClear();
  mockFinalizeStreamedWorkflow.mockClear();
  mockPostEphemeralFn.mockClear();
  mockPostMessageFn.mockClear();

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
  mockStartChangeWorkflow.mockImplementation(async () => ({ success: true }));
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

  // Register handler
  makeApp(makeDeps());
});

// ============================================================================
// Registration
// ============================================================================

describe("registerChangeActionHandler — registration", () => {
  it("registers an action handler matching clack_change_<digits>", () => {
    assert.ok(capturedHandler, "handler should have been registered");
  });
});

// ============================================================================
// Permission checks (registerChangeActionHandler)
// ============================================================================

describe("registerChangeActionHandler — permissions", () => {
  it("blocks member role with ephemeral message", async () => {
    mockGetRole.mockImplementation(async () => "member");
    mockCanRequestChanges.mockImplementation(
      (role) => role === "dev" || role === "admin" || role === "owner",
    );
    const args = makeHandlerArgs();

    await capturedHandler(args);

    assert.equal(args.ack.mock.calls.length, 1);
    const postEphemeral = mockPostEphemeralFn;
    assert.equal(postEphemeral.mock.calls.length, 1);
    const msgArgs = postEphemeral.mock.calls[0][0];
    assert.ok(
      msgArgs &&
        typeof msgArgs === "object" &&
        "text" in msgArgs &&
        typeof msgArgs.text === "string" &&
        msgArgs.text.includes("permission"),
    );
  });

  it("allows dev role through permission check", async () => {
    mockGetRole.mockImplementation(async () => "dev");

    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };
    mockGetStagedIntent.mockImplementation(async () => changeIntent);

    const args = makeHandlerArgs();
    await capturedHandler(args);

    // Should not post permission error
    const postEphemeral = mockPostEphemeralFn;
    for (const call of postEphemeral.mock.calls) {
      const callArg = call[0];
      if (
        callArg &&
        typeof callArg === "object" &&
        "text" in callArg &&
        typeof callArg.text === "string"
      ) {
        assert.ok(!callArg.text.includes("permission"), "should not contain permission error");
      }
    }
  });
});

// ============================================================================
// Missing ref
// ============================================================================

describe("registerChangeActionHandler — missing ref", () => {
  it("returns early when ref is missing", async () => {
    mockDecodeActionValue.mockImplementation(() => ({ sessionId: "session-1" }));
    const args = makeHandlerArgs();

    await capturedHandler(args);

    assert.equal(args.ack.mock.calls.length, 1);
    assert.equal(mockRestoreSessionInfo.mock.calls.length, 0);
  });
});

// ============================================================================
// Session restoration
// ============================================================================

describe("registerChangeActionHandler — session not found", () => {
  it("returns early when session cannot be restored", async () => {
    mockRestoreSessionInfo.mockImplementation(async () => undefined);
    const args = makeHandlerArgs();

    await capturedHandler(args);

    assert.equal(args.respond.mock.calls.length, 1);
    assert.equal(mockGetStagedIntent.mock.calls.length, 0);
  });
});

// ============================================================================
// Intent resolution
// ============================================================================

describe("registerChangeActionHandler — intent resolution", () => {
  it("posts ephemeral when intent is not found", async () => {
    mockGetStagedIntent.mockImplementation(async () => null);
    const args = makeHandlerArgs();

    await capturedHandler(args);

    const postEphemeral = mockPostEphemeralFn;
    assert.equal(postEphemeral.mock.calls.length, 1);
    const callArg = postEphemeral.mock.calls[0][0];
    assert.ok(
      callArg &&
        typeof callArg === "object" &&
        "text" in callArg &&
        typeof callArg.text === "string" &&
        callArg.text.includes("expired"),
    );
  });

  it("posts ephemeral when intent type is not change", async () => {
    mockGetStagedIntent.mockImplementation(async () => ({
      type: "config_update",
      operation: "write",
      file: "f.md",
      content: "c",
    }));
    const args = makeHandlerArgs();

    await capturedHandler(args);

    const postEphemeral = mockPostEphemeralFn;
    assert.equal(postEphemeral.mock.calls.length, 1);
    const callArg = postEphemeral.mock.calls[0][0];
    assert.ok(
      callArg &&
        typeof callArg === "object" &&
        "text" in callArg &&
        typeof callArg.text === "string" &&
        callArg.text.includes("expired"),
    );
  });
});

// ============================================================================
// Successful change action handler flow
// ============================================================================

describe("registerChangeActionHandler — success", () => {
  it("deletes original message, resolves intent, and triggers workflow", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/new-thing",
      description: "Add new thing",
      repo: "org/repo",
    };
    mockGetStagedIntent.mockImplementation(async () => changeIntent);

    const args = makeHandlerArgs();
    await capturedHandler(args);

    // Should ack and delete original
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

    // Should start the streamer and call startChangeWorkflow
    assert.equal(mockStreamerStart.mock.calls.length, 1);
    assert.equal(mockStartChangeWorkflow.mock.calls.length, 1);

    // Verify the change request passed to startChangeWorkflow
    const workflowArgs = mockStartChangeWorkflow.mock.calls[0];
    const request = workflowArgs[0];
    assert.ok(
      request && typeof request === "object" && "userId" in request && request.userId === "U001",
    );
    assert.ok(
      request &&
        typeof request === "object" &&
        "message" in request &&
        request.message === "Add new thing",
    );

    const plan = workflowArgs[1];
    assert.ok(
      plan &&
        typeof plan === "object" &&
        "branchName" in plan &&
        plan.branchName === "feat/new-thing",
    );
    assert.ok(
      plan && typeof plan === "object" && "targetRepo" in plan && plan.targetRepo === "org/repo",
    );
  });
});

// ============================================================================
// triggerChangeWorkflow — shared logic
// ============================================================================

describe("triggerChangeWorkflow", () => {
  it("posts error when session is not found", async () => {
    mockFindSessionByThread.mockImplementation(async () => null);

    const client = makeClient();
    const intent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };

    await triggerChangeWorkflow(
      intent,
      {
        channelId: "C001",
        threadTs: "1700000000.000001",
        userId: "U001",
        client,
      },
      makeDeps(),
    );

    const postMessage = mockPostMessageFn;
    assert.equal(postMessage.mock.calls.length, 1);
    const msgArg = postMessage.mock.calls[0][0];
    assert.ok(
      msgArg &&
        typeof msgArg === "object" &&
        "text" in msgArg &&
        typeof msgArg.text === "string" &&
        msgArg.text.includes("Could not find an active session"),
    );
  });

  it("starts streamer, calls startChangeWorkflow, and finalizes on success", async () => {
    mockFindSessionByThread.mockImplementation(async () => makeSession());
    mockStartChangeWorkflow.mockImplementation(async () => ({ success: true }));

    const client = makeClient();
    const intent: StagedChangeIntent = {
      type: "change",
      branch: "feat/awesome",
      description: "Awesome feature",
      repo: "org/repo",
    };

    await triggerChangeWorkflow(
      intent,
      {
        channelId: "C001",
        threadTs: "1700000000.000001",
        userId: "U001",
        client,
      },
      makeDeps(),
    );

    assert.equal(mockStreamerStart.mock.calls.length, 1);
    assert.equal(mockStartChangeWorkflow.mock.calls.length, 1);
    assert.equal(mockFinalizeStreamedWorkflow.mock.calls.length, 1);
  });

  it("uses stream channel and threadTs when provided", async () => {
    mockFindSessionByThread.mockImplementation(async () => makeSession());
    mockStartChangeWorkflow.mockImplementation(async () => ({ success: true }));

    const client = makeClient();
    const intent: StagedChangeIntent = {
      type: "change",
      branch: "feat/dm",
      description: "DM feature",
      repo: "org/repo",
    };

    await triggerChangeWorkflow(
      intent,
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

    // finalizeStreamedWorkflow should receive the stream channel
    assert.equal(mockFinalizeStreamedWorkflow.mock.calls.length, 1);
    const finalizeCall = mockFinalizeStreamedWorkflow.mock.calls[0];
    const channel = finalizeCall[2];
    const threadTs = finalizeCall[3];
    assert.equal(channel, "D_DM");
    assert.equal(threadTs, "1700000099.000001");
  });

  it("uses default triggerType of reactions when not specified", async () => {
    mockFindSessionByThread.mockImplementation(async () => makeSession());
    mockStartChangeWorkflow.mockImplementation(async () => ({ success: true }));

    const client = makeClient();
    const intent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };

    await triggerChangeWorkflow(
      intent,
      {
        channelId: "C001",
        threadTs: "1700000000.000001",
        userId: "U001",
        client,
      },
      makeDeps(),
    );

    const request = mockStartChangeWorkflow.mock.calls[0][0];
    assert.ok(
      request &&
        typeof request === "object" &&
        "triggerType" in request &&
        request.triggerType === "reactions",
    );
  });

  it("passes provided triggerType to the change request", async () => {
    mockFindSessionByThread.mockImplementation(async () => makeSession());
    mockStartChangeWorkflow.mockImplementation(async () => ({ success: true }));

    const client = makeClient();
    const intent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };

    await triggerChangeWorkflow(
      intent,
      {
        channelId: "C001",
        threadTs: "1700000000.000001",
        userId: "U001",
        client,
        triggerType: "mentions",
      },
      makeDeps(),
    );

    const request = mockStartChangeWorkflow.mock.calls[0][0];
    assert.ok(
      request &&
        typeof request === "object" &&
        "triggerType" in request &&
        request.triggerType === "mentions",
    );
  });

  it("handles workflow failure by stopping streamer and posting error", async () => {
    mockFindSessionByThread.mockImplementation(async () => makeSession());
    mockStartChangeWorkflow.mockImplementation(async () => {
      throw new Error("workflow exploded");
    });

    const client = makeClient();
    const intent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };

    await triggerChangeWorkflow(
      intent,
      {
        channelId: "C001",
        threadTs: "1700000000.000001",
        userId: "U001",
        client,
      },
      makeDeps(),
    );

    assert.equal(mockStreamerStop.mock.calls.length, 1);
    const postMessage = mockPostMessageFn;
    assert.equal(postMessage.mock.calls.length, 1);
    const msgArg = postMessage.mock.calls[0][0];
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
        msgArg.text.includes("workflow exploded"),
    );
  });
});
