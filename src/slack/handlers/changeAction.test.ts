import { describe, it, mock, beforeEach, type Mock } from "node:test";
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
const mockStartChangeWorkflow = mock.fn<ChangeActionDeps["startChangeWorkflow"]>(async () => ({
  success: true,
}));
const mockErrorMessage = mock.fn<ChangeActionDeps["errorMessage"]>((err) =>
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
const mockFinalizeStreamedWorkflow = mock.fn<ChangeActionDeps["finalizeStreamedWorkflow"]>(
  async () => {},
);
const mockSetAutoResponseActive = mock.fn<ChangeActionDeps["setAutoResponseActive"]>(
  async () => {},
);
const mockPostEphemeralFn = mock.fn<
  (args: { channel: string; user: string; text: string }) => Promise<{ ok: boolean }>
>(async () => ({ ok: true }));
const mockPostMessageFn = mock.fn<
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
    setAutoResponseActive: mockSetAutoResponseActive,
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
  mockStartChangeWorkflow.mock.resetCalls();
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
  mockStartChangeWorkflow.mock.mockImplementation(async () => ({ success: true }));
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
    mockGetRole.mock.mockImplementation(async () => "member");
    mockCanRequestChanges.mock.mockImplementation(
      (role) => role === "dev" || role === "admin" || role === "owner",
    );
    const args = makeHandlerArgs();

    await capturedHandler(args);

    assert.equal(args.ack.mock.callCount(), 1);
    const postEphemeral = mockPostEphemeralFn;
    assert.equal(postEphemeral.mock.callCount(), 1);
    const msgArgs = postEphemeral.mock.calls[0].arguments[0];
    assert.ok(
      msgArgs &&
        typeof msgArgs === "object" &&
        "text" in msgArgs &&
        typeof msgArgs.text === "string" &&
        msgArgs.text.includes("permission"),
    );
  });

  it("allows dev role through permission check", async () => {
    mockGetRole.mock.mockImplementation(async () => "dev");

    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };
    mockGetStagedIntent.mock.mockImplementation(async () => changeIntent);

    const args = makeHandlerArgs();
    await capturedHandler(args);

    // Should not post permission error
    const postEphemeral = mockPostEphemeralFn;
    for (const call of postEphemeral.mock.calls) {
      const callArg = call.arguments[0];
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
    mockDecodeActionValue.mock.mockImplementation(() => ({ sessionId: "session-1" }));
    const args = makeHandlerArgs();

    await capturedHandler(args);

    assert.equal(args.ack.mock.callCount(), 1);
    assert.equal(mockRestoreSessionInfo.mock.callCount(), 0);
  });
});

// ============================================================================
// Session restoration
// ============================================================================

describe("registerChangeActionHandler — session not found", () => {
  it("returns early when session cannot be restored", async () => {
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);
    const args = makeHandlerArgs();

    await capturedHandler(args);

    assert.equal(args.respond.mock.callCount(), 1);
    assert.equal(mockGetStagedIntent.mock.callCount(), 0);
  });
});

// ============================================================================
// Intent resolution
// ============================================================================

describe("registerChangeActionHandler — intent resolution", () => {
  it("posts ephemeral when intent is not found", async () => {
    mockGetStagedIntent.mock.mockImplementation(async () => null);
    const args = makeHandlerArgs();

    await capturedHandler(args);

    const postEphemeral = mockPostEphemeralFn;
    assert.equal(postEphemeral.mock.callCount(), 1);
    const callArg = postEphemeral.mock.calls[0].arguments[0];
    assert.ok(
      callArg &&
        typeof callArg === "object" &&
        "text" in callArg &&
        typeof callArg.text === "string" &&
        callArg.text.includes("expired"),
    );
  });

  it("posts ephemeral when intent type is not change", async () => {
    mockGetStagedIntent.mock.mockImplementation(async () => ({
      type: "config_update",
      file: "f.md",
      content: "c",
    }));
    const args = makeHandlerArgs();

    await capturedHandler(args);

    const postEphemeral = mockPostEphemeralFn;
    assert.equal(postEphemeral.mock.callCount(), 1);
    const callArg = postEphemeral.mock.calls[0].arguments[0];
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
    mockGetStagedIntent.mock.mockImplementation(async () => changeIntent);

    const args = makeHandlerArgs();
    await capturedHandler(args);

    // Should ack and delete original
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

    // Should start the streamer and call startChangeWorkflow
    assert.equal(mockStreamerStart.mock.callCount(), 1);
    assert.equal(mockStartChangeWorkflow.mock.callCount(), 1);

    // Verify the change request passed to startChangeWorkflow
    const workflowArgs = mockStartChangeWorkflow.mock.calls[0].arguments;
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
    mockFindSessionByThread.mock.mockImplementation(async () => null);

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
    assert.equal(postMessage.mock.callCount(), 1);
    const msgArg = postMessage.mock.calls[0].arguments[0];
    assert.ok(
      msgArg &&
        typeof msgArg === "object" &&
        "text" in msgArg &&
        typeof msgArg.text === "string" &&
        msgArg.text.includes("Could not find an active session"),
    );
  });

  it("starts streamer, calls startChangeWorkflow, and finalizes on success", async () => {
    mockFindSessionByThread.mock.mockImplementation(async () => makeSession());
    mockStartChangeWorkflow.mock.mockImplementation(async () => ({ success: true }));

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

    assert.equal(mockStreamerStart.mock.callCount(), 1);
    assert.equal(mockStartChangeWorkflow.mock.callCount(), 1);
    assert.equal(mockFinalizeStreamedWorkflow.mock.callCount(), 1);
  });

  it("uses stream channel and threadTs when provided", async () => {
    mockFindSessionByThread.mock.mockImplementation(async () => makeSession());
    mockStartChangeWorkflow.mock.mockImplementation(async () => ({ success: true }));

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
    assert.equal(mockFinalizeStreamedWorkflow.mock.callCount(), 1);
    const finalizeCall = mockFinalizeStreamedWorkflow.mock.calls[0];
    const channel = finalizeCall.arguments[2];
    const threadTs = finalizeCall.arguments[3];
    assert.equal(channel, "D_DM");
    assert.equal(threadTs, "1700000099.000001");
  });

  it("uses default triggerType of reactions when not specified", async () => {
    mockFindSessionByThread.mock.mockImplementation(async () => makeSession());
    mockStartChangeWorkflow.mock.mockImplementation(async () => ({ success: true }));

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

    const request = mockStartChangeWorkflow.mock.calls[0].arguments[0];
    assert.ok(
      request &&
        typeof request === "object" &&
        "triggerType" in request &&
        request.triggerType === "reactions",
    );
  });

  it("passes provided triggerType to the change request", async () => {
    mockFindSessionByThread.mock.mockImplementation(async () => makeSession());
    mockStartChangeWorkflow.mock.mockImplementation(async () => ({ success: true }));

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

    const request = mockStartChangeWorkflow.mock.calls[0].arguments[0];
    assert.ok(
      request &&
        typeof request === "object" &&
        "triggerType" in request &&
        request.triggerType === "mentions",
    );
  });

  it("handles workflow failure by stopping streamer and posting error", async () => {
    mockFindSessionByThread.mock.mockImplementation(async () => makeSession());
    mockStartChangeWorkflow.mock.mockImplementation(async () => {
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

    assert.equal(mockStreamerStop.mock.callCount(), 1);
    const postMessage = mockPostMessageFn;
    assert.equal(postMessage.mock.callCount(), 1);
    const msgArg = postMessage.mock.calls[0].arguments[0];
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
