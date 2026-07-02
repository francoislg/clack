import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import { createUsersCache, type UsersCacheDeps } from "./usersCache.js";
import type { UserRecord } from "../userRegistry.js";

// ---------------------------------------------------------------------------
// Helpers — the registry is the search universe; a stubbed roster refresh keeps
// unit tests off the Slack roster fetch entirely.
// ---------------------------------------------------------------------------

const DUMMY_CLIENT = {} as App["client"];

function makeCache(records: UserRecord[], over: Partial<UsersCacheDeps> = {}) {
  const deps: UsersCacheDeps = {
    registry: { listUserRecords: async () => records },
    ensureRosterFresh: async () => {},
    ...over,
  };
  return createUsersCache(DUMMY_CLIENT, deps);
}

const rec = (over: Partial<UserRecord> & { userId: string }): UserRecord => ({
  displayName: "",
  lastFetched: 0,
  ...over,
});

const RECORDS: UserRecord[] = [
  {
    userId: "U001",
    username: "alice",
    displayName: "Alice Anderson",
    lastFetched: 0,
    avatarUrl: "https://cdn.example.com/alice-orig.png",
    github: { username: "alice-gh" },
  },
  {
    userId: "U002",
    username: "bob",
    displayName: "Bob Baker",
    lastFetched: 0,
    avatarUrl: "https://cdn.example.com/bob-512.png",
    otherNames: ["Bobby", "Rob"],
  },
  { userId: "U003", username: "charlie", displayName: "Charlie Chen", lastFetched: 0 },
  { userId: "U004", username: "diana.prince", displayName: "Diana Prince", lastFetched: 0 },
  { userId: "U005", username: "eve_online", displayName: "Eve Online", lastFetched: 0 },
];

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

describe("UsersCache.search matching", () => {
  it("finds user by exact userId (case-insensitive)", async () => {
    const { entries } = await makeCache(RECORDS).search(["u001"]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].userId, "U001");
  });

  it("never matches a wildcard against userId (userId is exact-only)", async () => {
    const { entries } = await makeCache(RECORDS).search(["U*"]);
    assert.equal(entries.length, 0);
  });

  it("finds user by substring of username", async () => {
    const { entries } = await makeCache(RECORDS).search(["ali"]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].username, "alice");
  });

  it("finds user by substring of displayName", async () => {
    const { entries } = await makeCache(RECORDS).search(["Anderson"]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].displayName, "Alice Anderson");
  });

  it("matching is case-insensitive", async () => {
    const { entries } = await makeCache(RECORDS).search(["BOB"]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].username, "bob");
  });

  it("matches a mapped github.username", async () => {
    const { entries } = await makeCache(RECORDS).search(["alice-gh"]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].userId, "U001");
  });

  it("matches an alternate name (otherNames)", async () => {
    const { entries } = await makeCache(RECORDS).search(["Bobby"]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].userId, "U002");
  });

  it("matches otherNames via wildcard", async () => {
    const { entries } = await makeCache(RECORDS).search(["Ro*"]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].userId, "U002");
  });

  it("supports wildcard patterns", async () => {
    const { entries } = await makeCache(RECORDS).search(["diana*"]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].username, "diana.prince");
  });

  it("supports wildcard in the middle", async () => {
    const { entries } = await makeCache(RECORDS).search(["eve*online"]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].username, "eve_online");
  });

  it("escapes special regex characters in a wildcard query", async () => {
    const { entries } = await makeCache(RECORDS).search(["diana.prince"]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].username, "diana.prince");
  });

  it("OR-s multiple queries together", async () => {
    const { entries } = await makeCache(RECORDS).search(["alice", "bob"]);
    assert.deepEqual(entries.map((e) => e.username).sort(), ["alice", "bob"]);
  });

  it("deduplicates when the same user matches multiple queries", async () => {
    const { entries } = await makeCache(RECORDS).search(["alice", "Anderson"]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].userId, "U001");
  });

  it("returns an empty array when nothing matches", async () => {
    const { entries } = await makeCache(RECORDS).search(["nonexistent_xyz"]);
    assert.equal(entries.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Entry shape — Slack-sourced base fields, github, otherNames
// ---------------------------------------------------------------------------

describe("UsersCache.search entry shape", () => {
  it("carries the full github object when present", async () => {
    const { entries } = await makeCache(RECORDS).search(["alice"]);
    assert.deepEqual(entries[0].github, { username: "alice-gh" });
  });

  it("carries otherNames when present, omits when absent", async () => {
    const bob = await makeCache(RECORDS).search(["bob"]);
    assert.deepEqual(bob.entries[0].otherNames, ["Bobby", "Rob"]);
    const alice = await makeCache(RECORDS).search(["alice"]);
    assert.equal(alice.entries[0].otherNames, undefined);
  });

  it("returns empty strings for username/avatarUrl on a record missing synced base fields", async () => {
    const records = [rec({ userId: "U900", displayName: "", otherNames: ["Ghost"] })];
    const { entries } = await makeCache(records).search(["Ghost"]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].username, "");
    assert.equal(entries[0].avatarUrl, "");
    assert.equal(entries[0].displayName, "");
  });

  it("surfaces a registry user with no live-roster equivalent (registry is the universe)", async () => {
    const records = [rec({ userId: "U999", displayName: "Departed", username: "departed" })];
    const { entries, totalMatched } = await makeCache(records).search(["departed"]);
    assert.equal(entries.length, 1);
    assert.equal(totalMatched, 1);
  });
});

// ---------------------------------------------------------------------------
// Plugin projection
// ---------------------------------------------------------------------------

describe("UsersCache.search plugin projection", () => {
  const withPlugins = [
    rec({
      userId: "U001",
      username: "alice",
      displayName: "Alice",
      plugins: { trivia: { score: 42 }, casual: { mood: "chipper" } },
    }),
  ];

  it("projects only requested namespaces", async () => {
    const { entries } = await makeCache(withPlugins).search(["alice"], {
      includePluginData: ["trivia"],
    });
    assert.deepEqual(entries[0].plugins, { trivia: { score: 42 } });
  });

  it("omits plugins when includePluginData is empty", async () => {
    const { entries } = await makeCache(withPlugins).search(["alice"]);
    assert.equal(entries[0].plugins, undefined);
  });

  it("omits a requested namespace that is absent for the user", async () => {
    const { entries } = await makeCache(withPlugins).search(["alice"], {
      includePluginData: ["missing"],
    });
    assert.equal(entries[0].plugins, undefined);
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe("UsersCache.search pagination", () => {
  // All 5 records share a space in their displayName — a broad match.
  const ALL = [" "];

  it("reports totalMatched independent of limit", async () => {
    const { entries, totalMatched } = await makeCache(RECORDS).search(ALL, { limit: 2 });
    assert.equal(entries.length, 2);
    assert.equal(totalMatched, 5);
  });

  it("reports totalMatched independent of offset", async () => {
    const { entries, totalMatched } = await makeCache(RECORDS).search(ALL, { offset: 3, limit: 2 });
    assert.equal(entries.length, 2);
    assert.equal(totalMatched, 5);
  });

  it("returns disjoint pages across offsets", async () => {
    const page1 = await makeCache(RECORDS).search(ALL, { offset: 0, limit: 2 });
    const page2 = await makeCache(RECORDS).search(ALL, { offset: 2, limit: 2 });
    const ids2 = page2.entries.map((e) => e.userId);
    assert.equal(
      page1.entries.some((e) => ids2.includes(e.userId)),
      false,
    );
  });

  it("returns an empty page beyond the last match, keeping totalMatched", async () => {
    const { entries, totalMatched } = await makeCache(RECORDS).search(ALL, {
      offset: 99,
      limit: 2,
    });
    assert.equal(entries.length, 0);
    assert.equal(totalMatched, 5);
  });

  it("clamps a negative offset to 0", async () => {
    const { entries } = await makeCache(RECORDS).search(ALL, { offset: -5, limit: 2 });
    assert.equal(entries.length, 2);
  });

  it("falls back to the default limit when limit <= 0", async () => {
    const { entries } = await makeCache(RECORDS).search(ALL, { limit: 0 });
    assert.equal(entries.length, 5);
  });

  it("uses a default limit of 10", async () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      rec({ userId: `U${i}`, displayName: `User ${i}`, username: `user${i}` }),
    );
    const { entries, totalMatched } = await makeCache(many).search(["user"]);
    assert.equal(entries.length, 10);
    assert.equal(totalMatched, 15);
  });
});

// ---------------------------------------------------------------------------
// Roster-sync trigger wiring
// ---------------------------------------------------------------------------

describe("UsersCache.search roster-sync trigger", () => {
  it("calls ensureRosterFresh with the client before searching", async () => {
    const ensureRosterFresh = vi.fn<(client: App["client"] | null) => Promise<void>>(
      async () => {},
    );
    await makeCache(RECORDS, { ensureRosterFresh }).search(["alice"]);
    assert.equal(ensureRosterFresh.mock.calls.length, 1);
    assert.equal(ensureRosterFresh.mock.calls[0][0], DUMMY_CLIENT);
  });
});
