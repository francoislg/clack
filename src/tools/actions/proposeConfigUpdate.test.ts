import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  createProposeConfigUpdateTool,
  type ProposeConfigUpdateDeps,
} from "./proposeConfigUpdate.js";
import type { QueryToolContext } from "../types.js";
import type { IntentStore, ToolCallRecorder } from "../server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides?: Partial<ProposeConfigUpdateDeps>): ProposeConfigUpdateDeps {
  return {
    readInstructionFile: mock.fn(() => ({
      default_content: null,
      custom_content: null,
    })),
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<QueryToolContext>): QueryToolContext {
  return {
    mode: "query",
    userId: "U123",
    role: "admin",
    session: {
      sessionId: "sess-1",
      channelId: "C1",
      messageTs: "1.0",
      threadTs: "1.0",
      userId: "U123",
      originalQuestion: "test",
      threadContext: [],
      refinements: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    },
    config: {
      repositories: [],
    } as never as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
    ...overrides,
  };
}

function makeIntentStore(): IntentStore {
  const intents = new Map<string, ReturnType<IntentStore["resolve"]>>();
  let counter = 0;
  return {
    stage: (intent) => {
      const ref = `ref-${++counter}`;
      intents.set(ref, intent as ReturnType<IntentStore["resolve"]>);
      return ref;
    },
    resolve: (ref: string) => intents.get(ref) as ReturnType<IntentStore["resolve"]>,
    getAll: () => intents as ReturnType<IntentStore["getAll"]>,
  };
}

function makeRecorder(): ToolCallRecorder & {
  calls: Array<{
    tool: string;
    args: { [key: string]: unknown };
    result: { [key: string]: unknown };
  }>;
} {
  const calls: Array<{
    tool: string;
    args: { [key: string]: unknown };
    result: { [key: string]: unknown };
  }> = [];
  return {
    calls,
    record: (
      tool: string,
      args: { [key: string]: unknown },
      result: { [key: string]: unknown },
    ) => {
      calls.push({ tool, args, result });
    },
    getHistory: () => [],
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("proposeConfigUpdate tool", () => {
  let deps: ProposeConfigUpdateDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  // --- Path validation ---

  it("returns error for file without role/ prefix", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder, deps);

    const result = await toolDef.handler(
      {
        file: "instructions.md",
        content: "some content",
        operation: "append",
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Invalid file path"));
    assert.equal(result.isError, true);
  });

  it("records the error in the recorder for invalid path", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder, deps);

    await toolDef.handler(
      {
        file: "bad-path",
        content: "content",
        operation: "append",
      },
      { sessionId: "test" },
    );

    assert.equal(recorder.calls.length, 1);
    assert.ok((recorder.calls[0].result as { error: string }).error);
  });

  it("accepts valid role/filename paths", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder, deps);

    const result = await toolDef.handler(
      {
        file: "user/identity.md",
        content: "content",
        operation: "replace",
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.ref);
    assert.equal(parsed.file, "user/identity.md");
  });

  it("accepts repo/filename paths", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder, deps);

    const result = await toolDef.handler(
      {
        file: "my-repo/changes_instructions.md",
        content: "content",
        operation: "replace",
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.ref);
  });

  // --- Append operation ---

  it("appends to existing custom content when file has content", async () => {
    deps = makeDeps({
      readInstructionFile: mock.fn(() => ({
        default_content: "default stuff",
        custom_content: "existing line 1\nexisting line 2",
      })),
    });

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder, deps);

    const result = await toolDef.handler(
      {
        file: "user/identity.md",
        content: "new content",
        operation: "append",
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    const staged = store.resolve(parsed.ref) as { content: string };
    assert.equal(staged.content, "existing line 1\nexisting line 2\n\nnew content");
  });

  it("appends to default content when no custom exists", async () => {
    deps = makeDeps({
      readInstructionFile: mock.fn(() => ({
        default_content: "default content",
        custom_content: null,
      })),
    });

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder, deps);

    const result = await toolDef.handler(
      {
        file: "user/identity.md",
        content: "appended",
        operation: "append",
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    const staged = store.resolve(parsed.ref) as { content: string };
    assert.equal(staged.content, "default content\n\nappended");
  });

  it("uses content as-is when file has no existing content (append)", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder, deps);

    const result = await toolDef.handler(
      {
        file: "user/new-file.md",
        content: "brand new content",
        operation: "append",
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    const staged = store.resolve(parsed.ref) as { content: string };
    assert.equal(staged.content, "brand new content");
  });

  // --- Replace operation ---

  it("replaces content completely when operation is replace", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder, deps);

    const result = await toolDef.handler(
      {
        file: "user/identity.md",
        content: "completely new content",
        operation: "replace",
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    const staged = store.resolve(parsed.ref) as { content: string };
    assert.equal(staged.content, "completely new content");
  });

  // --- Status field ---

  it("returns will_overwrite_custom status when file has custom content", async () => {
    deps = makeDeps({
      readInstructionFile: mock.fn(() => ({
        default_content: "default",
        custom_content: "custom",
      })),
    });

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder, deps);

    const result = await toolDef.handler(
      {
        file: "user/identity.md",
        content: "content",
        operation: "replace",
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.status, "will_overwrite_custom");
  });

  it("returns will_override_default status when file has default but no custom", async () => {
    deps = makeDeps({
      readInstructionFile: mock.fn(() => ({
        default_content: "default",
        custom_content: null,
      })),
    });

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder, deps);

    const result = await toolDef.handler(
      {
        file: "user/identity.md",
        content: "content",
        operation: "replace",
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.status, "will_override_default");
  });

  it("returns will_create_new status when file has no content", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder, deps);

    const result = await toolDef.handler(
      {
        file: "user/new-file.md",
        content: "content",
        operation: "replace",
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.status, "will_create_new");
  });

  // --- Intent staging ---

  it("stages intent with correct type and file", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder, deps);

    const result = await toolDef.handler(
      {
        file: "dev/changes.md",
        content: "my content",
        operation: "replace",
      },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    const staged = store.resolve(parsed.ref);
    assert.ok(staged);
    assert.equal(staged!.type, "config_update");
    assert.equal((staged as { file: string }).file, "dev/changes.md");
    assert.equal((staged as { content: string }).content, "my content");
  });

  // --- Recorder ---

  it("records the tool call on success", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder, deps);

    await toolDef.handler(
      {
        file: "user/identity.md",
        content: "content",
        operation: "replace",
      },
      { sessionId: "test" },
    );

    assert.equal(recorder.calls.length, 1);
    assert.equal(recorder.calls[0].tool, "propose_config_update");
    const resultData = recorder.calls[0].result as { ref: string; file: string; status: string };
    assert.ok(resultData.ref);
    assert.equal(resultData.file, "user/identity.md");
  });
});
