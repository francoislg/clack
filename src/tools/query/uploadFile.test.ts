import { describe, it, expect, vi } from "vitest";
import assert from "node:assert/strict";
import { createUploadFileTool, type UploadFileDeps } from "./uploadFile.js";
import type { QueryToolContext } from "../types.js";
import { logger } from "../../logger.js";
import { createSlackClientMock, type MockSlackClient } from "../../slack/testSlackClient.js";

type UploadV2Mock = MockSlackClient["filesUploadV2"];
type UploadV2Result = Awaited<ReturnType<UploadV2Mock>>;

interface ObservedUploadArgs {
  channel_id?: string;
  thread_ts?: string;
  filename?: string;
  title?: string;
  content?: string;
  file?: Buffer;
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
  client: MockSlackClient;
  uploadV2: UploadV2Mock;
} {
  const client = createSlackClientMock();
  client.filesUploadV2.mockResolvedValue(uploadResult);
  return { client, uploadV2: client.filesUploadV2 };
}

type UploadArgs = Parameters<ReturnType<typeof createUploadFileTool>["handler"]>[0];

function uploadArgs(overrides?: Partial<UploadArgs>): UploadArgs {
  return {
    content: "data",
    file_path: undefined,
    filename: "test.txt",
    title: undefined,
    channel: undefined,
    thread_ts: undefined,
    ...overrides,
  };
}

interface FakeStat {
  isFile(): boolean;
  size: number;
}

function makeDeps(fileStat: FakeStat = { isFile: () => true, size: 12 }) {
  const deps = {
    resolveOwnedFile: vi.fn<UploadFileDeps["resolveOwnedFile"]>(),
    markUploaded: vi.fn<UploadFileDeps["markUploaded"]>(),
    stat: vi.fn<UploadFileDeps["stat"]>(),
    readFile: vi.fn<UploadFileDeps["readFile"]>(),
  };
  deps.resolveOwnedFile.mockResolvedValue({
    ok: true,
    path: "/data/downloads/test-session/export.csv",
  });
  deps.markUploaded.mockResolvedValue(undefined);
  deps.stat.mockResolvedValue(fileStat);
  deps.readFile.mockResolvedValue(Buffer.from("a,b\n1,2\n"));
  return deps;
}

function fileArgs(overrides?: Partial<UploadArgs>): UploadArgs {
  return uploadArgs({
    content: undefined,
    filename: undefined,
    file_path: "export.csv",
    ...overrides,
  });
}

function errorText(result: { content: unknown[] }): string {
  return (result.content[0] as { text: string }).text;
}

function firstCallArgs(uploadV2: UploadV2Mock): ObservedUploadArgs {
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

  it("returns error for content exceeding 64KB", async () => {
    const tool = createUploadFileTool(makeContext({ slackClient: makeSlackClient().client }));
    const largeContent = "x".repeat(64 * 1024 + 1);
    const result = await tool.handler(uploadArgs({ content: largeContent }), {});
    assert.ok(result.isError);
    const text = (result.content[0] as { text: string }).text;
    assert.ok(text.includes("too large"));
    assert.ok(text.includes("file_path"));
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
    const client = createSlackClientMock();
    client.filesUploadV2.mockRejectedValue(new Error("channel_not_found"));
    const tool = createUploadFileTool(makeContext({ slackClient: client }));
    const result = await tool.handler(uploadArgs(), {});
    assert.ok(result.isError);
    const text = (result.content[0] as { text: string }).text;
    assert.ok(text.includes("channel_not_found"));
  });

  it("rejects passing both content and file_path", async () => {
    const { client, uploadV2 } = makeSlackClient();
    const tool = createUploadFileTool(makeContext({ slackClient: client }), makeDeps());
    const result = await tool.handler(uploadArgs({ file_path: "export.csv" }), {});
    assert.ok(result.isError);
    assert.ok(errorText(result).includes("exactly one of content or file_path"));
    assert.equal(uploadV2.mock.calls.length, 0);
  });

  it("rejects passing neither content nor file_path", async () => {
    const { client, uploadV2 } = makeSlackClient();
    const tool = createUploadFileTool(makeContext({ slackClient: client }), makeDeps());
    const result = await tool.handler(uploadArgs({ content: undefined }), {});
    assert.ok(result.isError);
    assert.ok(errorText(result).includes("exactly one of content or file_path"));
    assert.equal(uploadV2.mock.calls.length, 0);
  });

  it("requires filename with content", async () => {
    const { client, uploadV2 } = makeSlackClient();
    const tool = createUploadFileTool(makeContext({ slackClient: client }), makeDeps());
    const result = await tool.handler(uploadArgs({ filename: undefined }), {});
    assert.ok(result.isError);
    assert.ok(errorText(result).includes("filename is required with content"));
    assert.equal(uploadV2.mock.calls.length, 0);
  });

  it("uploads a session file by file_path and records the upload", async () => {
    const { client, uploadV2 } = makeSlackClient();
    const deps = makeDeps();
    const tool = createUploadFileTool(makeContext({ slackClient: client }), deps);
    const result = await tool.handler(fileArgs(), {});

    assert.ok(!result.isError);
    const parsed = JSON.parse(errorText(result));
    assert.equal(parsed.file_id, "F123");

    expect(deps.resolveOwnedFile).toHaveBeenCalledWith({
      owner: "test-session",
      path: "export.csv",
    });
    const bytes = await deps.readFile.mock.results[0].value;
    const callArgs = firstCallArgs(uploadV2);
    assert.equal(callArgs.file, bytes);
    assert.equal(callArgs.content, undefined);
    assert.equal(callArgs.filename, "export.csv");
    assert.equal(callArgs.title, "export.csv");
    assert.equal(callArgs.channel_id, "C_DEFAULT");
    assert.equal(callArgs.thread_ts, "1234567890.000001");
    expect(deps.markUploaded).toHaveBeenCalledWith("/data/downloads/test-session/export.csv", {
      fileId: "F123",
      permalink: "https://slack.com/files/F123",
      channel: "C_DEFAULT",
      threadTs: "1234567890.000001",
    });
  });

  it("passes through a resolveOwnedFile error without reading", async () => {
    const { client, uploadV2 } = makeSlackClient();
    const deps = makeDeps();
    deps.resolveOwnedFile.mockResolvedValue({ ok: false, error: "File not found: export.csv" });
    const tool = createUploadFileTool(makeContext({ slackClient: client }), deps);
    const result = await tool.handler(fileArgs(), {});
    assert.ok(result.isError);
    assert.ok(errorText(result).includes("File not found: export.csv"));
    assert.equal(deps.stat.mock.calls.length, 0);
    assert.equal(deps.readFile.mock.calls.length, 0);
    assert.equal(uploadV2.mock.calls.length, 0);
  });

  it.each([
    ["a directory", { isFile: () => false, size: 64 }, "Not a file: export.csv"],
    ["an empty file", { isFile: () => true, size: 0 }, "File is empty: export.csv"],
    [
      "a file over 50MB",
      { isFile: () => true, size: 50 * 1024 * 1024 + 1 },
      "Maximum is 50MB. Export a narrower query.",
    ],
  ])("rejects %s without reading it", async (_label, fileStat, expected) => {
    const { client, uploadV2 } = makeSlackClient();
    const deps = makeDeps(fileStat);
    const tool = createUploadFileTool(makeContext({ slackClient: client }), deps);
    const result = await tool.handler(fileArgs(), {});
    assert.ok(result.isError);
    assert.ok(errorText(result).includes(expected));
    expect(deps.stat).toHaveBeenCalledWith("/data/downloads/test-session/export.csv");
    assert.equal(deps.readFile.mock.calls.length, 0);
    assert.equal(uploadV2.mock.calls.length, 0);
  });

  it("does not record the upload when Slack fails", async () => {
    const client = createSlackClientMock();
    client.filesUploadV2.mockRejectedValue(new Error("channel_not_found"));
    const deps = makeDeps();
    const tool = createUploadFileTool(makeContext({ slackClient: client }), deps);
    const result = await tool.handler(fileArgs(), {});
    assert.ok(result.isError);
    assert.ok(errorText(result).includes("channel_not_found"));
    assert.equal(deps.markUploaded.mock.calls.length, 0);
  });

  it("returns a read error when stat fails", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const { client, uploadV2 } = makeSlackClient();
    const deps = makeDeps();
    deps.resolveOwnedFile.mockResolvedValue({ ok: true, path: "/data/downloads/S1/x.csv" });
    deps.stat.mockRejectedValue(new Error("ENOENT"));
    const tool = createUploadFileTool(makeContext({ slackClient: client }), deps);
    const result = await tool.handler(fileArgs({ file_path: "x.csv" }), {});
    assert.ok(result.isError);
    assert.ok(errorText(result).includes("Could not read file: x.csv"));
    expect(uploadV2).not.toHaveBeenCalled();
    expect(deps.markUploaded).not.toHaveBeenCalled();
  });

  it("returns a read error when readFile fails", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const { client, uploadV2 } = makeSlackClient();
    const deps = makeDeps({ isFile: () => true, size: 10 });
    deps.resolveOwnedFile.mockResolvedValue({ ok: true, path: "/data/downloads/S1/x.csv" });
    deps.readFile.mockRejectedValue(new Error("EIO"));
    const tool = createUploadFileTool(makeContext({ slackClient: client }), deps);
    const result = await tool.handler(fileArgs({ file_path: "x.csv" }), {});
    assert.ok(result.isError);
    assert.ok(errorText(result).includes("Could not read file: x.csv"));
    expect(uploadV2).not.toHaveBeenCalled();
    expect(deps.markUploaded).not.toHaveBeenCalled();
  });

  it("still succeeds when recording the upload fails", async () => {
    const { client } = makeSlackClient();
    const deps = makeDeps();
    deps.markUploaded.mockRejectedValue(new Error("ledger write failed"));
    const tool = createUploadFileTool(makeContext({ slackClient: client }), deps);
    const result = await tool.handler(fileArgs(), {});
    assert.ok(!result.isError);
    assert.equal(JSON.parse(errorText(result)).file_id, "F123");
    expect(deps.markUploaded).toHaveBeenCalledTimes(1);
  });
});
