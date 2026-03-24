import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App, BlockAction } from "@slack/bolt";
import type { UserRole } from "../../roles.js";
import type { StagedConfigUpdateIntent, StagedIntent } from "../../tools/types.js";
import type { SessionInfo } from "../activeSessions.js";

// ============================================================================
// Mocks — set up before importing the module under test
// ============================================================================

const mockGetRole = mock.fn<(userId: string) => Promise<UserRole>>(async () => "admin");
const mockGetStagedIntent = mock.fn<(...args: unknown[]) => Promise<StagedIntent | null>>(async () => null);
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
const mockWriteInstructionFile = mock.fn<(filename: string, content: string) => void>();

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

mock.module("../../roles.js", {
  namedExports: {
    getRole: mockGetRole,
  },
});

mock.module("../../permissions.js", {
  namedExports: {
    canEditConfig: (role: UserRole) => role === "admin" || role === "owner",
  },
});

mock.module("../../sessions.js", {
  namedExports: {
    getStagedIntent: mockGetStagedIntent,
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

mock.module("../../configurationFiles.js", {
  namedExports: {
    writeInstructionFile: mockWriteInstructionFile,
  },
});

mock.module("../../errors.js", {
  namedExports: {
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  },
});

// Import after mocks are configured
const { registerConfigUpdateActionHandler } = await import("./configUpdateAction.js");

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

/** Capture the registered action handler from `app.action(...)` */
function captureHandler() {
  const actionFn = mock.fn();
  const app = { action: actionFn } as unknown as App;

  registerConfigUpdateActionHandler(app);

  assert.equal(actionFn.mock.callCount(), 1, "should register exactly one action handler");
  const handler = actionFn.mock.calls[0].arguments[1] as (args: Record<string, unknown>) => Promise<void>;
  return handler;
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

beforeEach(() => {
  mockGetRole.mock.resetCalls();
  mockGetStagedIntent.mock.resetCalls();
  mockDecodeActionValue.mock.resetCalls();
  mockRestoreSessionInfo.mock.resetCalls();
  mockWriteInstructionFile.mock.resetCalls();

  // Reset to defaults
  mockGetRole.mock.mockImplementation(async () => "admin");
  mockDecodeActionValue.mock.mockImplementation(() => ({ sessionId: "session-1", ref: "r1" }));
  mockRestoreSessionInfo.mock.mockImplementation(async () => ({
    channelId: "C001",
    threadTs: "1700000000.000001",
    userId: "U001",
  }));
  mockWriteInstructionFile.mock.mockImplementation(() => {});
});

// ============================================================================
// Registration
// ============================================================================

describe("registerConfigUpdateActionHandler — registration", () => {
  it("registers an action handler with the correct pattern", () => {
    const actionFn = mock.fn();
    const app = { action: actionFn } as unknown as App;

    registerConfigUpdateActionHandler(app);

    assert.equal(actionFn.mock.callCount(), 1);
    const pattern = actionFn.mock.calls[0].arguments[0] as RegExp;
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern.test("clack_config_update_42"));
    assert.ok(!pattern.test("clack_change_42"));
  });
});

// ============================================================================
// Permission checks
// ============================================================================

describe("registerConfigUpdateActionHandler — permissions", () => {
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

  it("blocks dev role with ephemeral message", async () => {
    const handler = captureHandler();
    mockGetRole.mock.mockImplementation(async () => "dev");
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.ack.mock.callCount(), 1);
    const postEphemeral = args.client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postEphemeral.mock.callCount(), 1);
  });

  it("allows admin role", async () => {
    const handler = captureHandler();
    mockGetRole.mock.mockImplementation(async () => "admin");

    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      file: "instructions.md",
      content: "new content",
    };
    mockGetStagedIntent.mock.mockImplementation(async () => configIntent);

    const args = makeHandlerArgs();
    await handler(args);

    // Should not post ephemeral permission error
    const postEphemeral = args.client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    // It should either succeed or post a success ephemeral, not a permission error
    const calls = postEphemeral.mock.calls;
    for (const call of calls) {
      const text = (call.arguments[0] as { text: string }).text;
      assert.ok(!text.includes("permission"), "should not contain permission error");
    }
  });

  it("allows owner role", async () => {
    const handler = captureHandler();
    mockGetRole.mock.mockImplementation(async () => "owner");

    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      file: "instructions.md",
      content: "new content",
    };
    mockGetStagedIntent.mock.mockImplementation(async () => configIntent);

    const args = makeHandlerArgs();
    await handler(args);

    const postEphemeral = args.client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    const calls = postEphemeral.mock.calls;
    for (const call of calls) {
      const text = (call.arguments[0] as { text: string }).text;
      assert.ok(!text.includes("permission"), "should not contain permission error");
    }
  });
});

// ============================================================================
// Missing ref
// ============================================================================

describe("registerConfigUpdateActionHandler — missing ref", () => {
  it("returns early when ref is missing", async () => {
    const handler = captureHandler();
    mockDecodeActionValue.mock.mockImplementation(() => ({ sessionId: "session-1" }));
    const args = makeHandlerArgs();

    await handler(args);

    // Should ack but not try to restore session
    assert.equal(args.ack.mock.callCount(), 1);
    assert.equal(mockRestoreSessionInfo.mock.callCount(), 0);
  });
});

// ============================================================================
// Session restoration
// ============================================================================

describe("registerConfigUpdateActionHandler — session not found", () => {
  it("returns early when session cannot be restored", async () => {
    const handler = captureHandler();
    mockRestoreSessionInfo.mock.mockImplementation(async () => undefined);
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.ack.mock.callCount(), 1);
    assert.equal(args.respond.mock.callCount(), 1);
    // Should not try to get staged intent
    assert.equal(mockGetStagedIntent.mock.callCount(), 0);
  });
});

// ============================================================================
// Intent resolution
// ============================================================================

describe("registerConfigUpdateActionHandler — intent resolution", () => {
  it("posts ephemeral error when intent is not found", async () => {
    const handler = captureHandler();
    mockGetStagedIntent.mock.mockImplementation(async () => null);
    const args = makeHandlerArgs();

    await handler(args);

    const postEphemeral = args.client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postEphemeral.mock.callCount(), 1);
    const msgArgs = postEphemeral.mock.calls[0].arguments[0] as { text: string };
    assert.ok(msgArgs.text.includes("expired"));
  });

  it("posts ephemeral error when intent type is not config_update", async () => {
    const handler = captureHandler();
    mockGetStagedIntent.mock.mockImplementation(async () => ({
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
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
// Successful config update
// ============================================================================

describe("registerConfigUpdateActionHandler — success", () => {
  it("writes the instruction file and posts success ephemeral", async () => {
    const handler = captureHandler();
    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      file: "instructions.md",
      content: "new content",
    };
    mockGetStagedIntent.mock.mockImplementation(async () => configIntent);
    const args = makeHandlerArgs();

    await handler(args);

    // Should ack, respond (delete original), and write the file
    assert.equal(args.ack.mock.callCount(), 1);
    assert.equal(args.respond.mock.callCount(), 1);
    assert.equal(mockWriteInstructionFile.mock.callCount(), 1);
    const writeArgs = mockWriteInstructionFile.mock.calls[0].arguments;
    assert.equal(writeArgs[0], "instructions.md");
    assert.equal(writeArgs[1], "new content");

    // Should post success ephemeral
    const postEphemeral = args.client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postEphemeral.mock.callCount(), 1);
    const msgArgs = postEphemeral.mock.calls[0].arguments[0] as { text: string; channel: string; thread_ts: string };
    assert.ok(msgArgs.text.includes("instructions.md"));
    assert.ok(msgArgs.text.includes("updated"));
    assert.equal(msgArgs.channel, "C001");
    assert.equal(msgArgs.thread_ts, "1700000000.000001");
  });
});

// ============================================================================
// Write failure
// ============================================================================

describe("registerConfigUpdateActionHandler — write failure", () => {
  it("posts error ephemeral when writeInstructionFile throws", async () => {
    const handler = captureHandler();
    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      file: "broken.md",
      content: "data",
    };
    mockGetStagedIntent.mock.mockImplementation(async () => configIntent);
    mockWriteInstructionFile.mock.mockImplementation(() => {
      throw new Error("write failed");
    });
    const args = makeHandlerArgs();

    await handler(args);

    const postEphemeral = args.client.chat.postEphemeral as unknown as ReturnType<typeof mock.fn>;
    assert.equal(postEphemeral.mock.callCount(), 1);
    const msgArgs = postEphemeral.mock.calls[0].arguments[0] as { text: string };
    assert.ok(msgArgs.text.includes("Failed to update"));
    assert.ok(msgArgs.text.includes("broken.md"));
    assert.ok(msgArgs.text.includes("write failed"));
  });
});
