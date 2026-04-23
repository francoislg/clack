import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { WebClient } from "@slack/web-api";
import { createScheduleReminderTool } from "./scheduleReminder.js";
import type { QueryToolContext } from "../types.js";
import { parseToolResult } from "../testHelpers.js";

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
    allowScheduledMessages: true,
    ...overrides,
  };
}

function makeSlackClient(scheduleResult?: unknown, listResult?: unknown) {
  return {
    chat: {
      scheduleMessage: mock.fn(
        async () =>
          scheduleResult ?? {
            ok: true,
            scheduled_message_id: "Q1234567890",
          },
      ),
    },
    conversations: {
      list: mock.fn(
        async () =>
          listResult ?? {
            ok: true,
            channels: [{ id: "C_OPS", name: "ops" }],
          },
      ),
    },
  } as unknown as QueryToolContext["slackClient"];
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMockCalls(obj: unknown): any[] {
  return (obj as { mock: { calls: Array<{ arguments: unknown[] }> } }).mock.calls;
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

    const calls = getMockCalls(client!.chat.scheduleMessage);
    const callArgs = calls[0].arguments[0] as Record<string, string>;
    assert.equal(callArgs.channel, "C_OPS");
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
    const scheduleMsg = mock.fn(async () => {
      throw new Error("time_in_past");
    });
    const client = {
      chat: { scheduleMessage: scheduleMsg },
      conversations: { list: mock.fn(async () => ({ ok: true, channels: [] })) },
    } as unknown as QueryToolContext["slackClient"];
    const ctx = makeContext({ slackClient: client });
    const tool = createScheduleReminderTool(ctx);

    const result = await tool.handler(scheduleArgs(), {});
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("past"));
  });

  it("returns error for time_too_far", async () => {
    const scheduleMsg = mock.fn(async () => {
      throw new Error("time_too_far");
    });
    const client = {
      chat: { scheduleMessage: scheduleMsg },
      conversations: { list: mock.fn(async () => ({ ok: true, channels: [] })) },
    } as unknown as QueryToolContext["slackClient"];
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
    mock.method(client.conversations, "open", async () => ({
      ok: true,
      channel: { id: "D_SELF" },
    }));
    const scheduleSpy = mock.method(client.chat, "scheduleMessage", async () => ({
      ok: true,
      scheduled_message_id: "Q_SELF",
    }));

    const ctx = makeContext({ slackClient: client });
    const tool = createScheduleReminderTool(ctx);

    const result = await tool.handler(scheduleArgs({ channel: "U123" }), {});
    const parsed = parseToolResult(result);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.channel, "D_SELF");
    assert.equal(scheduleSpy.mock.callCount(), 1);
    const args = scheduleSpy.mock.calls[0].arguments[0];
    assert.equal(args?.channel, "D_SELF");
  });

  it("rejects a third-party user ID without scheduling", async () => {
    const client = new WebClient();
    const openSpy = mock.method(client.conversations, "open", async () => ({
      ok: true,
      channel: { id: "D_OTHER" },
    }));
    const scheduleSpy = mock.method(client.chat, "scheduleMessage", async () => ({ ok: true }));

    const ctx = makeContext({ slackClient: client });
    const tool = createScheduleReminderTool(ctx);

    const result = await tool.handler(scheduleArgs({ channel: "U999" }), {});
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.match(parsed.error, /can only DM the requesting user/);
    assert.equal(openSpy.mock.callCount(), 0, "should not open a DM with a third party");
    assert.equal(scheduleSpy.mock.callCount(), 0);
  });
});
