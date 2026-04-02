import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { ConversationMessage } from "./index.js";

// ---------------------------------------------------------------------------
// Module-level mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const mockQuery = mock.fn<(...args: unknown[]) => AsyncIterable<unknown>>();

mock.module("@anthropic-ai/claude-agent-sdk", {
  namedExports: {
    query: mockQuery,
  },
});

mock.module("../logger.js", {
  namedExports: {
    logger: {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    },
  },
});

// Import after mocks are registered
const { summarizeForSlack, analyzeError } = await import("./utilities.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an async iterable from an array of messages. */
function asyncIterableOf<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    },
  };
}

function makeConversationMessage(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    type: "assistant",
    content: "test content",
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// summarizeForSlack
// ---------------------------------------------------------------------------
describe("summarizeForSlack", () => {
  beforeEach(() => {
    mockQuery.mock.resetCalls();
  });

  it("returns summarized text from a successful Claude result", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Condensed summary" }],
          },
        },
        {
          type: "result",
          subtype: "success",
          result: "Condensed summary",
        },
      ]),
    );

    const result = await summarizeForSlack("a very long text");
    assert.equal(result, "Condensed summary");
  });

  it("falls back to lastAssistantText when result.result is empty", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "From assistant" }],
          },
        },
        {
          type: "result",
          subtype: "success",
          result: "",
        },
      ]),
    );

    const result = await summarizeForSlack("long text");
    assert.equal(result, "From assistant");
  });

  it("concatenates multiple text blocks in assistant message", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Part A " },
              { type: "text", text: "Part B" },
            ],
          },
        },
        {
          type: "result",
          subtype: "success",
          result: "",
        },
      ]),
    );

    const result = await summarizeForSlack("long text");
    assert.equal(result, "Part A Part B");
  });

  it("ignores non-text blocks in assistant content", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "tu_1", name: "foo" },
              { type: "text", text: "Actual text" },
            ],
          },
        },
        {
          type: "result",
          subtype: "success",
          result: "",
        },
      ]),
    );

    const result = await summarizeForSlack("long text");
    assert.equal(result, "Actual text");
  });

  it("uses the last assistant message when multiple are emitted", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "First" }],
          },
        },
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Second" }],
          },
        },
        {
          type: "result",
          subtype: "success",
          result: "",
        },
      ]),
    );

    const result = await summarizeForSlack("long text");
    assert.equal(result, "Second");
  });

  it("falls back to hard truncation when query throws", async () => {
    mockQuery.mock.mockImplementation(() => {
      throw new Error("SDK failure");
    });

    const input = "a".repeat(50000);
    const result = await summarizeForSlack(input);
    assert.equal(
      result.length,
      39000 + "\n\n(truncated — full output was too long for Slack)".length,
    );
    assert.ok(result.startsWith("a".repeat(100)));
    assert.ok(result.endsWith("(truncated — full output was too long for Slack)"));
  });

  it("falls back to hard truncation when result is empty", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([{ type: "result", subtype: "error", errors: ["fail"] }]),
    );

    const input = "x".repeat(50000);
    const result = await summarizeForSlack(input);
    assert.ok(result.endsWith("(truncated — full output was too long for Slack)"));
  });

  it("trims whitespace from the summary", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "result",
          subtype: "success",
          result: "  trimmed  ",
        },
      ]),
    );

    const result = await summarizeForSlack("text");
    assert.equal(result, "trimmed");
  });

  it("falls back to truncation when async iterator throws mid-stream", async () => {
    mockQuery.mock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "assistant",
          message: { content: [{ type: "text", text: "partial" }] },
        };
        throw new Error("stream interrupted");
      },
    }));

    const input = "b".repeat(50000);
    const result = await summarizeForSlack(input);
    assert.ok(result.endsWith("(truncated — full output was too long for Slack)"));
  });
});

// ---------------------------------------------------------------------------
// analyzeError
// ---------------------------------------------------------------------------
describe("analyzeError", () => {
  beforeEach(() => {
    mockQuery.mock.resetCalls();
  });

  it("returns analysis text from a successful Claude result", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "The error occurred because..." }],
          },
        },
        {
          type: "result",
          subtype: "success",
          result: "The error occurred because...",
        },
      ]),
    );

    const result = await analyzeError("timeout", [makeConversationMessage()]);
    assert.equal(result, "The error occurred because...");
  });

  it("falls back to lastAssistantText when result.result is empty", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Assistant explanation" }],
          },
        },
        {
          type: "result",
          subtype: "success",
          result: "",
        },
      ]),
    );

    const result = await analyzeError("error", [makeConversationMessage()]);
    assert.equal(result, "Assistant explanation");
  });

  it("returns 'Unable to analyze the error.' when result is whitespace-only", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "result",
          subtype: "success",
          result: "   ",
        },
      ]),
    );

    const result = await analyzeError("error", [makeConversationMessage()]);
    assert.equal(result, "Unable to analyze the error.");
  });

  it("returns 'Error analysis unavailable.' when query throws", async () => {
    mockQuery.mock.mockImplementation(() => {
      throw new Error("SDK failure");
    });

    const result = await analyzeError("error", [makeConversationMessage()]);
    assert.equal(result, "Error analysis unavailable.");
  });

  it("returns 'Error analysis unavailable.' when async iterator throws", async () => {
    mockQuery.mock.mockImplementation(() => ({
      // Intentionally throws before yielding to simulate a stream error
      // eslint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {
        throw new Error("stream interrupted");
      },
    }));

    const result = await analyzeError("error", [makeConversationMessage()]);
    assert.equal(result, "Error analysis unavailable.");
  });

  it("only uses the last 10 messages from the conversation trace", async () => {
    let capturedPrompt = "";
    mockQuery.mock.mockImplementation((...args: unknown[]) => {
      capturedPrompt = (args[0] as Record<string, unknown>).prompt as string;
      return asyncIterableOf([
        {
          type: "result",
          subtype: "success",
          result: "analysis",
        },
      ]);
    });

    const trace: ConversationMessage[] = Array.from({ length: 20 }, (_, i) =>
      makeConversationMessage({ content: `msg-${i}`, type: "assistant" }),
    );

    await analyzeError("some error", trace);

    // The prompt should reference last 10 messages
    assert.ok(capturedPrompt.includes("last 10 messages"));
    // Should contain msg-10 through msg-19 (the last 10)
    assert.ok(capturedPrompt.includes("msg-10"));
    assert.ok(capturedPrompt.includes("msg-19"));
    // Should NOT contain msg-0 (trimmed)
    assert.ok(!capturedPrompt.includes("msg-0]"));
  });

  it("formats tool calls in the trace", async () => {
    let capturedPrompt = "";
    mockQuery.mock.mockImplementation((...args: unknown[]) => {
      capturedPrompt = (args[0] as Record<string, unknown>).prompt as string;
      return asyncIterableOf([
        {
          type: "result",
          subtype: "success",
          result: "analysis",
        },
      ]);
    });

    const trace: ConversationMessage[] = [
      makeConversationMessage({
        type: "assistant",
        subtype: "tool_use",
        content: "Calling tool",
        toolCall: {
          tool: "read_file",
          args: { path: "/tmp/test.ts" },
          result: { content: "file contents" },
        },
      }),
    ];

    await analyzeError("file not found", trace);

    assert.ok(capturedPrompt.includes("Tool: read_file"));
    assert.ok(capturedPrompt.includes("/tmp/test.ts"));
    assert.ok(capturedPrompt.includes("Result:"));
  });

  it("includes subtype in trace formatting when present", async () => {
    let capturedPrompt = "";
    mockQuery.mock.mockImplementation((...args: unknown[]) => {
      capturedPrompt = (args[0] as Record<string, unknown>).prompt as string;
      return asyncIterableOf([
        {
          type: "result",
          subtype: "success",
          result: "analysis",
        },
      ]);
    });

    const trace: ConversationMessage[] = [
      makeConversationMessage({
        type: "result",
        subtype: "error",
        content: "Something failed",
      }),
    ];

    await analyzeError("error", trace);
    assert.ok(capturedPrompt.includes("[result:error]"));
  });

  it("omits subtype from trace formatting when absent", async () => {
    let capturedPrompt = "";
    mockQuery.mock.mockImplementation((...args: unknown[]) => {
      capturedPrompt = (args[0] as Record<string, unknown>).prompt as string;
      return asyncIterableOf([
        {
          type: "result",
          subtype: "success",
          result: "analysis",
        },
      ]);
    });

    const trace: ConversationMessage[] = [
      makeConversationMessage({
        type: "assistant",
        subtype: undefined,
        content: "Hello",
      }),
    ];

    await analyzeError("error", trace);
    assert.ok(capturedPrompt.includes("[assistant]"));
    assert.ok(!capturedPrompt.includes("[assistant:]"));
  });

  it("omits Result line for tool calls with empty result object", async () => {
    let capturedPrompt = "";
    mockQuery.mock.mockImplementation((...args: unknown[]) => {
      capturedPrompt = (args[0] as Record<string, unknown>).prompt as string;
      return asyncIterableOf([
        {
          type: "result",
          subtype: "success",
          result: "analysis",
        },
      ]);
    });

    const trace: ConversationMessage[] = [
      makeConversationMessage({
        type: "assistant",
        content: "tool call",
        toolCall: {
          tool: "list_repos",
          args: {},
          result: {},
        },
      }),
    ];

    await analyzeError("error", trace);
    assert.ok(capturedPrompt.includes("Tool: list_repos"));
    // The result line should NOT appear because result is empty {}
    const toolSection = capturedPrompt.split("Tool: list_repos")[1];
    // Next line check: it should not have "Result:" before the next message or end
    const beforeNextMessage = toolSection.split("\n[")[0];
    assert.ok(!beforeNextMessage.includes("Result:"));
  });

  it("handles empty conversation trace", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "result",
          subtype: "success",
          result: "No context available",
        },
      ]),
    );

    const result = await analyzeError("error", []);
    assert.equal(result, "No context available");
  });
});
