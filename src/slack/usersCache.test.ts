import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import { createUsersCache } from "./usersCache.js";
import type { SlackUserEntry } from "./usersCache.js";

// ---------------------------------------------------------------------------
// Mock Slack client that returns a fixed list of members
// ---------------------------------------------------------------------------

interface FakeMember {
  id: string;
  name: string;
  profile: { display_name?: string; real_name?: string };
  deleted?: boolean;
  is_bot?: boolean;
}

function makeClient(members: FakeMember[]): App["client"] {
  return {
    users: {
      list: async () => ({
        ok: true,
        members,
        response_metadata: { next_cursor: "" },
      }),
    },
  } as unknown as App["client"];
}

const MEMBERS: FakeMember[] = [
  { id: "U001", name: "alice", profile: { display_name: "Alice Anderson" } },
  { id: "U002", name: "bob", profile: { display_name: "Bob Baker" } },
  { id: "U003", name: "charlie", profile: { display_name: "", real_name: "Charlie Chen" } },
  { id: "U004", name: "diana.prince", profile: { display_name: "Diana Prince" } },
  { id: "U005", name: "eve_online", profile: { display_name: "Eve Online" } },
  // Filtered out:
  { id: "U006", name: "deleted_user", profile: { display_name: "Gone" }, deleted: true },
  { id: "U007", name: "botuser", profile: { display_name: "Bot" }, is_bot: true },
  { id: "USLACKBOT", name: "slackbot", profile: { display_name: "Slackbot" } },
];

// ---------------------------------------------------------------------------
// search — exercises buildMatcher internally
// ---------------------------------------------------------------------------

describe("UsersCache.search", () => {
  it("finds user by exact userId (case-insensitive)", async () => {
    const cache = createUsersCache(makeClient(MEMBERS));
    const results = await cache.search(["u001"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].userId, "U001");
  });

  it("finds user by substring of username", async () => {
    const cache = createUsersCache(makeClient(MEMBERS));
    const results = await cache.search(["ali"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].username, "alice");
  });

  it("finds user by substring of displayName", async () => {
    const cache = createUsersCache(makeClient(MEMBERS));
    const results = await cache.search(["Anderson"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].displayName, "Alice Anderson");
  });

  it("substring matching is case-insensitive", async () => {
    const cache = createUsersCache(makeClient(MEMBERS));
    const results = await cache.search(["BOB"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].username, "bob");
  });

  it("supports wildcard patterns", async () => {
    const cache = createUsersCache(makeClient(MEMBERS));
    // Matches "diana.prince" and nothing else
    const results = await cache.search(["diana*"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].username, "diana.prince");
  });

  it("supports wildcard in the middle", async () => {
    const cache = createUsersCache(makeClient(MEMBERS));
    // Matches usernames with underscore pattern: eve_online
    const results = await cache.search(["eve*online"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].username, "eve_online");
  });

  it("multiple queries are OR-ed together", async () => {
    const cache = createUsersCache(makeClient(MEMBERS));
    const results = await cache.search(["alice", "bob"]);
    assert.equal(results.length, 2);
    const names = results.map((r) => r.username).sort();
    assert.deepEqual(names, ["alice", "bob"]);
  });

  it("deduplicates results when same user matches multiple queries", async () => {
    const cache = createUsersCache(makeClient(MEMBERS));
    // Both "alice" and "Anderson" match U001
    const results = await cache.search(["alice", "Anderson"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].userId, "U001");
  });

  it("respects limit parameter", async () => {
    const cache = createUsersCache(makeClient(MEMBERS));
    // All 5 active users have displayNames containing a space — broad substring match
    const results = await cache.search([" "], 2);
    assert.equal(results.length, 2);
  });

  it("uses default limit of 10", async () => {
    const cache = createUsersCache(makeClient(MEMBERS));
    // All 5 active users have displayNames containing a space
    const results = await cache.search([" "]);
    assert.equal(results.length, 5);
  });

  it("filters out deleted users, bots, and USLACKBOT", async () => {
    const cache = createUsersCache(makeClient(MEMBERS));
    // Try to find the filtered-out users
    const results = await cache.search(["deleted_user", "botuser", "USLACKBOT"]);
    assert.equal(results.length, 0);
  });

  it("falls back to real_name when display_name is empty", async () => {
    const cache = createUsersCache(makeClient(MEMBERS));
    const results = await cache.search(["charlie"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].displayName, "Charlie Chen");
  });

  it("returns empty array when no matches", async () => {
    const cache = createUsersCache(makeClient(MEMBERS));
    const results = await cache.search(["nonexistent_user_xyz"]);
    assert.equal(results.length, 0);
  });

  it("caches the user list and does not re-fetch", async () => {
    let fetchCount = 0;
    const client = {
      users: {
        list: async () => {
          fetchCount++;
          return {
            ok: true,
            members: MEMBERS,
            response_metadata: { next_cursor: "" },
          };
        },
      },
    } as unknown as App["client"];

    const cache = createUsersCache(client);
    await cache.search(["alice"]);
    await cache.search(["bob"]);
    await cache.search(["charlie"]);
    assert.equal(fetchCount, 1);
  });

  it("handles wildcard with special regex characters in query", async () => {
    // "diana.prince" has a dot — the wildcard matcher should escape it
    const cache = createUsersCache(makeClient(MEMBERS));
    const results = await cache.search(["diana.prince"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].username, "diana.prince");
  });
});
