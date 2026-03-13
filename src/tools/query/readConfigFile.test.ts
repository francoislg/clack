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
const { createReadConfigFileTool } = await import("./readConfigFile.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { QueryToolContext } from "../types.js";

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

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function resetMocks() {
  mockListInstructionFiles.mock.resetCalls();
  mockReadInstructionFile.mock.resetCalls();

  mockListInstructionFiles.mock.mockImplementation(() => [
    { filename: "instructions.md", hasOverride: false, hasDefault: true },
    { filename: "dev_instructions.md", hasOverride: true, hasDefault: true },
  ]);
  mockReadInstructionFile.mock.mockImplementation(() => "file content");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readConfigFile tool", () => {
  beforeEach(resetMocks);

  it("returns error for unknown file", async () => {
    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    const result = await toolDef.handler({ file: "nonexistent.md" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("Unknown instruction file"));
    assert.ok(parsed.error.includes("nonexistent.md"));
    assert.ok(parsed.error.includes("instructions.md"));
    assert.ok(parsed.error.includes("dev_instructions.md"));
    assert.equal(result.isError, true);
  });

  it("reads a file with default content (no override)", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => "# Default Instructions\nBe helpful.");

    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    const result = await toolDef.handler({ file: "instructions.md" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.file, "instructions.md");
    assert.equal(parsed.hasOverride, false);
    assert.equal(parsed.hasDefault, true);
    assert.equal(parsed.status, "default");
    assert.equal(parsed.content, "# Default Instructions\nBe helpful.");
    assert.equal(result.isError, undefined);
  });

  it("reads a customized file (has override)", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => "Custom instructions");

    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    const result = await toolDef.handler({ file: "dev_instructions.md" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.file, "dev_instructions.md");
    assert.equal(parsed.hasOverride, true);
    assert.equal(parsed.hasDefault, true);
    assert.equal(parsed.status, "customized");
  });

  it("returns not_created status when file has neither override nor default", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => [
      { filename: "missing.md", hasOverride: false, hasDefault: false },
    ]);
    mockReadInstructionFile.mock.mockImplementation(() => null);

    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    const result = await toolDef.handler({ file: "missing.md" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.status, "not_created");
    assert.equal(parsed.content, "");
  });

  it("returns empty string when readInstructionFile returns null", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => null);

    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    const result = await toolDef.handler({ file: "instructions.md" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.content, "");
  });

  it("calls readInstructionFile with the correct filename", async () => {
    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    await toolDef.handler({ file: "dev_instructions.md" }, { sessionId: "test" });

    assert.equal(mockReadInstructionFile.mock.callCount(), 1);
    assert.equal(mockReadInstructionFile.mock.calls[0].arguments[0], "dev_instructions.md");
  });

  it("lists available files in error message", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => [
      { filename: "a.md", hasOverride: false, hasDefault: true },
      { filename: "b.md", hasOverride: false, hasDefault: true },
      { filename: "c.md", hasOverride: false, hasDefault: true },
    ]);

    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    const result = await toolDef.handler({ file: "unknown.md" }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("a.md"));
    assert.ok(parsed.error.includes("b.md"));
    assert.ok(parsed.error.includes("c.md"));
  });
});
