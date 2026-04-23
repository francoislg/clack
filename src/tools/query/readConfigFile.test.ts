import { describe, it, mock } from "node:test";
import { parseToolResult } from "../testHelpers.js";
import assert from "node:assert/strict";
import { createReadConfigFileTool, type ReadConfigFileDeps } from "./readConfigFile.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestCtx {
  mode: "query";
  userId: string;
  role: string;
}

function makeCtx(): TestCtx {
  return {
    mode: "query",
    userId: "U123",
    role: "admin",
  };
}

function makeDeps(overrides: Partial<ReadConfigFileDeps> = {}): ReadConfigFileDeps {
  return {
    readInstructionFile: mock.fn(() => ({
      default_content: "file content",
      custom_content: null,
    })) as ReadConfigFileDeps["readInstructionFile"],
    buildRoleChain: mock.fn(() => ["user"]) as ReadConfigFileDeps["buildRoleChain"],
    resolveInstructions: mock.fn(
      () => "resolved content",
    ) as ReadConfigFileDeps["resolveInstructions"],
    ...overrides,
  };
}

function callTool(
  ctx: TestCtx,
  deps: ReadConfigFileDeps,
  args: { file: string; changesWorkflowEnabled: boolean },
) {
  const toolDef = createReadConfigFileTool(ctx as never, deps);
  return toolDef.handler(args, { sessionId: "test" });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readConfigFile tool", () => {
  it("returns error when file is not found (both null)", async () => {
    const deps = makeDeps({
      readInstructionFile: mock.fn(() => ({
        default_content: null,
        custom_content: null,
      })) as ReadConfigFileDeps["readInstructionFile"],
    });

    const result = await callTool(makeCtx(), deps, {
      file: "nonexistent.md",
      changesWorkflowEnabled: true,
    });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("not found"));
    assert.ok(parsed.error.includes("nonexistent.md"));
    assert.equal(result.isError, true);
  });

  it("reads a file with only default content", async () => {
    const deps = makeDeps({
      readInstructionFile: mock.fn(() => ({
        default_content: "# Default Instructions\nBe helpful.",
        custom_content: null,
      })) as ReadConfigFileDeps["readInstructionFile"],
    });

    const result = await callTool(makeCtx(), deps, {
      file: "user/identity.md",
      changesWorkflowEnabled: true,
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.file, "user/identity.md");
    assert.equal(parsed.default_content, "# Default Instructions\nBe helpful.");
    assert.equal(parsed.custom_content, null);
    assert.equal(result.isError, undefined);
  });

  it("reads a file with both default and custom content", async () => {
    const deps = makeDeps({
      readInstructionFile: mock.fn(() => ({
        default_content: "Default instructions",
        custom_content: "Custom instructions",
      })) as ReadConfigFileDeps["readInstructionFile"],
    });

    const result = await callTool(makeCtx(), deps, {
      file: "user/identity.md",
      changesWorkflowEnabled: true,
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.file, "user/identity.md");
    assert.equal(parsed.default_content, "Default instructions");
    assert.equal(parsed.custom_content, "Custom instructions");
  });

  it("reads a file with only custom content (custom-only)", async () => {
    const deps = makeDeps({
      readInstructionFile: mock.fn(() => ({
        default_content: null,
        custom_content: "Custom only content",
      })) as ReadConfigFileDeps["readInstructionFile"],
    });

    const result = await callTool(makeCtx(), deps, {
      file: "dev/custom-rule.md",
      changesWorkflowEnabled: true,
    });

    const parsed = parseToolResult(result);
    assert.equal(parsed.file, "dev/custom-rule.md");
    assert.equal(parsed.default_content, null);
    assert.equal(parsed.custom_content, "Custom only content");
    assert.equal(result.isError, undefined);
  });

  it("calls readInstructionFile with the correct filename", async () => {
    const mockReadInstructionFile = mock.fn<ReadConfigFileDeps["readInstructionFile"]>(
      (_filepath) => ({
        default_content: "file content",
        custom_content: null,
      }),
    );
    const deps = makeDeps({ readInstructionFile: mockReadInstructionFile });

    await callTool(makeCtx(), deps, {
      file: "dev/changes.md",
      changesWorkflowEnabled: true,
    });

    assert.equal(mockReadInstructionFile.mock.callCount(), 1);
    assert.equal(mockReadInstructionFile.mock.calls[0].arguments[0], "dev/changes.md");
  });

  it("suggests role/filename format in error message", async () => {
    const deps = makeDeps({
      readInstructionFile: mock.fn(() => ({
        default_content: null,
        custom_content: null,
      })) as ReadConfigFileDeps["readInstructionFile"],
    });

    const result = await callTool(makeCtx(), deps, {
      file: "unknown.md",
      changesWorkflowEnabled: true,
    });

    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("user/identity.md"));
  });

  it("returns resolved view when file is a valid role name", async () => {
    const mockBuildRoleChain = mock.fn<ReadConfigFileDeps["buildRoleChain"]>((_role, _cwe) => [
      "user",
      "dev",
    ]);
    const mockResolveInstructions = mock.fn<ReadConfigFileDeps["resolveInstructions"]>(
      (_chain) => "All resolved instructions for dev",
    );

    const deps = makeDeps({
      buildRoleChain: mockBuildRoleChain,
      resolveInstructions: mockResolveInstructions,
    });

    const result = await callTool(makeCtx(), deps, {
      file: "dev",
      changesWorkflowEnabled: true,
    });

    const parsed = parseToolResult(result);
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
    const mockBuildRoleChain = mock.fn<ReadConfigFileDeps["buildRoleChain"]>((_role, _cwe) => [
      "user",
    ]);
    const deps = makeDeps({ buildRoleChain: mockBuildRoleChain });

    await callTool(makeCtx(), deps, {
      file: "admin",
      changesWorkflowEnabled: false,
    });

    assert.equal(mockBuildRoleChain.mock.callCount(), 1);
    assert.equal(mockBuildRoleChain.mock.calls[0].arguments[1], false);
  });

  it("does not call readInstructionFile for resolved view", async () => {
    const mockReadInstructionFile = mock.fn<ReadConfigFileDeps["readInstructionFile"]>(
      (_filepath) => ({
        default_content: "file content",
        custom_content: null,
      }),
    );
    const deps = makeDeps({ readInstructionFile: mockReadInstructionFile });

    await callTool(makeCtx(), deps, {
      file: "member",
      changesWorkflowEnabled: true,
    });

    assert.equal(mockReadInstructionFile.mock.callCount(), 0);
  });
});
