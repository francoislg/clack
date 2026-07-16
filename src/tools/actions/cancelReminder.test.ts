import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createCancelReminderTool } from "./cancelReminder.js";
import { parseToolResult } from "../testHelpers.js";
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
    cronUserSchedules: true,
    ...overrides,
  };
}

function makeSlackClient(deleteResult?: unknown) {
  return {
    chat: {
      deleteScheduledMessage: vi.fn(async () => deleteResult ?? { ok: true }),
    },
  } as unknown as QueryToolContext["slackClient"];
}

describe("createCancelReminderTool", () => {
  it("creates a tool named cancel_reminder", () => {
    const ctx = makeContext();
    const tool = createCancelReminderTool(ctx);
    assert.equal(tool.name, "cancel_reminder");
  });

  it("cancels a scheduled message", async () => {
    const client = makeSlackClient();
    const ctx = makeContext({ slackClient: client });
    const tool = createCancelReminderTool(ctx);

    const result = await tool.handler(
      {
        channel: "C_OPS",
        scheduled_message_id: "Q123",
      },
      {},
    );
    const parsed = parseToolResult(result);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.cancelled, true);
    assert.equal(parsed.scheduled_message_id, "Q123");
  });

  it("returns error for invalid_scheduled_message_id", async () => {
    const deleteMsg = vi.fn(async () => {
      throw new Error("invalid_scheduled_message_id");
    });
    const client = {
      chat: { deleteScheduledMessage: deleteMsg },
    } as unknown as QueryToolContext["slackClient"];
    const ctx = makeContext({ slackClient: client });
    const tool = createCancelReminderTool(ctx);

    const result = await tool.handler(
      {
        channel: "C_OPS",
        scheduled_message_id: "Q_INVALID",
      },
      {},
    );
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("already been posted or cancelled"));
  });

  it("returns error without slack client", async () => {
    const ctx = makeContext();
    const tool = createCancelReminderTool(ctx);

    const result = await tool.handler(
      {
        channel: "C_OPS",
        scheduled_message_id: "Q123",
      },
      {},
    );
    const parsed = parseToolResult(result);

    assert.ok(parsed.error);
    assert.ok(result.isError);
  });
});
