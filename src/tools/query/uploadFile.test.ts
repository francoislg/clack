import { describe, it, vi, type Mock } from "vitest";
import assert from "node:assert/strict";
import { WebClient } from "@slack/web-api";
import { createUploadFileTool } from "./uploadFile.js";
import type { QueryToolContext } from "../types.js";

type UploadV2 = WebClient["filesUploadV2"];
type UploadV2Result = Awaited<ReturnType<UploadV2>>;

interface ObservedUploadArgs {
  channel_id?: string;
  thread_ts?: string;
  filename?: string;
  title?: string;
  content?: string;
}

const DEFAULT_UPLOAD_RESULT: UploadV2Result = {
  ok: true,
  files: [
    {
      ok: true,
      files: [{ id: "F123", permalink: "https://slack.com/files/F123" }],
    },
  ],
};

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
    cronUserSchedules: false,
    ...overrides,
  };
}

function makeSlackClient(uploadResult: UploadV2Result = DEFAULT_UPLOAD_RESULT): {
  client: WebClient;
  uploadV2: Mock<UploadV2>;
} {
  const client = new WebClient();
  const uploadV2 = vi.spyOn(client, "filesUploadV2").mockImplementation(async () => uploadResult);
  return { client, uploadV2 };
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

function firstCallArgs(uploadV2: Mock<UploadV2>): ObservedUploadArgs {
  const args = uploadV2.mock.calls[0][0];
  if (!args || typeof args !== "object") {
    throw new Error("Expected uploadV2 to be called with an options object");
  }
  return args as ObservedUploadArgs;
}

describe("createUploadFileTool", () => {
  it("creates a tool named upload_file", () => {
    const tool = createUploadFileTool(makeContext({ slackClient: makeSlackClient().client }));
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
    const tool = createUploadFileTool(makeContext({ slackClient: makeSlackClient().client }));
    const result = await tool.handler(uploadArgs({ content: "   " }), {});
    assert.ok(result.isError);
    const text = (result.content[0] as { text: string }).text;
    assert.ok(text.includes("non-empty"));
  });

  it("returns error for content exceeding 500KB", async () => {
    const tool = createUploadFileTool(makeContext({ slackClient: makeSlackClient().client }));
    const largeContent = "x".repeat(500 * 1024 + 1);
    const result = await tool.handler(uploadArgs({ content: largeContent }), {});
    assert.ok(result.isError);
    const text = (result.content[0] as { text: string }).text;
    assert.ok(text.includes("too large"));
  });

  it("uploads to current thread by default", async () => {
    const { client, uploadV2 } = makeSlackClient();
    const tool = createUploadFileTool(makeContext({ slackClient: client }));
    const result = await tool.handler(
      uploadArgs({ content: "csv,data", filename: "report.csv" }),
      {},
    );

    assert.ok(!result.isError);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.file_id, "F123");
    assert.equal(parsed.permalink, "https://slack.com/files/F123");

    const callArgs = firstCallArgs(uploadV2);
    assert.equal(callArgs.channel_id, "C_DEFAULT");
    assert.equal(callArgs.thread_ts, "1234567890.000001");
    assert.equal(callArgs.filename, "report.csv");
    assert.equal(callArgs.content, "csv,data");
  });

  it("inherits session thread when explicit channel matches session channel", async () => {
    const { client, uploadV2 } = makeSlackClient();
    const tool = createUploadFileTool(makeContext({ slackClient: client }));
    await tool.handler(uploadArgs({ channel: "C_DEFAULT" }), {});

    const callArgs = firstCallArgs(uploadV2);
    assert.equal(callArgs.channel_id, "C_DEFAULT");
    assert.equal(callArgs.thread_ts, "1234567890.000001");
  });

  it("uploads to explicit channel and thread", async () => {
    const { client, uploadV2 } = makeSlackClient();
    const tool = createUploadFileTool(makeContext({ slackClient: client }));
    await tool.handler(
      uploadArgs({
        channel: "C_OTHER",
        thread_ts: "9999999999.000001",
      }),
      {},
    );

    const callArgs = firstCallArgs(uploadV2);
    assert.equal(callArgs.channel_id, "C_OTHER");
    assert.equal(callArgs.thread_ts, "9999999999.000001");
  });

  it("uploads to explicit channel without thread (top-level message)", async () => {
    const { client, uploadV2 } = makeSlackClient();
    const tool = createUploadFileTool(makeContext({ slackClient: client }));
    await tool.handler(uploadArgs({ channel: "C_OTHER" }), {});

    const callArgs = firstCallArgs(uploadV2);
    assert.equal(callArgs.channel_id, "C_OTHER");
    assert.equal(callArgs.thread_ts, undefined);
  });

  it("uses filename as title when no title provided", async () => {
    const { client, uploadV2 } = makeSlackClient();
    const tool = createUploadFileTool(makeContext({ slackClient: client }));
    await tool.handler(uploadArgs({ filename: "report.csv" }), {});

    const callArgs = firstCallArgs(uploadV2);
    assert.equal(callArgs.title, "report.csv");
  });

  it("uses explicit title when provided", async () => {
    const { client, uploadV2 } = makeSlackClient();
    const tool = createUploadFileTool(makeContext({ slackClient: client }));
    await tool.handler(uploadArgs({ filename: "report.csv", title: "Monthly Report" }), {});

    const callArgs = firstCallArgs(uploadV2);
    assert.equal(callArgs.title, "Monthly Report");
  });

  it("returns error on Slack API failure", async () => {
    const client = new WebClient();
    vi.spyOn(client, "filesUploadV2").mockImplementation(async () => {
      throw new Error("channel_not_found");
    });
    const tool = createUploadFileTool(makeContext({ slackClient: client }));
    const result = await tool.handler(uploadArgs(), {});
    assert.ok(result.isError);
    const text = (result.content[0] as { text: string }).text;
    assert.ok(text.includes("channel_not_found"));
  });
});
