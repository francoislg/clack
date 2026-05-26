import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { UserRole } from "../../roles.js";
import type { StagedConfigUpdateIntent, StagedIntent } from "../../tools/types.js";
import type { SessionInfo } from "../activeSessions.js";
import {
  registerConfigUpdateActionHandler,
  type ConfigUpdateActionDeps,
} from "./configUpdateAction.js";

// ============================================================================
// Mocks
// ============================================================================

const mockGetRole = vi.fn<(userId: string) => Promise<UserRole>>(async () => "admin");
const mockGetStagedIntent = vi.fn<(...args: unknown[]) => Promise<StagedIntent | null>>(
  async () => null,
);
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
const mockWriteInstructionFile = vi.fn<(filename: string, content: string) => void>();

function makeDeps(): ConfigUpdateActionDeps {
  return {
    getRole: mockGetRole,
    canEditConfig: (role: UserRole) => role === "admin" || role === "owner",
    decodeActionValue: mockDecodeActionValue,
    restoreSession: mockRestoreSessionInfo,
    getStagedIntent: mockGetStagedIntent,
    writeInstructionFile: mockWriteInstructionFile,
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function makeClient() {
  const postEphemeralFn = vi.fn<
    (args: {
      channel: string;
      user?: string;
      text: string;
      thread_ts?: string;
    }) => Promise<{ ok: boolean }>
  >(async () => ({ ok: true }));
  const postMessageFn = vi.fn<
    (args: { text: string; channel: string; thread_ts: string }) => Promise<{ ok: boolean }>
  >(async () => ({ ok: true }));
  return {
    obj: {
      chat: { postEphemeral: postEphemeralFn, postMessage: postMessageFn },
    } as never as App["client"],
    postEphemeral: postEphemeralFn,
    postMessage: postMessageFn,
  };
}

/** Capture the registered action handler from `app.action(...)` */
function captureHandler() {
  const actionFn = vi.fn();
  const app = { action: actionFn } as never as App;

  registerConfigUpdateActionHandler(app, makeDeps());

  assert.equal(actionFn.mock.calls.length, 1, "should register exactly one action handler");
  const handler = actionFn.mock.calls[0]![1] as (args: {
    ack: () => Promise<void>;
    body: { user: { id: string }; channel?: { id: string }; actions: Array<{ value: string }> };
    client: App["client"];
    respond: (...a: unknown[]) => Promise<void>;
  }) => Promise<void>;
  return handler;
}

function makeHandlerArgs() {
  const clientBundle = makeClient();
  const respondFn = vi.fn(async () => {});
  return {
    ack: vi.fn(async () => {}),
    body: {
      user: { id: "U001" },
      channel: { id: "C001" },
      actions: [{ value: "encoded-value" }],
    },
    client: clientBundle.obj,
    postEphemeral: clientBundle.postEphemeral,
    postMessage: clientBundle.postMessage,
    respond: respondFn,
  };
}

beforeEach(() => {
  mockGetRole.mockClear();
  mockGetStagedIntent.mockClear();
  mockDecodeActionValue.mockClear();
  mockRestoreSessionInfo.mockClear();
  mockWriteInstructionFile.mockClear();

  // Reset to defaults
  mockGetRole.mockImplementation(async () => "admin");
  mockDecodeActionValue.mockImplementation(() => ({ sessionId: "session-1", ref: "r1" }));
  mockRestoreSessionInfo.mockImplementation(async () => ({
    channelId: "C001",
    threadTs: "1700000000.000001",
    userId: "U001",
  }));
  mockWriteInstructionFile.mockImplementation(() => {});
});

// ============================================================================
// Registration
// ============================================================================

describe("registerConfigUpdateActionHandler — registration", () => {
  it("registers an action handler with the correct pattern", () => {
    const actionFn = vi.fn();
    const app = { action: actionFn } as never as App;

    registerConfigUpdateActionHandler(app, makeDeps());

    assert.equal(actionFn.mock.calls.length, 1);
    const pattern = actionFn.mock.calls[0]![0] as RegExp;
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
    mockGetRole.mockImplementation(async () => "member");
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.ack.mock.calls.length, 1);
    const postEphemeral = args.postEphemeral;
    assert.equal(postEphemeral.mock.calls.length, 1);
    const msgArgs = postEphemeral.mock.calls[0]![0] as { text: string };
    assert.ok(msgArgs.text.includes("permission"));
  });

  it("blocks dev role with ephemeral message", async () => {
    const handler = captureHandler();
    mockGetRole.mockImplementation(async () => "dev");
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.ack.mock.calls.length, 1);
    const postEphemeral = args.postEphemeral;
    assert.equal(postEphemeral.mock.calls.length, 1);
  });

  it("allows admin role", async () => {
    const handler = captureHandler();
    mockGetRole.mockImplementation(async () => "admin");

    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      file: "instructions.md",
      content: "new content",
    };
    mockGetStagedIntent.mockImplementation(async () => configIntent);

    const args = makeHandlerArgs();
    await handler(args);

    // Should not post ephemeral permission error
    const postEphemeral = args.postEphemeral;
    // It should either succeed or post a success ephemeral, not a permission error
    const calls = postEphemeral.mock.calls;
    for (const call of calls) {
      const text = (call[0] as { text: string }).text;
      assert.ok(!text.includes("permission"), "should not contain permission error");
    }
  });

  it("allows owner role", async () => {
    const handler = captureHandler();
    mockGetRole.mockImplementation(async () => "owner");

    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      file: "instructions.md",
      content: "new content",
    };
    mockGetStagedIntent.mockImplementation(async () => configIntent);

    const args = makeHandlerArgs();
    await handler(args);

    const postEphemeral = args.postEphemeral;
    const calls = postEphemeral.mock.calls;
    for (const call of calls) {
      const text = (call[0] as { text: string }).text;
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
    mockDecodeActionValue.mockImplementation(() => ({ sessionId: "session-1" }));
    const args = makeHandlerArgs();

    await handler(args);

    // Should ack but not try to restore session
    assert.equal(args.ack.mock.calls.length, 1);
    assert.equal(mockRestoreSessionInfo.mock.calls.length, 0);
  });
});

// ============================================================================
// Session restoration
// ============================================================================

describe("registerConfigUpdateActionHandler — session not found", () => {
  it("returns early when session cannot be restored", async () => {
    const handler = captureHandler();
    mockRestoreSessionInfo.mockImplementation(async () => undefined);
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.ack.mock.calls.length, 1);
    assert.equal(args.respond.mock.calls.length, 1);
    // Should not try to get staged intent
    assert.equal(mockGetStagedIntent.mock.calls.length, 0);
  });
});

// ============================================================================
// Intent resolution
// ============================================================================

describe("registerConfigUpdateActionHandler — intent resolution", () => {
  it("posts ephemeral error when intent is not found", async () => {
    const handler = captureHandler();
    mockGetStagedIntent.mockImplementation(async () => null);
    const args = makeHandlerArgs();

    await handler(args);

    const postEphemeral = args.postEphemeral;
    assert.equal(postEphemeral.mock.calls.length, 1);
    const msgArgs = postEphemeral.mock.calls[0]![0] as { text: string };
    assert.ok(msgArgs.text.includes("expired"));
  });

  it("posts ephemeral error when intent type is not config_update", async () => {
    const handler = captureHandler();
    mockGetStagedIntent.mockImplementation(async () => ({
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    }));
    const args = makeHandlerArgs();

    await handler(args);

    const postEphemeral = args.postEphemeral;
    assert.equal(postEphemeral.mock.calls.length, 1);
    const msgArgs = postEphemeral.mock.calls[0]![0] as { text: string };
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
    mockGetStagedIntent.mockImplementation(async () => configIntent);
    const args = makeHandlerArgs();

    await handler(args);

    // Should ack, respond (delete original), and write the file
    assert.equal(args.ack.mock.calls.length, 1);
    assert.equal(args.respond.mock.calls.length, 1);
    assert.equal(mockWriteInstructionFile.mock.calls.length, 1);
    const writeArgs = mockWriteInstructionFile.mock.calls[0]!;
    assert.equal(writeArgs[0], "instructions.md");
    assert.equal(writeArgs[1], "new content");

    // Should post success ephemeral
    const postEphemeral = args.postEphemeral;
    assert.equal(postEphemeral.mock.calls.length, 1);
    const msgArgs = postEphemeral.mock.calls[0]![0] as {
      text: string;
      channel: string;
      thread_ts: string;
    };
    assert.ok(msgArgs.text.includes("instructions.md"));
    assert.ok(msgArgs.text.includes("updated"));
    assert.equal(msgArgs.channel, "C001");
    assert.equal(msgArgs.thread_ts, "1700000000.000001");
  });

  it("writes a topic-scoped intent path through to writeInstructionFile unchanged", async () => {
    // The propose tool composes `dev/topics/metabase/rules.md` into `intent.file`;
    // the apply handler must pass it through verbatim so writeInstructionFile creates
    // the nested topic directory and lands the override at the right cascade level.
    const handler = captureHandler();
    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      file: "dev/topics/metabase/rules.md",
      content: "metabase rules",
    };
    mockGetStagedIntent.mockImplementation(async () => configIntent);
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(mockWriteInstructionFile.mock.calls.length, 1);
    const writeArgs = mockWriteInstructionFile.mock.calls[0]!;
    assert.equal(writeArgs[0], "dev/topics/metabase/rules.md");
    assert.equal(writeArgs[1], "metabase rules");

    const postEphemeral = args.postEphemeral;
    const msgArgs = postEphemeral.mock.calls[0]![0] as { text: string };
    assert.ok(msgArgs.text.includes("dev/topics/metabase/rules.md"));
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
    mockGetStagedIntent.mockImplementation(async () => configIntent);
    mockWriteInstructionFile.mockImplementation(() => {
      throw new Error("write failed");
    });
    const args = makeHandlerArgs();

    await handler(args);

    const postEphemeral = args.postEphemeral;
    assert.equal(postEphemeral.mock.calls.length, 1);
    const msgArgs = postEphemeral.mock.calls[0]![0] as { text: string };
    assert.ok(msgArgs.text.includes("Failed to update"));
    assert.ok(msgArgs.text.includes("broken.md"));
    assert.ok(msgArgs.text.includes("write failed"));
  });
});
