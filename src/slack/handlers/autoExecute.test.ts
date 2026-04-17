import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import type { ClaudeResponse } from "../../claude/index.js";
import type {
  Action,
  StagedIntent,
  StagedChangeIntent,
  StagedConfigUpdateIntent,
  StagedUpdateIntent,
  ResponseSnapshot,
} from "../../tools/types.js";
import type { UserRole } from "../../roles.js";
import type { SessionContext } from "../../sessions.js";
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

const mockWriteInstructionFile = mock.fn<(filename: string, content: string) => void>();
const mockTriggerChangeWorkflow = mock.fn<
  (intent: StagedChangeIntent, slack: SlackDeliveryContext) => Promise<void>
>(async () => {});
const mockTriggerFollowUp = mock.fn<
  (
    session: SessionContext,
    command: string,
    instructions: string | undefined,
    slack: SlackDeliveryContext,
  ) => Promise<void>
>(async () => {});
const mockFindSessionByThread = mock.fn<
  (channelId: string, threadTs: string) => Promise<SessionContext | null>
>(async () => null);
const mockGetSession = mock.fn<(sessionId: string) => Promise<SessionContext | null>>(
  async () => null,
);
const mockUpdateSession = mock.fn<
  (sessionId: string, updates: { responseTs: string }) => Promise<SessionContext | null>
>(async () => null);
const mockPostAnswerToChannel = mock.fn<
  (
    client: App["client"],
    snapshot: ResponseSnapshot,
    targetChannel: string,
    targetThreadTs?: string,
  ) => Promise<{ ok: boolean; ts?: string }>
>(async () => ({ ok: true }));
const mockResolveOrigin = mock.fn<
  (
    session: SessionContext,
    sessionInfo: SessionInfo,
  ) => { originChannel: string | undefined; originThreadTs: string | undefined }
>(() => ({ originChannel: undefined, originThreadTs: undefined }));
const mockRestoreSession = mock.fn<(sessionId: string) => Promise<SessionInfo | null>>(
  async () => null,
);
const mockActiveSessions = {
  restore: mock.fn<(sessionId: string) => Promise<SessionInfo | null>>(async () => null),
};
const mockPostMessageFn = mock.fn<(args: PostMessageArgs) => Promise<{ ok: boolean }>>(
  async () => ({ ok: true }),
);

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
    triggerChangeWorkflow: mockTriggerChangeWorkflow,
    triggerFollowUp: mockTriggerFollowUp,
    postAnswerToChannel: mockPostAnswerToChannel,
    resolveOrigin: mockResolveOrigin,
    writeInstructionFile: mockWriteInstructionFile,
    findSessionByThread: mockFindSessionByThread,
    getSession: mockGetSession,
    updateSession: mockUpdateSession,
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
  mockWriteInstructionFile.mock.resetCalls();
  mockTriggerChangeWorkflow.mock.resetCalls();
  mockTriggerFollowUp.mock.resetCalls();
  mockFindSessionByThread.mock.resetCalls();
  mockGetSession.mock.resetCalls();
  mockPostAnswerToChannel.mock.resetCalls();
  mockResolveOrigin.mock.resetCalls();
  mockActiveSessions.restore.mock.resetCalls();
  mockPostMessageFn.mock.resetCalls();
  mockPostMessageFn.mock.mockImplementation(async () => ({ ok: true }));
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
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 0);
    assert.equal(mockWriteInstructionFile.mock.callCount(), 0);
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
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 0);
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
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 0);
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
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 0);
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
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 0);
    assert.equal(mockWriteInstructionFile.mock.callCount(), 0);
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
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 0);
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
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 1);
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
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 1);
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
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 1);
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
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 0);
  });
});

// ============================================================================
// config_update intent
// ============================================================================

describe("handleAutoExecuteActions — config_update", () => {
  it("writes the instruction file and posts a success message", async () => {
    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      file: "instructions.md",
      content: "new content",
    };
    const client = makeClient();
    const params = makeBaseParams({
      client,
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [
            {
              type: "config_update",
              ref: "c1",
              auto: true,
            } as unknown as Action,
          ],
        },
        { c1: configIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockWriteInstructionFile.mock.callCount(), 1);
    const writeArgs = mockWriteInstructionFile.mock.calls[0].arguments;
    assert.equal(writeArgs[0], "instructions.md");
    assert.equal(writeArgs[1], "new content");

    const postMessage = mockPostMessageFn;
    assert.equal(postMessage.mock.callCount(), 1);
    const msgArgs = postMessage.mock.calls[0].arguments[0] as {
      channel: string;
      thread_ts: string;
      text: string;
    };
    assert.equal(msgArgs.channel, "C001");
    assert.ok(msgArgs.text.includes("instructions.md"));
    assert.ok(msgArgs.text.includes("updated"));
  });

  it("posts an error message when writeInstructionFile throws", async () => {
    mockWriteInstructionFile.mock.mockImplementation(() => {
      throw new Error("write failed");
    });

    const configIntent: StagedConfigUpdateIntent = {
      type: "config_update",
      file: "broken.md",
      content: "data",
    };
    const client = makeClient();
    const params = makeBaseParams({
      client,
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [
            {
              type: "config_update",
              ref: "c1",
              auto: true,
            } as unknown as Action,
          ],
        },
        { c1: configIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    const postMessage = mockPostMessageFn;
    assert.equal(postMessage.mock.callCount(), 1);
    const msgArgs = postMessage.mock.calls[0].arguments[0] as PostMessageArgs;
    assert.ok(msgArgs.text.includes("Failed to update"));
    assert.ok(msgArgs.text.includes("broken.md"));
    assert.ok(msgArgs.text.includes("write failed"));
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

    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 1);
    const args = mockTriggerChangeWorkflow.mock.calls[0].arguments;
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

    const slackCtx = mockTriggerChangeWorkflow.mock.calls[0].arguments[1] as SlackDeliveryContext;
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

    const slackCtx = mockTriggerChangeWorkflow.mock.calls[0].arguments[1] as SlackDeliveryContext;
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

    const slackCtx = mockTriggerChangeWorkflow.mock.calls[0].arguments[1] as SlackDeliveryContext;
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
    } as SessionContext;

    mockFindSessionByThread.mock.mockImplementation(async () => fakeSession);

    const params = makeBaseParams({
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "update", ref: "u1", auto: true }] },
        { u1: updateIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockTriggerFollowUp.mock.callCount(), 1);
    const args = mockTriggerFollowUp.mock.calls[0].arguments;
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

    mockFindSessionByThread.mock.mockImplementation(async () => null);

    const params = makeBaseParams({
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "update", ref: "u1", auto: true }] },
        { u1: updateIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockTriggerFollowUp.mock.callCount(), 0);
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
      originalQuestion: "q",
      threadContext: [],
      refinements: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      // no activeChange
    } as SessionContext;

    mockFindSessionByThread.mock.mockImplementation(async () => fakeSession);

    const params = makeBaseParams({
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "update", ref: "u1", auto: true }] },
        { u1: updateIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockTriggerFollowUp.mock.callCount(), 0);
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
    } as SessionContext;

    mockFindSessionByThread.mock.mockImplementation(async () => fakeSession);

    const params = makeBaseParams({
      dmChannel: "D_DM",
      dmThreadTs: "17.99",
      response: makeResponseWithActions(
        { blocks: [], actions: [{ type: "update", ref: "u1", auto: true }] },
        { u1: updateIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    const slackCtx = mockTriggerFollowUp.mock.calls[0].arguments[3] as SlackDeliveryContext;
    assert.equal(slackCtx.streamChannel, "D_DM");
    assert.equal(slackCtx.streamThreadTs, "17.99");
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe("handleAutoExecuteActions — error handling", () => {
  it("posts error to thread when triggerChangeWorkflow throws", async () => {
    mockTriggerChangeWorkflow.mock.mockImplementation(async () => {
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
    assert.equal(postMessage.mock.callCount(), 1);
    const msgArgs = postMessage.mock.calls[0].arguments[0] as PostMessageArgs;
    assert.ok(msgArgs.text.includes("Auto-execute failed"));
    assert.ok(msgArgs.text.includes("workflow exploded"));
  });

  it("does not crash when error reporting itself fails", async () => {
    mockTriggerChangeWorkflow.mock.mockImplementation(async () => {
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
    mockPostMessageFn.mock.mockImplementation(async () => {
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
      file: "settings.md",
      content: "new settings",
    };
    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [],
          actions: [
            { type: "change", ref: "r1", auto: true },
            {
              type: "config_update",
              ref: "c1",
              auto: true,
            } as unknown as Action,
          ],
        },
        { r1: changeIntent, c1: configIntent },
      ),
    });

    await handleAutoExecuteActions(params, makeDeps());

    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 1);
    assert.equal(mockWriteInstructionFile.mock.callCount(), 1);
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

    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 1);
    const calledIntent = mockTriggerChangeWorkflow.mock.calls[0].arguments[0] as StagedChangeIntent;
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
      originalQuestion: "q",
      threadContext: [],
      refinements: [],
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

    mockGetSession.mock.mockImplementation(async () => fakeSession);
    mockActiveSessions.restore.mock.mockImplementation(async () => null);

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

    assert.equal(mockPostAnswerToChannel.mock.callCount(), 1);
    const args = mockPostAnswerToChannel.mock.calls[0].arguments;
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
      originalQuestion: "q",
      threadContext: [],
      refinements: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      // no assistantOriginChannelId
    } as unknown as SessionContext;

    mockGetSession.mock.mockImplementation(async () => fakeSession);

    const params = makeBaseParams({
      triggerType: "directMessages",
      response: makeResponseWithActions(
        {
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Response" } }],
          actions: [
            {
              type: "post_to" as const,
              auto: true,
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

    assert.equal(mockPostAnswerToChannel.mock.callCount(), 0);
  });

  it("proceeds for assistant panel DM trigger (has assistantOriginChannelId)", async () => {
    const fakeSession = {
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
      assistantOriginChannelId: "C_PANEL",
      assistantCurrentChannelId: "C_VIEWED",
      snapshots: {
        snap1: {
          text: "content",
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "content" } }],
        },
      },
    } as unknown as SessionContext;

    mockGetSession.mock.mockImplementation(async () => fakeSession);
    mockActiveSessions.restore.mock.mockImplementation(async () => null);

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

    assert.equal(mockPostAnswerToChannel.mock.callCount(), 1);
    const args = mockPostAnswerToChannel.mock.calls[0].arguments;
    assert.equal(args[2], "C_VIEWED"); // assistantCurrentChannelId
  });

  it("uses explicit channel and thread_ts when provided", async () => {
    const fakeSession = {
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

    mockGetSession.mock.mockImplementation(async () => fakeSession);
    mockActiveSessions.restore.mock.mockImplementation(async () => null);

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

    assert.equal(mockPostAnswerToChannel.mock.callCount(), 1);
    const args = mockPostAnswerToChannel.mock.calls[0].arguments;
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
      originalQuestion: "q",
      threadContext: [],
      refinements: [],
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

    mockGetSession.mock.mockImplementation(async () => fakeSession);
    mockActiveSessions.restore.mock.mockImplementation(async () => null);

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
    assert.equal(mockPostAnswerToChannel.mock.callCount(), 1);
    assert.equal(mockTriggerChangeWorkflow.mock.callCount(), 1);
  });

  it("skips when session is not found", async () => {
    mockGetSession.mock.mockImplementation(async () => null);

    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Response" } }],
          actions: [
            {
              type: "post_to" as const,
              auto: true,
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

    assert.equal(mockPostAnswerToChannel.mock.callCount(), 0);
  });

  it("skips action when snapshot is missing", async () => {
    const fakeSession = {
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
      snapshots: {},
    } as unknown as SessionContext;

    mockGetSession.mock.mockImplementation(async () => fakeSession);
    mockActiveSessions.restore.mock.mockImplementation(async () => null);

    const params = makeBaseParams({
      response: makeResponseWithActions(
        {
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Response" } }],
          actions: [
            {
              type: "post_to" as const,
              auto: true,
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

    assert.equal(mockPostAnswerToChannel.mock.callCount(), 0);
  });

  it("posts error to thread when postAnswerToChannel throws", async () => {
    const fakeSession = {
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
      snapshots: {
        snap1: {
          text: "content",
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "content" } }],
        },
      },
    } as unknown as SessionContext;

    mockGetSession.mock.mockImplementation(async () => fakeSession);
    mockActiveSessions.restore.mock.mockImplementation(async () => null);
    mockPostAnswerToChannel.mock.mockImplementation(async () => {
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
    assert.equal(postMessage.mock.callCount(), 1);
    const msgArgs = postMessage.mock.calls[0].arguments[0] as PostMessageArgs;
    assert.ok(msgArgs.text.includes("Failed to post"));
    assert.ok(msgArgs.text.includes("channel_not_found"));
  });
});
