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
// runPreAnalysis
// ---------------------------------------------------------------------------
describe("runPreAnalysis", () => {
  beforeEach(() => {
    mockQuery.mock.resetCalls();
  });

  it("returns true when Claude responds with 'yes'", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "yes" }] },
        },
        {
          type: "result",
          subtype: "success",
          result: "yes",
        },
      ])
    );

    const result = await runPreAnalysis("server is down", "Only respond to errors");
    assert.equal(result, true);
  });

  it("returns false when Claude responds with 'no'", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "no" }] },
        },
        {
          type: "result",
          subtype: "success",
          result: "no",
        },
      ])
    );

    const result = await runPreAnalysis("daily status update", "Only respond to errors");
    assert.equal(result, false);
  });

  it("returns true for 'Yes' (case-insensitive)", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "result",
          subtype: "success",
          result: "Yes",
        },
      ])
    );

    const result = await runPreAnalysis("error in production", "Only respond to errors");
    assert.equal(result, true);
  });

  it("returns false for ambiguous response", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "result",
          subtype: "success",
          result: "maybe, it depends on context",
        },
      ])
    );

    const result = await runPreAnalysis("some message", "Only respond to errors");
    assert.equal(result, false);
  });

  it("returns false when query throws", async () => {
    mockQuery.mock.mockImplementation(() => {
      throw new Error("SDK failure");
    });

    const result = await runPreAnalysis("message", "context");
    assert.equal(result, false);
  });

  it("returns false when async iterator throws", async () => {
    mockQuery.mock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error("stream interrupted");
      },
    }));

    const result = await runPreAnalysis("message", "context");
    assert.equal(result, false);
  });

  it("returns false when result is empty", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "result",
          subtype: "success",
          result: "",
        },
      ])
    );

    const result = await runPreAnalysis("message", "context");
    assert.equal(result, false);
  });

  it("falls back to lastAssistantText when result.result is empty", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "yes" }] },
        },
        {
          type: "result",
          subtype: "success",
          result: "",
        },
      ])
    );

    const result = await runPreAnalysis("error message", "Only respond to errors");
    assert.equal(result, true);
  });

  it("parses only the first word of the response", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "result",
          subtype: "success",
          result: "yes I think the assistant should respond",
        },
      ])
    );

    const result = await runPreAnalysis("error", "Only respond to errors");
    assert.equal(result, true);
  });

  it("passes systemPrompt with the preAnalysisContext to query", async () => {
    let capturedOptions: Record<string, unknown> = {};
    mockQuery.mock.mockImplementation((...args: unknown[]) => {
      capturedOptions = ((args[0] as Record<string, unknown>).options ?? {}) as Record<string, unknown>;
      return asyncIterableOf([
        { type: "result", subtype: "success", result: "no" },
      ]);
    });

    await runPreAnalysis("test message", "Only respond to product questions");

    assert.ok(typeof capturedOptions.systemPrompt === "string");
    assert.ok((capturedOptions.systemPrompt as string).includes("Only respond to product questions"));
    assert.equal(capturedOptions.model, "haiku");
    assert.equal(capturedOptions.maxTurns, 1);
  });
});
