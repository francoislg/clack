import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type {
  query as sdkQuery,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
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

function makeResultErrorMessage(errors: string[]) {
  return {
    type: "result" as const,
    subtype: "error_during_execution" as const,
    errors,
    session_id: "test-session",
    uuid: "err-uuid",
  };
}

/** Minimal-but-valid shape for fixtures in this test file. */
interface MessageFixture {
  type: string;
  subtype?: string;
  session_id?: string;
}

/**
 * Build a Query stub that yields the supplied fixtures. The SDK's `Query` interface
 * extends `AsyncGenerator<SDKMessage, void>` plus 11 control methods. The control
 * methods are no-op stubs — tests don't invoke them, but the type system requires
 * them. Fixtures are cast to `SDKMessage` at the yield boundary because the test
 * fixtures intentionally omit fields that clackSession doesn't read at runtime.
 */
function makeMockQuery(items: ReadonlyArray<MessageFixture>): Query {
  async function* gen(): AsyncGenerator<SDKMessage, void> {
    for (const item of items) {
      yield item as SDKMessage;
    }
  }
  const generator = gen();
  const errors: Record<string, string> = {};
  // `notImplemented` returns `Promise<never>`, which is assignable to any `Promise<X>`.
  // Used for Query control methods whose return shapes (SDKControlInitializeResponse,
  // AccountInfo, etc.) we don't have an easy way to construct in tests. Tests don't
  // invoke these — they exist only to satisfy the Query interface.
  const notImplemented = (name: string) => () =>
    Promise.reject(new Error(`mock Query.${name} not implemented in tests`));

  const control: Pick<
    Query,
    | "interrupt"
    | "setPermissionMode"
    | "setModel"
    | "setMaxThinkingTokens"
    | "applyFlagSettings"
    | "initializationResult"
    | "supportedCommands"
    | "supportedModels"
    | "supportedAgents"
    | "mcpServerStatus"
    | "getContextUsage"
    | "readFile"
    | "reloadPlugins"
    | "accountInfo"
    | "rewindFiles"
    | "seedReadState"
    | "reconnectMcpServer"
    | "toggleMcpServer"
    | "setMcpServers"
    | "streamInput"
    | "stopTask"
    | "close"
  > = {
    interrupt: () => Promise.resolve(),
    setPermissionMode: () => Promise.resolve(),
    setModel: () => Promise.resolve(),
    setMaxThinkingTokens: () => Promise.resolve(),
    applyFlagSettings: () => Promise.resolve(),
    initializationResult: notImplemented("initializationResult"),
    supportedCommands: () => Promise.resolve([]),
    supportedModels: () => Promise.resolve([]),
    supportedAgents: () => Promise.resolve([]),
    mcpServerStatus: () => Promise.resolve([]),
    getContextUsage: notImplemented("getContextUsage"),
    readFile: () => Promise.resolve(null),
    reloadPlugins: notImplemented("reloadPlugins"),
    accountInfo: notImplemented("accountInfo"),
    rewindFiles: () => Promise.resolve({ canRewind: false }),
    seedReadState: () => Promise.resolve(),
    reconnectMcpServer: () => Promise.resolve(),
    toggleMcpServer: () => Promise.resolve(),
    setMcpServers: () =>
      Promise.resolve({ added: [] as string[], removed: [] as string[], errors }),
    streamInput: () => Promise.resolve(),
    stopTask: () => Promise.resolve(),
    close: () => {},
  };
  return Object.assign(generator, control);
}

interface QueryCallArg {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options: {
    persistSession: boolean;
    resume?: string;
    model?: string;
    cwd?: string;
    permissionMode?: string;
  };
}

async function collectMessages(messages: AsyncIterable<SDKMessage>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  for await (const msg of messages) out.push(msg);
  return out;
}

// ---------------------------------------------------------------------------
// clackQuery
// ---------------------------------------------------------------------------

describe("clackQuery", () => {
  beforeEach(() => {
    mockQuery = mock.fn<typeof sdkQuery>();
  });

  it("sets persistSession to false", () => {
    mockQuery.mock.mockImplementation(() => makeMockQuery([makeResultMessage("done")]));

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
    mockQuery.mock.mockImplementation(() => makeMockQuery([makeResultMessage("done")]));

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

  it("sets persistSession to true and returns a streaming-input run", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeMockQuery([makeInitMessage("abc-123"), makeResultMessage("done")]),
    );

    const run = clackSession({ prompt: "test" }, makeDeps());
    const messages = await collectMessages(run.messages);

    const args = mockQuery.mock.calls[0]!.arguments[0] as QueryCallArg;
    assert.equal(args.options.persistSession, true);
    // Streaming-input mode: prompt is now an async iterable of SDKUserMessage
    assert.notEqual(typeof args.prompt, "string");
    assert.equal(messages.length, 2);
  });

  it("captures session_id from init message via onSessionId callback", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeMockQuery([makeInitMessage("captured-id"), makeResultMessage("done")]),
    );

    let capturedId: string | undefined;
    const run = clackSession(
      {
        prompt: "test",
        onSessionId: (id) => {
          capturedId = id;
        },
      },
      makeDeps(),
    );
    await collectMessages(run.messages);

    assert.equal(capturedId, "captured-id");
  });

  it("passes resumeSessionId as resume option", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeMockQuery([makeInitMessage("resumed-id"), makeResultMessage("done")]),
    );

    const run = clackSession(
      {
        prompt: "test",
        resumeSessionId: "previous-session-id",
      },
      makeDeps(),
    );
    await collectMessages(run.messages);

    const args = mockQuery.mock.calls[0]!.arguments[0] as QueryCallArg;
    assert.equal(args.options.resume, "previous-session-id");
  });

  it("does not pass resume when resumeSessionId is undefined", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeMockQuery([makeInitMessage("fresh-id"), makeResultMessage("done")]),
    );

    const run = clackSession({ prompt: "test" }, makeDeps());
    await collectMessages(run.messages);

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
      return makeMockQuery([makeInitMessage("new-session-id"), makeResultMessage("done")]);
    });

    let capturedId: string | undefined;
    const run = clackSession(
      {
        prompt: "test",
        resumeSessionId: "broken-session",
        onSessionId: (id) => {
          capturedId = id;
        },
      },
      makeDeps(),
    );
    const messages = await collectMessages(run.messages);

    // Should have been called twice: failed resume + fresh start
    assert.equal(mockQuery.mock.callCount(), 2);
    // Fresh session should not have resume
    const secondArgs = mockQuery.mock.calls[1]!.arguments[0] as QueryCallArg;
    assert.equal(secondArgs.options.resume, undefined);
    // Should have captured the new session ID
    assert.equal(capturedId, "new-session-id");
    assert.equal(messages.length, 2);
  });

  it("falls back to fresh session when SDK yields a resume-missing result", async () => {
    let callCount = 0;
    mockQuery.mock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeMockQuery([
          makeResultErrorMessage(["No conversation found with session ID: broken-session"]),
        ]);
      }
      return makeMockQuery([makeInitMessage("new-session-id"), makeResultMessage("done")]);
    });

    let capturedId: string | undefined;
    const run = clackSession(
      {
        prompt: "test",
        resumeSessionId: "broken-session",
        onSessionId: (id) => {
          capturedId = id;
        },
      },
      makeDeps(),
    );
    const messages = await collectMessages(run.messages);

    assert.equal(mockQuery.mock.callCount(), 2);
    const secondArgs = mockQuery.mock.calls[1]!.arguments[0] as QueryCallArg;
    assert.equal(secondArgs.options.resume, undefined);
    assert.equal(capturedId, "new-session-id");
    assert.equal(messages.length, 2);
    assert.deepEqual(messages, [makeInitMessage("new-session-id"), makeResultMessage("done")]);
  });

  it("surfaces non-resume-missing error results without retrying", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeMockQuery([
        makeInitMessage("sess-id"),
        makeResultErrorMessage(["Something else went wrong"]),
      ]),
    );

    const run = clackSession(
      {
        prompt: "test",
        resumeSessionId: "some-session",
      },
      makeDeps(),
    );
    const messages = await collectMessages(run.messages);

    assert.equal(mockQuery.mock.callCount(), 1);
    assert.equal(messages.length, 2);
  });

  it("throws on non-resume errors (no resumeSessionId)", async () => {
    mockQuery.mock.mockImplementation(() => {
      throw new Error("API rate limit");
    });

    const run = clackSession({ prompt: "test" }, makeDeps());
    await assert.rejects(async () => collectMessages(run.messages), { message: "API rate limit" });
  });

  it("forwards all other options unchanged", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeMockQuery([makeInitMessage("id"), makeResultMessage("done")]),
    );

    const run = clackSession(
      {
        prompt: "test",
        options: {
          model: "opus",
          cwd: "/repos",
          permissionMode: "bypassPermissions",
        },
      },
      makeDeps(),
    );
    await collectMessages(run.messages);

    const args = mockQuery.mock.calls[0]!.arguments[0] as QueryCallArg;
    assert.equal(args.options.model, "opus");
    assert.equal(args.options.cwd, "/repos");
    assert.equal(args.options.permissionMode, "bypassPermissions");
  });

  it("the initial SDKUserMessage carries the prompt text", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeMockQuery([makeInitMessage("id"), makeResultMessage("done")]),
    );

    const run = clackSession({ prompt: "hello world" }, makeDeps());
    await collectMessages(run.messages);

    const args = mockQuery.mock.calls[0]!.arguments[0] as QueryCallArg;
    assert.notEqual(typeof args.prompt, "string");
    if (typeof args.prompt === "string") {
      assert.fail("Expected AsyncIterable prompt");
    }
    const inputStream = args.prompt;
    const collected: SDKUserMessage[] = [];
    for await (const msg of inputStream) {
      collected.push(msg);
      // Collect just the first message; the stream stays open for more pushes
      break;
    }
    assert.equal(collected.length, 1);
    assert.equal(collected[0]!.type, "user");
    const content = collected[0]!.message.content;
    if (Array.isArray(content) && content[0] && "text" in content[0]) {
      assert.equal(content[0].text, "hello world");
    } else {
      assert.fail("Expected text content block");
    }
  });

  it("sendUpdate pushes a follow-up SDKUserMessage onto the input stream", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeMockQuery([makeInitMessage("id"), makeResultMessage("done")]),
    );

    const run = clackSession({ prompt: "first" }, makeDeps());
    // Start consuming `run.messages` so the SDK query is constructed and the input
    // stream becomes the prompt source — only then does `sendUpdate` land somewhere
    // observable.
    async function drainMessages(): Promise<void> {
      for await (const _msg of run.messages) {
        // ignored — we only care that the generator runs and triggers deps.query
      }
    }
    const drain = drainMessages();
    // Yield so the generator's first `for await` tick reaches `deps.query(...)`.
    await new Promise((resolve) => setImmediate(resolve));
    await run.sendUpdate("second");
    await drain;

    const args = mockQuery.mock.calls[0]!.arguments[0] as QueryCallArg;
    if (typeof args.prompt === "string") {
      assert.fail("Expected AsyncIterable prompt");
    }
    const inputStream = args.prompt;
    const iter = inputStream[Symbol.asyncIterator]();
    const first = (await iter.next()).value;
    const second = (await iter.next()).value;
    assert.ok(first);
    assert.ok(second);
    const content = second.message.content;
    if (Array.isArray(content) && content[0] && "text" in content[0]) {
      assert.equal(content[0].text, "second");
    } else {
      assert.fail("Expected text content block");
    }
  });

  it("settle resolves futureResponse and the run's status flips to settled", async () => {
    mockQuery.mock.mockImplementation(() =>
      makeMockQuery([makeInitMessage("id"), makeResultMessage("done")]),
    );

    const run = clackSession({ prompt: "test" }, makeDeps());
    assert.equal(run.status, "running");
    run.settle({ success: true, answer: "ok" });
    const response = await run.futureResponse;
    assert.equal(response.success, true);
    assert.equal(run.status, "settled");
  });
});
