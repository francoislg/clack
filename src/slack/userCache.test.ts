import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { App } from "@slack/bolt";
import {
  formatUserIdentity,
  getUserInfo,
  resolveUsers,
  transformUserMentions,
  clearUserCache,
} from "./userCache.js";
import type { UserInfo } from "./userCache.js";

// ---------------------------------------------------------------------------
// formatUserIdentity — pure function tests
// ---------------------------------------------------------------------------

describe("formatUserIdentity", () => {
  it("returns ID-only fallback when no userInfo is provided", () => {
    assert.equal(formatUserIdentity("U123"), "[ID: U123]");
  });

  it("returns ID-only fallback when userInfo has no names", () => {
    const info: UserInfo = { userId: "U123" };
    assert.equal(formatUserIdentity("U123", info), "[ID: U123]");
  });

  it("formats with displayName and username", () => {
    const info: UserInfo = {
      userId: "U123",
      username: "jdoe",
      displayName: "Jane Doe",
    };
    assert.equal(
      formatUserIdentity("U123", info),
      "[Jane Doe (@jdoe - ID: U123)]"
    );
  });

  it("formats with displayName only", () => {
    const info: UserInfo = {
      userId: "U123",
      displayName: "Jane Doe",
    };
    assert.equal(formatUserIdentity("U123", info), "[Jane Doe (ID: U123)]");
  });

  it("formats with username only", () => {
    const info: UserInfo = {
      userId: "U123",
      username: "jdoe",
    };
    assert.equal(formatUserIdentity("U123", info), "[@jdoe (ID: U123)]");
  });
});

// ---------------------------------------------------------------------------
// Mock Slack client helper
// ---------------------------------------------------------------------------

function makeClient(
  users: Record<string, { name?: string; display_name?: string; real_name?: string; tz?: string }>,
  bots: Record<string, { name?: string }> = {}
): App["client"] {
  return {
    users: {
      info: async ({ user }: { user: string }) => {
        const u = users[user];
        if (!u) return { ok: false, error: "user_not_found" };
        return {
          ok: true,
          user: {
            name: u.name,
            tz: u.tz,
            profile: {
              display_name: u.display_name,
              real_name: u.real_name,
            },
          },
        };
      },
    },
    bots: {
      info: async ({ bot }: { bot: string }) => {
        const b = bots[bot];
        if (!b) return { ok: false, error: "bot_not_found" };
        return { ok: true, bot: { name: b.name } };
      },
    },
  } as unknown as App["client"];
}

// ---------------------------------------------------------------------------
// getUserInfo — with mock client
// ---------------------------------------------------------------------------

describe("getUserInfo", () => {
  beforeEach(() => {
    clearUserCache();
  });

  it("fetches and caches user info", async () => {
    const client = makeClient({
      U111: { name: "alice", display_name: "Alice A" },
    });
    const info = await getUserInfo(client, "U111");
    assert.equal(info?.username, "alice");
    assert.equal(info?.displayName, "Alice A");

    // Second call should return from cache (even if client would fail)
    const info2 = await getUserInfo(client, "U111");
    assert.deepEqual(info, info2);
  });

  it("falls back to real_name when display_name is empty", async () => {
    const client = makeClient({
      U222: { name: "bob", display_name: "", real_name: "Bob B" },
    });
    const info = await getUserInfo(client, "U222");
    assert.equal(info?.displayName, "Bob B");
  });

  it("returns undefined for unknown user", async () => {
    const client = makeClient({});
    const info = await getUserInfo(client, "U999");
    assert.equal(info, undefined);
  });

  it("populates tz field from users.info response", async () => {
    const client = makeClient({
      U333: { name: "carol", display_name: "Carol", tz: "America/New_York" },
    });
    const info = await getUserInfo(client, "U333");
    assert.equal(info?.tz, "America/New_York");
  });

  it("leaves tz undefined when not set in Slack", async () => {
    const client = makeClient({
      U444: { name: "dave", display_name: "Dave" },
    });
    const info = await getUserInfo(client, "U444");
    assert.equal(info?.tz, undefined);
  });

  it("routes bot IDs (starting with B) to bots.info", async () => {
    const client = makeClient({}, { B001: { name: "TestBot" } });
    const info = await getUserInfo(client, "B001");
    assert.equal(info?.username, "TestBot");
    assert.equal(info?.displayName, "TestBot");
  });

  it("returns undefined for unknown bot", async () => {
    const client = makeClient({}, {});
    const info = await getUserInfo(client, "B999");
    assert.equal(info, undefined);
  });
});

// ---------------------------------------------------------------------------
// resolveUsers
// ---------------------------------------------------------------------------

describe("resolveUsers", () => {
  beforeEach(() => {
    clearUserCache();
  });

  it("resolves multiple users in parallel", async () => {
    const client = makeClient({
      U001: { name: "alice", display_name: "Alice" },
      U002: { name: "bob", display_name: "Bob" },
    });
    const map = await resolveUsers(client, ["U001", "U002"]);
    assert.equal(map.size, 2);
    assert.equal(map.get("U001")?.username, "alice");
    assert.equal(map.get("U002")?.username, "bob");
  });

  it("deduplicates user IDs", async () => {
    let callCount = 0;
    const client = {
      users: {
        info: async () => {
          callCount++;
          return {
            ok: true,
            user: { name: "a", profile: { display_name: "A" } },
          };
        },
      },
      bots: { info: async () => ({ ok: false }) },
    } as unknown as App["client"];

    await resolveUsers(client, ["U001", "U001", "U001"]);
    // Only one API call for the deduplicated ID
    assert.equal(callCount, 1);
  });

  it("omits users that cannot be resolved", async () => {
    const client = makeClient({ U001: { name: "alice", display_name: "A" } });
    const map = await resolveUsers(client, ["U001", "U999"]);
    assert.equal(map.size, 1);
    assert.ok(map.has("U001"));
    assert.ok(!map.has("U999"));
  });
});

// ---------------------------------------------------------------------------
// transformUserMentions
// ---------------------------------------------------------------------------

describe("transformUserMentions", () => {
  beforeEach(() => {
    clearUserCache();
  });

  it("returns text unchanged when there are no mentions", async () => {
    const client = makeClient({});
    const result = await transformUserMentions(client, "hello world");
    assert.equal(result, "hello world");
  });

  it("replaces <@USERID> with formatted identity", async () => {
    const client = makeClient({
      U123: { name: "alice", display_name: "Alice" },
    });
    const result = await transformUserMentions(
      client,
      "Hey <@U123>, how are you?"
    );
    assert.equal(result, "Hey [Alice (@alice - ID: U123)], how are you?");
  });

  it("replaces multiple distinct mentions", async () => {
    const client = makeClient({
      U001: { name: "alice", display_name: "Alice" },
      U002: { name: "bob", display_name: "Bob" },
    });
    const result = await transformUserMentions(
      client,
      "<@U001> and <@U002> are here"
    );
    assert.ok(result.includes("[Alice (@alice - ID: U001)]"));
    assert.ok(result.includes("[Bob (@bob - ID: U002)]"));
  });

  it("handles unresolvable mentions with ID-only fallback", async () => {
    const client = makeClient({});
    const result = await transformUserMentions(client, "cc <@U999>");
    assert.equal(result, "cc [ID: U999]");
  });

  it("handles W-prefixed user IDs", async () => {
    const client = makeClient({
      W123: { name: "enterprise_user", display_name: "Enterprise User" },
    });
    const result = await transformUserMentions(client, "ask <@W123>");
    assert.equal(
      result,
      "ask [Enterprise User (@enterprise_user - ID: W123)]"
    );
  });
});
