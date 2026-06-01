import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import {
  runPreAnalysis,
  runActiveRunPreAnalysis,
  formatElapsedSeconds,
  type PreAnalysisDeps,
  defaultPreAnalysisDeps,
} from "./preAnalysis.js";
import type { clackQuery } from "./query.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockClackQuery = ReturnType<typeof vi.fn<typeof clackQuery>>;

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
    mockQuery = vi.fn<typeof clackQuery>();
  });

  it("returns 'respond' when Claude responds with 'respond'", async () => {
    mockQuery.mockImplementation(() =>
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
      undefined,
      makeDeps(),
    );
    assert.equal(result, "respond");
  });

  it("returns 'skip' when Claude responds with 'skip'", async () => {
    mockQuery.mockImplementation(() =>
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
      undefined,
      makeDeps(),
    );
    assert.equal(result, "skip");
  });

  it("returns 'stop' when Claude responds with 'stop'", async () => {
    mockQuery.mockImplementation(() =>
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
      undefined,
      makeDeps(),
    );
    assert.equal(result, "stop");
  });

  it("returns 'skip' when result subtype is not success (fail-closed)", async () => {
    mockQuery.mockImplementation(() =>
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
      undefined,
      makeDeps(),
    );
    assert.equal(result, "skip");
  });

  it("returns false for ambiguous response (fail-closed)", async () => {
    mockQuery.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "result",
          subtype: "success",
          result: "maybe, it depends on context",
        },
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
      undefined,
      makeDeps(),
    );
    assert.equal(result, "skip");
  });

  it("returns false when query throws (fail-closed)", async () => {
    mockQuery.mockImplementation(() => {
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
      undefined,
      makeDeps(),
    );
    assert.equal(result, "skip");
  });

  it("returns false when async iterator throws (fail-closed)", async () => {
    mockQuery.mockImplementation(() => ({
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
      undefined,
      makeDeps(),
    );
    assert.equal(result, "skip");
  });

  it("returns false when result is empty (fail-closed)", async () => {
    mockQuery.mockImplementation(() =>
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
      undefined,
      makeDeps(),
    );
    assert.equal(result, "skip");
  });

  it("falls back to lastAssistantText when result.result is empty", async () => {
    mockQuery.mockImplementation(() =>
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
      undefined,
      makeDeps(),
    );
    assert.equal(result, "respond");
  });

  it("detects 'skip' in verbose response", async () => {
    mockQuery.mockImplementation(() =>
      asyncIterableOf([
        {
          type: "result",
          subtype: "success",
          result: "I would skip this message",
        },
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
      undefined,
      makeDeps(),
    );
    assert.equal(result, "skip");
  });

  it("passes systemPrompt with preAnalysisContext and bot name to query", async () => {
    let capturedOptions: QueryCallArg["options"];
    mockQuery.mockImplementation((...args: unknown[]) => {
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
      undefined,
      makeDeps(),
    );

    assert.ok(typeof capturedOptions?.systemPrompt === "string");
    const systemPrompt = capturedOptions!.systemPrompt!;
    assert.ok(systemPrompt.includes("Only respond to product questions"));
    assert.ok(systemPrompt.includes("Clack"));
    assert.ok(systemPrompt.includes("prefer skip"));
    assert.ok(systemPrompt.includes("DIRECT ADDRESS"));
    assert.ok(systemPrompt.includes("thank-you"));
    assert.ok(systemPrompt.includes("stop"));
    assert.equal(capturedOptions!.model, "sonnet");
    assert.equal(capturedOptions!.maxTurns, 1);
  });

  it("does NOT inject the language directive — pre-analysis is internal reasoning", async () => {
    // The pre-analysis path builds its systemPrompt inline (not through
    // buildSystemPrompt), so the LANGUAGE directive must never appear regardless
    // of `config.language`. This structural assertion guards against accidental
    // future coupling between the two paths.
    let capturedOptions: QueryCallArg["options"];
    mockQuery.mockImplementation((...args: unknown[]) => {
      capturedOptions = (args[0] as QueryCallArg).options;
      return asyncIterableOf([{ type: "result", subtype: "success", result: "skip" }]);
    });

    await runPreAnalysis(
      "bonjour",
      "Alice",
      "Clack",
      "Skip noise",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );

    const systemPrompt = capturedOptions!.systemPrompt!;
    assert.ok(
      !systemPrompt.includes("LANGUAGE\n"),
      "pre-analysis system prompt must not contain the LANGUAGE directive",
    );
    assert.ok(
      !systemPrompt.includes("Français"),
      "pre-analysis system prompt must not name any non-English language",
    );
  });

  it("includes attributed recent messages and author in the prompt", async () => {
    let capturedPrompt = "";
    mockQuery.mockImplementation((...args: unknown[]) => {
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
        {
          author: "Clack (bot)",
          text: "Here's your daily update!",
          isBot: true,
        },
        { author: "Alice", text: "thanks", isBot: false },
      ],
      undefined,
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
    mockQuery.mockImplementation((...args: unknown[]) => {
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
      undefined,
      makeDeps(),
    );

    assert.ok(capturedPrompt.includes("Channel: #security-compliance"));
  });

  it("omits channel name from the prompt when not provided", async () => {
    let capturedPrompt = "";
    mockQuery.mockImplementation((...args: unknown[]) => {
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
      undefined,
      makeDeps(),
    );

    assert.ok(!capturedPrompt.includes("Channel:"));
  });

  // -------------------------------------------------------------------------
  // Direct-address override + temporal-proximity guidance (system prompt)
  // -------------------------------------------------------------------------
  it("injects the direct-address override into the system prompt", async () => {
    let capturedOptions: QueryCallArg["options"];
    mockQuery.mockImplementation((...args: unknown[]) => {
      capturedOptions = (args[0] as QueryCallArg).options;
      return asyncIterableOf([{ type: "result", subtype: "success", result: "respond" }]);
    });

    await runPreAnalysis(
      "come on Clack, use a worker",
      "Alice",
      "Clack",
      "context",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );

    const systemPrompt = capturedOptions!.systemPrompt!;
    // Directed messages are never skipped; verdict follows intent (respond vs stop).
    assert.ok(systemPrompt.includes("DIRECT ADDRESS"));
    assert.ok(systemPrompt.includes('NEVER "skip"'));
    assert.ok(systemPrompt.includes("DIRECTED AT Clack"));
    assert.ok(systemPrompt.includes('"Clack, stop"'));
    // Takes priority over tone.
    assert.ok(systemPrompt.toLowerCase().includes("takes priority over the thread-tone"));
  });

  it("frames stop as explicit sign-off / topic change, not serious tone or quietness", async () => {
    let capturedOptions: QueryCallArg["options"];
    mockQuery.mockImplementation((...args: unknown[]) => {
      capturedOptions = (args[0] as QueryCallArg).options;
      return asyncIterableOf([{ type: "result", subtype: "success", result: "skip" }]);
    });

    await runPreAnalysis(
      "message",
      "Alice",
      "Clack",
      "context",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );

    const systemPrompt = capturedOptions!.systemPrompt!;
    assert.ok(systemPrompt.includes("explicitly signs off"));
    assert.ok(systemPrompt.includes("is not by itself a reason to stop"));
    assert.ok(systemPrompt.includes("quiet threads often resume"));
  });

  it("injects the timing line when secondsSinceLastBotMessage is provided", async () => {
    let capturedPrompt = "";
    mockQuery.mockImplementation((...args: unknown[]) => {
      capturedPrompt = (args[0] as QueryCallArg).prompt;
      return asyncIterableOf([{ type: "result", subtype: "success", result: "respond" }]);
    });

    await runPreAnalysis(
      "you there?",
      "Alice",
      "Clack",
      "context",
      undefined,
      undefined,
      undefined,
      undefined,
      25,
      makeDeps(),
    );

    assert.ok(
      capturedPrompt.includes("TIMING: this message arrived 25s after Clack's last message"),
    );
  });

  it("omits the timing line when secondsSinceLastBotMessage is undefined", async () => {
    let capturedPrompt = "";
    mockQuery.mockImplementation((...args: unknown[]) => {
      capturedPrompt = (args[0] as QueryCallArg).prompt;
      return asyncIterableOf([{ type: "result", subtype: "success", result: "respond" }]);
    });

    await runPreAnalysis(
      "you there?",
      "Alice",
      "Clack",
      "context",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );

    assert.ok(!capturedPrompt.includes("TIMING:"));
  });

  it("instructs that elapsed time alone is never grounds to skip or stop", async () => {
    let capturedOptions: QueryCallArg["options"];
    mockQuery.mockImplementation((...args: unknown[]) => {
      capturedOptions = (args[0] as QueryCallArg).options;
      return asyncIterableOf([{ type: "result", subtype: "success", result: "respond" }]);
    });

    await runPreAnalysis(
      "message",
      "Alice",
      "Clack",
      "context",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );

    const systemPrompt = capturedOptions!.systemPrompt!;
    assert.ok(systemPrompt.includes('elapsed time alone is never a reason to "skip" or "stop"'));
  });
});

// ---------------------------------------------------------------------------
// runActiveRunPreAnalysis — append/skip gate (mirrors direct-address + timing)
// ---------------------------------------------------------------------------
describe("runActiveRunPreAnalysis", () => {
  beforeEach(() => {
    mockQuery = vi.fn<typeof clackQuery>();
  });

  it("returns 'skip' when Claude responds with 'skip'", async () => {
    mockQuery.mockImplementation(() =>
      asyncIterableOf([{ type: "result", subtype: "success", result: "skip" }]),
    );

    const result = await runActiveRunPreAnalysis(
      "lol nice",
      "Bob",
      "Clack",
      "context",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );
    assert.equal(result, "skip");
  });

  it("defaults to 'append' for anything not containing 'skip'", async () => {
    mockQuery.mockImplementation(() =>
      asyncIterableOf([{ type: "result", subtype: "success", result: "append" }]),
    );

    const result = await runActiveRunPreAnalysis(
      "wait, also check the worker logs",
      "Bob",
      "Clack",
      "context",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );
    assert.equal(result, "append");
  });

  it("defaults to 'append' on error (fail-open)", async () => {
    mockQuery.mockImplementation(() => {
      throw new Error("SDK failure");
    });

    const result = await runActiveRunPreAnalysis(
      "message",
      "Bob",
      "Clack",
      "context",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );
    assert.equal(result, "append");
  });

  it("mirrors the direct-address guidance (directed → append, never skip)", async () => {
    let capturedOptions: QueryCallArg["options"];
    mockQuery.mockImplementation((...args: unknown[]) => {
      capturedOptions = (args[0] as QueryCallArg).options;
      return asyncIterableOf([{ type: "result", subtype: "success", result: "append" }]);
    });

    await runActiveRunPreAnalysis(
      "Clack, also retry",
      "Bob",
      "Clack",
      "context",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );

    const systemPrompt = capturedOptions!.systemPrompt!;
    assert.ok(systemPrompt.includes("DIRECT ADDRESS"));
    assert.ok(systemPrompt.includes('always "append", never "skip"'));
  });

  it("injects the timing line when provided and omits it otherwise", async () => {
    let capturedPrompt = "";
    mockQuery.mockImplementation((...args: unknown[]) => {
      capturedPrompt = (args[0] as QueryCallArg).prompt;
      return asyncIterableOf([{ type: "result", subtype: "success", result: "append" }]);
    });

    await runActiveRunPreAnalysis(
      "still there?",
      "Bob",
      "Clack",
      "context",
      undefined,
      undefined,
      undefined,
      undefined,
      90,
      makeDeps(),
    );
    assert.ok(
      capturedPrompt.includes("TIMING: this message arrived 2m after Clack's last message"),
    );

    capturedPrompt = "";
    await runActiveRunPreAnalysis(
      "still there?",
      "Bob",
      "Clack",
      "context",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(),
    );
    assert.ok(!capturedPrompt.includes("TIMING:"));
  });
});

// ---------------------------------------------------------------------------
// formatElapsedSeconds — compact duration buckets
// ---------------------------------------------------------------------------
describe("formatElapsedSeconds", () => {
  it("formats seconds, minutes, hours, and days", () => {
    assert.equal(formatElapsedSeconds(5), "5s");
    assert.equal(formatElapsedSeconds(89), "89s");
    assert.equal(formatElapsedSeconds(120), "2m");
    assert.equal(formatElapsedSeconds(3600 * 3), "3h");
    assert.equal(formatElapsedSeconds(86400 * 2), "2d");
  });
});
