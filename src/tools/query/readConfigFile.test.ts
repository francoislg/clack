import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockReadInstructionFile =
  mock.fn<
    (filename: string) => { default_content: string | null; custom_content: string | null }
  >();
const mockBuildRoleChain = mock.fn<(role: string, changesWorkflowEnabled: boolean) => string[]>();
const mockResolveInstructions = mock.fn<(roleChain: string[]) => string>();

mock.module("../../configurationFiles.js", {
  namedExports: {
    readInstructionFile: mockReadInstructionFile,
  },
});

mock.module("../../cascadingConfigResolver.js", {
  namedExports: {
    buildRoleChain: mockBuildRoleChain,
    resolveInstructions: mockResolveInstructions,
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
    allowScheduledMessages: false,
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function resetMocks() {
  mockReadInstructionFile.mock.resetCalls();
  mockBuildRoleChain.mock.resetCalls();
  mockResolveInstructions.mock.resetCalls();

  mockReadInstructionFile.mock.mockImplementation(() => ({
    default_content: "file content",
    custom_content: null,
  }));
  mockBuildRoleChain.mock.mockImplementation(() => ["user"]);
  mockResolveInstructions.mock.mockImplementation(() => "resolved content");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readConfigFile tool", () => {
  beforeEach(resetMocks);

  it("returns error when file is not found (both null)", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => ({
      default_content: null,
      custom_content: null,
    }));

    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    const result = await toolDef.handler(
      { file: "nonexistent.md", changesWorkflowEnabled: true },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not found"));
    assert.ok(parsed.error.includes("nonexistent.md"));
    assert.equal(result.isError, true);
  });

  it("reads a file with only default content", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => ({
      default_content: "# Default Instructions\nBe helpful.",
      custom_content: null,
    }));

    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    const result = await toolDef.handler(
      { file: "user/identity.md", changesWorkflowEnabled: true },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.file, "user/identity.md");
    assert.equal(parsed.default_content, "# Default Instructions\nBe helpful.");
    assert.equal(parsed.custom_content, null);
    assert.equal(result.isError, undefined);
  });

  it("reads a file with both default and custom content", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => ({
      default_content: "Default instructions",
      custom_content: "Custom instructions",
    }));

    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    const result = await toolDef.handler(
      { file: "user/identity.md", changesWorkflowEnabled: true },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.file, "user/identity.md");
    assert.equal(parsed.default_content, "Default instructions");
    assert.equal(parsed.custom_content, "Custom instructions");
  });

  it("reads a file with only custom content (custom-only)", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => ({
      default_content: null,
      custom_content: "Custom only content",
    }));

    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    const result = await toolDef.handler(
      { file: "dev/custom-rule.md", changesWorkflowEnabled: true },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.file, "dev/custom-rule.md");
    assert.equal(parsed.default_content, null);
    assert.equal(parsed.custom_content, "Custom only content");
    assert.equal(result.isError, undefined);
  });

  it("calls readInstructionFile with the correct filename", async () => {
    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    await toolDef.handler(
      { file: "dev/changes.md", changesWorkflowEnabled: true },
      { sessionId: "test" },
    );

    assert.equal(mockReadInstructionFile.mock.callCount(), 1);
    assert.equal(mockReadInstructionFile.mock.calls[0].arguments[0], "dev/changes.md");
  });

  it("suggests role/filename format in error message", async () => {
    mockReadInstructionFile.mock.mockImplementation(() => ({
      default_content: null,
      custom_content: null,
    }));

    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    const result = await toolDef.handler(
      { file: "unknown.md", changesWorkflowEnabled: true },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error.includes("user/identity.md"));
  });

  it("returns resolved view when file is a valid role name", async () => {
    mockBuildRoleChain.mock.mockImplementation(() => ["user", "dev"]);
    mockResolveInstructions.mock.mockImplementation(() => "All resolved instructions for dev");

    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    const result = await toolDef.handler(
      { file: "dev", changesWorkflowEnabled: true },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.view, "resolved");
    assert.equal(parsed.role, "dev");
    assert.deepEqual(parsed.roleChain, ["user", "dev"]);
    assert.equal(parsed.content, "All resolved instructions for dev");
    assert.equal(result.isError, undefined);

    assert.equal(mockBuildRoleChain.mock.callCount(), 1);
    assert.equal(mockBuildRoleChain.mock.calls[0].arguments[0], "dev");
    assert.equal(mockBuildRoleChain.mock.calls[0].arguments[1], true);
  });

  it("passes changesWorkflowEnabled to buildRoleChain for resolved view", async () => {
    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    await toolDef.handler({ file: "admin", changesWorkflowEnabled: false }, { sessionId: "test" });

    assert.equal(mockBuildRoleChain.mock.callCount(), 1);
    assert.equal(mockBuildRoleChain.mock.calls[0].arguments[1], false);
  });

  it("does not call readInstructionFile for resolved view", async () => {
    const ctx = makeCtx();
    const toolDef = createReadConfigFileTool(ctx);

    await toolDef.handler({ file: "member", changesWorkflowEnabled: true }, { sessionId: "test" });

    assert.equal(mockReadInstructionFile.mock.callCount(), 0);
  });
});
