import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { WebClient } from "@slack/web-api";
import { createScheduleReminderTool } from "./scheduleReminder.js";
import type { QueryToolContext } from "../types.js";
import { parseToolResult } from "../testHelpers.js";
import { createSlackClientMock, type MockSlackClient } from "../../slack/testSlackClient.js";

function makeContext(overrides?: Partial<QueryToolContext>): QueryToolContext {
  return {
    mode: "query",
    userId: "U123",
    role: "member",
    session: {
      sessionId: "test-session",
      channelId: "C_DEFAULT",
      threadTs: "1234567890.000001",
    } as QueryToolContext["session"],
    config: {} as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    cronUserSchedules: true,
    ...overrides,
  };
}

type ScheduleMessageResult = Awaited<ReturnType<MockSlackClient["chat"]["scheduleMessage"]>>;
type ConversationsListResult = Awaited<ReturnType<MockSlackClient["conversations"]["list"]>>;

function makeSlackClient(
  scheduleResult: ScheduleMessageResult = { ok: true, scheduled_message_id: "Q1234567890" },
  listResult: ConversationsListResult = { ok: true, channels: [{ id: "C_OPS", name: "ops" }] },
) {
  const client = createSlackClientMock();
  client.chat.scheduleMessage.mockResolvedValue(scheduleResult);
  client.conversations.list.mockResolvedValue(listResult);
  return client;
}

type ScheduleArgs = Parameters<ReturnType<typeof createScheduleReminderTool>["handler"]>[0];

function scheduleArgs(overrides?: Partial<ScheduleArgs>): ScheduleArgs {
  return {
    channel: "C_OPS",
    message: "Check the dashboard",
    post_at: "2026-04-01T15:00:00Z",
    ...overrides,
  };
}

describe("createScheduleReminderTool", () => {
  it("creates a tool named schedule_reminder", () => {
    const ctx = makeContext();
    const tool = createScheduleReminderTool(ctx);
    assert.equal(tool.name, "schedule_reminder");
  });

  it("schedules a message with channel ID", async () => {
    const client = makeSlackClient();
    const ctx = makeContext({ slackClient: client });
    const tool = createScheduleReminderTool(ctx);

    const result = await tool.handler(scheduleArgs(), {});
    const parsed = parseToolResult(result);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.scheduled_message_id, "Q1234567890");
    assert.equal(parsed.channel, "C_OPS");

    const [callArgs] = client.chat.scheduleMessage.mock.calls[0];
    assert.equal(callArgs.channel, "C_OPS");
    if (!("text" in callArgs) || typeof callArgs.text !== "string") {
      throw new Error("expected scheduleMessage call to include text");
    }
    assert.ok(callArgs.text.includes("🔔 Reminder from <@U123>:"));
    assert.ok(callArgs.text.includes("Check the dashboard"));
  });

  it("resolves channel name to ID", async () => {
    const client = makeSlackClient();
    const ctx = makeContext({ slackClient: client });
    const tool = createScheduleReminderTool(ctx);

    const result = await tool.handler(scheduleArgs({ channel: "#ops" }), {});
    const parsed = parseToolResult(result);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.channel, "C_OPS");
  });

  it("returns error when channel name not found", async () => {
    const client = makeSlackClient(undefined, { ok: true, channels: [] });
    const ctx = makeContext({ slackClient: client });
    const tool = createScheduleReminderTool(ctx);

    const result = await tool.handler(scheduleArgs({ channel: "nonexistent" }), {});
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Could not find channel"));
  });

  it("returns error for invalid timestamp", async () => {
    const client = makeSlackClient();
    const ctx = makeContext({ slackClient: client });
    const tool = createScheduleReminderTool(ctx);

    const result = await tool.handler(scheduleArgs({ post_at: "not-a-date" }), {});
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Invalid timestamp"));
  });

  it("returns error for time_in_past", async () => {
    const client = createSlackClientMock();
    client.chat.scheduleMessage.mockRejectedValue(new Error("time_in_past"));
    client.conversations.list.mockResolvedValue({ ok: true, channels: [] });
    const ctx = makeContext({ slackClient: client });
    const tool = createScheduleReminderTool(ctx);

    const result = await tool.handler(scheduleArgs(), {});
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("past"));
  });

  it("returns error for time_too_far", async () => {
    const client = createSlackClientMock();
    client.chat.scheduleMessage.mockRejectedValue(new Error("time_too_far"));
    client.conversations.list.mockResolvedValue({ ok: true, channels: [] });
    const ctx = makeContext({ slackClient: client });
    const tool = createScheduleReminderTool(ctx);

    const result = await tool.handler(scheduleArgs(), {});
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("120 days"));
  });

  it("returns error without slack client", async () => {
    const ctx = makeContext();
    const tool = createScheduleReminderTool(ctx);

    const result = await tool.handler(scheduleArgs(), {});
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.ok(result.isError);
  });

  it("normalizes the requester's own user ID to a DM channel", async () => {
    const client = new WebClient();
    vi.spyOn(client.conversations, "open").mockImplementation(async () => ({
      ok: true,
      channel: { id: "D_SELF" },
    }));
    const scheduleSpy = vi.spyOn(client.chat, "scheduleMessage").mockImplementation(async () => ({
      ok: true,
      scheduled_message_id: "Q_SELF",
    }));

    const ctx = makeContext({ slackClient: client });
    const tool = createScheduleReminderTool(ctx);

    const result = await tool.handler(scheduleArgs({ channel: "U123" }), {});
    const parsed = parseToolResult(result);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.channel, "D_SELF");
    assert.equal(scheduleSpy.mock.calls.length, 1);
    const args = scheduleSpy.mock.calls[0][0];
    assert.equal(args?.channel, "D_SELF");
  });

  it("rejects a third-party user ID without scheduling", async () => {
    const client = new WebClient();
    const openSpy = vi.spyOn(client.conversations, "open").mockImplementation(async () => ({
      ok: true,
      channel: { id: "D_OTHER" },
    }));
    const scheduleSpy = vi
      .spyOn(client.chat, "scheduleMessage")
      .mockImplementation(async () => ({ ok: true }));

    const ctx = makeContext({ slackClient: client });
    const tool = createScheduleReminderTool(ctx);

    const result = await tool.handler(scheduleArgs({ channel: "U999" }), {});
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.match(parsed.error, /can only DM the requesting user/);
    assert.equal(openSpy.mock.calls.length, 0, "should not open a DM with a third party");
    assert.equal(scheduleSpy.mock.calls.length, 0);
  });
});
