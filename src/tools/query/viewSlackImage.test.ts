import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createViewSlackImageTool } from "./viewSlackImage.js";
import type { QueryToolContext } from "../types.js";
import type { SlackImageFile } from "../../slack/slackFileBase.js";

function makeContext(images: Map<string, SlackImageFile>): QueryToolContext {
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
    availableImages: images,
  };
}

describe("createViewSlackImageTool", () => {
  it("exports a function", () => {
    assert.equal(typeof createViewSlackImageTool, "function");
  });

  it("creates a tool with correct name and description", () => {
    const images = new Map<string, SlackImageFile>([
      [
        "F1",
        {
          id: "F1",
          name: "test.png",
          mimetype: "image/png",
          size: 100,
          url_private: "https://example.com",
        },
      ],
    ]);
    const tool = createViewSlackImageTool(makeContext(images));
    assert.equal(tool.name, "view_slack_image");
    assert.ok(tool.description.includes("image"));
  });

  it("handler returns error for unknown file_id", async () => {
    const images = new Map<string, SlackImageFile>([
      [
        "F1",
        {
          id: "F1",
          name: "test.png",
          mimetype: "image/png",
          size: 100,
          url_private: "https://example.com",
        },
      ],
    ]);
    const tool = createViewSlackImageTool(makeContext(images));
    const result = await tool.handler({ file_id: "NONEXISTENT" }, {});
    assert.ok(result.isError);
    const text = (result.content[0] as { text: string }).text;
    assert.ok(text.includes("Unknown file_id"));
    assert.ok(text.includes("F1"));
  });
});
