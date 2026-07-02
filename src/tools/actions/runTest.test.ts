import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { createRunTestTool, type RunTestDeps } from "./runTest.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import { createIntentStore } from "../server.js";
import type { RepositoryConfig } from "../../config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(overrides?: Partial<RepositoryConfig>): RepositoryConfig {
  return {
    name: "my-repo",
    url: "https://github.com/org/my-repo.git",
    description: "Test repo",
    branch: "main",
    access: { read: "member", write: "dev" },
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<RunTestDeps>): RunTestDeps {
  return {
    canWriteRepo: vi.fn(() => true),
    getWritableRepos: vi.fn(() => [makeRepo()]),
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<QueryToolContext>): QueryToolContext {
  return {
    mode: "query",
    userId: "U123",
    role: "dev",
    session: {
      sessionId: "sess-1",
      channelId: "C1",
      messageTs: "1.0",
      threadTs: "1.0",
      userId: "U123",
      trigger: { type: "mentions", userId: "U123", messageTs: "1.0", messageText: "test" },
      messages: [],
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    },
    config: {
      repositories: [makeRepo()],
      tester: { enabled: true, sidecarUrl: "http://sidecar/mcp", recordingsDir: "/recordings" },
    } as QueryToolContext["config"],
    changesWorkflowEnabled: true,
    cronUserSchedules: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runTest tool", () => {
  let deps: RunTestDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("stages a kind:'test' change intent with resumeRemoteBranch always set", async () => {
    const ctx = makeCtx();
    const store = createIntentStore();
    const toolDef = createRunTestTool(ctx, store, deps);

    const result = await toolDef.handler(
      { branch: "feature/login-flow", repo: "my-repo", test_focus: "exercise the login page" },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(result.isError ?? false, false);
    assert.ok(parsed.ref);
    const intent = store.resolve(String(parsed.ref));
    assert.ok(intent && intent.type === "change");
    assert.equal(intent.kind, "test");
    assert.equal(intent.branch, "feature/login-flow");
    assert.equal(intent.resumeRemoteBranch, true);
    assert.ok(intent.description.includes("exercise the login page"));
  });

  it("does not require the clack/{type}/{name} branch convention", async () => {
    const ctx = makeCtx();
    const store = createIntentStore();
    const toolDef = createRunTestTool(ctx, store, deps);

    const result = await toolDef.handler(
      { branch: "someone-elses/pr-branch", repo: "my-repo", test_focus: undefined },
      { sessionId: "test" },
    );

    assert.equal(result.isError ?? false, false);
  });

  it("rejects an unknown repository", async () => {
    const ctx = makeCtx();
    const store = createIntentStore();
    const toolDef = createRunTestTool(ctx, store, deps);

    const result = await toolDef.handler(
      { branch: "feature/x", repo: "nope", test_focus: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(result.isError, true);
    assert.ok(parsed.error.includes("not found"));
  });

  it("rejects users without write access", async () => {
    const ctx = makeCtx();
    const store = createIntentStore();
    const toolDef = createRunTestTool(ctx, store, makeDeps({ canWriteRepo: vi.fn(() => false) }));

    const result = await toolDef.handler(
      { branch: "feature/x", repo: "my-repo", test_focus: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(result.isError, true);
    assert.ok(parsed.error.includes("write access"));
  });

  it("refuses to test the protected default branch", async () => {
    const ctx = makeCtx();
    const store = createIntentStore();
    const toolDef = createRunTestTool(ctx, store, deps);

    const result = await toolDef.handler(
      { branch: "main", repo: "my-repo", test_focus: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(result.isError, true);
    assert.ok(parsed.error.includes("protected"));
  });

  it("marks the result as staged (not applied)", async () => {
    const ctx = makeCtx();
    const store = createIntentStore();
    const toolDef = createRunTestTool(ctx, store, deps);

    const result = await toolDef.handler(
      { branch: "feature/x", repo: "my-repo", test_focus: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.applied, false);
    assert.ok(String(parsed.instruction).includes("STAGED"));
  });
});
