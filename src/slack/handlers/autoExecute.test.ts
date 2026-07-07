import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { ClaudeResponse } from "../../claude/index.js";
import type {
  StagedIntent,
  StagedChangeIntent,
  StagedConfigUpdateIntent,
  StagedUpdateIntent,
  ResponseSnapshot,
  PostToAction,
  Action,
} from "../../tools/types.js";
import type { UserRole } from "../../roles.js";
import type { UserSkill } from "../../userSkills.js";
import type { SessionContext, AttentionLevel, DeliveryMode } from "../../sessions.js";
import type { SessionInfo } from "../activeSessions.js";
import type { SlackDeliveryContext } from "./changeAction.js";
import { handleAutoExecuteActions, type AutoExecuteDeps } from "./autoExecute.js";

// ============================================================================
// Mocks
// ============================================================================

interface PostMessageArgs {
  channel: string;
  thread_ts?: string;
  text: string;
}

interface PostMessageMock {
  mock: {
    callCount(): number;
    calls: Array<{ arguments: [PostMessageArgs] }>;
    resetCalls(): void;
    mockImplementation(fn: (args: PostMessageArgs) => Promise<{ ok: boolean }>): void;
  };
  (args: PostMessageArgs): Promise<{ ok: boolean }>;
}

const mockWriteInstructionFile = vi.fn<(filename: string, content: string) => void>();
const mockDeleteInstructionFile = vi.fn<(filepath: string) => void>();
const mockReadInstructionFile = vi.fn<
  (filepath: string) => { default_content: string | null; custom_content: string | null }
>(() => ({ default_content: null, custom_content: null }));
const mockTriggerChangeWorkflow = vi.fn<
  (intent: StagedChangeIntent, slack: SlackDeliveryContext) => Promise<void>
>(async () => {});
const mockTriggerFollowUp = vi.fn<
  (
    session: SessionContext,
    command: string,
    instructions: string | undefined,
    slack: SlackDeliveryContext,
  ) => Promise<void>
>(async () => {});
const mockFindSessionByThread = vi.fn<
  (channelId: string, threadTs: string) => Promise<SessionContext | null>
>(async () => null);
const mockGetSession = vi.fn<(sessionId: string) => Promise<SessionContext | null>>(
  async () => null,
);
const mockUpdateSession = vi.fn<
  (sessionId: string, updates: { responseTs: string }) => Promise<SessionContext | null>
>(async () => null);
const mockRegisterThreadSession = vi.fn<
  (
    channel: string,
    threadRoot: string,
    opts: { attentionLevel: AttentionLevel; followUpContext?: string; deliveryMode?: DeliveryMode },
  ) => Promise<SessionContext | null>
>(async () => null);
const mockPostAnswerToChannel = vi.fn<
  (
    client: App["client"],
    snapshot: ResponseSnapshot,
    targetChannel: string,
    targetThreadTs?: string,
    deps?: unknown,
    opts?: {
      sessionId?: string;
      actions?: unknown;
      reactions?: string[];
      suppressUnfurls?: boolean;
    },
  ) => Promise<{ ok: boolean; ts?: string }>
>(async () => ({ ok: true }));
const mockResolveOrigin = vi.fn<
  (
    session: SessionContext,
    sessionInfo: SessionInfo,
  ) => { originChannel: string | undefined; originThreadTs: string | undefined }
>(() => ({ originChannel: undefined, originThreadTs: undefined }));
const mockRestoreSession = vi.fn<(sessionId: string) => Promise<SessionInfo | null>>(
  async () => null,
);
const mockSeedEphemeralRule = vi.fn<AutoExecuteDeps["seedEphemeralRule"]>(async (opts) => ({
  id: "eph-1",
  kind: "ephemeral",
  channels: [opts.channel],
  attentionLevel: opts.attentionLevel,
  expiresAt: 0,
  sessionIds: [opts.sessionId],
  anchorText: opts.anchorText,
  enabled: true,
}));
const mockActiveSessions = {
  restore: vi.fn<(sessionId: string) => Promise<SessionInfo | null>>(async () => null),
};
const mockPostMessageFn = vi.fn<(args: PostMessageArgs) => Promise<{ ok: boolean }>>(async () => ({
  ok: true,
}));

// ============================================================================
// Helpers
// ============================================================================

function makeClient(): App["client"] {
  return {
    chat: {
      postMessage: mockPostMessageFn,
    },
  } as object as App["client"];
}

function makeDeps(): AutoExecuteDeps {
  return {
    canRequestChanges: (role: UserRole) => role !== "member",
    canCreateUserSkill: () => true,
    canEditUserSkillContent: () => true,
    canManageUserSkill: () => true,
    canDeleteUserSkill: () => true,
    writeUserSkill: () => {
      throw new Error("not used in test");
    },
    updateUserSkill: () => {
      throw new Error("not used in test");
    },
    disableUserSkill: () => {
      throw new Error("not used in test");
    },
    restoreUserSkill: () => {
      throw new Error("not used in test");
    },
    deleteUserSkill: () => {
      throw new Error("not used in test");
    },
    readUserSkill: () => null,
    triggerChangeWorkflow: mockTriggerChangeWorkflow,
    triggerFollowUp: mockTriggerFollowUp,
    postAnswerToChannel: mockPostAnswerToChannel,
    resolveOrigin: mockResolveOrigin,
    writeInstructionFile: mockWriteInstructionFile,
    deleteInstructionFile: mockDeleteInstructionFile,
    readInstructionFile: mockReadInstructionFile,
    findSessionByThread: mockFindSessionByThread,
    getSession: mockGetSession,
    updateSession: mockUpdateSession,
    registerThreadSession: mockRegisterThreadSession,
    seedEphemeralRule: mockSeedEphemeralRule,
    restoreSession: mockActiveSessions.restore,
  };
}

function makeBaseParams(overrides: Partial<Parameters<typeof handleAutoExecuteActions>[0]> = {}) {
  return {
    client: makeClient(),
    channelId: "C001",
    threadTs: "1700000000.000001",
    userId: "U001",
    sessionId: "session-1",
    role: "dev" as UserRole,
    response: {
      success: true,
      answer: "test",
    } as ClaudeResponse,
    ...overrides,
  };
}

function makeResponseWithActions(
  actions: ClaudeResponse["response"],
  stagedIntents?: Record<string, StagedIntent>,
): ClaudeResponse {
  return {
    success: true,
    answer: "test",
    response: actions,
    stagedIntents,
  };
}

beforeEach(() => {
  mockWriteInstructionFile.mockClear();
  mockDeleteInstructionFile.mockClear();
  mockReadInstructionFile.mockClear();
  mockReadInstructionFile.mockReturnValue({ default_content: null, custom_content: null });
  mockTriggerChangeWorkflow.mockClear();
  mockTriggerFollowUp.mockClear();
  mockFindSessionByThread.mockClear();
  mockGetSession.mockClear();
  mockRegisterThreadSession.mockClear();
  mockSeedEphemeralRule.mockClear();
  mockPostAnswerToChannel.mockClear();
  mockResolveOrigin.mockClear();
  mockActiveSessions.restore.mockClear();
  mockPostMessageFn.mockClear();
  mockPostMessageFn.mockImplementation(async () => ({ ok: true }));
});

// ============================================================================
// Early returns — no actions to auto-execute
// ============================================================================

describe("handleAutoExecuteActions — early returns", () => {
  it("returns immediately when response has no actions", async () => {
    const params = makeBaseParams({
      response: { success: true, answer: "hello" },
    });

    await handleAutoExecuteActions(params, makeDeps());
    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 0);
    assert.equal(mockWriteInstructionFile.mock.calls.length, 0);
  });

  it("returns immediately when response has no stagedIntents", async () => {
    const params = makeBaseParams({
      response: {
        success: true,
        answer: "hello",
        response: {
          blocks: [],
          actions: [{ type: "change", ref: "r1", auto: true }],
        },
        // no stagedIntents
      },
    });

    await handleAutoExecuteActions(params, makeDeps());
    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 0);
  });

  it("returns immediately when response.response is undefined", async () => {
    const params = makeBaseParams({
      response: {
        success: true,
        answer: "hello",
        stagedIntents: {
          r1: { type: "change", branch: "b", description: "d", repo: "r" },
        },
      },
    });

    await handleAutoExecuteActions(params, makeDeps());
    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 0);
  });

  it("returns immediately when there are no auto-flagged actions", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "change", ref: "r1" }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());
    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 0);
  });

  it("does not trigger ref-based auto-execute for post_to actions", async () => {
    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [
            // post_to with auto but no ref — handled by post_to auto-execute, not ref-based loop
            {
              type: "post_to",
              auto: true,
              creation_context: "why this was posted",
              blocks: [
                {
                  type: "section",
                  text: { type: "mrkdwn", text: "auto content" },
                },
              ],
            },
          ],
        },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());
    // post_to is handled separately, should not trigger change/config workflows
    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 0);
    assert.equal(mockWriteInstructionFile.mock.calls.length, 0);
  });
});

// ============================================================================
// post_to thread engagement (attention_level / creation_context)
// ============================================================================

describe("handleAutoExecuteActions — post_to thread engagement", () => {
  const SNAP_ID = "snap1";

  function sessionWithSnapshot(): SessionContext {
    return {
      sessionId: "session-1",
      channelId: "C001",
      messageTs: "1700000000.000001",
      threadTs: "1700000000.000001",
      userId: "U001",
      trigger: {
        type: "mentions",
        userId: "U001",
        messageTs: "1700000000.000001",
        messageText: "hi",
      },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: 0,
      createdAt: 0,
      snapshots: { [SNAP_ID]: { text: "x", blocks: [] } },
    };
  }

  function postTo(extra: Partial<PostToAction>): Action {
    return {
      type: "post_to",
      auto: true,
      _snapshotId: SNAP_ID,
      channel: "C200",
      creation_context: "why this was posted",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "auto" } }],
      ...extra,
    };
  }

  it("seeds the posted ts as root for a top-level cross-post with attention_level", async () => {
    mockGetSession.mockResolvedValue(sessionWithSnapshot());
    mockPostAnswerToChannel.mockResolvedValue({ ok: true, ts: "1700000000.999999" });
    const params = makeBaseParams({
      response: makeResponseWithActions(
        { blocks: [], actions: [postTo({ attention_level: "high", creation_context: "ctx" })] },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockRegisterThreadSession.mock.calls.length, 1);
    assert.deepEqual(mockRegisterThreadSession.mock.calls[0], [
      "C200",
      "1700000000.999999",
      { attentionLevel: "high", creationContext: "ctx" },
    ]);
  });

  it("forwards default_delivery_mode into registerThreadSession", async () => {
    mockGetSession.mockResolvedValue(sessionWithSnapshot());
    mockPostAnswerToChannel.mockResolvedValue({ ok: true, ts: "1700000000.999999" });
    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [postTo({ attention_level: "high", default_delivery_mode: "invisible" })],
        },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockRegisterThreadSession.mock.calls.length, 1);
    assert.deepEqual(mockRegisterThreadSession.mock.calls[0][2], {
      attentionLevel: "high",
      creationContext: "why this was posted",
      deliveryMode: "invisible",
    });
  });

  it("seeds the action's thread_ts as root for a threaded cross-post", async () => {
    mockGetSession.mockResolvedValue(sessionWithSnapshot());
    mockPostAnswerToChannel.mockResolvedValue({ ok: true, ts: "1700000000.999999" });
    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [postTo({ thread_ts: "1700000000.111111", attention_level: "always" })],
        },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockRegisterThreadSession.mock.calls.length, 1);
    assert.equal(mockRegisterThreadSession.mock.calls[0][1], "1700000000.111111");
  });

  it("does not seed when attention_level is omitted", async () => {
    mockGetSession.mockResolvedValue(sessionWithSnapshot());
    mockPostAnswerToChannel.mockResolvedValue({ ok: true, ts: "1700000000.999999" });
    const params = makeBaseParams({
      response: makeResponseWithActions({ blocks: [], actions: [postTo({})] }, {}),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockRegisterThreadSession.mock.calls.length, 0);
  });

  it("does not seed when the cross-post throws", async () => {
    mockGetSession.mockResolvedValue(sessionWithSnapshot());
    mockPostAnswerToChannel.mockRejectedValue(new Error("slack down"));
    const params = makeBaseParams({
      response: makeResponseWithActions(
        { blocks: [], actions: [postTo({ attention_level: "high" })] },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockRegisterThreadSession.mock.calls.length, 0);
  });

  it("seeds a channel conversation for a top-level cross-post with channel_attention_level", async () => {
    mockGetSession.mockResolvedValue(sessionWithSnapshot());
    mockPostAnswerToChannel.mockResolvedValue({ ok: true, ts: "1700000000.999999" });
    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [postTo({ channel_attention_level: "medium", creation_context: "ctx" })],
        },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockSeedEphemeralRule.mock.calls.length, 1);
    assert.deepEqual(mockSeedEphemeralRule.mock.calls[0][0], {
      channel: "C200",
      attentionLevel: "medium",
      sessionId: "session-1",
      anchorText: "x",
      creationContext: "ctx",
    });
  });

  it("ignores channel_attention_level when the action targets a thread", async () => {
    mockGetSession.mockResolvedValue(sessionWithSnapshot());
    mockPostAnswerToChannel.mockResolvedValue({ ok: true, ts: "1700000000.999999" });
    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [postTo({ thread_ts: "1700000000.111111", channel_attention_level: "medium" })],
        },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockSeedEphemeralRule.mock.calls.length, 0);
  });

  it("does not seed a channel conversation when the cross-post throws", async () => {
    mockGetSession.mockResolvedValue(sessionWithSnapshot());
    mockPostAnswerToChannel.mockRejectedValue(new Error("slack down"));
    const params = makeBaseParams({
      response: makeResponseWithActions(
        { blocks: [], actions: [postTo({ channel_attention_level: "high" })] },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockSeedEphemeralRule.mock.calls.length, 0);
  });
});

// ============================================================================
// Permission checks
// ============================================================================

describe("handleAutoExecuteActions — permission checks", () => {
  it("blocks auto-execute for member role", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      role: "member",
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());
    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 0);
  });

  it("allows auto-execute for dev role", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      role: "dev",
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());
    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 1);
  });

  it("threads silent: true into triggerChangeWorkflow when the run is silent", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      role: "dev",
      silent: true,
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());
    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 1);
    const slack = mockTriggerChangeWorkflow.mock.calls[0]![1];
    assert.equal(slack.silent, true);
  });

  it("does not set silent on triggerChangeWorkflow for a normal run", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      role: "dev",
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());
    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 1);
    const slack = mockTriggerChangeWorkflow.mock.calls[0]![1];
    assert.equal(slack.silent, undefined);
  });

  it("allows auto-execute for admin role", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      role: "admin",
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());
    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 1);
  });

  it("allows auto-execute for owner role", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      role: "owner",
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());
    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 1);
  });
});

// ============================================================================
// Intent resolution
// ============================================================================

describe("handleAutoExecuteActions — intent resolution", () => {
  it("skips action when intent ref cannot be resolved", async () => {
    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [{ type: "change", ref: "missing-ref", auto: true }],
        },
        {
          "other-ref": {
            type: "change",
            branch: "b",
            description: "d",
            repo: "r",
          },
        },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());
    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 0);
  });
});

// ============================================================================
// config_update intent
// ============================================================================

describe("handleAutoExecuteActions — config_update", () => {
  it("writes the instruction file and posts a success message", async () => {
    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "write",
      file: "instructions.md",
      content: "new content",
    };
    const client = makeClient();
    const params = makeBaseParams({
      client,
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [{ type: "config_update", ref: "c1", auto: true }],
        },
        { c1: configIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockWriteInstructionFile.mock.calls.length, 1);
    const writeArgs = mockWriteInstructionFile.mock.calls[0];
    assert.equal(writeArgs[0], "instructions.md");
    assert.equal(writeArgs[1], "new content");

    const postMessage = mockPostMessageFn;
    assert.equal(postMessage.mock.calls.length, 1);
    const msgArgs = postMessage.mock.calls[0][0] as {
      channel: string;
      thread_ts: string;
      text: string;
    };
    assert.equal(msgArgs.channel, "C001");
    assert.ok(msgArgs.text.includes("instructions.md"));
    assert.ok(msgArgs.text.includes("updated"));
  });

  it("posts an error message when writeInstructionFile throws", async () => {
    mockWriteInstructionFile.mockImplementation(() => {
      throw new Error("write failed");
    });

    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "write",
      file: "broken.md",
      content: "data",
    };
    const client = makeClient();
    const params = makeBaseParams({
      client,
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [{ type: "config_update", ref: "c1", auto: true }],
        },
        { c1: configIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    const postMessage = mockPostMessageFn;
    assert.equal(postMessage.mock.calls.length, 1);
    const msgArgs = postMessage.mock.calls[0][0] as PostMessageArgs;
    assert.ok(msgArgs.text.includes("Failed to update"));
    assert.ok(msgArgs.text.includes("broken.md"));
    assert.ok(msgArgs.text.includes("write failed"));
  });

  // --- Delete operation ---

  it("calls deleteInstructionFile and posts revert-to-default when default exists", async () => {
    mockReadInstructionFile.mockReturnValue({
      default_content: "shipped default",
      custom_content: "custom override",
    });

    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "delete",
      file: "user/identity.md",
    };
    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [{ type: "config_update", ref: "c1", auto: true }],
        },
        { c1: configIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockDeleteInstructionFile.mock.calls.length, 1);
    assert.equal(mockDeleteInstructionFile.mock.calls[0]![0], "user/identity.md");
    assert.equal(mockWriteInstructionFile.mock.calls.length, 0);

    assert.equal(mockPostMessageFn.mock.calls.length, 1);
    const msgArgs = mockPostMessageFn.mock.calls[0]![0] as PostMessageArgs;
    assert.match(msgArgs.text, /removed/i);
    assert.match(msgArgs.text, /default/i);
  });

  it("posts file-deleted confirmation when no default exists", async () => {
    mockReadInstructionFile.mockReturnValue({
      default_content: null,
      custom_content: "custom-only",
    });

    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "delete",
      file: "user/company-context.md",
    };
    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [{ type: "config_update", ref: "c1", auto: true }],
        },
        { c1: configIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockPostMessageFn.mock.calls.length, 1);
    const msgArgs = mockPostMessageFn.mock.calls[0]![0] as PostMessageArgs;
    assert.match(msgArgs.text, /deleted/i);
    assert.doesNotMatch(msgArgs.text, /default/i);
  });

  it("posts an error message when deleteInstructionFile throws", async () => {
    mockReadInstructionFile.mockReturnValue({
      default_content: null,
      custom_content: "still here at stage time",
    });
    mockDeleteInstructionFile.mockImplementation(() => {
      throw new Error("File not found: user/gone.md");
    });

    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "delete",
      file: "user/gone.md",
    };
    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [{ type: "config_update", ref: "c1", auto: true }],
        },
        { c1: configIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockPostMessageFn.mock.calls.length, 1);
    const msgArgs = mockPostMessageFn.mock.calls[0]![0] as PostMessageArgs;
    assert.match(msgArgs.text, /failed to delete/i);
    assert.match(msgArgs.text, /user\/gone\.md/);
    assert.match(msgArgs.text, /file not found/i);
  });
});

// ============================================================================
// change intent
// ============================================================================

describe("handleAutoExecuteActions — change intent", () => {
  it("triggers the change workflow with correct parameters", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/auto",
      description: "Auto change",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 1);
    const args = mockTriggerChangeWorkflow.mock.calls[0];
    assert.deepEqual(args[0], changeIntent);
    const slackCtx = args[1] as SlackDeliveryContext;
    assert.equal(slackCtx.channelId, "C001");
    assert.equal(slackCtx.threadTs, "1700000000.000001");
    assert.equal(slackCtx.userId, "U001");
  });

  it("propagates triggerType to the change workflow", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/auto",
      description: "desc",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      triggerType: "mentions",
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    const slackCtx = mockTriggerChangeWorkflow.mock.calls[0][1] as SlackDeliveryContext;
    assert.equal(slackCtx.triggerType, "mentions");
  });

  it("passes DM channel and thread when provided", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/auto",
      description: "desc",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      dmChannel: "D_DM",
      dmThreadTs: "1700000099.000001",
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    const slackCtx = mockTriggerChangeWorkflow.mock.calls[0][1] as SlackDeliveryContext;
    assert.equal(slackCtx.streamChannel, "D_DM");
    assert.equal(slackCtx.streamThreadTs, "1700000099.000001");
  });

  it("does not include stream fields when dmChannel is not provided", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/auto",
      description: "desc",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    const slackCtx = mockTriggerChangeWorkflow.mock.calls[0][1] as SlackDeliveryContext;
    assert.equal("streamChannel" in slackCtx, false);
    assert.equal("streamThreadTs" in slackCtx, false);
  });
});

// ============================================================================
// update intent
// ============================================================================

describe("handleAutoExecuteActions — update intent", () => {
  it("triggers follow-up when active change exists", async () => {
    const updateIntent: StagedUpdateIntent = {
      type: "update",
      sessionId: "session-1",
      instructions: "fix the tests",
    };
    const fakeSession = {
      sessionId: "session-1",
      channelId: "C001",
      messageTs: "1700000000.000001",
      threadTs: "1700000000.000001",
      userId: "U001",
      trigger: {
        type: "mentions",
        userId: "U001",
        messageTs: "1700000000.000001",
        messageText: "q",
      },
      messages: [],
      threadContext: [],
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
    } as SessionContext;

    mockFindSessionByThread.mockImplementation(async () => fakeSession);

    const params = makeBaseParams({
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "update", ref: "u1", auto: true }] },
        { u1: updateIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockTriggerFollowUp.mock.calls.length, 1);
    const args = mockTriggerFollowUp.mock.calls[0];
    assert.equal(args[0], fakeSession);
    assert.equal(args[1], "update");
    assert.equal(args[2], "fix the tests");
  });

  it("skips when no active change exists in thread", async () => {
    const updateIntent: StagedUpdateIntent = {
      type: "update",
      sessionId: "session-1",
      instructions: "fix the tests",
    };

    mockFindSessionByThread.mockImplementation(async () => null);

    const params = makeBaseParams({
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "update", ref: "u1", auto: true }] },
        { u1: updateIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockTriggerFollowUp.mock.calls.length, 0);
  });

  it("skips when session exists but has no activeChange", async () => {
    const updateIntent: StagedUpdateIntent = {
      type: "update",
      sessionId: "session-1",
      instructions: "fix",
    };
    const fakeSession = {
      sessionId: "session-1",
      channelId: "C001",
      messageTs: "1700000000.000001",
      threadTs: "1700000000.000001",
      userId: "U001",
      trigger: {
        type: "mentions",
        userId: "U001",
        messageTs: "1700000000.000001",
        messageText: "q",
      },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      // no activeChange
    } as SessionContext;

    mockFindSessionByThread.mockImplementation(async () => fakeSession);

    const params = makeBaseParams({
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "update", ref: "u1", auto: true }] },
        { u1: updateIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockTriggerFollowUp.mock.calls.length, 0);
  });

  it("passes DM stream fields for update follow-up", async () => {
    const updateIntent: StagedUpdateIntent = {
      type: "update",
      sessionId: "session-1",
      instructions: "fix it",
    };
    const fakeSession = {
      sessionId: "session-1",
      channelId: "C001",
      messageTs: "1700000000.000001",
      threadTs: "1700000000.000001",
      userId: "U001",
      trigger: {
        type: "mentions",
        userId: "U001",
        messageTs: "1700000000.000001",
        messageText: "q",
      },
      messages: [],
      threadContext: [],
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
    } as SessionContext;

    mockFindSessionByThread.mockImplementation(async () => fakeSession);

    const params = makeBaseParams({
      dmChannel: "D_DM",
      dmThreadTs: "17.99",
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "update", ref: "u1", auto: true }] },
        { u1: updateIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    const slackCtx = mockTriggerFollowUp.mock.calls[0][3] as SlackDeliveryContext;
    assert.equal(slackCtx.streamChannel, "D_DM");
    assert.equal(slackCtx.streamThreadTs, "17.99");
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe("handleAutoExecuteActions — error handling", () => {
  it("posts error to thread when triggerChangeWorkflow throws", async () => {
    mockTriggerChangeWorkflow.mockImplementation(async () => {
      throw new Error("workflow exploded");
    });

    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/auto",
      description: "desc",
      repo: "org/repo",
    };
    const client = makeClient();
    const params = makeBaseParams({
      client,
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    // Should not throw
    await handleAutoExecuteActions(params, makeDeps());

    const postMessage = mockPostMessageFn;
    assert.equal(postMessage.mock.calls.length, 1);
    const msgArgs = postMessage.mock.calls[0][0] as PostMessageArgs;
    assert.ok(msgArgs.text.includes("Auto-execute failed"));
    assert.ok(msgArgs.text.includes("workflow exploded"));
  });

  it("does not crash when error reporting itself fails", async () => {
    mockTriggerChangeWorkflow.mockImplementation(async () => {
      throw new Error("workflow exploded");
    });

    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/auto",
      description: "desc",
      repo: "org/repo",
    };
    const client = makeClient();
    // Make postMessage also throw
    mockPostMessageFn.mockImplementation(async () => {
      throw new Error("slack down");
    });

    const params = makeBaseParams({
      client,
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    // Should not throw — best-effort error reporting
    await handleAutoExecuteActions(params, makeDeps());
  });
});

// ============================================================================
// Multiple auto actions
// ============================================================================

describe("handleAutoExecuteActions — multiple actions", () => {
  it("processes multiple auto actions sequentially", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/first",
      description: "first",
      repo: "org/repo",
    };
    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      operation: "write",
      file: "settings.md",
      content: "new settings",
    };
    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [
            { type: "change", ref: "r1", auto: true },
            { type: "config_update", ref: "c1", auto: true },
          ],
        },
        { r1: changeIntent, c1: configIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 1);
    assert.equal(mockWriteInstructionFile.mock.calls.length, 1);
  });

  it("skips non-auto actions and processes auto ones", async () => {
    const changeIntent1: StagedChangeIntent = {
      type: "change",
      branch: "feat/manual",
      description: "manual",
      repo: "org/repo",
    };
    const changeIntent2: StagedChangeIntent = {
      type: "change",
      branch: "feat/auto",
      description: "auto",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [
            { type: "change", ref: "r1" }, // no auto
            { type: "change", ref: "r2", auto: true }, // auto
          ],
        },
        { r1: changeIntent1, r2: changeIntent2 },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 1);
    const calledIntent = mockTriggerChangeWorkflow.mock.calls[0][0] as StagedChangeIntent;
    assert.equal(calledIntent.branch, "feat/auto");
  });
});

// ============================================================================
// post_to auto-execute
// ============================================================================

describe("handleAutoExecuteActions — post_to auto-execute", () => {
  it("posts snapshot content to the session channel when auto is true", async () => {
    const fakeSession = {
      sessionId: "session-1",
      channelId: "C001",
      messageTs: "1700000000.000001",
      threadTs: "1700000000.000001",
      userId: "U001",
      trigger: {
        type: "mentions",
        userId: "U001",
        messageTs: "1700000000.000001",
        messageText: "q",
      },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      snapshots: {
        snap1: {
          text: "Channel post content",
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: "Channel post content" },
            },
          ],
        },
      },
    } as unknown as SessionContext;

    mockGetSession.mockImplementation(async () => fakeSession);
    mockActiveSessions.restore.mockImplementation(async () => null);

    const client = makeClient();
    const params = makeBaseParams({
      client,
      response: makeResponseWithActions(
        {
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: "Thread response" },
            },
          ],
          actions: [
            {
              type: "post_to" as const,
              auto: true,
              creation_context: "why this was posted",
              blocks: [
                {
                  type: "section" as const,
                  text: {
                    type: "mrkdwn" as const,
                    text: "Channel post content",
                  },
                },
              ],
              _snapshotId: "snap1",
            },
          ],
        },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockPostAnswerToChannel.mock.calls.length, 1);
    const args = mockPostAnswerToChannel.mock.calls[0];
    assert.deepEqual(args[1], {
      text: "Channel post content",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "Channel post content" },
        },
      ],
    });
    assert.equal(args[2], "C001"); // session channel
    assert.equal(args[3], undefined); // no thread_ts = top-level
  });

  it("skips post_to auto-execute for plain DM trigger (no assistant)", async () => {
    const fakeSession = {
      sessionId: "session-1",
      channelId: "C001",
      messageTs: "1700000000.000001",
      threadTs: "1700000000.000001",
      userId: "U001",
      trigger: {
        type: "mentions",
        userId: "U001",
        messageTs: "1700000000.000001",
        messageText: "q",
      },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      // no assistantOriginChannelId
    } as unknown as SessionContext;

    mockGetSession.mockImplementation(async () => fakeSession);

    const params = makeBaseParams({
      triggerType: "directMessages",
      response: makeResponseWithActions(
        {
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Response" } }],
          actions: [
            {
              type: "post_to" as const,
              auto: true,
              creation_context: "why this was posted",
              blocks: [
                {
                  type: "section" as const,
                  text: { type: "mrkdwn" as const, text: "content" },
                },
              ],
              _snapshotId: "snap1",
            },
          ],
        },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockPostAnswerToChannel.mock.calls.length, 0);
  });

  it("proceeds for assistant panel DM trigger (has assistantOriginChannelId)", async () => {
    const fakeSession = {
      sessionId: "session-1",
      channelId: "C001",
      messageTs: "1700000000.000001",
      threadTs: "1700000000.000001",
      userId: "U001",
      trigger: {
        type: "mentions",
        userId: "U001",
        messageTs: "1700000000.000001",
        messageText: "q",
      },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      assistantOriginChannelId: "C_PANEL",
      assistantCurrentChannelId: "C_VIEWED",
      snapshots: {
        snap1: {
          text: "content",
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "content" } }],
        },
      },
    } as unknown as SessionContext;

    mockGetSession.mockImplementation(async () => fakeSession);
    mockActiveSessions.restore.mockImplementation(async () => null);

    const client = makeClient();
    const params = makeBaseParams({
      client,
      triggerType: "directMessages",
      response: makeResponseWithActions(
        {
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Response" } }],
          actions: [
            {
              type: "post_to" as const,
              auto: true,
              creation_context: "why this was posted",
              blocks: [
                {
                  type: "section" as const,
                  text: { type: "mrkdwn" as const, text: "content" },
                },
              ],
              _snapshotId: "snap1",
            },
          ],
        },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockPostAnswerToChannel.mock.calls.length, 1);
    const args = mockPostAnswerToChannel.mock.calls[0];
    assert.equal(args[2], "C_VIEWED"); // assistantCurrentChannelId
  });

  it("uses explicit channel and thread_ts when provided", async () => {
    const fakeSession = {
      sessionId: "session-1",
      channelId: "C001",
      messageTs: "1700000000.000001",
      threadTs: "1700000000.000001",
      userId: "U001",
      trigger: {
        type: "mentions",
        userId: "U001",
        messageTs: "1700000000.000001",
        messageText: "q",
      },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      snapshots: {
        snap1: {
          text: "Cross-post content",
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: "Cross-post content" },
            },
          ],
        },
      },
    } as unknown as SessionContext;

    mockGetSession.mockImplementation(async () => fakeSession);
    mockActiveSessions.restore.mockImplementation(async () => null);

    const client = makeClient();
    const params = makeBaseParams({
      client,
      response: makeResponseWithActions(
        {
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: "Thread response" },
            },
          ],
          actions: [
            {
              type: "post_to" as const,
              auto: true,
              creation_context: "why this was posted",
              blocks: [
                {
                  type: "section" as const,
                  text: { type: "mrkdwn" as const, text: "Cross-post content" },
                },
              ],
              _snapshotId: "snap1",
              channel: "C999",
              thread_ts: "1700099.000",
            },
          ],
        },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockPostAnswerToChannel.mock.calls.length, 1);
    const args = mockPostAnswerToChannel.mock.calls[0];
    assert.equal(args[2], "C999"); // explicit channel
    assert.equal(args[3], "1700099.000"); // explicit thread_ts
  });

  it("does not block ref-based auto-execute when post_to also present", async () => {
    const fakeSession = {
      sessionId: "session-1",
      channelId: "C001",
      messageTs: "1700000000.000001",
      threadTs: "1700000000.000001",
      userId: "U001",
      trigger: {
        type: "mentions",
        userId: "U001",
        messageTs: "1700000000.000001",
        messageText: "q",
      },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      snapshots: {
        snap1: {
          text: "content",
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "content" } }],
        },
      },
    } as unknown as SessionContext;

    mockGetSession.mockImplementation(async () => fakeSession);
    mockActiveSessions.restore.mockImplementation(async () => null);

    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };
    const client = makeClient();
    const params = makeBaseParams({
      client,
      response: makeResponseWithActions(
        {
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Response" } }],
          actions: [
            {
              type: "post_to" as const,
              auto: true,
              creation_context: "why this was posted",
              blocks: [
                {
                  type: "section" as const,
                  text: { type: "mrkdwn" as const, text: "content" },
                },
              ],
              _snapshotId: "snap1",
            },
            { type: "change", ref: "r1", auto: true },
          ],
        },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    // Both should execute
    assert.equal(mockPostAnswerToChannel.mock.calls.length, 1);
    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 1);
  });

  it("skips when session is not found", async () => {
    mockGetSession.mockImplementation(async () => null);

    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Response" } }],
          actions: [
            {
              type: "post_to" as const,
              auto: true,
              creation_context: "why this was posted",
              blocks: [
                {
                  type: "section" as const,
                  text: { type: "mrkdwn" as const, text: "content" },
                },
              ],
              _snapshotId: "snap1",
            },
          ],
        },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockPostAnswerToChannel.mock.calls.length, 0);
  });

  it("skips action when snapshot is missing", async () => {
    const fakeSession = {
      sessionId: "session-1",
      channelId: "C001",
      messageTs: "1700000000.000001",
      threadTs: "1700000000.000001",
      userId: "U001",
      trigger: {
        type: "mentions",
        userId: "U001",
        messageTs: "1700000000.000001",
        messageText: "q",
      },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      snapshots: {},
    } as unknown as SessionContext;

    mockGetSession.mockImplementation(async () => fakeSession);
    mockActiveSessions.restore.mockImplementation(async () => null);

    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Response" } }],
          actions: [
            {
              type: "post_to" as const,
              auto: true,
              creation_context: "why this was posted",
              blocks: [
                {
                  type: "section" as const,
                  text: { type: "mrkdwn" as const, text: "content" },
                },
              ],
              _snapshotId: "missing-snap",
            },
          ],
        },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockPostAnswerToChannel.mock.calls.length, 0);
  });

  it("posts error to thread when postAnswerToChannel throws", async () => {
    const fakeSession = {
      sessionId: "session-1",
      channelId: "C001",
      messageTs: "1700000000.000001",
      threadTs: "1700000000.000001",
      userId: "U001",
      trigger: {
        type: "mentions",
        userId: "U001",
        messageTs: "1700000000.000001",
        messageText: "q",
      },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      snapshots: {
        snap1: {
          text: "content",
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "content" } }],
        },
      },
    } as unknown as SessionContext;

    mockGetSession.mockImplementation(async () => fakeSession);
    mockActiveSessions.restore.mockImplementation(async () => null);
    mockPostAnswerToChannel.mockImplementation(async () => {
      throw new Error("channel_not_found");
    });

    const client = makeClient();
    const params = makeBaseParams({
      client,
      response: makeResponseWithActions(
        {
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Response" } }],
          actions: [
            {
              type: "post_to" as const,
              auto: true,
              creation_context: "why this was posted",
              blocks: [
                {
                  type: "section" as const,
                  text: { type: "mrkdwn" as const, text: "content" },
                },
              ],
              _snapshotId: "snap1",
            },
          ],
        },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    const postMessage = mockPostMessageFn;
    assert.equal(postMessage.mock.calls.length, 1);
    const msgArgs = postMessage.mock.calls[0][0] as PostMessageArgs;
    assert.ok(msgArgs.text.includes("Failed to post"));
    assert.ok(msgArgs.text.includes("channel_not_found"));
  });
});

// ============================================================================
// Channelless (invisible) context
// ============================================================================

describe("handleAutoExecuteActions — channelless context", () => {
  it("suppresses intent auto-execute in a channelless context", async () => {
    const changeIntent: StagedChangeIntent = {
      type: "change",
      branch: "feat/x",
      description: "desc",
      repo: "org/repo",
    };
    const params = makeBaseParams({
      channelId: "channelless:job-1",
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "change", ref: "r1", auto: true }] },
        { r1: changeIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());
    assert.equal(mockTriggerChangeWorkflow.mock.calls.length, 0);
  });

  it("still runs post_to auto-execute in a channelless context", async () => {
    const fakeSession: Partial<SessionContext> = {
      sessionId: "session-1",
      channelId: "channelless:job-1",
      snapshots: {
        snap1: {
          text: "Channel post content",
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Channel post content" } }],
        },
      },
    };
    mockGetSession.mockImplementation(async () => fakeSession as SessionContext);
    mockActiveSessions.restore.mockImplementation(async () => null);

    const params = makeBaseParams({
      channelId: "channelless:job-1",
      response: makeResponseWithActions(
        {
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Thread response" } }],
          actions: [
            {
              type: "post_to" as const,
              auto: true,
              creation_context: "why this was posted",
              channel: "C999",
              blocks: [
                {
                  type: "section" as const,
                  text: { type: "mrkdwn" as const, text: "Channel post content" },
                },
              ],
              _snapshotId: "snap1",
            },
          ],
        },
        {},
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockPostAnswerToChannel.mock.calls.length, 1);
    assert.equal(mockPostAnswerToChannel.mock.calls[0][2], "C999");
  });
});

describe("handleAutoExecuteActions — skill_delete auto-execute", () => {
  const skillFixture: UserSkill = {
    slug: "foo",
    description: "d",
    body: "b",
    ownerUserId: "U_OWNER",
    createdAt: "t",
    updatedAt: "t",
  };

  function makeDeleteDeps(opts: { canDelete: boolean }): {
    deps: AutoExecuteDeps;
    deleteUserSkill: ReturnType<typeof vi.fn>;
  } {
    const deleteUserSkill = vi.fn();
    const deps: AutoExecuteDeps = {
      ...makeDeps(),
      readUserSkill: () => skillFixture,
      canDeleteUserSkill: () => opts.canDelete,
      deleteUserSkill,
    };
    return { deps, deleteUserSkill };
  }

  it("removes the skill and posts a success message when the caller is admin", async () => {
    const { deps, deleteUserSkill } = makeDeleteDeps({ canDelete: true });
    const params = makeBaseParams({
      role: "admin",
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "skill_delete", ref: "d1", auto: true }] },
        { d1: { type: "skill_delete", slug: "foo" } },
      ),
    });

    await handleAutoExecuteActions(params, deps);

    assert.equal(deleteUserSkill.mock.calls.length, 1);
    assert.equal(deleteUserSkill.mock.calls[0][0], "foo");
    assert.equal(mockPostMessageFn.mock.calls.length, 1);
  });

  it("is a no-op when the caller lacks the admin gate", async () => {
    const { deps, deleteUserSkill } = makeDeleteDeps({ canDelete: false });
    const params = makeBaseParams({
      role: "member",
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "skill_delete", ref: "d1", auto: true }] },
        { d1: { type: "skill_delete", slug: "foo" } },
      ),
    });

    await handleAutoExecuteActions(params, deps);

    assert.equal(deleteUserSkill.mock.calls.length, 0);
  });
});
