import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { createFindUserTool } from "./findUser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { QueryToolContext } from "../types.js";
import { parseToolResult } from "../testHelpers.js";
import type {
  UsersCache,
  SlackUserEntry,
  UserSearchOptions,
  UserSearchResult,
} from "../../slack/usersCache.js";

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
      repositories: [],
    } as unknown as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    ...overrides,
  };
}

const mockSearch =
  vi.fn<(queries: string[], options?: UserSearchOptions) => Promise<UserSearchResult>>();

function makeUsersCache(): UsersCache {
  return { search: mockSearch };
}

function searchResult(entries: SlackUserEntry[], totalMatched = entries.length): UserSearchResult {
  return { entries, totalMatched };
}

function resetMocks() {
  mockSearch.mockClear();
  mockSearch.mockImplementation(async () => searchResult([]));
}

// Every arg key is passed explicitly (undefined for unset) — the SDK tool handler types
// the full arg object as required.
function args(over: {
  query: string[];
  limit?: number;
  offset?: number;
  includePluginData?: string[];
}) {
  return {
    query: over.query,
    limit: over.limit,
    offset: over.offset,
    includePluginData: over.includePluginData,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findUser tool", () => {
  beforeEach(resetMocks);

  it("returns cache entries with the pagination envelope", async () => {
    const users: SlackUserEntry[] = [
      {
        userId: "U100",
        username: "alice",
        displayName: "Alice A",
        avatarUrl: "https://x/alice.png",
        github: { username: "alice-gh" },
      },
      { userId: "U200", username: "bob", displayName: "Bob B", avatarUrl: "https://x/bob.png" },
    ];
    mockSearch.mockImplementation(async () => searchResult(users, 2));

    const toolDef = createFindUserTool(makeCtx(), makeUsersCache());
    const parsed = parseToolResult(
      await toolDef.handler(args({ query: ["alice", "bob"] }), { sessionId: "test" }),
    );

    assert.equal(parsed.totalCount, 2);
    assert.equal(parsed.offset, 0);
    assert.equal(parsed.hasMore, false);
    assert.equal(parsed.users.length, 2);
    assert.equal(parsed.users[0].userId, "U100");
    assert.deepEqual(parsed.users[0].github, { username: "alice-gh" });
    assert.equal(parsed.users[1].username, "bob");
  });

  it("forwards default offset/limit and empty plugin data to the cache", async () => {
    const toolDef = createFindUserTool(makeCtx(), makeUsersCache());
    await toolDef.handler(args({ query: ["test-query"] }), { sessionId: "test" });

    assert.equal(mockSearch.mock.calls.length, 1);
    const [queries, options] = mockSearch.mock.calls[0];
    assert.deepEqual(queries, ["test-query"]);
    assert.deepEqual(options, { offset: 0, limit: 10, includePluginData: [] });
  });

  it("forwards custom limit and offset to the cache", async () => {
    const toolDef = createFindUserTool(makeCtx(), makeUsersCache());
    await toolDef.handler(args({ query: ["someone"], limit: 5, offset: 20 }), {
      sessionId: "test",
    });

    const [, options] = mockSearch.mock.calls[0];
    assert.equal(options?.limit, 5);
    assert.equal(options?.offset, 20);
  });

  it("reports hasMore=true when more matches remain beyond the page", async () => {
    const page = Array.from({ length: 10 }, (_, i) => ({
      userId: `U${i}`,
      username: `user${i}`,
      displayName: `User ${i}`,
      avatarUrl: "",
    }));
    mockSearch.mockImplementation(async () => searchResult(page, 25));

    const toolDef = createFindUserTool(makeCtx(), makeUsersCache());
    const parsed = parseToolResult(
      await toolDef.handler(args({ query: ["user"] }), { sessionId: "test" }),
    );

    assert.equal(parsed.totalCount, 25);
    assert.equal(parsed.hasMore, true);
  });

  it("reports hasMore=false when the page reaches the end from an offset", async () => {
    const page = [{ userId: "U9", username: "z", displayName: "Z", avatarUrl: "" }];
    mockSearch.mockImplementation(async () => searchResult(page, 6));

    const toolDef = createFindUserTool(makeCtx(), makeUsersCache());
    const parsed = parseToolResult(
      await toolDef.handler(args({ query: ["z"], offset: 5 }), { sessionId: "test" }),
    );

    assert.equal(parsed.totalCount, 6);
    assert.equal(parsed.offset, 5);
    assert.equal(parsed.hasMore, false);
  });

  it("clamps a negative offset to 0", async () => {
    const toolDef = createFindUserTool(makeCtx(), makeUsersCache());
    const parsed = parseToolResult(
      await toolDef.handler(args({ query: ["a"], offset: -5 }), { sessionId: "test" }),
    );

    assert.equal(parsed.offset, 0);
    assert.equal(mockSearch.mock.calls[0][1]?.offset, 0);
  });

  it("falls back to the default limit when limit <= 0", async () => {
    const toolDef = createFindUserTool(makeCtx(), makeUsersCache());
    await toolDef.handler(args({ query: ["a"], limit: 0 }), { sessionId: "test" });

    assert.equal(mockSearch.mock.calls[0][1]?.limit, 10);
  });

  it("forwards includePluginData for a dev-role caller", async () => {
    const toolDef = createFindUserTool(makeCtx({ role: "dev" }), makeUsersCache());
    await toolDef.handler(args({ query: ["a"], includePluginData: ["trivia"] }), {
      sessionId: "test",
    });

    assert.deepEqual(mockSearch.mock.calls[0][1]?.includePluginData, ["trivia"]);
  });

  it("surfaces plugin data returned by the cache in the response", async () => {
    const users: SlackUserEntry[] = [
      {
        userId: "U100",
        username: "alice",
        displayName: "Alice A",
        avatarUrl: "",
        plugins: { trivia: { score: 42 } },
      },
    ];
    mockSearch.mockImplementation(async () => searchResult(users));

    const toolDef = createFindUserTool(makeCtx({ role: "dev" }), makeUsersCache());
    const parsed = parseToolResult(
      await toolDef.handler(args({ query: ["alice"], includePluginData: ["trivia"] }), {
        sessionId: "test",
      }),
    );

    assert.deepEqual(parsed.users[0].plugins, { trivia: { score: 42 } });
  });

  it("drops includePluginData for a below-dev caller", async () => {
    const toolDef = createFindUserTool(makeCtx({ role: "member" }), makeUsersCache());
    await toolDef.handler(args({ query: ["a"], includePluginData: ["trivia"] }), {
      sessionId: "test",
    });

    assert.deepEqual(mockSearch.mock.calls[0][1]?.includePluginData, []);
  });

  it("returns an empty envelope when no users match", async () => {
    const toolDef = createFindUserTool(makeCtx(), makeUsersCache());
    const parsed = parseToolResult(
      await toolDef.handler(args({ query: ["nonexistent"] }), { sessionId: "test" }),
    );

    assert.equal(parsed.totalCount, 0);
    assert.deepEqual(parsed.users, []);
    assert.equal(parsed.hasMore, false);
  });
});
