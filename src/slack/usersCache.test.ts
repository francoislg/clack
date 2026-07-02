import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import { createUsersCache, type UserRegistryReader } from "./usersCache.js";
import type { UserRecord } from "../userRegistry.js";

// ---------------------------------------------------------------------------
// Mock Slack client that returns a fixed list of members
// ---------------------------------------------------------------------------

interface FakeMember {
  id: string;
  name: string;
  profile: {
    display_name?: string;
    real_name?: string;
    image_original?: string;
    image_512?: string;
  };
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

// Registry is an outside dependency — always injected so a unit test never touches disk.
const EMPTY_REGISTRY: UserRegistryReader = { getUserRecord: async () => null };

function makeRegistry(records: { [userId: string]: UserRecord }): UserRegistryReader {
  return { getUserRecord: async (userId) => records[userId] ?? null };
}

function makeCache(members: FakeMember[], registry: UserRegistryReader = EMPTY_REGISTRY) {
  return createUsersCache(makeClient(members), registry);
}

const MEMBERS: FakeMember[] = [
  {
    id: "U001",
    name: "alice",
    profile: {
      display_name: "Alice Anderson",
      image_original: "https://cdn.example.com/alice-orig.png",
      image_512: "https://cdn.example.com/alice-512.png",
    },
  },
  {
    id: "U002",
    name: "bob",
    profile: { display_name: "Bob Baker", image_512: "https://cdn.example.com/bob-512.png" },
  },
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
    const cache = makeCache(MEMBERS);
    const { entries: results } = await cache.search(["u001"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].userId, "U001");
  });

  it("finds user by substring of username", async () => {
    const cache = makeCache(MEMBERS);
    const { entries: results } = await cache.search(["ali"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].username, "alice");
  });

  it("never matches a wildcard against userId (userId is exact-only)", async () => {
    // Every roster id starts with "U", but "U*" must not match any of them via userId.
    const cache = makeCache(MEMBERS);
    const { entries } = await cache.search(["U*"]);
    assert.equal(entries.length, 0);
  });

  it("finds user by substring of displayName", async () => {
    const cache = makeCache(MEMBERS);
    const { entries: results } = await cache.search(["Anderson"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].displayName, "Alice Anderson");
  });

  it("substring matching is case-insensitive", async () => {
    const cache = makeCache(MEMBERS);
    const { entries: results } = await cache.search(["BOB"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].username, "bob");
  });

  it("supports wildcard patterns", async () => {
    const cache = makeCache(MEMBERS);
    // Matches "diana.prince" and nothing else
    const { entries: results } = await cache.search(["diana*"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].username, "diana.prince");
  });

  it("supports wildcard in the middle", async () => {
    const cache = makeCache(MEMBERS);
    // Matches usernames with underscore pattern: eve_online
    const { entries: results } = await cache.search(["eve*online"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].username, "eve_online");
  });

  it("multiple queries are OR-ed together", async () => {
    const cache = makeCache(MEMBERS);
    const { entries: results } = await cache.search(["alice", "bob"]);
    assert.equal(results.length, 2);
    const names = results.map((r) => r.username).sort();
    assert.deepEqual(names, ["alice", "bob"]);
  });

  it("deduplicates results when same user matches multiple queries", async () => {
    const cache = makeCache(MEMBERS);
    // Both "alice" and "Anderson" match U001
    const { entries: results } = await cache.search(["alice", "Anderson"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].userId, "U001");
  });

  it("respects limit parameter", async () => {
    const cache = makeCache(MEMBERS);
    // All 5 active users have displayNames containing a space — broad substring match
    const { entries: results } = await cache.search([" "], { limit: 2 });
    assert.equal(results.length, 2);
  });

  it("uses default limit of 10", async () => {
    const cache = makeCache(MEMBERS);
    // All 5 active users have displayNames containing a space
    const { entries: results } = await cache.search([" "]);
    assert.equal(results.length, 5);
  });

  it("filters out deleted users, bots, and USLACKBOT", async () => {
    const cache = makeCache(MEMBERS);
    // Try to find the filtered-out users
    const { entries: results } = await cache.search(["deleted_user", "botuser", "USLACKBOT"]);
    assert.equal(results.length, 0);
  });

  it("falls back to real_name when display_name is empty", async () => {
    const cache = makeCache(MEMBERS);
    const { entries: results } = await cache.search(["charlie"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].displayName, "Charlie Chen");
  });

  it("prefers image_original for avatarUrl when present", async () => {
    const cache = makeCache(MEMBERS);
    const { entries: results } = await cache.search(["alice"]);
    assert.equal(results[0].avatarUrl, "https://cdn.example.com/alice-orig.png");
  });

  it("falls back to image_512 when image_original is absent", async () => {
    const cache = makeCache(MEMBERS);
    const { entries: results } = await cache.search(["bob"]);
    assert.equal(results[0].avatarUrl, "https://cdn.example.com/bob-512.png");
  });

  it("uses empty string for avatarUrl when no image fields are present", async () => {
    const cache = makeCache(MEMBERS);
    const { entries: results } = await cache.search(["charlie"]);
    assert.equal(results[0].avatarUrl, "");
  });

  it("returns empty array when no matches", async () => {
    const cache = makeCache(MEMBERS);
    const { entries: results } = await cache.search(["nonexistent_user_xyz"]);
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

    const cache = createUsersCache(client, EMPTY_REGISTRY);
    await cache.search(["alice"]);
    await cache.search(["bob"]);
    await cache.search(["charlie"]);
    assert.equal(fetchCount, 1);
  });

  it("handles wildcard with special regex characters in query", async () => {
    // "diana.prince" has a dot — the wildcard matcher should escape it
    const cache = makeCache(MEMBERS);
    const { entries: results } = await cache.search(["diana.prince"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].username, "diana.prince");
  });
});

// ---------------------------------------------------------------------------
// Pagination — offset, limit bounds, and totalMatched
// ---------------------------------------------------------------------------

describe("UsersCache.search pagination", () => {
  // All 5 active members share a space in their displayName — a broad match.
  const ALL = [" "];

  it("reports totalMatched independent of limit", async () => {
    const cache = makeCache(MEMBERS);
    const { entries, totalMatched } = await cache.search(ALL, { limit: 2 });
    assert.equal(entries.length, 2);
    assert.equal(totalMatched, 5);
  });

  it("reports totalMatched independent of offset", async () => {
    const cache = makeCache(MEMBERS);
    const { entries, totalMatched } = await cache.search(ALL, { offset: 3, limit: 2 });
    assert.equal(entries.length, 2);
    assert.equal(totalMatched, 5);
  });

  it("returns disjoint pages across offsets", async () => {
    const cache = makeCache(MEMBERS);
    const page1 = await cache.search(ALL, { offset: 0, limit: 2 });
    const page2 = await cache.search(ALL, { offset: 2, limit: 2 });
    const ids2 = page2.entries.map((e) => e.userId);
    assert.equal(
      page1.entries.some((e) => ids2.includes(e.userId)),
      false,
    );
  });

  it("returns an empty page beyond the last match, keeping totalMatched", async () => {
    const cache = makeCache(MEMBERS);
    const { entries, totalMatched } = await cache.search(ALL, { offset: 99, limit: 2 });
    assert.equal(entries.length, 0);
    assert.equal(totalMatched, 5);
  });

  it("clamps a negative offset to 0", async () => {
    const cache = makeCache(MEMBERS);
    const { entries } = await cache.search(ALL, { offset: -5, limit: 2 });
    assert.equal(entries.length, 2);
  });

  it("falls back to the default limit when limit <= 0", async () => {
    const cache = makeCache(MEMBERS);
    const { entries } = await cache.search(ALL, { limit: 0 });
    assert.equal(entries.length, 5);
  });
});

// ---------------------------------------------------------------------------
// Registry enrichment
// ---------------------------------------------------------------------------

describe("UsersCache.search registry enrichment", () => {
  const record = (over: Partial<UserRecord>): UserRecord => ({
    userId: "U001",
    displayName: "Alice Anderson",
    lastFetched: 0,
    ...over,
  });

  it("attaches the full github object when the registry has one", async () => {
    const registry = makeRegistry({ U001: record({ github: { username: "alice-gh" } }) });
    const { entries } = await makeCache(MEMBERS, registry).search(["alice"]);
    assert.deepEqual(entries[0].github, { username: "alice-gh" });
  });

  it("omits github when the user has no registry record", async () => {
    const { entries } = await makeCache(MEMBERS, EMPTY_REGISTRY).search(["alice"]);
    assert.equal(entries[0].github, undefined);
  });

  it("projects only requested plugin namespaces", async () => {
    const registry = makeRegistry({
      U001: record({ plugins: { trivia: { score: 42 }, casual: { mood: "chipper" } } }),
    });
    const { entries } = await makeCache(MEMBERS, registry).search(["alice"], {
      includePluginData: ["trivia"],
    });
    assert.deepEqual(entries[0].plugins, { trivia: { score: 42 } });
  });

  it("omits plugins entirely when includePluginData is empty", async () => {
    const registry = makeRegistry({ U001: record({ plugins: { trivia: { score: 42 } } }) });
    const { entries } = await makeCache(MEMBERS, registry).search(["alice"]);
    assert.equal(entries[0].plugins, undefined);
  });

  it("omits a requested namespace that is absent for the user", async () => {
    const registry = makeRegistry({ U001: record({ plugins: { trivia: { score: 42 } } }) });
    const { entries } = await makeCache(MEMBERS, registry).search(["alice"], {
      includePluginData: ["missing"],
    });
    assert.equal(entries[0].plugins, undefined);
  });

  it("only enriches the returned page, not the whole match set", async () => {
    let reads = 0;
    const registry: UserRegistryReader = {
      getUserRecord: async (userId) => {
        reads++;
        return record({ userId });
      },
    };
    await makeCache(MEMBERS, registry).search([" "], { limit: 2 });
    assert.equal(reads, 2);
  });

  it("does not source registry-only users (roster is the search universe)", async () => {
    const registry = makeRegistry({
      U999: record({ userId: "U999", displayName: "Ghost", github: { username: "ghost" } }),
    });
    const { entries, totalMatched } = await makeCache(MEMBERS, registry).search(["U999"]);
    assert.equal(entries.length, 0);
    assert.equal(totalMatched, 0);
  });

  it("degrades gracefully when the registry read throws", async () => {
    const registry: UserRegistryReader = {
      getUserRecord: async () => {
        throw new Error("registry exploded");
      },
    };
    const { entries } = await makeCache(MEMBERS, registry).search(["alice"], {
      includePluginData: ["trivia"],
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].userId, "U001");
    assert.equal(entries[0].github, undefined);
    assert.equal(entries[0].plugins, undefined);
  });
});

// ---------------------------------------------------------------------------
// fetchAll — roster paging and API failure
// ---------------------------------------------------------------------------

describe("UsersCache.search roster fetch", () => {
  it("follows next_cursor across multiple pages", async () => {
    const page1 = [{ id: "U001", name: "alice", profile: { display_name: "Alice" } }];
    const page2 = [{ id: "U002", name: "bob", profile: { display_name: "Bob" } }];
    const client = new WebClient();
    vi.spyOn(client.users, "list").mockImplementation(async (opts) =>
      opts?.cursor === "next"
        ? { ok: true, members: page2, response_metadata: { next_cursor: "" } }
        : { ok: true, members: page1, response_metadata: { next_cursor: "next" } },
    );

    const cache = createUsersCache(client, EMPTY_REGISTRY);
    const { entries, totalMatched } = await cache.search(["alice", "bob"]);
    assert.equal(totalMatched, 2);
    assert.deepEqual(entries.map((e) => e.userId).sort(), ["U001", "U002"]);
  });

  it("returns no results when the roster fetch fails", async () => {
    const client = new WebClient();
    vi.spyOn(client.users, "list").mockImplementation(async () => ({
      ok: false,
      error: "rate_limited",
    }));

    const cache = createUsersCache(client, EMPTY_REGISTRY);
    const { entries, totalMatched } = await cache.search(["alice"]);
    assert.equal(entries.length, 0);
    assert.equal(totalMatched, 0);
  });
});
