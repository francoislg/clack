import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { BlockAction } from "@slack/bolt";
import type { ChatPostEphemeralArguments } from "@slack/web-api";
import type { UserRole } from "../../roles.js";
import type { StagedConfigUpdateIntent, StagedIntent } from "../../tools/types.js";
import type { SessionInfo } from "../activeSessions.js";
import {
  registerConfigUpdateActionHandler,
  type ConfigUpdateActionDeps,
} from "./configUpdateAction.js";
import { createBlockActionArgs, createSlackAppMock } from "../testBoltApp.js";

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
const mockDeleteInstructionFile = vi.fn<(filepath: string) => void>();
const mockReadInstructionFile = vi.fn<
  (filepath: string) => { default_content: string | null; custom_content: string | null }
>(() => ({ default_content: null, custom_content: null }));

function makeDeps(): ConfigUpdateActionDeps {
  return {
    getRole: mockGetRole,
    canEditConfig: (role: UserRole) => role === "admin" || role === "owner",
    decodeActionValue: mockDecodeActionValue,
    restoreSession: mockRestoreSessionInfo,
    getStagedIntent: mockGetStagedIntent,
    writeInstructionFile: mockWriteInstructionFile,
    deleteInstructionFile: mockDeleteInstructionFile,
    readInstructionFile: mockReadInstructionFile,
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  };
}

// ============================================================================
// Helpers
// ============================================================================

/** Register the handler on a fresh mocked app and read it back off `app.action`. */
function captureHandler() {
  const app = createSlackAppMock();
  registerConfigUpdateActionHandler(app, makeDeps());

  assert.equal(app.action.mock.calls.length, 1, "should register exactly one action handler");
  const [, handler] = app.action.mock.calls[0];
  return handler;
}

const CONFIG_SECTION = { type: "section", text: { type: "mrkdwn", text: "Config diff" } };

/** A posted config-update confirmation message, matching what `stripClickedButton` expects. */
function makeConfigMessage(): NonNullable<BlockAction["message"]> {
  return {
    type: "message",
    ts: "1700000000.000100",
    text: "Apply this config update?",
    blocks: [
      CONFIG_SECTION,
      { type: "divider" },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "clack_config_update_0",
            text: { type: "plain_text", text: "Apply" },
          },
        ],
      },
    ],
  };
}

/** Extract `text` from a `chat.postEphemeral` call, narrowing across its content-shape union. */
function ephemeralText(call: ChatPostEphemeralArguments): string | undefined {
  return "text" in call ? call.text : undefined;
}

function makeHandlerArgs() {
  const args = createBlockActionArgs({
    value: "encoded-value",
    actionId: "clack_config_update_0",
    userId: "U001",
    channelId: "C001",
  });
  args.body.message = makeConfigMessage();
  return args;
}

beforeEach(() => {
  mockGetRole.mockClear();
  mockGetStagedIntent.mockClear();
  mockDecodeActionValue.mockClear();
  mockRestoreSessionInfo.mockClear();
  mockWriteInstructionFile.mockClear();
  mockDeleteInstructionFile.mockClear();
  mockReadInstructionFile.mockClear();

  // Reset to defaults
  mockGetRole.mockImplementation(async () => "admin");
  mockDecodeActionValue.mockImplementation(() => ({ sessionId: "session-1", ref: "r1" }));
  mockRestoreSessionInfo.mockImplementation(async () => ({
    channelId: "C001",
    threadTs: "1700000000.000001",
    userId: "U001",
  }));
  mockWriteInstructionFile.mockImplementation(() => {});
  mockDeleteInstructionFile.mockImplementation(() => {});
  mockReadInstructionFile.mockReturnValue({ default_content: null, custom_content: null });
});

// ============================================================================
// Registration
// ============================================================================

describe("registerConfigUpdateActionHandler — registration", () => {
  it("registers an action handler with the correct pattern", () => {
    const app = createSlackAppMock();
    registerConfigUpdateActionHandler(app, makeDeps());

    assert.equal(app.action.mock.calls.length, 1);
    const [pattern] = app.action.mock.calls[0];
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
    const postEphemeral = args.client.chat.postEphemeral;
    assert.equal(postEphemeral.mock.calls.length, 1);
    const msgArgs = postEphemeral.mock.calls[0]![0];
    assert.ok(ephemeralText(msgArgs)?.includes("permission"));
  });

  it("blocks dev role with ephemeral message", async () => {
    const handler = captureHandler();
    mockGetRole.mockImplementation(async () => "dev");
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(args.ack.mock.calls.length, 1);
    const postEphemeral = args.client.chat.postEphemeral;
    assert.equal(postEphemeral.mock.calls.length, 1);
  });

  it("allows admin role", async () => {
    const handler = captureHandler();
    mockGetRole.mockImplementation(async () => "admin");

    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "write",
      file: "instructions.md",
      content: "new content",
    };
    mockGetStagedIntent.mockImplementation(async () => configIntent);

    const args = makeHandlerArgs();
    await handler(args);

    // Should not post ephemeral permission error
    const postEphemeral = args.client.chat.postEphemeral;
    // It should either succeed or post a success ephemeral, not a permission error
    const calls = postEphemeral.mock.calls;
    for (const call of calls) {
      const text = ephemeralText(call[0]);
      assert.ok(!text?.includes("permission"), "should not contain permission error");
    }
  });

  it("allows owner role", async () => {
    const handler = captureHandler();
    mockGetRole.mockImplementation(async () => "owner");

    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "write",
      file: "instructions.md",
      content: "new content",
    };
    mockGetStagedIntent.mockImplementation(async () => configIntent);

    const args = makeHandlerArgs();
    await handler(args);

    const postEphemeral = args.client.chat.postEphemeral;
    const calls = postEphemeral.mock.calls;
    for (const call of calls) {
      const text = ephemeralText(call[0]);
      assert.ok(!text?.includes("permission"), "should not contain permission error");
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

    const postEphemeral = args.client.chat.postEphemeral;
    assert.equal(postEphemeral.mock.calls.length, 1);
    const msgArgs = postEphemeral.mock.calls[0]![0];
    assert.ok(ephemeralText(msgArgs)?.includes("expired"));
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

    const postEphemeral = args.client.chat.postEphemeral;
    assert.equal(postEphemeral.mock.calls.length, 1);
    const msgArgs = postEphemeral.mock.calls[0]![0];
    assert.ok(ephemeralText(msgArgs)?.includes("expired"));
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
      operation: "write",
      file: "instructions.md",
      content: "new content",
    };
    mockGetStagedIntent.mockImplementation(async () => configIntent);
    const args = makeHandlerArgs();

    await handler(args);

    // Should ack, replace the message (clicked button removed), and write the file
    assert.equal(args.ack.mock.calls.length, 1);
    assert.equal(args.respond.mock.calls.length, 1);
    const respondArg = args.respond.mock.calls[0]![0];
    assert.ok(respondArg, "expected a respond call");
    assert.ok(typeof respondArg !== "string", "expected an object response");
    assert.equal(respondArg.replace_original, true);
    assert.ok("blocks" in respondArg);
    assert.deepEqual(respondArg.blocks, [CONFIG_SECTION]);
    assert.equal(mockWriteInstructionFile.mock.calls.length, 1);
    const writeArgs = mockWriteInstructionFile.mock.calls[0]!;
    assert.equal(writeArgs[0], "instructions.md");
    assert.equal(writeArgs[1], "new content");

    // Should post success ephemeral
    const postEphemeral = args.client.chat.postEphemeral;
    assert.equal(postEphemeral.mock.calls.length, 1);
    const msgArgs = postEphemeral.mock.calls[0]![0];
    assert.ok(ephemeralText(msgArgs)?.includes("instructions.md"));
    assert.ok(ephemeralText(msgArgs)?.includes("updated"));
    assert.equal(msgArgs.channel, "C001");
    assert.equal(msgArgs.thread_ts, "1700000000.000001");
  });

  it("leaves the message untouched (never deletes) when the payload has no blocks", async () => {
    const handler = captureHandler();
    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "write",
      file: "instructions.md",
      content: "new content",
    };
    mockGetStagedIntent.mockImplementation(async () => configIntent);
    const args = makeHandlerArgs();
    args.body.message = undefined;

    await handler(args);

    assert.equal(args.respond.mock.calls.length, 0);
    assert.equal(mockWriteInstructionFile.mock.calls.length, 1);
  });

  it("writes a topic-scoped intent path through to writeInstructionFile unchanged", async () => {
    // The propose tool composes `dev/topics/metabase/rules.md` into `intent.file`;
    // the apply handler must pass it through verbatim so writeInstructionFile creates
    // the nested topic directory and lands the override at the right cascade level.
    const handler = captureHandler();
    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "write",
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

    const postEphemeral = args.client.chat.postEphemeral;
    const msgArgs = postEphemeral.mock.calls[0]![0];
    assert.ok(ephemeralText(msgArgs)?.includes("dev/topics/metabase/rules.md"));
  });

  it("writes a repo-scoped intent path through to writeInstructionFile unchanged", async () => {
    const handler = captureHandler();
    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "write",
      file: "acme-monorepo/changes_instructions.md",
      content: "repo changes",
    };
    mockGetStagedIntent.mockImplementation(async () => configIntent);
    const args = makeHandlerArgs();

    await handler(args);

    assert.equal(mockWriteInstructionFile.mock.calls.length, 1);
    const writeArgs = mockWriteInstructionFile.mock.calls[0]!;
    assert.equal(writeArgs[0], "acme-monorepo/changes_instructions.md");
    assert.equal(writeArgs[1], "repo changes");

    const postEphemeral = args.client.chat.postEphemeral;
    const msgArgs = postEphemeral.mock.calls[0]![0];
    assert.ok(ephemeralText(msgArgs)?.includes("acme-monorepo/changes_instructions.md"));
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
      operation: "write",
      file: "broken.md",
      content: "data",
    };
    mockGetStagedIntent.mockImplementation(async () => configIntent);
    mockWriteInstructionFile.mockImplementation(() => {
      throw new Error("write failed");
    });
    const args = makeHandlerArgs();

    await handler(args);

    const postEphemeral = args.client.chat.postEphemeral;
    assert.equal(postEphemeral.mock.calls.length, 1);
    const msgArgs = postEphemeral.mock.calls[0]![0];
    assert.ok(ephemeralText(msgArgs)?.includes("Failed to update"));
    assert.ok(ephemeralText(msgArgs)?.includes("broken.md"));
    assert.ok(ephemeralText(msgArgs)?.includes("write failed"));
  });
});
