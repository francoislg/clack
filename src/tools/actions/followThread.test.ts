import { describe, it, beforeEach, vi, expect } from "vitest";
import { WebClient } from "@slack/web-api";
import { createFollowThreadTool } from "./followThread.js";
import { parseToolResult } from "../testHelpers.js";
import { errorResult } from "../helpers.js";
import type { QueryToolContext } from "../types.js";

vi.mock("../investigationSession.js", () => ({
  requireInvestigationSession: vi.fn(),
}));

vi.mock("../../sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../sessions.js")>();
  return { ...actual, updateSession: vi.fn() };
});

vi.mock("../../investigations/state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../investigations/state.js")>();
  return { ...actual, getInvestigationsChannel: vi.fn(), addFollowedThread: vi.fn() };
});

// The requester access check is an outside dependency: stub the verdict and assert the wiring.
vi.mock("../../slack/requesterAccess.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../slack/requesterAccess.js")>();
  return { ...actual, checkConversationAccess: vi.fn() };
});

vi.mock("../../slack/botMembership.js");

import { requireInvestigationSession } from "../investigationSession.js";
import { isBotInConversation } from "../../slack/botMembership.js";
import { NOT_IN_CHANNEL_MESSAGE } from "../../investigations/notInChannel.js";
import { updateSession } from "../../sessions.js";
import { getInvestigationsChannel, addFollowedThread } from "../../investigations/state.js";
import { ACCESS_DENIED_MESSAGE, checkConversationAccess } from "../../slack/requesterAccess.js";

function makeCtx(overrides?: Partial<QueryToolContext>): QueryToolContext {
  return {
    mode: "query",
    userId: "U_REQUESTER",
    role: "dev",
    session: {
      sessionId: "sess-inv",
      channelId: "C_INVESTIGATIONS",
      messageTs: "1.0",
      threadTs: "1.1",
      userId: "U_SESSION_OWNER",
      trigger: {
        type: "mentions",
        userId: "U_SESSION_OWNER",
        messageTs: "1.0",
        messageText: "test",
      },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
      followedThreads: [],
    },
    config: {} as QueryToolContext["config"],
    slackClient: new WebClient(),
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    ...overrides,
  };
}

const ARGS = { channel: "C_TARGET", thread_ts: "5.5", mode: "follow" as const };

describe("follow_thread tool", () => {
  let ctx: QueryToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = makeCtx();
    vi.mocked(requireInvestigationSession).mockResolvedValue({
      ok: true,
      session: ctx.session,
      followedThreads: [],
    });
    vi.mocked(getInvestigationsChannel).mockReturnValue("C_INVESTIGATIONS");
    vi.mocked(updateSession).mockResolvedValue(ctx.session);
    vi.mocked(checkConversationAccess).mockResolvedValue({ allowed: true });
    vi.mocked(isBotInConversation).mockResolvedValue(true);
  });

  it("refuses with the not-in-channel message and changes nothing when the bot is not in the channel", async () => {
    vi.mocked(isBotInConversation).mockResolvedValue(false);

    const result = await createFollowThreadTool(ctx).handler(ARGS, { sessionId: "sess-inv" });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result)).toEqual({ error: NOT_IN_CHANNEL_MESSAGE });
    expect(vi.mocked(isBotInConversation)).toHaveBeenCalledWith(ctx.slackClient, "C_TARGET");
    expect(vi.mocked(updateSession)).not.toHaveBeenCalled();
    expect(vi.mocked(addFollowedThread)).not.toHaveBeenCalled();
  });

  it("follows a DM thread when the bot is in the conversation", async () => {
    const result = await createFollowThreadTool(ctx).handler(
      { ...ARGS, channel: "D123" },
      { sessionId: "sess-inv" },
    );

    expect(result.isError).toBeUndefined();
    expect(vi.mocked(isBotInConversation)).toHaveBeenCalledWith(ctx.slackClient, "D123");
    expect(vi.mocked(addFollowedThread)).toHaveBeenCalledWith("sess-inv", "D123", "5.5");
  });

  it("refuses with the access-denied message and changes nothing when the requester cannot read the channel", async () => {
    vi.mocked(checkConversationAccess).mockResolvedValue({ allowed: false, reason: "not_member" });

    const result = await createFollowThreadTool(ctx).handler(ARGS, { sessionId: "sess-inv" });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result)).toEqual({ error: ACCESS_DENIED_MESSAGE });
    expect(vi.mocked(updateSession)).not.toHaveBeenCalled();
    expect(vi.mocked(addFollowedThread)).not.toHaveBeenCalled();
  });

  it("checks the requested channel as the context's requester", async () => {
    await createFollowThreadTool(ctx).handler(ARGS, { sessionId: "sess-inv" });

    expect(vi.mocked(checkConversationAccess)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(checkConversationAccess)).toHaveBeenCalledWith(
      { client: ctx.slackClient, userId: "U_REQUESTER", role: "dev", session: ctx.session },
      "C_TARGET",
    );
  });

  it("follows the thread when the requester has access", async () => {
    const result = await createFollowThreadTool(ctx).handler(ARGS, { sessionId: "sess-inv" });

    expect(result.isError).toBeUndefined();
    expect(parseToolResult(result)).toMatchObject({
      status: "ok",
      channel: "C_TARGET",
      threadTs: "5.5",
      mode: "follow",
    });
    expect(vi.mocked(updateSession)).toHaveBeenCalledWith("sess-inv", {
      followedThreads: [
        {
          channel: "C_TARGET",
          threadTs: "5.5",
          mode: "follow",
          lastInjectedTs: "0",
          pendingCount: 0,
          addedBy: "U_REQUESTER",
        },
      ],
    });
    expect(vi.mocked(addFollowedThread)).toHaveBeenCalledWith("sess-inv", "C_TARGET", "5.5");
  });

  it("returns the session guard's error without checking access outside an investigation session", async () => {
    const guardError = errorResult("This is not an investigation session.");
    vi.mocked(requireInvestigationSession).mockResolvedValue({ ok: false, error: guardError });

    const result = await createFollowThreadTool(ctx).handler(ARGS, { sessionId: "sess-inv" });

    expect(result).toBe(guardError);
    expect(vi.mocked(checkConversationAccess)).not.toHaveBeenCalled();
    expect(vi.mocked(updateSession)).not.toHaveBeenCalled();
  });

  it("errors without checking access or changing state when no Slack client is available", async () => {
    ctx = makeCtx({ slackClient: undefined });

    const result = await createFollowThreadTool(ctx).handler(ARGS, { sessionId: "sess-inv" });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result)).toEqual({
      error: "Slack client is not available in this context",
    });
    expect(vi.mocked(checkConversationAccess)).not.toHaveBeenCalled();
    expect(vi.mocked(updateSession)).not.toHaveBeenCalled();
    expect(vi.mocked(addFollowedThread)).not.toHaveBeenCalled();
  });
});
