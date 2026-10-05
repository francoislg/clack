import { describe, it, beforeEach, vi, expect } from "vitest";
import assert from "node:assert/strict";
import { createStartInvestigationTool } from "./startInvestigation.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import { WebClient } from "@slack/web-api";

vi.mock("../../investigations/engine.js", () => ({
  bootstrapInvestigation: vi.fn(),
}));

vi.mock("../../sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../sessions.js")>();
  return {
    ...actual,
    setAttentionLevel: vi.fn(),
  };
});

vi.mock("../../slack/ownerDm.js", () => ({
  getOwnerUserId: vi.fn(),
  sendOwnerDm: vi.fn(),
}));

// The requester access check is an outside dependency: stub the verdict and assert the wiring.
vi.mock("../../slack/requesterAccess.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../slack/requesterAccess.js")>();
  return { ...actual, checkConversationAccess: vi.fn() };
});

import { bootstrapInvestigation } from "../../investigations/engine.js";
import { NOT_IN_CHANNEL_MESSAGE } from "../../investigations/notInChannel.js";
import { setAttentionLevel } from "../../sessions.js";
import { ACCESS_DENIED_MESSAGE, checkConversationAccess } from "../../slack/requesterAccess.js";

function makeCtx(overrides?: Partial<QueryToolContext>): QueryToolContext {
  const client = new WebClient();
  vi.spyOn(client.chat, "postMessage").mockResolvedValue({ ok: true, ts: "1000.0" });

  return {
    mode: "query",
    userId: "U_REQUESTER",
    role: "dev",
    session: {
      sessionId: "sess-current",
      channelId: "C_CURRENT",
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
    },
    config: {} as QueryToolContext["config"],
    slackClient: client,
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    ...overrides,
  };
}

describe("start_investigation tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkConversationAccess).mockResolvedValue({ allowed: true });
  });

  it("refuses with the access-denied message and bootstraps nothing when the requester cannot read the origin channel", async () => {
    const ctx = makeCtx();
    vi.mocked(checkConversationAccess).mockResolvedValue({ allowed: false, reason: "not_member" });

    const tool = createStartInvestigationTool(ctx);
    const result = await tool.handler(
      {
        surface: "channel",
        thread_ref: { channel: "C_OTHER", thread_ts: "2.2" },
        subject: undefined,
      },
      { sessionId: "sess-current" },
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result)).toEqual({ error: ACCESS_DENIED_MESSAGE });
    expect(vi.mocked(bootstrapInvestigation)).not.toHaveBeenCalled();
    expect(vi.mocked(setAttentionLevel)).not.toHaveBeenCalled();
  });

  it("checks the explicit thread_ref channel as the context's requester", async () => {
    const ctx = makeCtx();
    vi.mocked(bootstrapInvestigation).mockResolvedValue({ status: "duplicate" });

    const tool = createStartInvestigationTool(ctx);
    await tool.handler(
      {
        surface: "channel",
        thread_ref: { channel: "C_OTHER", thread_ts: "2.2" },
        subject: undefined,
      },
      { sessionId: "sess-current" },
    );

    expect(vi.mocked(checkConversationAccess)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(checkConversationAccess)).toHaveBeenCalledWith(
      { client: ctx.slackClient, userId: "U_REQUESTER", role: "dev", session: ctx.session },
      "C_OTHER",
    );
  });

  it("checks the session's channel when no thread_ref is given", async () => {
    const ctx = makeCtx();
    vi.mocked(bootstrapInvestigation).mockResolvedValue({ status: "duplicate" });

    const tool = createStartInvestigationTool(ctx);
    await tool.handler(
      { surface: "channel", thread_ref: undefined, subject: undefined },
      { sessionId: "sess-current" },
    );

    expect(vi.mocked(checkConversationAccess)).toHaveBeenCalledWith(
      { client: ctx.slackClient, userId: "U_REQUESTER", role: "dev", session: ctx.session },
      "C_CURRENT",
    );
  });

  it("disengages the current thread on ok with no thread_ref", async () => {
    const ctx = makeCtx();
    vi.mocked(bootstrapInvestigation).mockResolvedValue({
      status: "ok",
      sessionId: "S1",
      mainChannel: "CMAIN",
      permalink: "http://...",
    });

    const tool = createStartInvestigationTool(ctx);
    const result = await tool.handler(
      { surface: "channel", thread_ref: undefined, subject: undefined },
      { sessionId: "sess-current" },
    );

    assert.strictEqual(result.isError, undefined);
    const parsed = parseToolResult(result);
    assert.strictEqual(parsed.originDisengaged, true);
    assert(String(parsed.note).includes("disengaged"));

    expect(vi.mocked(setAttentionLevel)).toHaveBeenCalledWith("sess-current", "off");
  });

  it("disengages when thread_ref equals the current thread", async () => {
    const ctx = makeCtx();
    vi.mocked(bootstrapInvestigation).mockResolvedValue({
      status: "ok",
      sessionId: "S1",
      mainChannel: "CMAIN",
    });

    const tool = createStartInvestigationTool(ctx);
    const result = await tool.handler(
      {
        surface: "channel",
        thread_ref: { channel: "C_CURRENT", thread_ts: "1.1" },
        subject: undefined,
      },
      { sessionId: "sess-current" },
    );

    assert.strictEqual(result.isError, undefined);
    const parsed = parseToolResult(result);
    assert.strictEqual(parsed.originDisengaged, true);

    expect(vi.mocked(setAttentionLevel)).toHaveBeenCalledWith("sess-current", "off");
  });

  it("does not disengage when thread_ref points to a different thread", async () => {
    const ctx = makeCtx();
    vi.mocked(bootstrapInvestigation).mockResolvedValue({
      status: "ok",
      sessionId: "S1",
      mainChannel: "CMAIN",
    });

    const tool = createStartInvestigationTool(ctx);
    const result = await tool.handler(
      {
        surface: "channel",
        thread_ref: { channel: "C_OTHER", thread_ts: "2.2" },
        subject: undefined,
      },
      { sessionId: "sess-current" },
    );

    assert.strictEqual(result.isError, undefined);
    const parsed = parseToolResult(result);
    assert.strictEqual(parsed.originDisengaged, undefined);
    assert.strictEqual(parsed.note, undefined);

    assert.strictEqual(vi.mocked(setAttentionLevel).mock.calls.length, 0);
  });

  it("does not disengage on duplicate status", async () => {
    const ctx = makeCtx();
    vi.mocked(bootstrapInvestigation).mockResolvedValue({
      status: "duplicate",
      permalink: "http://...",
    });

    const tool = createStartInvestigationTool(ctx);
    const result = await tool.handler(
      { surface: "channel", thread_ref: undefined, subject: undefined },
      { sessionId: "sess-current" },
    );

    assert.strictEqual(result.isError, undefined);
    const parsed = parseToolResult(result);
    assert.strictEqual(parsed.status, "duplicate");

    assert.strictEqual(vi.mocked(setAttentionLevel).mock.calls.length, 0);
  });

  it("does not disengage on cycle status", async () => {
    const ctx = makeCtx();
    vi.mocked(bootstrapInvestigation).mockResolvedValue({
      status: "cycle",
    });

    const tool = createStartInvestigationTool(ctx);
    const result = await tool.handler(
      { surface: "channel", thread_ref: undefined, subject: undefined },
      { sessionId: "sess-current" },
    );

    assert.strictEqual(result.isError, true);

    assert.strictEqual(vi.mocked(setAttentionLevel).mock.calls.length, 0);
  });

  it("returns the not-in-channel error when the bot is not in the origin channel", async () => {
    const ctx = makeCtx();
    vi.mocked(bootstrapInvestigation).mockResolvedValue({ status: "not_in_channel" });

    const tool = createStartInvestigationTool(ctx);
    const result = await tool.handler(
      { surface: "channel", thread_ref: undefined, subject: undefined },
      { sessionId: "sess-current" },
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result)).toEqual({ error: NOT_IN_CHANNEL_MESSAGE });
    expect(vi.mocked(setAttentionLevel)).not.toHaveBeenCalled();
  });

  it("does not disengage on channel_not_configured status", async () => {
    const ctx = makeCtx();
    vi.mocked(bootstrapInvestigation).mockResolvedValue({
      status: "channel_not_configured",
    });

    const tool = createStartInvestigationTool(ctx);
    const result = await tool.handler(
      { surface: "channel", thread_ref: undefined, subject: undefined },
      { sessionId: "sess-current" },
    );

    assert.strictEqual(result.isError, true);

    assert.strictEqual(vi.mocked(setAttentionLevel).mock.calls.length, 0);
  });

  it("does not disengage on dm_failed status", async () => {
    const ctx = makeCtx();
    vi.mocked(bootstrapInvestigation).mockResolvedValue({
      status: "dm_failed",
    });

    const tool = createStartInvestigationTool(ctx);
    const result = await tool.handler(
      { surface: "dm", thread_ref: undefined, subject: undefined },
      { sessionId: "sess-current" },
    );

    assert.strictEqual(result.isError, true);

    assert.strictEqual(vi.mocked(setAttentionLevel).mock.calls.length, 0);
  });

  it("passes ctx.userId as requester (distinct from session owner)", async () => {
    const ctx = makeCtx({ userId: "U_REQUESTER" });
    vi.mocked(bootstrapInvestigation).mockResolvedValue({
      status: "ok",
      sessionId: "S1",
      mainChannel: "CMAIN",
    });

    const tool = createStartInvestigationTool(ctx);
    await tool.handler(
      { surface: "channel", thread_ref: undefined, subject: undefined },
      { sessionId: "sess-current" },
    );

    expect(vi.mocked(bootstrapInvestigation)).toHaveBeenCalledWith(
      expect.objectContaining({ requester: "U_REQUESTER" }),
    );
  });

  it("channel surface bootstraps with originMode followAndInteract", async () => {
    const ctx = makeCtx();
    vi.mocked(bootstrapInvestigation).mockResolvedValue({
      status: "ok",
      sessionId: "S1",
      mainChannel: "CMAIN",
    });

    const tool = createStartInvestigationTool(ctx);
    await tool.handler(
      { surface: "channel", thread_ref: undefined, subject: undefined },
      { sessionId: "sess-current" },
    );

    expect(vi.mocked(bootstrapInvestigation)).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "channel", originMode: "followAndInteract" }),
    );
  });

  it("dm surface bootstraps with originMode follow", async () => {
    const ctx = makeCtx();
    vi.mocked(bootstrapInvestigation).mockResolvedValue({
      status: "ok",
      sessionId: "S1",
      mainChannel: "D_DM",
    });

    const tool = createStartInvestigationTool(ctx);
    const result = await tool.handler(
      { surface: "dm", thread_ref: undefined, subject: undefined },
      { sessionId: "sess-current" },
    );

    assert.strictEqual(result.isError, undefined);
    expect(vi.mocked(bootstrapInvestigation)).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "dm", originMode: "follow" }),
    );
  });

  it("still returns ok when setAttentionLevel rejects", async () => {
    const ctx = makeCtx();
    vi.mocked(bootstrapInvestigation).mockResolvedValue({
      status: "ok",
      sessionId: "S1",
      mainChannel: "CMAIN",
    });
    vi.mocked(setAttentionLevel).mockRejectedValue(new Error("permission denied"));

    const tool = createStartInvestigationTool(ctx);
    const result = await tool.handler(
      { surface: "channel", thread_ref: undefined, subject: undefined },
      { sessionId: "sess-current" },
    );

    assert.strictEqual(result.isError, undefined);
    const parsed = parseToolResult(result);
    assert.strictEqual(parsed.status, "ok");
  });
});
