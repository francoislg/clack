import { describe, it, mock } from "node:test";
import { parseToolResult } from "../testHelpers.js";
import assert from "node:assert/strict";
import { createReadConfigFileTool, type ReadConfigFileDeps } from "./readConfigFile.js";
import type { QueryToolContext } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeSession = {
  sessionId: "test-session",
  channelId: "C1",
  threadTs: "1.0",
};
const fakeConfig = {};

function makeCtx(): QueryToolContext {
  return {
    mode: "query",
    userId: "U123",
    role: "admin",
    session: fakeSession as QueryToolContext["session"],
    config: fakeConfig as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
  };
}

function makeDeps(overrides: Partial<ReadConfigFileDeps> = {}): ReadConfigFileDeps {
  return {
    readInstructionFile: mock.fn<ReadConfigFileDeps["readInstructionFile"]>(() => ({
      default_content: "file content",
      custom_content: null,
    })),
    ...overrides,
  };
}

function callTool(
  ctx: QueryToolContext,
  deps: ReadConfigFileDeps,
  args: { role: "user" | "dev" | "admin" | "owner"; topic?: string; file: string },
) {
  const toolDef = createReadConfigFileTool(ctx, deps);
  return toolDef.handler(
    { role: args.role, topic: args.topic, file: args.file },
    { sessionId: "test" },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readConfigFile tool", () => {
  it("returns error when file is not found (both null)", async () => {
    const deps = makeDeps({
      readInstructionFile: mock.fn<ReadConfigFileDeps["readInstructionFile"]>(() => ({
        default_content: null,
        custom_content: null,
      })),
    });

    const result = await callTool(makeCtx(), deps, {
      role: "user",
      file: "nonexistent.md",
    });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not found"));
    assert.ok(parsed.error.includes("user/nonexistent.md"));
    assert.equal(result.isError, true);
  });

  it("reads a baseline file with only default content", async () => {
    const deps = makeDeps({
      readInstructionFile: mock.fn<ReadConfigFileDeps["readInstructionFile"]>(() => ({
        default_content: "# Default Instructions\nBe helpful.",
        custom_content: null,
      })),
    });

    const result = await callTool(makeCtx(), deps, {
      role: "user",
      file: "identity.md",
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.file, "user/identity.md");
    assert.equal(parsed.default_content, "# Default Instructions\nBe helpful.");
    assert.equal(parsed.custom_content, null);
    assert.equal(result.isError, undefined);
  });

  it("reads a baseline file with both default and custom content", async () => {
    const deps = makeDeps({
      readInstructionFile: mock.fn<ReadConfigFileDeps["readInstructionFile"]>(() => ({
        default_content: "Default instructions",
        custom_content: "Custom instructions",
      })),
    });

    const result = await callTool(makeCtx(), deps, {
      role: "user",
      file: "identity.md",
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.file, "user/identity.md");
    assert.equal(parsed.default_content, "Default instructions");
    assert.equal(parsed.custom_content, "Custom instructions");
  });

  it("reads a baseline file with only custom content (custom-only)", async () => {
    const deps = makeDeps({
      readInstructionFile: mock.fn<ReadConfigFileDeps["readInstructionFile"]>(() => ({
        default_content: null,
        custom_content: "Custom only content",
      })),
    });

    const result = await callTool(makeCtx(), deps, {
      role: "dev",
      file: "custom-rule.md",
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.file, "dev/custom-rule.md");
    assert.equal(parsed.default_content, null);
    assert.equal(parsed.custom_content, "Custom only content");
    assert.equal(result.isError, undefined);
  });

  it("reads a topic-scoped file via the topic field", async () => {
    const mockReadInstructionFile = mock.fn<ReadConfigFileDeps["readInstructionFile"]>(() => ({
      default_content: "topic default",
      custom_content: "topic override",
    }));
    const deps = makeDeps({ readInstructionFile: mockReadInstructionFile });

    const result = await callTool(makeCtx(), deps, {
      role: "dev",
      topic: "metabase",
      file: "rules.md",
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.file, "dev/topics/metabase/rules.md");
    assert.equal(parsed.default_content, "topic default");
    assert.equal(parsed.custom_content, "topic override");
    assert.equal(
      mockReadInstructionFile.mock.calls[0].arguments[0],
      "dev/topics/metabase/rules.md",
    );
  });

  it("composes the path with role/file when no topic is passed", async () => {
    const mockReadInstructionFile = mock.fn<ReadConfigFileDeps["readInstructionFile"]>(() => ({
      default_content: "content",
      custom_content: null,
    }));
    const deps = makeDeps({ readInstructionFile: mockReadInstructionFile });

    await callTool(makeCtx(), deps, {
      role: "dev",
      file: "changes.md",
    });

    assert.equal(mockReadInstructionFile.mock.callCount(), 1);
    assert.equal(mockReadInstructionFile.mock.calls[0].arguments[0], "dev/changes.md");
  });
});
