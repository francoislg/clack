import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

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
const { runPreAnalysis } = await import("./preAnalysis.js");

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

// ---------------------------------------------------------------------------
// runPreAnalysis — fail-open design: only "skip" causes a skip
// ---------------------------------------------------------------------------
describe("runPreAnalysis", () => {
  beforeEach(() => {
    mockQuery.mock.resetCalls();
  });

  it("returns true (respond) when Claude responds with 'respond'", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        { type: "result", subtype: "success", result: "respond" },
      ])
    );

    const result = await runPreAnalysis("server is down", "Only respond to errors");
    assert.equal(result, true);
  });

  it("returns false (skip) when Claude responds with 'skip'", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        { type: "result", subtype: "success", result: "skip" },
      ])
    );

    const result = await runPreAnalysis("lol", "Skip noise");
    assert.equal(result, false);
  });

  it("returns true for ambiguous response (fail-open)", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        { type: "result", subtype: "success", result: "maybe, it depends on context" },
      ])
    );

    const result = await runPreAnalysis("some message", "Only respond to errors");
    assert.equal(result, true);
  });

  it("returns true when query throws (fail-open)", async () => {
    mockQuery.mock.mockImplementation(() => {
      throw new Error("SDK failure");
    });

    const result = await runPreAnalysis("message", "context");
    assert.equal(result, true);
  });

  it("returns true when async iterator throws (fail-open)", async () => {
    mockQuery.mock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error("stream interrupted");
      },
    }));

    const result = await runPreAnalysis("message", "context");
    assert.equal(result, true);
  });

  it("returns true when result is empty (fail-open)", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        { type: "result", subtype: "success", result: "" },
      ])
    );

    const result = await runPreAnalysis("message", "context");
    assert.equal(result, true);
  });

  it("falls back to lastAssistantText when result.result is empty", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "respond" }] },
        },
        { type: "result", subtype: "success", result: "" },
      ])
    );

    const result = await runPreAnalysis("error message", "Only respond to errors");
    assert.equal(result, true);
  });

  it("detects 'skip' in verbose response", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        { type: "result", subtype: "success", result: "I would skip this message" },
      ])
    );

    const result = await runPreAnalysis("lol", "Skip noise");
    assert.equal(result, false);
  });

  it("passes systemPrompt with the preAnalysisContext to query", async () => {
    let capturedOptions: Record<string, unknown> = {};
    mockQuery.mock.mockImplementation((...args: unknown[]) => {
      capturedOptions = ((args[0] as Record<string, unknown>).options ?? {}) as Record<string, unknown>;
      return asyncIterableOf([
        { type: "result", subtype: "success", result: "respond" },
      ]);
    });

    await runPreAnalysis("test message", "Only respond to product questions");

    assert.ok(typeof capturedOptions.systemPrompt === "string");
    assert.ok((capturedOptions.systemPrompt as string).includes("Only respond to product questions"));
    assert.equal(capturedOptions.model, "sonnet");
    assert.equal(capturedOptions.maxTurns, 1);
  });

  it("includes recent messages in the prompt when provided", async () => {
    let capturedPrompt = "";
    mockQuery.mock.mockImplementation((...args: unknown[]) => {
      capturedPrompt = (args[0] as Record<string, unknown>).prompt as string;
      return asyncIterableOf([
        { type: "result", subtype: "success", result: "respond" },
      ]);
    });

    await runPreAnalysis("what about today", "Skip noise", undefined, [
      "Bot: Here's your daily update!",
      "User: thanks",
    ]);

    assert.ok(capturedPrompt.includes("RECENT CHANNEL HISTORY"));
    assert.ok(capturedPrompt.includes("Here's your daily update!"));
    assert.ok(capturedPrompt.includes("MESSAGE TO CLASSIFY"));
    assert.ok(capturedPrompt.includes("what about today"));
  });
});
