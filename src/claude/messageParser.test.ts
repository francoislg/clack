import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ClaudeMessageParser,
  detectPlatformError,
  extractToolErrorMessage,
} from "./messageParser.js";
import type { StreamEvent } from "../streaming/types.js";

// ---------------------------------------------------------------------------
// detectPlatformError
// ---------------------------------------------------------------------------
describe("detectPlatformError", () => {
  it("returns error message when text matches rate-limit pattern", () => {
    const text =
      "Sorry, you've hit your limit for today. Your usage resets 14 hours from now.";
    const result = detectPlatformError(text);
    assert.equal(
      result,
      "Claude usage limit reached. The limit resets automatically — please try again later."
    );
  });

  it("matches case-insensitive variants", () => {
    const text =
      "You've Hit Your Limit on this plan. Usage Resets 3 hours from now.";
    assert.notEqual(detectPlatformError(text), null);
  });

  it("returns null for unrelated text", () => {
    assert.equal(detectPlatformError("Hello, how can I help?"), null);
  });

  it("returns null for partial match — only limit phrase", () => {
    assert.equal(detectPlatformError("you've hit your limit"), null);
  });

  it("returns null for partial match — only reset phrase", () => {
    assert.equal(detectPlatformError("Usage resets 5 hours from now"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(detectPlatformError(""), null);
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
    assert.equal(result, "x".repeat(100) + "…");
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
      await parser.process({
        type: "tool_progress",
        tool_use_id: "tu_1",
        tool_name: "read_file",
      });

      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        type: "tool_start",
        taskId: "tu_1",
        toolName: "read_file",
        toolArgs: {},
      });
    });

    it("does not emit duplicate tool_start for the same tool_use_id", async () => {
      await parser.process({
        type: "tool_progress",
        tool_use_id: "tu_1",
        tool_name: "read_file",
      });
      await parser.process({
        type: "tool_progress",
        tool_use_id: "tu_1",
        tool_name: "read_file",
      });

      assert.equal(events.length, 1);
    });

    it("emits separate events for different tool_use_ids", async () => {
      await parser.process({
        type: "tool_progress",
        tool_use_id: "tu_1",
        tool_name: "read_file",
      });
      await parser.process({
        type: "tool_progress",
        tool_use_id: "tu_2",
        tool_name: "write_file",
      });

      assert.equal(events.length, 2);
    });

    it("does not emit when onEvent is not provided", async () => {
      const noCallbackParser = new ClaudeMessageParser();
      // Should not throw
      await noCallbackParser.process({
        type: "tool_progress",
        tool_use_id: "tu_1",
        tool_name: "read_file",
      });
    });
  });

  // ---- assistant messages ----
  describe("assistant messages", () => {
    it("extracts tool_use blocks into parsed.toolUses", async () => {
      const parsed = await parser.process({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "read_file",
              input: { path: "/tmp/test.ts" },
            },
          ],
        },
      });

      assert.equal(parsed.toolUses.length, 1);
      assert.equal(parsed.toolUses[0].name, "read_file");
      assert.deepEqual(parsed.toolUses[0].args, { path: "/tmp/test.ts" });
      assert.equal(parsed.toolUses[0].id, "tu_1");
    });

    it("emits tool_start for tool_use blocks", async () => {
      await parser.process({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "search",
              input: { query: "hello" },
            },
          ],
        },
      });

      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        type: "tool_start",
        taskId: "tu_1",
        toolName: "search",
        toolArgs: { query: "hello" },
      });
    });

    it("re-emits tool_start with real args if previously seen via tool_progress", async () => {
      // First: tool_progress with empty args
      await parser.process({
        type: "tool_progress",
        tool_use_id: "tu_1",
        tool_name: "search",
      });
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].type, "tool_start");
      assert.deepEqual((events[0] as { toolArgs: Record<string, unknown> }).toolArgs, {});

      // Then: assistant with real args
      await parser.process({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "search",
              input: { query: "hello" },
            },
          ],
        },
      });

      assert.equal(events.length, 2);
      assert.deepEqual((events[1] as { toolArgs: Record<string, unknown> }).toolArgs, {
        query: "hello",
      });
    });

    it("does not re-emit tool_start if already seen and args are empty", async () => {
      // First via tool_progress
      await parser.process({
        type: "tool_progress",
        tool_use_id: "tu_1",
        tool_name: "search",
      });

      // Then assistant with empty input
      await parser.process({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "search",
              input: {},
            },
          ],
        },
      });

      // Should not duplicate — only 1 event from tool_progress
      assert.equal(events.length, 1);
    });

    it("extracts text blocks into parsed.assistantText", async () => {
      const parsed = await parser.process({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world" },
          ],
        },
      });

      assert.equal(parsed.assistantText, "Hello world");
    });

    it("updates lastAssistantText on each assistant message", async () => {
      await parser.process({
        type: "assistant",
        message: { content: [{ type: "text", text: "first" }] },
      });
      assert.equal(parser.lastAssistantText, "first");

      await parser.process({
        type: "assistant",
        message: { content: [{ type: "text", text: "second" }] },
      });
      assert.equal(parser.lastAssistantText, "second");
    });

    it("handles mixed tool_use and text blocks", async () => {
      const parsed = await parser.process({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me check" },
            {
              type: "tool_use",
              id: "tu_1",
              name: "read_file",
              input: { path: "foo" },
            },
          ],
        },
      });

      assert.equal(parsed.toolUses.length, 1);
      assert.equal(parsed.assistantText, "Let me check");
    });

    it("handles tool_use with null input", async () => {
      const parsed = await parser.process({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "no_args_tool",
              input: null,
            },
          ],
        },
      });

      assert.equal(parsed.toolUses.length, 1);
      assert.deepEqual(parsed.toolUses[0].args, {});
    });

    it("handles tool_use with missing id", async () => {
      const parsed = await parser.process({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "some_tool",
              input: {},
            },
          ],
        },
      });

      assert.equal(parsed.toolUses.length, 1);
      assert.equal(parsed.toolUses[0].id, "");
    });

    it("handles empty content array", async () => {
      const parsed = await parser.process({
        type: "assistant",
        message: { content: [] },
      });

      assert.deepEqual(parsed.toolUses, []);
      assert.equal(parsed.assistantText, "");
    });

    it("ignores null/undefined blocks in content", async () => {
      const parsed = await parser.process({
        type: "assistant",
        message: { content: [null, undefined, { type: "text", text: "ok" }] },
      });

      assert.equal(parsed.assistantText, "ok");
    });
  });

  // ---- user messages (tool_result) ----
  describe("user messages", () => {
    it("emits tool_end for tool_result blocks", async () => {
      await parser.process({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              is_error: false,
            },
          ],
        },
      });

      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        type: "tool_end",
        taskId: "tu_1",
        error: false,
        errorMessage: undefined,
      });
    });

    it("emits tool_end with error flag and message for error results", async () => {
      await parser.process({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              is_error: true,
              content: "Permission denied",
            },
          ],
        },
      });

      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        type: "tool_end",
        taskId: "tu_1",
        error: true,
        errorMessage: "Permission denied",
      });
    });

    it("does not extract error message when is_error is false", async () => {
      await parser.process({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              is_error: false,
              content: "some output",
            },
          ],
        },
      });

      assert.equal(events.length, 1);
      assert.equal(
        (events[0] as { errorMessage?: string }).errorMessage,
        undefined
      );
    });

    it("ignores non-tool_result blocks", async () => {
      await parser.process({
        type: "user",
        message: {
          content: [
            { type: "text", text: "follow up" },
            { type: "tool_result", tool_use_id: "tu_1", is_error: false },
          ],
        },
      });

      assert.equal(events.length, 1);
    });
  });

  // ---- result messages ----
  describe("result messages", () => {
    it("captures success result", async () => {
      await parser.process({
        type: "result",
        subtype: "success",
        result: "All done",
      });

      assert.deepEqual(parser.result, {
        success: true,
        text: "All done",
      });
    });

    it("captures success result with empty result text", async () => {
      await parser.process({
        type: "result",
        subtype: "success",
        result: "",
      });

      assert.deepEqual(parser.result, {
        success: true,
        text: "",
      });
    });

    it("captures error result with error messages", async () => {
      await parser.process({
        type: "result",
        subtype: "error",
        errors: ["timeout", "rate limit"],
      });

      assert.deepEqual(parser.result, {
        success: false,
        text: "",
        error: "timeout, rate limit",
      });
    });

    it("captures error result with no errors array", async () => {
      await parser.process({
        type: "result",
        subtype: "error",
      });

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
    it("returns empty parsed message for unknown message types", async () => {
      const parsed = await parser.process({ type: "unknown_event" });
      assert.deepEqual(parsed, { toolUses: [], assistantText: null });
    });

    it("returns empty parsed message for tool_progress", async () => {
      const parsed = await parser.process({
        type: "tool_progress",
        tool_use_id: "tu_1",
        tool_name: "read_file",
      });
      assert.deepEqual(parsed, { toolUses: [], assistantText: null });
    });
  });
});
