import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createUploadFileTool } from "./uploadFile.js";
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
    config: {
      slack: { botToken: "xoxb-test-token" },
    } as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
    ...overrides,
  };
}

function makeSlackClient(uploadResult?: unknown) {
  return {
    files: {
      uploadV2: mock.fn(async () => uploadResult ?? {
        ok: true,
        files: [{ id: "F123", permalink: "https://slack.com/files/F123" }],
      }),
    },
  } as unknown as QueryToolContext["slackClient"];
}

type UploadArgs = Parameters<ReturnType<typeof createUploadFileTool>["handler"]>[0];

function uploadArgs(overrides?: Partial<UploadArgs>): UploadArgs {
  return {
    content: "data",
    filename: "test.txt",
    title: undefined,
    channel: undefined,
    thread_ts: undefined,
    ...overrides,
  };
}

describe("createUploadFileTool", () => {
  it("creates a tool named upload_file", () => {
    const tool = createUploadFileTool(makeContext({ slackClient: makeSlackClient() }));
    assert.equal(tool.name, "upload_file");
  });

  it("returns error when no Slack client", async () => {
    const tool = createUploadFileTool(makeContext({ slackClient: undefined }));
    const result = await tool.handler(uploadArgs(), {});
    assert.ok(result.isError);
    const text = (result.content[0] as { text: string }).text;
    assert.ok(text.includes("Slack connection"));
  });

  it("returns error for empty content", async () => {
    const tool = createUploadFileTool(makeContext({ slackClient: makeSlackClient() }));
    const result = await tool.handler(uploadArgs({ content: "   " }), {});
    assert.ok(result.isError);
    const text = (result.content[0] as { text: string }).text;
    assert.ok(text.includes("non-empty"));
  });

  it("returns error for content exceeding 500KB", async () => {
    const tool = createUploadFileTool(makeContext({ slackClient: makeSlackClient() }));
    const largeContent = "x".repeat(500 * 1024 + 1);
    const result = await tool.handler(uploadArgs({ content: largeContent }), {});
    assert.ok(result.isError);
    const text = (result.content[0] as { text: string }).text;
    assert.ok(text.includes("too large"));
  });

  it("uploads to current thread by default", async () => {
    const client = makeSlackClient();
    const tool = createUploadFileTool(makeContext({ slackClient: client }));
    const result = await tool.handler(uploadArgs({ content: "csv,data", filename: "report.csv" }), {});

    assert.ok(!result.isError);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.file_id, "F123");

    const uploadV2 = (client as unknown as { files: { uploadV2: { mock: { calls: Array<{ arguments: unknown[] }> } } } }).files.uploadV2;
    const callArgs = uploadV2.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(callArgs.channel_id, "C_DEFAULT");
    assert.equal(callArgs.thread_ts, "1234567890.000001");
    assert.equal(callArgs.filename, "report.csv");
    assert.equal(callArgs.content, "csv,data");
  });

  it("uploads to explicit channel and thread", async () => {
    const client = makeSlackClient();
    const tool = createUploadFileTool(makeContext({ slackClient: client }));
    await tool.handler(uploadArgs({
      channel: "C_OTHER",
      thread_ts: "9999999999.000001",
    }), {});

    const uploadV2 = (client as unknown as { files: { uploadV2: { mock: { calls: Array<{ arguments: unknown[] }> } } } }).files.uploadV2;
    const callArgs = uploadV2.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(callArgs.channel_id, "C_OTHER");
    assert.equal(callArgs.thread_ts, "9999999999.000001");
  });

  it("uploads to explicit channel without thread (top-level message)", async () => {
    const client = makeSlackClient();
    const tool = createUploadFileTool(makeContext({ slackClient: client }));
    await tool.handler(uploadArgs({ channel: "C_OTHER" }), {});

    const uploadV2 = (client as unknown as { files: { uploadV2: { mock: { calls: Array<{ arguments: unknown[] }> } } } }).files.uploadV2;
    const callArgs = uploadV2.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(callArgs.channel_id, "C_OTHER");
    assert.equal(callArgs.thread_ts, undefined);
  });

  it("uses filename as title when no title provided", async () => {
    const client = makeSlackClient();
    const tool = createUploadFileTool(makeContext({ slackClient: client }));
    await tool.handler(uploadArgs({ filename: "report.csv" }), {});

    const uploadV2 = (client as unknown as { files: { uploadV2: { mock: { calls: Array<{ arguments: unknown[] }> } } } }).files.uploadV2;
    const callArgs = uploadV2.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(callArgs.title, "report.csv");
  });

  it("uses explicit title when provided", async () => {
    const client = makeSlackClient();
    const tool = createUploadFileTool(makeContext({ slackClient: client }));
    await tool.handler(uploadArgs({ filename: "report.csv", title: "Monthly Report" }), {});

    const uploadV2 = (client as unknown as { files: { uploadV2: { mock: { calls: Array<{ arguments: unknown[] }> } } } }).files.uploadV2;
    const callArgs = uploadV2.mock.calls[0].arguments[0] as Record<string, unknown>;
    assert.equal(callArgs.title, "Monthly Report");
  });

  it("returns error on Slack API failure", async () => {
    const client = {
      files: {
        uploadV2: mock.fn(async () => { throw new Error("channel_not_found"); }),
      },
    } as unknown as QueryToolContext["slackClient"];
    const tool = createUploadFileTool(makeContext({ slackClient: client }));
    const result = await tool.handler(uploadArgs(), {});
    assert.ok(result.isError);
    const text = (result.content[0] as { text: string }).text;
    assert.ok(text.includes("channel_not_found"));
  });
});
