import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ClaudeMessageParser,
  detectPlatformError,
  extractToolErrorMessage,
  isResumeMissingError,
} from "./messageParser.js";
import type { StreamEvent } from "../streaming/types.js";
import type {
  SDKToolProgressMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultSuccess,
  SDKResultError,
} from "@anthropic-ai/claude-agent-sdk";
import type { UUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Test helpers — factory functions for SDK message types
// ---------------------------------------------------------------------------

const TEST_UUID = "00000000-0000-0000-0000-000000000000" as UUID;
const TEST_SESSION_ID = "test-session";

function toolProgress(fields: { tool_use_id: string; tool_name: string }): SDKToolProgressMessage {
  return {
    type: "tool_progress",
    tool_use_id: fields.tool_use_id,
    tool_name: fields.tool_name,
    parent_tool_use_id: null,
    elapsed_time_seconds: 0,
    uuid: TEST_UUID,
    session_id: TEST_SESSION_ID,
  };
}

function assistantMsg(content: unknown[]): SDKAssistantMessage {
  return {
    type: "assistant",
    message: { content } as SDKAssistantMessage["message"],
    parent_tool_use_id: null,
    uuid: TEST_UUID,
    session_id: TEST_SESSION_ID,
  };
}

function userMsg(content: unknown[]): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content } as SDKUserMessage["message"],
    parent_tool_use_id: null,
    session_id: TEST_SESSION_ID,
  };
}

function resultSuccess(result: string): SDKResultSuccess {
  return {
    type: "result",
    subtype: "success",
    result,
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 1,
    total_cost_usd: 0,
    usage: {} as SDKResultSuccess["usage"],
    modelUsage: {},
    permission_denials: [],
    uuid: TEST_UUID,
    session_id: TEST_SESSION_ID,
  };
}

function resultError(
  errors: string[],
  subtype: SDKResultError["subtype"] = "error_during_execution",
): SDKResultError {
  return {
    type: "result",
    subtype,
    errors,
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: true,
    num_turns: 1,
    total_cost_usd: 0,
    usage: {} as SDKResultError["usage"],
    modelUsage: {},
    permission_denials: [],
    uuid: TEST_UUID,
    session_id: TEST_SESSION_ID,
  };
}

// ---------------------------------------------------------------------------
// detectPlatformError
// ---------------------------------------------------------------------------
describe("detectPlatformError", () => {
  it("returns error message when text matches rate-limit pattern", () => {
    const text = "Sorry, you've hit your limit for today. Your usage resets 14 hours from now.";
    const result = detectPlatformError(text);
    assert.equal(
      result,
      "Claude usage limit reached. The limit resets automatically \u2014 please try again later.",
    );
  });

  it("matches case-insensitive variants", () => {
    const text = "You've Hit Your Limit on this plan. Usage Resets 3 hours from now.";
    assert.notEqual(detectPlatformError(text), null);
  });

  it("returns null for unrelated text", () => {
    assert.equal(detectPlatformError("Hello, how can I help?"), null);
  });

  it("returns null for partial match \u2014 only limit phrase", () => {
    assert.equal(detectPlatformError("you've hit your limit"), null);
  });

  it("returns null for partial match \u2014 only reset phrase", () => {
    assert.equal(detectPlatformError("Usage resets 5 hours from now"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(detectPlatformError(""), null);
  });
});

// ---------------------------------------------------------------------------
// isResumeMissingError
// ---------------------------------------------------------------------------
describe("isResumeMissingError", () => {
  it("matches the SDK's resume-missing phrasing", () => {
    assert.equal(
      isResumeMissingError(
        "No conversation found with session ID: 639882d6-b817-433e-9dda-ead8d4394657",
      ),
      true,
    );
  });

  it("matches case-insensitively", () => {
    assert.equal(isResumeMissingError("no CONVERSATION found with Session ID: abc"), true);
  });

  it("returns false for unrelated errors", () => {
    assert.equal(isResumeMissingError("API rate limit exceeded"), false);
  });

  it("returns false for empty string", () => {
    assert.equal(isResumeMissingError(""), false);
  });
});

// ---------------------------------------------------------------------------
// extractToolErrorMessage
// ---------------------------------------------------------------------------
describe("extractToolErrorMessage", () => {
  it("returns a short string directly", () => {
    assert.equal(extractToolErrorMessage("file not found"), "file not found");
  });

  it("truncates strings longer than 100 characters", () => {
    const long = "x".repeat(150);
    const result = extractToolErrorMessage(long);
    assert.equal(result, "x".repeat(99) + "\u2026");
  });

  it("returns undefined for empty string", () => {
    assert.equal(extractToolErrorMessage(""), undefined);
  });

  it("returns undefined for whitespace-only string", () => {
    assert.equal(extractToolErrorMessage("   "), undefined);
  });

  it("extracts text from array of text blocks", () => {
    const content = [
      { type: "text", text: "Error:" },
      { type: "text", text: "bad request" },
    ];
    assert.equal(extractToolErrorMessage(content), "Error: bad request");
  });

  it("ignores non-text blocks in array", () => {
    const content = [
      { type: "image", url: "https://example.com" },
      { type: "text", text: "only this" },
    ];
    assert.equal(extractToolErrorMessage(content), "only this");
  });

  it("returns undefined for empty array", () => {
    assert.equal(extractToolErrorMessage([]), undefined);
  });

  it("returns undefined for null", () => {
    assert.equal(extractToolErrorMessage(null), undefined);
  });

  it("returns undefined for undefined", () => {
    assert.equal(extractToolErrorMessage(undefined), undefined);
  });

  it("returns undefined for a number", () => {
    assert.equal(extractToolErrorMessage(42), undefined);
  });

  it("trims whitespace before checking emptiness", () => {
    assert.equal(extractToolErrorMessage("  hello  "), "hello");
  });
});

// ---------------------------------------------------------------------------
// ClaudeMessageParser
// ---------------------------------------------------------------------------
describe("ClaudeMessageParser", () => {
  let events: StreamEvent[];
  let parser: ClaudeMessageParser;

  beforeEach(() => {
    events = [];
    parser = new ClaudeMessageParser((event) => {
      events.push(event);
    });
  });

  // ---- tool_progress ----
  describe("tool_progress messages", () => {
    it("emits tool_start on first occurrence of a tool_use_id", async () => {
      await parser.process(toolProgress({ tool_use_id: "tu_1", tool_name: "read_file" }));

      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        type: "tool_start",
        taskId: "tu_1",
        toolName: "read_file",
        toolArgs: {},
      });
    });

    it("does not emit duplicate tool_start for the same tool_use_id", async () => {
      await parser.process(toolProgress({ tool_use_id: "tu_1", tool_name: "read_file" }));
      await parser.process(toolProgress({ tool_use_id: "tu_1", tool_name: "read_file" }));

      assert.equal(events.length, 1);
    });

    it("emits separate events for different tool_use_ids", async () => {
      await parser.process(toolProgress({ tool_use_id: "tu_1", tool_name: "read_file" }));
      await parser.process(toolProgress({ tool_use_id: "tu_2", tool_name: "write_file" }));

      assert.equal(events.length, 2);
    });

    it("does not emit when onEvent is not provided", async () => {
      const noCallbackParser = new ClaudeMessageParser();
      await noCallbackParser.process(toolProgress({ tool_use_id: "tu_1", tool_name: "read_file" }));
    });
  });

  // ---- assistant messages ----
  describe("assistant messages", () => {
    it("extracts tool_use blocks into parsed.toolUses", async () => {
      const parsed = await parser.process(
        assistantMsg([
          {
            type: "tool_use",
            id: "tu_1",
            name: "read_file",
            input: { path: "/tmp/test.ts" },
          },
        ]),
      );

      assert.equal(parsed.toolUses.length, 1);
      assert.equal(parsed.toolUses[0].name, "read_file");
      assert.deepEqual(parsed.toolUses[0].args, { path: "/tmp/test.ts" });
      assert.equal(parsed.toolUses[0].id, "tu_1");
    });

    it("emits tool_start for tool_use blocks", async () => {
      await parser.process(
        assistantMsg([
          {
            type: "tool_use",
            id: "tu_1",
            name: "search",
            input: { query: "hello" },
          },
        ]),
      );

      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        type: "tool_start",
        taskId: "tu_1",
        toolName: "search",
        toolArgs: { query: "hello" },
      });
    });

    it("re-emits tool_start with real args if previously seen via tool_progress", async () => {
      await parser.process(toolProgress({ tool_use_id: "tu_1", tool_name: "search" }));
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].type, "tool_start");
      assert.deepEqual((events[0] as { toolArgs: Record<string, unknown> }).toolArgs, {});

      await parser.process(
        assistantMsg([
          {
            type: "tool_use",
            id: "tu_1",
            name: "search",
            input: { query: "hello" },
          },
        ]),
      );

      assert.equal(events.length, 2);
      assert.deepEqual((events[1] as { toolArgs: Record<string, unknown> }).toolArgs, {
        query: "hello",
      });
    });

    it("does not re-emit tool_start if already seen and args are empty", async () => {
      await parser.process(toolProgress({ tool_use_id: "tu_1", tool_name: "search" }));

      await parser.process(
        assistantMsg([
          {
            type: "tool_use",
            id: "tu_1",
            name: "search",
            input: {},
          },
        ]),
      );

      assert.equal(events.length, 1);
    });

    it("extracts text blocks into parsed.assistantText", async () => {
      const parsed = await parser.process(
        assistantMsg([
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ]),
      );

      assert.equal(parsed.assistantText, "Hello world");
    });

    it("updates lastAssistantText on each assistant message", async () => {
      await parser.process(assistantMsg([{ type: "text", text: "first" }]));
      assert.equal(parser.lastAssistantText, "first");

      await parser.process(assistantMsg([{ type: "text", text: "second" }]));
      assert.equal(parser.lastAssistantText, "second");
    });

    it("handles mixed tool_use and text blocks", async () => {
      const parsed = await parser.process(
        assistantMsg([
          { type: "text", text: "Let me check" },
          {
            type: "tool_use",
            id: "tu_1",
            name: "read_file",
            input: { path: "foo" },
          },
        ]),
      );

      assert.equal(parsed.toolUses.length, 1);
      assert.equal(parsed.assistantText, "Let me check");
    });

    it("handles tool_use with null input", async () => {
      const parsed = await parser.process(
        assistantMsg([
          {
            type: "tool_use",
            id: "tu_1",
            name: "no_args_tool",
            input: null,
          },
        ]),
      );

      assert.equal(parsed.toolUses.length, 1);
      assert.deepEqual(parsed.toolUses[0].args, {});
    });

    it("handles empty content array", async () => {
      const parsed = await parser.process(assistantMsg([]));

      assert.deepEqual(parsed.toolUses, []);
      assert.equal(parsed.assistantText, "");
    });
  });

  // ---- user messages (tool_result) ----
  describe("user messages", () => {
    it("emits tool_end for tool_result blocks", async () => {
      await parser.process(
        userMsg([
          {
            type: "tool_result",
            tool_use_id: "tu_1",
            is_error: false,
          },
        ]),
      );

      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        type: "tool_end",
        taskId: "tu_1",
        error: false,
        errorMessage: undefined,
      });
    });

    it("emits tool_end with error flag and message for error results", async () => {
      await parser.process(
        userMsg([
          {
            type: "tool_result",
            tool_use_id: "tu_1",
            is_error: true,
            content: "Permission denied",
          },
        ]),
      );

      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        type: "tool_end",
        taskId: "tu_1",
        error: true,
        errorMessage: "Permission denied",
      });
    });

    it("does not extract error message when is_error is false", async () => {
      await parser.process(
        userMsg([
          {
            type: "tool_result",
            tool_use_id: "tu_1",
            is_error: false,
            content: "some output",
          },
        ]),
      );

      assert.equal(events.length, 1);
      assert.equal((events[0] as { errorMessage?: string }).errorMessage, undefined);
    });

    it("ignores non-tool_result blocks", async () => {
      await parser.process(
        userMsg([
          { type: "text", text: "follow up" },
          { type: "tool_result", tool_use_id: "tu_1", is_error: false },
        ]),
      );

      assert.equal(events.length, 1);
    });
  });

  // ---- result messages ----
  describe("result messages", () => {
    it("captures success result", async () => {
      await parser.process(resultSuccess("All done"));

      assert.deepEqual(parser.result, {
        success: true,
        text: "All done",
      });
    });

    it("captures success result with empty result text", async () => {
      await parser.process(resultSuccess(""));

      assert.deepEqual(parser.result, {
        success: true,
        text: "",
      });
    });

    it("captures error result with error messages", async () => {
      await parser.process(resultError(["timeout", "rate limit"]));

      assert.deepEqual(parser.result, {
        success: false,
        text: "",
        error: "timeout, rate limit",
      });
    });

    it("captures error result with empty errors array", async () => {
      await parser.process(resultError([]));

      assert.deepEqual(parser.result, {
        success: false,
        text: "",
        error: "Unknown error",
      });
    });

    it("result starts as null", () => {
      assert.equal(parser.result, null);
    });
  });

  // ---- return value shape ----
  describe("return value", () => {
    it("returns empty parsed message for tool_progress", async () => {
      const parsed = await parser.process(
        toolProgress({ tool_use_id: "tu_1", tool_name: "read_file" }),
      );
      assert.deepEqual(parsed, { toolUses: [], assistantText: null, completedToolCalls: [] });
    });
  });

  describe("completedToolCalls", () => {
    it("pairs a tool_result with its prior tool_use and emits a completed record", async () => {
      await parser.process(
        assistantMsg([
          { type: "tool_use", id: "tu_1", name: "Read", input: { path: "/tmp/f.ts" } },
        ]),
      );

      const parsed = await parser.process(
        userMsg([{ type: "tool_result", tool_use_id: "tu_1", content: "hello world" }]),
      );

      assert.equal(parsed.completedToolCalls.length, 1);
      const rec = parsed.completedToolCalls[0];
      assert.equal(rec.tool, "Read");
      assert.deepEqual(rec.args, { path: "/tmp/f.ts" });
      assert.deepEqual(rec.result, { content: "hello world" });
    });

    it("records an error outcome when is_error is true", async () => {
      await parser.process(
        assistantMsg([{ type: "tool_use", id: "tu_2", name: "Bash", input: { command: "ls" } }]),
      );

      const parsed = await parser.process(
        userMsg([
          {
            type: "tool_result",
            tool_use_id: "tu_2",
            content: "command failed",
            is_error: true,
          },
        ]),
      );

      assert.equal(parsed.completedToolCalls.length, 1);
      assert.deepEqual(parsed.completedToolCalls[0].result, { error: "command failed" });
    });

    it("normalizes array content (e.g., MCP tool text blocks) into a string", async () => {
      await parser.process(
        assistantMsg([
          { type: "tool_use", id: "tu_3", name: "mcp__trivia__submit_answers", input: { n: 1 } },
        ]),
      );

      const parsed = await parser.process(
        userMsg([
          {
            type: "tool_result",
            tool_use_id: "tu_3",
            content: [
              { type: "text", text: "line 1" },
              { type: "text", text: "line 2" },
            ],
          },
        ]),
      );

      assert.equal(parsed.completedToolCalls.length, 1);
      assert.deepEqual(parsed.completedToolCalls[0].result, { content: "line 1\nline 2" });
    });

    it("emits nothing for a tool_result whose tool_use was never seen", async () => {
      const parsed = await parser.process(
        userMsg([{ type: "tool_result", tool_use_id: "unknown_id", content: "x" }]),
      );
      assert.equal(parsed.completedToolCalls.length, 0);
    });

    it("handles multiple tool_uses in one assistant message, paired across messages", async () => {
      await parser.process(
        assistantMsg([
          { type: "tool_use", id: "tu_a", name: "Read", input: { path: "a.ts" } },
          { type: "tool_use", id: "tu_b", name: "Grep", input: { pattern: "foo" } },
        ]),
      );

      const parsedA = await parser.process(
        userMsg([{ type: "tool_result", tool_use_id: "tu_a", content: "contents-a" }]),
      );
      const parsedB = await parser.process(
        userMsg([{ type: "tool_result", tool_use_id: "tu_b", content: "match-b" }]),
      );

      assert.equal(parsedA.completedToolCalls.length, 1);
      assert.equal(parsedA.completedToolCalls[0].tool, "Read");
      assert.deepEqual(parsedA.completedToolCalls[0].result, { content: "contents-a" });

      assert.equal(parsedB.completedToolCalls.length, 1);
      assert.equal(parsedB.completedToolCalls[0].tool, "Grep");
      assert.deepEqual(parsedB.completedToolCalls[0].result, { content: "match-b" });
    });

    it("truncates results larger than the size cap with an elision marker", async () => {
      const big = "x".repeat(150_000);
      await parser.process(
        assistantMsg([{ type: "tool_use", id: "tu_big", name: "BigTool", input: {} }]),
      );

      const parsed = await parser.process(
        userMsg([{ type: "tool_result", tool_use_id: "tu_big", content: big }]),
      );

      assert.equal(parsed.completedToolCalls.length, 1);
      const result = parsed.completedToolCalls[0].result as { content: string };
      assert.ok(
        result.content.length < big.length,
        "result content should be shorter than original",
      );
      assert.match(result.content, /truncated/);
    });
  });
});
