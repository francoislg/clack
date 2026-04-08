import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { clackQuery, clackSession, type QueryDeps, defaultQueryDeps } from "./query.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockQuery = ReturnType<typeof mock.fn<typeof sdkQuery>>;

let mockQuery: MockQuery;

function makeDeps(): QueryDeps {
  return {
    ...defaultQueryDeps,
    query: mockQuery,
  };
}

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

function makeAsyncIterable<T>(items: T[]): never {
  async function* gen() {
    for (const item of items) {
      yield item;
    }
  }
  return gen() as never;
}

interface QueryCallArg {
  prompt: string;
  options: {
    persistSession: boolean;
    resume?: string;
    model?: string;
    cwd?: string;
    permissionMode?: string;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// clackQuery
// ---------------------------------------------------------------------------

describe("clackQuery", () => {
  beforeEach(() => {
    mockQuery = mock.fn<typeof sdkQuery>();
  });

  it("sets persistSession to false", () => {
    mockQuery.mock.mockImplementation(() => makeAsyncIterable([makeResultMessage("done")]));

    clackQuery(
      {
        prompt: "test",
        options: { model: "sonnet" },
      },
      makeDeps(),
    );

    assert.equal(mockQuery.mock.callCount(), 1);
    const call = mockQuery.mock.calls[0]!;
    const args = call.arguments[0] as QueryCallArg;
    assert.equal(args.options.persistSession, false);
    assert.equal(args.prompt, "test");
    assert.equal(args.options.model, "sonnet");
  });

  it("does not pass resume", () => {
    mockQuery.mock.mockImplementation(() => makeAsyncIterable([makeResultMessage("done")]));

    clackQuery({ prompt: "test" }, makeDeps());

    const args = mockQuery.mock.calls[0]!.arguments[0] as QueryCallArg;
    assert.equal(args.options.resume, undefined);
  });
});

// ---------------------------------------------------------------------------
// clackSession
// ---------------------------------------------------------------------------

describe("clackSession", () => {
  beforeEach(() => {
    mockQuery = mock.fn<typeof sdkQuery>();
  });

  it("sets persistSession to true", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeAsyncIterable([makeInitMessage("abc-123"), makeResultMessage("done")]),
    );

    const messages: unknown[] = [];
    for await (const msg of clackSession({ prompt: "test" }, makeDeps())) {
      messages.push(msg);
    }

    const args = mockQuery.mock.calls[0]!.arguments[0] as QueryCallArg;
    assert.equal(args.options.persistSession, true);
    assert.equal(messages.length, 2);
  });

  it("captures session_id from init message via onSessionId callback", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeAsyncIterable([makeInitMessage("captured-id"), makeResultMessage("done")]),
    );

    let capturedId: string | undefined;
    for await (const _msg of clackSession(
      {
        prompt: "test",
        onSessionId: (id) => {
          capturedId = id;
        },
      },
      makeDeps(),
    )) {
      // consume
    }

    assert.equal(capturedId, "captured-id");
  });

  it("passes resumeSessionId as resume option", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeAsyncIterable([makeInitMessage("resumed-id"), makeResultMessage("done")]),
    );

    for await (const _msg of clackSession(
      {
        prompt: "test",
        resumeSessionId: "previous-session-id",
      },
      makeDeps(),
    )) {
      // consume
    }

    const args = mockQuery.mock.calls[0]!.arguments[0] as QueryCallArg;
    assert.equal(args.options.resume, "previous-session-id");
  });

  it("does not pass resume when resumeSessionId is undefined", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeAsyncIterable([makeInitMessage("fresh-id"), makeResultMessage("done")]),
    );

    for await (const _msg of clackSession({ prompt: "test" }, makeDeps())) {
      // consume
    }

    const args = mockQuery.mock.calls[0]!.arguments[0] as QueryCallArg;
    assert.equal(args.options.resume, undefined);
  });

  it("falls back to fresh session on resume failure", async () => {
    let callCount = 0;
    mockQuery.mock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call (resume attempt) throws
        throw new Error("Session file not found");
      }
      // Second call (fresh session) succeeds
      return makeAsyncIterable([makeInitMessage("new-session-id"), makeResultMessage("done")]);
    });

    let capturedId: string | undefined;
    const messages: unknown[] = [];
    for await (const msg of clackSession(
      {
        prompt: "test",
        resumeSessionId: "broken-session",
        onSessionId: (id) => {
          capturedId = id;
        },
      },
      makeDeps(),
    )) {
      messages.push(msg);
    }

    // Should have been called twice: failed resume + fresh start
    assert.equal(mockQuery.mock.callCount(), 2);
    // Fresh session should not have resume
    const secondArgs = mockQuery.mock.calls[1]!.arguments[0] as QueryCallArg;
    assert.equal(secondArgs.options.resume, undefined);
    // Should have captured the new session ID
    assert.equal(capturedId, "new-session-id");
    assert.equal(messages.length, 2);
  });

  it("throws on non-resume errors (no resumeSessionId)", async () => {
    mockQuery.mock.mockImplementation(() => {
      throw new Error("API rate limit");
    });

    await assert.rejects(
      async () => {
        for await (const _msg of clackSession({ prompt: "test" }, makeDeps())) {
          // consume
        }
      },
      { message: "API rate limit" },
    );
  });

  it("forwards all other options unchanged", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeAsyncIterable([makeInitMessage("id"), makeResultMessage("done")]),
    );

    for await (const _msg of clackSession(
      {
        prompt: "test",
        options: {
          model: "opus",
          cwd: "/repos",
          permissionMode: "bypassPermissions",
        },
      },
      makeDeps(),
    )) {
      // consume
    }

    const args = mockQuery.mock.calls[0]!.arguments[0] as QueryCallArg;
    assert.equal(args.options.model, "opus");
    assert.equal(args.options.cwd, "/repos");
    assert.equal(args.options.permissionMode, "bypassPermissions");
  });
});
