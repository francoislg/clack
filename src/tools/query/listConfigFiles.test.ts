import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockListInstructionFiles = mock.fn<() => unknown[]>();

mock.module("../../configurationFiles.js", {
  namedExports: {
    listInstructionFiles: mockListInstructionFiles,
  },
});

// Import after mocks
const { createListConfigFilesTool } = await import("./listConfigFiles.js");

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
  mockListInstructionFiles.mock.mockImplementation(() => []);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("listConfigFiles tool", () => {
  beforeEach(resetMocks);

  it("returns empty array when no instruction files exist", async () => {
    const ctx = makeCtx();
    const toolDef = createListConfigFilesTool(ctx);

    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.deepEqual(parsed, []);
  });

  it("maps files with overrides to 'customized' status", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => [
      { filename: "instructions.md", hasOverride: true, hasDefault: true },
    ]);

    const ctx = makeCtx();
    const toolDef = createListConfigFilesTool(ctx);

    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].filename, "instructions.md");
    assert.equal(parsed[0].status, "customized");
  });

  it("maps files with only defaults to 'default' status", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => [
      { filename: "dev_instructions.md", hasOverride: false, hasDefault: true },
    ]);

    const ctx = makeCtx();
    const toolDef = createListConfigFilesTool(ctx);

    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed[0].status, "default");
  });

  it("maps files with neither override nor default to 'missing' status", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => [
      { filename: "my-repo/changes_instructions.md", hasOverride: false, hasDefault: false },
    ]);

    const ctx = makeCtx();
    const toolDef = createListConfigFilesTool(ctx);

    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed[0].status, "missing");
  });

  it("returns all files with correct statuses", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => [
      { filename: "instructions.md", hasOverride: true, hasDefault: true },
      { filename: "dev_instructions.md", hasOverride: false, hasDefault: true },
      { filename: "admin_instructions.md", hasOverride: false, hasDefault: false },
      { filename: "my-repo/changes_instructions.md", hasOverride: true, hasDefault: false },
    ]);

    const ctx = makeCtx();
    const toolDef = createListConfigFilesTool(ctx);

    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.length, 4);
    assert.equal(parsed[0].status, "customized");
    assert.equal(parsed[1].status, "default");
    assert.equal(parsed[2].status, "missing");
    assert.equal(parsed[3].status, "customized");
  });

  it("only includes filename and status in output", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => [
      { filename: "instructions.md", hasOverride: true, hasDefault: true },
    ]);

    const ctx = makeCtx();
    const toolDef = createListConfigFilesTool(ctx);

    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    const keys = Object.keys(parsed[0]);
    assert.deepEqual(keys.sort(), ["filename", "status"]);
  });
});
