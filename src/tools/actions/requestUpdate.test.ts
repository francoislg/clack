import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequestUpdateTool } from "./requestUpdate.js";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";
import type { ActiveChangeState } from "../../changes/activeState.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActiveChange(overrides?: Partial<ActiveChangeState>): ActiveChangeState {
  return {
    branch: "clack/fix/my-fix",
    repo: "my-repo",
    description: "Fix something",
    status: "executing",
    startedAt: new Date(),
    lastActivityAt: new Date(),
    worktree: {
      repoName: "my-repo",
      branchName: "clack/fix/my-fix",
      worktreePath: "/tmp/worktrees/my-repo/clack-fix-my-fix",
      createdAt: new Date(),
    },
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
      activeChange: makeActiveChange(),
    },
    config: {
      repositories: [],
    } as never as QueryToolContext["config"],
    changesWorkflowEnabled: true,
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

function parseResult(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("requestUpdate tool", () => {
  it("returns error when there is no active change", async () => {
    const ctx = makeCtx({
      session: {
        ...makeCtx().session,
        activeChange: undefined,
      },
    });
    const store = makeIntentStore();
    const toolDef = createRequestUpdateTool(ctx, store);

    const result = await toolDef.handler(
      { instructions: "Fix the tests", userFeedback: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("No active change"));
    assert.equal(result.isError, true);
  });

  it("returns error when active change has no worktree", async () => {
    const ctx = makeCtx({
      session: {
        ...makeCtx().session,
        activeChange: makeActiveChange({ worktree: undefined }),
      },
    });
    const store = makeIntentStore();
    const toolDef = createRequestUpdateTool(ctx, store);

    const result = await toolDef.handler(
      { instructions: "Fix the tests", userFeedback: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.error);
    assert.ok(parsed.error.includes("No worktree"));
    assert.equal(result.isError, true);
  });

  it("stages update intent and returns ref on success", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createRequestUpdateTool(ctx, store);

    const result = await toolDef.handler(
      { instructions: "Add tests for the login module", userFeedback: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.ok(parsed.ref);
    assert.equal(parsed.sessionId, "sess-1");
    assert.equal(parsed.instructions, "Add tests for the login module");
    assert.equal(result.isError, undefined);

    // Verify the intent was staged
    const staged = store.resolve(parsed.ref);
    assert.ok(staged);
    assert.equal(staged!.type, "update");
  });

  it("forwards userFeedback into the staged intent", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createRequestUpdateTool(ctx, store);

    const feedback = "you missed the login form, please fix it";
    const result = await toolDef.handler(
      { instructions: "Add login form validation", userFeedback: feedback },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.userFeedback, feedback);

    const staged = store.resolve(parsed.ref) as { userFeedback?: string };
    assert.equal(staged.userFeedback, feedback);
  });

  it("omits userFeedback from the staged intent when not provided", async () => {
    const ctx = makeCtx();
    const store = makeIntentStore();
    const toolDef = createRequestUpdateTool(ctx, store);

    const result = await toolDef.handler(
      { instructions: "Add login form validation", userFeedback: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.userFeedback, undefined);

    const staged = store.resolve(parsed.ref) as { userFeedback?: string };
    assert.ok(!("userFeedback" in staged));
  });

  // Recording is handled uniformly by `wrapToolForRecording` in buildQueryTools — see
  // server.test.ts `wrapToolForRecording` describe block for coverage. No per-tool
  // recording tests needed here.

  it("uses the session ID from context", async () => {
    const ctx = makeCtx({
      session: {
        ...makeCtx().session,
        sessionId: "custom-session-42",
      },
    });
    const store = makeIntentStore();
    const toolDef = createRequestUpdateTool(ctx, store);

    const result = await toolDef.handler(
      { instructions: "Update styles", userFeedback: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.sessionId, "custom-session-42");

    const staged = store.resolve(parsed.ref);
    assert.ok(staged);
    assert.equal((staged as { sessionId: string }).sessionId, "custom-session-42");
  });
});
