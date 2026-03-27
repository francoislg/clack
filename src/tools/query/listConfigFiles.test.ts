import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockListInstructionFiles = mock.fn<() => unknown>();

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
    allowScheduledMessages: false,
    ...overrides,
  };
}

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function resetMocks() {
  mockListInstructionFiles.mock.resetCalls();
  mockListInstructionFiles.mock.mockImplementation(() => ({ roles: [], repos: [] }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("listConfigFiles tool", () => {
  beforeEach(resetMocks);

  it("returns empty object when no instruction files exist", async () => {
    const ctx = makeCtx();
    const toolDef = createListConfigFilesTool(ctx);

    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.deepEqual(parsed, {});
  });

  it("returns role directories with file listings", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => ({
      roles: [
        { role: "user", files: [
          { filename: "identity.md", source: "default" },
          { filename: "response-style.md", source: "customized" },
        ]},
        { role: "dev", files: [
          { filename: "changes.md", source: "default" },
        ]},
      ],
      repos: [],
    }));

    const ctx = makeCtx();
    const toolDef = createListConfigFilesTool(ctx);

    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.user.length, 2);
    assert.equal(parsed.user[0].file, "identity.md");
    assert.equal(parsed.user[0].status, "default");
    assert.equal(parsed.user[1].status, "customized");
    assert.equal(parsed.dev.length, 1);
    assert.equal(parsed.dev[0].file, "changes.md");
  });

  it("includes repo files when present", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => ({
      roles: [],
      repos: [
        { filename: "my-repo/changes_instructions.md", hasOverride: false, hasDefault: true },
        { filename: "my-repo/worktree_setup_instructions.md", hasOverride: false, hasDefault: false },
      ],
    }));

    const ctx = makeCtx();
    const toolDef = createListConfigFilesTool(ctx);

    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.repos.length, 2);
    assert.equal(parsed.repos[0].status, "default");
    assert.equal(parsed.repos[1].status, "not_created");
  });

  it("includes custom-only files", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => ({
      roles: [
        { role: "user", files: [
          { filename: "company.md", source: "custom-only" },
        ]},
      ],
      repos: [],
    }));

    const ctx = makeCtx();
    const toolDef = createListConfigFilesTool(ctx);

    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.user[0].status, "custom-only");
  });

  it("omits repos key when no repo files exist", async () => {
    mockListInstructionFiles.mock.mockImplementation(() => ({
      roles: [{ role: "user", files: [{ filename: "identity.md", source: "default" }] }],
      repos: [],
    }));

    const ctx = makeCtx();
    const toolDef = createListConfigFilesTool(ctx);

    const result = await toolDef.handler({ _placeholder: undefined }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.repos, undefined);
  });
});
