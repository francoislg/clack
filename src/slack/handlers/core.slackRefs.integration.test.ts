import { describe, it, vi, expect, beforeEach } from "vitest";
import type { SessionContext } from "../../sessions.js";
import { processMessage, type CoreDeps } from "./core.js";
import { createSlackClientMock } from "../testSlackClient.js";
import { withThreadLock, _resetForTesting as resetActiveRuns } from "../activeRuns.js";
import { resolveSlackRefs } from "../slackRefs.js";
import { checkFileAccess } from "../requesterAccess.js";
import { stub } from "../../testStubs.js";

// processMessage wired to the real resolver; only the requester access check (files.info) is
// stubbed. DM D0EXAMPLE04: the event carried the canvas id as text and no files[] entry,
// because Slack adds the attachment when it unfurls the link.
vi.mock("../requesterAccess.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../requesterAccess.js")>();
  return { ...actual, checkFileAccess: vi.fn() };
});

function makeSession(): SessionContext {
  return {
    sessionId: "session-dm",
    channelId: "D0EXAMPLE04",
    messageTs: "1700000000.000001",
    threadTs: "1700000000.000001",
    userId: "U001",
    trigger: {
      type: "directMessages",
      userId: "U001",
      messageTs: "1700000000.000001",
      messageText: "F09SBU6D3FV",
    },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: 0,
    createdAt: 0,
  };
}

function makeDeps(session: SessionContext): CoreDeps {
  return {
    findSessionByThread: vi.fn<CoreDeps["findSessionByThread"]>(async () => null),
    createSession: vi.fn<CoreDeps["createSession"]>(async () => session),
    getSession: vi.fn<CoreDeps["getSession"]>(async () => session),
    updateSession: vi.fn<CoreDeps["updateSession"]>(async () => session),
    updateThreadContext: vi.fn<CoreDeps["updateThreadContext"]>(async () => session),
    getConfig: vi.fn<CoreDeps["getConfig"]>(() =>
      stub<ReturnType<CoreDeps["getConfig"]>>({
        slack: { fetchAndStoreUsername: false },
        canvases: { mode: "read" },
      }),
    ),
    setSessionInfo: vi.fn<CoreDeps["setSessionInfo"]>(),
    fetchThreadContext: vi.fn<CoreDeps["fetchThreadContext"]>(async () => []),
    transformUserMentions: vi.fn<CoreDeps["transformUserMentions"]>(async (_c, text) => text),
    getUserInfo: vi.fn<CoreDeps["getUserInfo"]>(async () => undefined),
    getUserRecord: vi.fn<CoreDeps["getUserRecord"]>(async () => null),
    getChannelInfo: vi.fn<CoreDeps["getChannelInfo"]>(async () => undefined),
    resolveChannelLabel: vi.fn<CoreDeps["resolveChannelLabel"]>(async () => "#dm"),
    resolveUserLabel: vi.fn<CoreDeps["resolveUserLabel"]>(async () => "@user"),
    slackLink: vi.fn<CoreDeps["slackLink"]>(async () => ""),
    getClaudeOptions: vi.fn<CoreDeps["getClaudeOptions"]>(async () => ({
      role: "dev",
      changesWorkflowEnabled: false,
    })),
    getReactionDelivery: vi.fn<CoreDeps["getReactionDelivery"]>(async () => "thread"),
    storeDmCoordinates: vi.fn<CoreDeps["storeDmCoordinates"]>(),
    executeAndDeliver: vi.fn<CoreDeps["executeAndDeliver"]>(async () => ({
      success: true,
      answer: "ok",
    })),
    appendUserMessage: vi.fn<CoreDeps["appendUserMessage"]>(async () => null),
    withThreadLock,
    trackQueuedAck: vi.fn<CoreDeps["trackQueuedAck"]>(),
    getRole: vi.fn<CoreDeps["getRole"]>(async () => "dev"),
    resolveSlackRefs,
  };
}

describe("processMessage + resolveSlackRefs — a canvas id whose attachment arrives late", () => {
  beforeEach(() => {
    resetActiveRuns();
  });

  it("registers the canvas from the message text with read_canvas", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: "read",
      creator: "U002",
      facts: {
        filetype: "quip",
        prettyType: "Canvas",
        name: "Infrastructure_TODO",
        mimetype: "application/vnd.slack-docs",
      },
    });
    const session = makeSession();
    const deps = makeDeps(session);
    const client = createSlackClientMock();

    await processMessage(
      {
        client,
        userId: "U001",
        channelId: "D0EXAMPLE04",
        messageTs: "1700000000.000001",
        messageText: "F09SBU6D3FV",
        triggerType: "directMessages",
      },
      deps,
    );

    expect(checkFileAccess).toHaveBeenCalledTimes(1);
    expect(checkFileAccess).toHaveBeenCalledWith(
      { client, userId: "U001", role: "dev", session },
      "F09SBU6D3FV",
    );
    const call = vi.mocked(deps.executeAndDeliver).mock.calls[0]![0];
    expect(call.claudeOptions.availableRefs?.get("F09SBU6D3FV")).toMatchObject({
      type: "file",
      kind: "canvas",
      reader: "read_canvas",
      name: "Infrastructure_TODO",
      fromCurrentMessage: true,
    });
  });
});
