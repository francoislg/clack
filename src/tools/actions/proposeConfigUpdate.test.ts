import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockListInstructionFiles = mock.fn<() => unknown[]>();
const mockReadInstructionFile = mock.fn<(filename: string) => string | null>();

mock.module("../../configurationFiles.js", {
  namedExports: {
    listInstructionFiles: mockListInstructionFiles,
    readInstructionFile: mockReadInstructionFile,
  },
});

// Import after mocks
const { createProposeConfigUpdateTool } = await import("./proposeConfigUpdate.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { QueryToolContext } from "../types.js";
import type { IntentStore, ToolCallRecorder } from "../server.js";

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
    } as unknown as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    ...overrides,
  };
}

function makeIntentStore(): IntentStore {
  const intents = new Map<string, unknown>();
  let counter = 0;
  return {
    stage: (intent: unknown) => {
      const ref = `ref-${++counter}`;
      intents.set(ref, intent);
      return ref;
    },
    resolve: (ref: string) => intents.get(ref) as ReturnType<IntentStore["resolve"]>,
    getAll: () => intents as ReturnType<IntentStore["getAll"]>,
  };
}

function makeRecorder(): ToolCallRecorder & { calls: Array<{ tool: string; args: unknown; result: unknown }> } {
  const calls: Array<{ tool: string; args: unknown; result: unknown }> = [];
  return {
    calls,
    record: (tool: string, args: Record<string, unknown>, result: Record<string, unknown>) => {
      calls.push({ tool, args, result });
    },
    getHistory: () => [],
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function makeFileInfo(filename: string, hasOverride = false, hasDefault = true) {
  return { filename, hasOverride, hasDefault };
}

function resetMocks() {
  mockListInstructionFiles.mock.resetCalls();
  mockReadInstructionFile.mock.resetCalls();

  mockListInstructionFiles.mock.mockImplementation(() => [
    makeFileInfo("instructions.md"),
    makeFileInfo("dev_instructions.md"),
    makeFileInfo("admin_instructions.md"),
  ]);
  mockReadInstructionFile.mock.mockImplementation(() => null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("proposeConfigUpdate tool", () => {
  beforeEach(resetMocks);

  // --- Unknown file ---

  it("returns error for unknown instruction file", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder);

    const result = await toolDef.handler({
      file: "nonexistent.md",
      content: "some content",
      operation: "append",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Unknown instruction file"));
    assert.ok(parsed.error.includes("nonexistent.md"));
    assert.ok(parsed.error.includes("instructions.md")); // lists available files
    assert.equal(result.isError, true);
  });

  it("records the error in the recorder for unknown file", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder);

    await toolDef.handler({
      file: "unknown.md",
      content: "content",
      operation: "append",
    }, { sessionId: "test" });

    assert.equal(recorder.calls.length, 1);
    assert.equal(recorder.calls[0].tool, "propose_config_update");
    assert.ok((recorder.calls[0].result as { error: string }).error);
  });

  // --- Append operation ---

  it("appends to existing content when file has content", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => "existing line 1\nexisting line 2");

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder);

    const result = await toolDef.handler({
      file: "instructions.md",
      content: "new content",
      operation: "append",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.ref);
    assert.equal(parsed.file, "instructions.md");

    // Verify the staged intent has appended content
    const staged = store.resolve(parsed.ref);
    assert.ok(staged);
    assert.equal(staged!.type, "config_update");
    assert.equal((staged as { content: string }).content, "existing line 1\nexisting line 2\n\nnew content");
  });

  it("trims trailing whitespace from existing content before appending", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => "existing content   \n\n  ");

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder);

    const result = await toolDef.handler({
      file: "instructions.md",
      content: "appended",
      operation: "append",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    const staged = store.resolve(parsed.ref) as { content: string };
    assert.equal(staged.content, "existing content\n\nappended");
  });

  it("uses content as-is when file has no existing content (append)", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => null);

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder);

    const result = await toolDef.handler({
      file: "instructions.md",
      content: "brand new content",
      operation: "append",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    const staged = store.resolve(parsed.ref) as { content: string };
    assert.equal(staged.content, "brand new content");
  });

  // --- Replace operation ---

  it("replaces content completely when operation is replace", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => "old content");

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder);

    const result = await toolDef.handler({
      file: "instructions.md",
      content: "completely new content",
      operation: "replace",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    const staged = store.resolve(parsed.ref) as { content: string };
    assert.equal(staged.content, "completely new content");
  });

  it("does not read existing content when operation is replace", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder);

    await toolDef.handler({
      file: "instructions.md",
      content: "replacement",
      operation: "replace",
    }, { sessionId: "test" });

    // readInstructionFile should not be called for replace
    assert.equal(mockReadInstructionFile.mock.callCount(), 0);
  });

  // --- Status field ---

  it("returns will_overwrite_custom status when file has an override", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => [
      makeFileInfo("instructions.md", true, true), // hasOverride=true
    ]);

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder);

    const result = await toolDef.handler({
      file: "instructions.md",
      content: "content",
      operation: "replace",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.status, "will_overwrite_custom");
  });

  it("returns will_override_default status when file has default but no override", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => [
      makeFileInfo("instructions.md", false, true), // hasOverride=false, hasDefault=true
    ]);

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder);

    const result = await toolDef.handler({
      file: "instructions.md",
      content: "content",
      operation: "replace",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.status, "will_override_default");
  });

  it("returns will_create_new status when file has no override and no default", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => [
      makeFileInfo("instructions.md", false, false),
    ]);

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder);

    const result = await toolDef.handler({
      file: "instructions.md",
      content: "content",
      operation: "replace",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.status, "will_create_new");
  });

  // --- Intent staging ---

  it("stages intent with correct type and file", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder);

    const result = await toolDef.handler({
      file: "instructions.md",
      content: "my content",
      operation: "replace",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    const staged = store.resolve(parsed.ref);
    assert.ok(staged);
    assert.equal(staged!.type, "config_update");
    assert.equal((staged as { file: string }).file, "instructions.md");
    assert.equal((staged as { content: string }).content, "my content");
  });

  // --- Recorder ---

  it("records the tool call on success", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder);

    await toolDef.handler({
      file: "instructions.md",
      content: "content",
      operation: "replace",
    }, { sessionId: "test" });

    assert.equal(recorder.calls.length, 1);
    assert.equal(recorder.calls[0].tool, "propose_config_update");
    const resultData = recorder.calls[0].result as { ref: string; file: string; status: string };
    assert.ok(resultData.ref);
    assert.equal(resultData.file, "instructions.md");
  });

  // --- Default operation ---

  it("defaults to append when operation is not specified", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => "existing");

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder);

    // Zod default kicks in — operation defaults to "append"
    const result = await toolDef.handler({
      file: "instructions.md",
      content: "added",
    } as { file: string; content: string; operation: "append" | "replace" }, { sessionId: "test" });

    const parsed = parseResult(result);
    const staged = store.resolve(parsed.ref) as { content: string };
    assert.equal(staged.content, "existing\n\nadded");
  });

  // --- Lists available files in error ---

  it("lists all available filenames in error message", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => [
      makeFileInfo("instructions.md"),
      makeFileInfo("dev_instructions.md"),
      makeFileInfo("admin_instructions.md"),
    ]);

    const ctx = makeCtx();
    const store = makeIntentStore();
    const recorder = makeRecorder();
    const toolDef = createProposeConfigUpdateTool(ctx, store, recorder);

    const result = await toolDef.handler({
      file: "bad.md",
      content: "x",
      operation: "append",
    }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("instructions.md"));
    assert.ok(parsed.error.includes("dev_instructions.md"));
    assert.ok(parsed.error.includes("admin_instructions.md"));
  });
});
