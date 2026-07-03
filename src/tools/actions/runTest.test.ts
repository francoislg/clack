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

  it("stages a kind:'test' change intent resuming the remote branch by default", async () => {
    const ctx = makeCtx();
    const store = createIntentStore();
    const toolDef = createRunTestTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "feature/login-flow",
        repo: "my-repo",
        new_branch: undefined,
        test_focus: "exercise the login page",
      },
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

  it("stages resumeRemoteBranch: false when new_branch is true", async () => {
    const ctx = makeCtx();
    const store = createIntentStore();
    const toolDef = createRunTestTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "test/record-login-flow",
        repo: "my-repo",
        new_branch: true,
        test_focus: "record the login flow as it works today",
      },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(result.isError ?? false, false);
    const intent = store.resolve(String(parsed.ref));
    assert.ok(intent && intent.type === "change");
    assert.equal(intent.resumeRemoteBranch, false);
    assert.ok(intent.description.includes("fresh branch off main"));
    assert.ok(intent.description.includes("record the login flow as it works today"));
  });

  it("describes a fresh-branch run without test_focus using the repo default branch", async () => {
    const ctx = makeCtx({
      config: {
        repositories: [makeRepo({ branch: "master" })],
        tester: { enabled: true, sidecarUrl: "http://sidecar/mcp", recordingsDir: "/recordings" },
      } as QueryToolContext["config"],
    });
    const store = createIntentStore();
    const toolDef = createRunTestTool(ctx, store, deps);

    const result = await toolDef.handler(
      { branch: "test/smoke", repo: "my-repo", new_branch: true, test_focus: undefined },
      { sessionId: "test" },
    );

    const intent = store.resolve(String(parseToolResult(result).ref));
    assert.ok(intent && intent.type === "change");
    assert.equal(intent.description, "Test the app on a fresh branch off master");
  });

  it("stages resumeRemoteBranch: true when new_branch is omitted or false", async () => {
    const ctx = makeCtx();
    const store = createIntentStore();
    const toolDef = createRunTestTool(ctx, store, deps);

    const omitted = await toolDef.handler(
      { branch: "feature/x", repo: "my-repo", new_branch: undefined, test_focus: undefined },
      { sessionId: "test" },
    );
    const omittedIntent = store.resolve(String(parseToolResult(omitted).ref));
    assert.ok(omittedIntent && omittedIntent.type === "change");
    assert.equal(omittedIntent.resumeRemoteBranch, true);

    const explicit = await toolDef.handler(
      { branch: "feature/x", repo: "my-repo", new_branch: false, test_focus: undefined },
      { sessionId: "test" },
    );
    const explicitIntent = store.resolve(String(parseToolResult(explicit).ref));
    assert.ok(explicitIntent && explicitIntent.type === "change");
    assert.equal(explicitIntent.resumeRemoteBranch, true);
  });

  it("refuses the protected default branch even with new_branch: true", async () => {
    const ctx = makeCtx();
    const store = createIntentStore();
    const toolDef = createRunTestTool(ctx, store, deps);

    const result = await toolDef.handler(
      { branch: "main", repo: "my-repo", new_branch: true, test_focus: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(result.isError, true);
    assert.ok(parsed.error.includes("protected"));
  });

  it("does not require the clack/{type}/{name} branch convention", async () => {
    const ctx = makeCtx();
    const store = createIntentStore();
    const toolDef = createRunTestTool(ctx, store, deps);

    const result = await toolDef.handler(
      {
        branch: "someone-elses/pr-branch",
        repo: "my-repo",
        new_branch: undefined,
        test_focus: undefined,
      },
      { sessionId: "test" },
    );

    assert.equal(result.isError ?? false, false);
  });

  it("rejects an unknown repository", async () => {
    const ctx = makeCtx();
    const store = createIntentStore();
    const toolDef = createRunTestTool(ctx, store, deps);

    const result = await toolDef.handler(
      { branch: "feature/x", repo: "nope", new_branch: undefined, test_focus: undefined },
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
      { branch: "feature/x", repo: "my-repo", new_branch: undefined, test_focus: undefined },
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
      { branch: "main", repo: "my-repo", new_branch: undefined, test_focus: undefined },
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
      { branch: "feature/x", repo: "my-repo", new_branch: undefined, test_focus: undefined },
      { sessionId: "test" },
    );

    const parsed = parseToolResult(result);
    assert.equal(parsed.applied, false);
    assert.ok(String(parsed.instruction).includes("STAGED"));
  });
});
