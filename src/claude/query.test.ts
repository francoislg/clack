import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockQuery = mock.fn<(...args: unknown[]) => unknown>();

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

// Import after mocks
const { clackQuery, clackSession } = await import("./query.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInitMessage(sessionId: string) {
  return {
    type: "system" as const,
    subtype: "init" as const,
    session_id: sessionId,
    tools: [],
    mcp_servers: [],
    model: "test",
    cwd: "/test",
    apiKeySource: "env" as const,
    claude_code_version: "1.0.0",
    permissionMode: "bypassPermissions" as const,
    slash_commands: [],
    output_style: "text",
    skills: [],
    plugins: [],
    uuid: "test-uuid",
  };
}

function makeResultMessage(text: string) {
  return {
    type: "result" as const,
    subtype: "success" as const,
    result: text,
    session_id: "test-session",
    uuid: "result-uuid",
  };
}

function makeAsyncIterable<T>(items: T[]): AsyncGenerator<T, void> {
  async function* gen() {
    for (const item of items) {
      yield item;
    }
  }
  return gen();
}

// ---------------------------------------------------------------------------
// clackQuery
// ---------------------------------------------------------------------------

describe("clackQuery", () => {
  beforeEach(() => {
    mockQuery.mock.resetCalls();
  });

  it("sets persistSession to false", () => {
    mockQuery.mock.mockImplementation(() =>
      makeAsyncIterable([makeResultMessage("done")])
    );

    clackQuery({
      prompt: "test",
      options: { model: "sonnet" },
    });

    assert.equal(mockQuery.mock.callCount(), 1);
    const call = mockQuery.mock.calls[0];
    const args = call.arguments[0] as { prompt: string; options: Record<string, unknown> };
    assert.equal(args.options.persistSession, false);
    assert.equal(args.prompt, "test");
    assert.equal(args.options.model, "sonnet");
  });

  it("does not pass resume", () => {
    mockQuery.mock.mockImplementation(() =>
      makeAsyncIterable([makeResultMessage("done")])
    );

    clackQuery({ prompt: "test" });

    const args = mockQuery.mock.calls[0].arguments[0] as { options: Record<string, unknown> };
    assert.equal(args.options.resume, undefined);
  });
});

// ---------------------------------------------------------------------------
// clackSession
// ---------------------------------------------------------------------------

describe("clackSession", () => {
  beforeEach(() => {
    mockQuery.mock.resetCalls();
  });

  it("sets persistSession to true", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeAsyncIterable([makeInitMessage("abc-123"), makeResultMessage("done")])
    );

    const messages: unknown[] = [];
    for await (const msg of clackSession({ prompt: "test" })) {
      messages.push(msg);
    }

    const args = mockQuery.mock.calls[0].arguments[0] as { options: Record<string, unknown> };
    assert.equal(args.options.persistSession, true);
    assert.equal(messages.length, 2);
  });

  it("captures session_id from init message via onSessionId callback", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeAsyncIterable([makeInitMessage("captured-id"), makeResultMessage("done")])
    );

    let capturedId: string | undefined;
    for await (const _msg of clackSession({
      prompt: "test",
      onSessionId: (id) => { capturedId = id; },
    })) {
      // consume
    }

    assert.equal(capturedId, "captured-id");
  });

  it("passes resumeSessionId as resume option", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeAsyncIterable([makeInitMessage("resumed-id"), makeResultMessage("done")])
    );

    for await (const _msg of clackSession({
      prompt: "test",
      resumeSessionId: "previous-session-id",
    })) {
      // consume
    }

    const args = mockQuery.mock.calls[0].arguments[0] as { options: Record<string, unknown> };
    assert.equal(args.options.resume, "previous-session-id");
  });

  it("does not pass resume when resumeSessionId is undefined", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeAsyncIterable([makeInitMessage("fresh-id"), makeResultMessage("done")])
    );

    for await (const _msg of clackSession({ prompt: "test" })) {
      // consume
    }

    const args = mockQuery.mock.calls[0].arguments[0] as { options: Record<string, unknown> };
    assert.equal(args.options.resume, undefined);
  });

  it("falls back to fresh session on resume failure", async () => {
    let callCount = 0;
    mockQuery.mock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call (resume attempt) throws
        const gen = async function* () {
          throw new Error("Session file not found");
          yield; // unreachable, satisfies generator type
        };
        return gen();
      }
      // Second call (fresh session) succeeds
      return makeAsyncIterable([makeInitMessage("new-session-id"), makeResultMessage("done")]);
    });

    let capturedId: string | undefined;
    const messages: unknown[] = [];
    for await (const msg of clackSession({
      prompt: "test",
      resumeSessionId: "broken-session",
      onSessionId: (id) => { capturedId = id; },
    })) {
      messages.push(msg);
    }

    // Should have been called twice: failed resume + fresh start
    assert.equal(mockQuery.mock.callCount(), 2);
    // Fresh session should not have resume
    const secondArgs = mockQuery.mock.calls[1].arguments[0] as { options: Record<string, unknown> };
    assert.equal(secondArgs.options.resume, undefined);
    // Should have captured the new session ID
    assert.equal(capturedId, "new-session-id");
    assert.equal(messages.length, 2);
  });

  it("throws on non-resume errors (no resumeSessionId)", async () => {
    mockQuery.mock.mockImplementation(() => {
      const gen = async function* () {
        throw new Error("API rate limit");
        yield;
      };
      return gen();
    });

    await assert.rejects(
      async () => {
        for await (const _msg of clackSession({ prompt: "test" })) {
          // consume
        }
      },
      { message: "API rate limit" }
    );
  });

  it("forwards all other options unchanged", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeAsyncIterable([makeInitMessage("id"), makeResultMessage("done")])
    );

    for await (const _msg of clackSession({
      prompt: "test",
      options: {
        model: "opus",
        cwd: "/repos",
        permissionMode: "bypassPermissions",
      },
    })) {
      // consume
    }

    const args = mockQuery.mock.calls[0].arguments[0] as { options: Record<string, unknown> };
    assert.equal(args.options.model, "opus");
    assert.equal(args.options.cwd, "/repos");
    assert.equal(args.options.permissionMode, "bypassPermissions");
  });
});
