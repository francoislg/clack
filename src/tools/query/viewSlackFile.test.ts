import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createViewSlackFileTool } from "./viewSlackFile.js";
import type { QueryToolContext } from "../types.js";
import type { SlackFile } from "../../slack/slackFileBase.js";

function makeContext(files: Map<string, SlackFile>): QueryToolContext {
  return {
    mode: "query",
    userId: "U123",
    role: "member",
    session: {} as QueryToolContext["session"],
    config: {
      slack: { botToken: "xoxb-test-token" },
    } as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
    availableFiles: files,
  };
}

describe("createViewSlackFileTool", () => {
  it("exports a function", () => {
    assert.equal(typeof createViewSlackFileTool, "function");
  });

  it("creates a tool with correct name", () => {
    const files = new Map<string, SlackFile>([
      ["F1", { id: "F1", name: "report.pdf", mimetype: "application/pdf", size: 100, url_private: "https://example.com" }],
    ]);
    const tool = createViewSlackFileTool(makeContext(files));
    assert.equal(tool.name, "view_slack_file");
    assert.ok(tool.description.includes("file"));
  });

  it("returns error for unknown file_id", async () => {
    const files = new Map<string, SlackFile>([
      ["F1", { id: "F1", name: "report.pdf", mimetype: "application/pdf", size: 100, url_private: "https://example.com" }],
    ]);
    const tool = createViewSlackFileTool(makeContext(files));
    const result = await tool.handler({ file_id: "NONEXISTENT" }, {});
    assert.ok(result.isError);
    const text = (result.content[0] as { text: string }).text;
    assert.ok(text.includes("Unknown file_id"));
    assert.ok(text.includes("F1"));
  });

  it("returns metadata-only text for unsupported binary formats", async () => {
    const files = new Map<string, SlackFile>([
      ["F1", { id: "F1", name: "archive.zip", mimetype: "application/zip", size: 4096, url_private: "https://example.com" }],
    ]);
    const tool = createViewSlackFileTool(makeContext(files));
    const result = await tool.handler({ file_id: "F1" }, {});
    assert.ok(!result.isError);
    const text = (result.content[0] as { text: string }).text;
    assert.ok(text.includes("archive.zip"));
    assert.ok(text.includes("application/zip"));
    assert.ok(text.includes("cannot be read directly"));
  });

  it("returns metadata with formatted size for unsupported files", async () => {
    const files = new Map<string, SlackFile>([
      ["F1", { id: "F1", name: "big.xlsx", mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 2.5 * 1024 * 1024, url_private: "https://example.com" }],
    ]);
    const tool = createViewSlackFileTool(makeContext(files));
    const result = await tool.handler({ file_id: "F1" }, {});
    const text = (result.content[0] as { text: string }).text;
    assert.ok(text.includes("2.5 MB"));
  });

  it("works with empty availableFiles map", () => {
    const tool = createViewSlackFileTool(makeContext(new Map()));
    assert.equal(tool.name, "view_slack_file");
  });
});
