import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { UserRole } from "../../roles.js";
import type { StagedChangeIntent, StagedIntent } from "../../tools/types.js";
import type { SessionInfo } from "../activeSessions.js";
import type { SessionContext } from "../../sessions.js";
import type { ChangeResult } from "../../changes/types.js";

// ============================================================================
// Mocks — set up before importing the module under test
// ============================================================================

const mockGetRole = mock.fn<(userId: string) => Promise<UserRole>>(async () => "dev");
const mockGetStagedIntent = mock.fn<(...args: unknown[]) => Promise<StagedIntent | null>>(
  async () => null,
);
const mockFindSessionByThread = mock.fn<(...args: unknown[]) => Promise<SessionContext | null>>(
  async () => null,
);
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
const mockStartChangeWorkflow = mock.fn<(...args: unknown[]) => Promise<ChangeResult>>(
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

mock.module("../activeSessions.js", {
  namedExports: {
    activeSessions: { restore: mockRestoreSessionInfo },
  },
});

mock.module("../../changes/workflow.js", {
  namedExports: {
    startChangeWorkflow: mockStartChangeWorkflow,
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

// Import after mocks are configured
const { registerChangeActionHandler, triggerChangeWorkflow } = await import("./changeAction.js");

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

function captureHandler() {
  const actionFn = mock.fn();
  const app = { action: actionFn } as unknown as App;
  registerChangeActionHandler(app);
  assert.equal(actionFn.mock.callCount(), 1, "should register exactly one action handler");
  return actionFn.mock.calls[0].arguments[1] as (args: Record<string, unknown>) => Promise<void>;
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
      ...(overrides.body as Record<string, unknown>),
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
    ...overrides,
  } as SessionContext;
}

beforeEach(() => {
  mockGetRole.mock.resetCalls();
  mockGetStagedIntent.mock.resetCalls();
  mockFindSessionByThread.mock.resetCalls();
  mockDecodeActionValue.mock.resetCalls();
  mockRestoreSessionInfo.mock.resetCalls();
  mockStartChangeWorkflow.mock.resetCalls();
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
  mockStartChangeWorkflow.mock.mockImplementation(async () => ({ success: true }));
  mockFindSessionByThread.mock.mockImplementation(async () => makeSession());
  mockFinalizeStreamedWorkflow.mock.mockImplementation(async () => {});
});

// ============================================================================
// Registration
// ============================================================================

describe("registerChangeActionHandler — registration", () => {
  it("registers an action handler matching clack_change_<digits>", () => {
    const actionFn = mock.fn();
    const app = { action: actionFn } as unknown as App;
    registerChangeActionHandler(app);
    const pattern = actionFn.mock.calls[0].arguments[0] as RegExp;
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern.test("clack_change_42"));
    assert.ok(!pattern.test("clack_config_update_42"));
  });
});

// ============================================================================
// Permission checks (registerChangeActionHandler)
// ============================================================================

describe("registerChangeActionHandler — permissions", () => {
  it("blocks member role with ephemeral message", async () => {
    const handler = captureHandler();
    mockGetRole.mock.mockImplementation(async () => "member");
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.ack.mock.callCount(), 1);
    const postEphemeral = args.client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postEphemeral.mock.callCount(), 1);
    const msgArgs = postEphemeral.mock.calls[0].arguments[0] as { text: string };
    assert.ok(msgArgs.text.includes("permission"));
  });

  it("allows dev role through permission check", async () => {
    const handler = captureHandler();
    mockGetRole.mock.mockImplementation(async () => "dev");

    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };
    mockGetStagedIntent.mock.mockImplementation(async () => changeIntent);

    const args = makeHandlerArgs();
    await handler(args);

    // Should not post permission error
    const postEphemeral = args.client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    for (const call of postEphemeral.mock.calls) {
      const text = (call.arguments[0] as { text: string }).text;
      assert.ok(!text.includes("permission"), "should not contain permission error");
    }
  });
});

// ============================================================================
// Missing ref
// ============================================================================

describe("registerChangeActionHandler — missing ref", () => {
  it("returns early when ref is missing", async () => {
    const handler = captureHandler();
    mockDecodeActionValue.mock.mockImplementation(() => ({ sessionId: "session-1" }));
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.ack.mock.callCount(), 1);
    assert.equal(mockRestoreSessionInfo.mock.callCount(), 0);
  });
});

// ============================================================================
// Session restoration
// ============================================================================

describe("registerChangeActionHandler — session not found", () => {
  it("returns early when session cannot be restored", async () => {
    const handler = captureHandler();
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.respond.mock.callCount(), 1);
    assert.equal(mockGetStagedIntent.mock.callCount(), 0);
  });
});

// ============================================================================
// Intent resolution
// ============================================================================

describe("registerChangeActionHandler — intent resolution", () => {
  it("posts ephemeral when intent is not found", async () => {
    const handler = captureHandler();
    mockGetStagedIntent.mock.mockImplementation(async () => null);
    const args = makeHandlerArgs();

    await handler(args);

    const postEphemeral = args.client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postEphemeral.mock.callCount(), 1);
    const msgArgs = postEphemeral.mock.calls[0].arguments[0] as { text: string };
    assert.ok(msgArgs.text.includes("expired"));
  });

  it("posts ephemeral when intent type is not change", async () => {
    const handler = captureHandler();
    mockGetStagedIntent.mock.mockImplementation(async () => ({
      type: "config_update",
      file: "f.md",
      content: "c",
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
// Successful change action handler flow
// ============================================================================

describe("registerChangeActionHandler — success", () => {
  it("deletes original message, resolves intent, and triggers workflow", async () => {
    const handler = captureHandler();
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/new-thing",
      description: "Add new thing",
      repo: "org/repo",
    };
    mockGetStagedIntent.mock.mockImplementation(async () => changeIntent);

    const args = makeHandlerArgs();
    await handler(args);

    // Should ack and delete original
    assert.equal(args.ack.mock.callCount(), 1);
    assert.equal(args.respond.mock.callCount(), 1);
    const respondCall = args.respond.mock.calls[0] as unknown as {
      arguments: [{ delete_original: boolean }];
    };
    assert.equal(respondCall.arguments[0].delete_original, true);

    // Should start the streamer and call startChangeWorkflow
    assert.equal(mockStreamerStart.mock.callCount(), 1);
    assert.equal(mockStartChangeWorkflow.mock.callCount(), 1);

    // Verify the change request passed to startChangeWorkflow
    const workflowArgs = mockStartChangeWorkflow.mock.calls[0].arguments;
    const request = workflowArgs[0] as { userId: string; message: string };
    assert.equal(request.userId, "U001");
    assert.equal(request.message, "Add new thing");

    const plan = workflowArgs[1] as { branchName: string; targetRepo: string };
    assert.equal(plan.branchName, "feat/new-thing");
    assert.equal(plan.targetRepo, "org/repo");
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

    await triggerChangeWorkflow(intent, {
      channelId: "C001",
      threadTs: "1700000000.000001",
      userId: "U001",
      client,
    });

    const postMessage = client.chat.postMessage as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postMessage.mock.callCount(), 1);
    const msgArgs = postMessage.mock.calls[0].arguments[0] as { text: string };
    assert.ok(msgArgs.text.includes("Could not find an active session"));
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

    await triggerChangeWorkflow(intent, {
      channelId: "C001",
      threadTs: "1700000000.000001",
      userId: "U001",
      client,
    });

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

    await triggerChangeWorkflow(intent, {
      channelId: "C001",
      threadTs: "1700000000.000001",
      userId: "U001",
      client,
      streamChannel: "D_DM",
      streamThreadTs: "1700000099.000001",
    });

    // finalizeStreamedWorkflow should receive the stream channel
    assert.equal(mockFinalizeStreamedWorkflow.mock.callCount(), 1);
    const finalizeCall = mockFinalizeStreamedWorkflow.mock.calls[0] as unknown as {
      arguments: unknown[];
    };
    assert.equal(finalizeCall.arguments[2], "D_DM");
    assert.equal(finalizeCall.arguments[3], "1700000099.000001");
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

    await triggerChangeWorkflow(intent, {
      channelId: "C001",
      threadTs: "1700000000.000001",
      userId: "U001",
      client,
    });

    const request = mockStartChangeWorkflow.mock.calls[0].arguments[0] as { triggerType: string };
    assert.equal(request.triggerType, "reactions");
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

    await triggerChangeWorkflow(intent, {
      channelId: "C001",
      threadTs: "1700000000.000001",
      userId: "U001",
      client,
      triggerType: "mentions",
    });

    const request = mockStartChangeWorkflow.mock.calls[0].arguments[0] as { triggerType: string };
    assert.equal(request.triggerType, "mentions");
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

    await triggerChangeWorkflow(intent, {
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
    assert.ok(msgArgs.text.includes("workflow exploded"));
  });
});
