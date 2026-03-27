import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createListRemindersTool } from "./listReminders.js";
import type { QueryToolContext } from "../types.js";

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

function makeSlackClient(listResult?: unknown) {
  return {
    chat: {
      scheduledMessages: {
        list: mock.fn(async () => listResult ?? {
          ok: true,
          scheduled_messages: [
            {
              id: "Q123",
              channel_id: "C_OPS",
              post_at: 1743523200,
              date_created: 1743436800,
              text: "🔔 Reminder from <@U123>:\nCheck the dashboard",
            },
          ],
        }),
      },
    },
  } as unknown as QueryToolContext["slackClient"];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMockCalls(obj: unknown): any[] {
  return (obj as { mock: { calls: Array<{ arguments: unknown[] }> } }).mock.calls;
}

describe("createListRemindersTool", () => {
  it("creates a tool named list_reminders", () => {
    const ctx = makeContext();
    const tool = createListRemindersTool(ctx);
    assert.equal(tool.name, "list_reminders");
  });

  it("lists all pending scheduled messages", async () => {
    const client = makeSlackClient();
    const ctx = makeContext({ slackClient: client });
    const tool = createListRemindersTool(ctx);

    const result = await tool.handler({ channel: undefined }, {});
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.scheduled_messages[0].id, "Q123");
    assert.equal(parsed.scheduled_messages[0].channel_id, "C_OPS");
    assert.ok(parsed.scheduled_messages[0].text.includes("Check the dashboard"));
  });

  it("filters by channel when provided", async () => {
    const client = makeSlackClient();
    const ctx = makeContext({ slackClient: client });
    const tool = createListRemindersTool(ctx);

    await tool.handler({ channel: "C_OPS" }, {});

    const calls = getMockCalls(client!.chat.scheduledMessages.list);
    const callArgs = calls[0].arguments[0] as Record<string, string>;
    assert.equal(callArgs.channel, "C_OPS");
  });

  it("returns empty list when no messages", async () => {
    const client = makeSlackClient({ ok: true, scheduled_messages: [] });
    const ctx = makeContext({ slackClient: client });
    const tool = createListRemindersTool(ctx);

    const result = await tool.handler({ channel: undefined }, {});
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.count, 0);
    assert.deepEqual(parsed.scheduled_messages, []);
  });

  it("returns error without slack client", async () => {
    const ctx = makeContext();
    const tool = createListRemindersTool(ctx);

    const result = await tool.handler({ channel: undefined }, {});
    const parsed = JSON.parse(result.content[0].text);

    assert.ok(parsed.error);
    assert.ok(result.isError);
  });
});
