import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { runPreAnalysis, type PreAnalysisDeps, defaultPreAnalysisDeps } from "./preAnalysis.js";
import type { clackQuery } from "./query.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockClackQuery = ReturnType<typeof mock.fn<typeof clackQuery>>;

let mockQuery: MockClackQuery;

function makeDeps(): PreAnalysisDeps {
  return {
    ...defaultPreAnalysisDeps,
    clackQuery: mockQuery,
  };
}

/** Build an async iterable from an array of messages. Return typed as never so it satisfies any AsyncIterable<T> parameter. */
function asyncIterableOf<T>(items: T[]): never {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    },
  } as never;
}

interface QueryCallArg {
  prompt: string;
  options?: {
    systemPrompt?: string;
    model?: string;
    maxTurns?: number;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// runPreAnalysis — fail-closed design: errors and ambiguity cause a skip
// ---------------------------------------------------------------------------
describe("runPreAnalysis", () => {
  beforeEach(() => {
    mockQuery = mock.fn<typeof clackQuery>();
  });

  it("returns 'respond' when Claude responds with 'respond'", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([{ type: "result", subtype: "success", result: "respond" }]),
    );

    const result = await runPreAnalysis(
      "server is down",
      "Alice",
      "Clack",
      "Only respond to errors",
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );
    assert.equal(result, "respond");
  });

  it("returns 'skip' when Claude responds with 'skip'", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([{ type: "result", subtype: "success", result: "skip" }]),
    );

    const result = await runPreAnalysis(
      "lol",
      "Alice",
      "Clack",
      "Skip noise",
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );
    assert.equal(result, "skip");
  });

  it("returns 'stop' when Claude responds with 'stop'", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([{ type: "result", subtype: "success", result: "stop" }]),
    );

    const result = await runPreAnalysis(
      "let's grab lunch",
      "Alice",
      "Clack",
      "Skip noise",
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );
    assert.equal(result, "stop");
  });

  it("returns 'skip' when result subtype is not success (fail-closed)", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([{ type: "result", subtype: "error", result: "respond" }]),
    );

    const result = await runPreAnalysis(
      "server is down",
      "Alice",
      "Clack",
      "Only respond to errors",
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );
    assert.equal(result, "skip");
  });

  it("returns false for ambiguous response (fail-closed)", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        { type: "result", subtype: "success", result: "maybe, it depends on context" },
      ]),
    );

    const result = await runPreAnalysis(
      "some message",
      "Alice",
      "Clack",
      "Only respond to errors",
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );
    assert.equal(result, "skip");
  });

  it("returns false when query throws (fail-closed)", async () => {
    mockQuery.mock.mockImplementation(() => {
      throw new Error("SDK failure");
    });

    const result = await runPreAnalysis(
      "message",
      "Alice",
      "Clack",
      "context",
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );
    assert.equal(result, "skip");
  });

  it("returns false when async iterator throws (fail-closed)", async () => {
    mockQuery.mock.mockImplementation(() => ({
      // Intentionally throws before yielding to simulate a stream error
      // eslint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {
        throw new Error("stream interrupted");
      },
    }));

    const result = await runPreAnalysis(
      "message",
      "Alice",
      "Clack",
      "context",
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );
    assert.equal(result, "skip");
  });

  it("returns false when result is empty (fail-closed)", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([{ type: "result", subtype: "success", result: "" }]),
    );

    const result = await runPreAnalysis(
      "message",
      "Alice",
      "Clack",
      "context",
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );
    assert.equal(result, "skip");
  });

  it("falls back to lastAssistantText when result.result is empty", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "respond" }] },
        },
        { type: "result", subtype: "success", result: "" },
      ]),
    );

    const result = await runPreAnalysis(
      "error message",
      "Alice",
      "Clack",
      "Only respond to errors",
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );
    assert.equal(result, "respond");
  });

  it("detects 'skip' in verbose response", async () => {
    mockQuery.mock.mockImplementation(() =>
      asyncIterableOf([
        { type: "result", subtype: "success", result: "I would skip this message" },
      ]),
    );

    const result = await runPreAnalysis(
      "lol",
      "Alice",
      "Clack",
      "Skip noise",
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );
    assert.equal(result, "skip");
  });

  it("passes systemPrompt with preAnalysisContext and bot name to query", async () => {
    let capturedOptions: QueryCallArg["options"];
    mockQuery.mock.mockImplementation((...args: unknown[]) => {
      capturedOptions = (args[0] as QueryCallArg).options;
      return asyncIterableOf([{ type: "result", subtype: "success", result: "respond" }]);
    });

    await runPreAnalysis(
      "test message",
      "Alice",
      "Clack",
      "Only respond to product questions",
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );

    assert.ok(typeof capturedOptions?.systemPrompt === "string");
    const systemPrompt = capturedOptions!.systemPrompt!;
    assert.ok(systemPrompt.includes("Only respond to product questions"));
    assert.ok(systemPrompt.includes("Clack"));
    assert.ok(systemPrompt.includes("When in doubt, SKIP"));
    assert.equal(capturedOptions!.model, "sonnet");
    assert.equal(capturedOptions!.maxTurns, 1);
  });

  it("includes attributed recent messages and author in the prompt", async () => {
    let capturedPrompt = "";
    mockQuery.mock.mockImplementation((...args: unknown[]) => {
      capturedPrompt = (args[0] as QueryCallArg).prompt;
      return asyncIterableOf([{ type: "result", subtype: "success", result: "respond" }]);
    });

    await runPreAnalysis(
      "what about today",
      "Bob",
      "Clack",
      "Skip noise",
      undefined,
      [
        { author: "Clack (bot)", text: "Here's your daily update!", isBot: true },
        { author: "Alice", text: "thanks", isBot: false },
      ],
      undefined,
      undefined,
      makeDeps(),
    );

    assert.ok(capturedPrompt.includes("RECENT CHANNEL HISTORY"));
    assert.ok(capturedPrompt.includes("[Clack (bot)]: Here's your daily update!"));
    assert.ok(capturedPrompt.includes("[Alice]: thanks"));
    assert.ok(capturedPrompt.includes("MESSAGE TO CLASSIFY"));
    assert.ok(capturedPrompt.includes("From: Bob"));
    assert.ok(capturedPrompt.includes("what about today"));
  });

  it("includes channel name in the prompt when provided", async () => {
    let capturedPrompt = "";
    mockQuery.mock.mockImplementation((...args: unknown[]) => {
      capturedPrompt = (args[0] as QueryCallArg).prompt;
      return asyncIterableOf([{ type: "result", subtype: "success", result: "respond" }]);
    });

    await runPreAnalysis(
      "test message",
      "Alice",
      "Clack",
      "context",
      undefined,
      undefined,
      "security-compliance",
      undefined,
      makeDeps(),
    );

    assert.ok(capturedPrompt.includes("Channel: #security-compliance"));
  });

  it("omits channel name from the prompt when not provided", async () => {
    let capturedPrompt = "";
    mockQuery.mock.mockImplementation((...args: unknown[]) => {
      capturedPrompt = (args[0] as QueryCallArg).prompt;
      return asyncIterableOf([{ type: "result", subtype: "success", result: "respond" }]);
    });

    await runPreAnalysis(
      "test message",
      "Alice",
      "Clack",
      "context",
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );

    assert.ok(!capturedPrompt.includes("Channel:"));
  });
});
