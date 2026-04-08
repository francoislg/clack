import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createFindUserTool } from "./findUser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { QueryToolContext } from "../types.js";
import type { UsersCache, SlackUserEntry } from "../../slack/usersCache.js";

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

const mockSearch = mock.fn<(queries: string[], limit?: number) => Promise<SlackUserEntry[]>>();

function makeUsersCache(): UsersCache {
  return { search: mockSearch };
}

function resetMocks() {
  mockSearch.mock.resetCalls();
  mockSearch.mock.mockImplementation(async () => []);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findUser tool", () => {
  beforeEach(resetMocks);

  it("returns users from cache search", async () => {
    const users = [
      { userId: "U100", username: "alice", displayName: "Alice A" },
      { userId: "U200", username: "bob", displayName: "Bob B" },
    ];
    mockSearch.mock.mockImplementation(async () => users);

    const ctx = makeCtx();
    const toolDef = createFindUserTool(ctx, makeUsersCache());

    const result = await toolDef.handler(
      { query: ["alice", "bob"], limit: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.total, 2);
    assert.equal(parsed.users.length, 2);
    assert.equal(parsed.truncated, false);
    assert.equal(parsed.users[0].userId, "U100");
    assert.equal(parsed.users[1].username, "bob");
  });

  it("passes query and default limit to cache", async () => {
    mockSearch.mock.mockImplementation(async () => []);

    const ctx = makeCtx();
    const toolDef = createFindUserTool(ctx, makeUsersCache());

    await toolDef.handler({ query: ["test-query"], limit: undefined }, { sessionId: "test" });

    assert.equal(mockSearch.mock.callCount(), 1);
    const call = mockSearch.mock.calls[0];
    assert.deepEqual(call.arguments[0], ["test-query"]);
    assert.equal(call.arguments[1], 10);
  });

  it("passes custom limit to cache", async () => {
    mockSearch.mock.mockImplementation(async () => []);

    const ctx = makeCtx();
    const toolDef = createFindUserTool(ctx, makeUsersCache());

    await toolDef.handler({ query: ["someone"], limit: 5 }, { sessionId: "test" });

    assert.equal(mockSearch.mock.callCount(), 1);
    assert.equal(mockSearch.mock.calls[0].arguments[1], 5);
  });

  it("sets truncated=true when results hit the limit", async () => {
    const users = Array.from({ length: 10 }, (_, i) => ({
      userId: `U${i}`,
      username: `user${i}`,
      displayName: `User ${i}`,
    }));
    mockSearch.mock.mockImplementation(async () => users);

    const ctx = makeCtx();
    const toolDef = createFindUserTool(ctx, makeUsersCache());

    const result = await toolDef.handler(
      { query: ["user"], limit: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.total, 10);
    assert.equal(parsed.truncated, true);
  });

  it("sets truncated=true when results match custom limit", async () => {
    const users = [
      { userId: "U1", username: "a", displayName: "A" },
      { userId: "U2", username: "b", displayName: "B" },
      { userId: "U3", username: "c", displayName: "C" },
    ];
    mockSearch.mock.mockImplementation(async () => users);

    const ctx = makeCtx();
    const toolDef = createFindUserTool(ctx, makeUsersCache());

    const result = await toolDef.handler({ query: ["test"], limit: 3 }, { sessionId: "test" });

    const parsed = parseResult(result);
    assert.equal(parsed.truncated, true);
  });

  it("sets truncated=false when results are below the limit", async () => {
    const users = [{ userId: "U1", username: "solo", displayName: "Solo" }];
    mockSearch.mock.mockImplementation(async () => users);

    const ctx = makeCtx();
    const toolDef = createFindUserTool(ctx, makeUsersCache());

    const result = await toolDef.handler(
      { query: ["solo"], limit: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.total, 1);
    assert.equal(parsed.truncated, false);
  });

  it("returns empty when no users match", async () => {
    mockSearch.mock.mockImplementation(async () => []);

    const ctx = makeCtx();
    const toolDef = createFindUserTool(ctx, makeUsersCache());

    const result = await toolDef.handler(
      { query: ["nonexistent"], limit: undefined },
      { sessionId: "test" },
    );

    const parsed = parseResult(result);
    assert.equal(parsed.total, 0);
    assert.deepEqual(parsed.users, []);
    assert.equal(parsed.truncated, false);
  });
});
