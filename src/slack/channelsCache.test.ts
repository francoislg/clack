import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createChannelsCache, type ChannelsCacheClient } from "./channelsCache.js";

interface MockChannel {
  id: string;
  name: string;
  is_private?: boolean;
  is_archived?: boolean;
  topic?: { value: string };
  purpose?: { value: string };
  num_members?: number;
}

function makeClient(channels: MockChannel[]): ChannelsCacheClient {
  return {
    conversations: {
      list: vi.fn(async () => ({ ok: true, channels })),
      info: vi.fn(async () => ({ ok: false })),
    },
  };
}

describe("channelsCache", () => {
  describe("search", () => {
    it("finds channels by substring", async () => {
      const client = makeClient([
        { id: "C001", name: "dev-team" },
        { id: "C002", name: "dev-updates" },
        { id: "C003", name: "general" },
      ]);
      const cache = createChannelsCache(client);

      const results = await cache.search("dev");

      assert.equal(results.length, 2);
      assert.equal(results[0].name, "dev-team");
      assert.equal(results[1].name, "dev-updates");
    });

    it("is case-insensitive", async () => {
      const client = makeClient([{ id: "C001", name: "Dev-Team" }]);
      const cache = createChannelsCache(client);

      const results = await cache.search("dev-team");

      assert.equal(results.length, 1);
    });

    it("supports wildcard patterns", async () => {
      const client = makeClient([
        { id: "C001", name: "dev-team" },
        { id: "C002", name: "dev-updates" },
        { id: "C003", name: "general-dev" },
      ]);
      const cache = createChannelsCache(client);

      const results = await cache.search("dev-*");

      assert.equal(results.length, 2);
      assert.equal(results[0].name, "dev-team");
      assert.equal(results[1].name, "dev-updates");
    });

    it("strips leading # from query", async () => {
      const client = makeClient([{ id: "C001", name: "general" }]);
      const cache = createChannelsCache(client);

      const results = await cache.search("#general");

      assert.equal(results.length, 1);
    });

    it("excludes archived channels by default", async () => {
      const client = makeClient([
        { id: "C001", name: "active" },
        { id: "C002", name: "archived-one", is_archived: true },
      ]);
      const cache = createChannelsCache(client);

      const all = await cache.search("");

      assert.equal(all.length, 1);
      assert.equal(all[0].name, "active");
    });

    it("includes archived when requested", async () => {
      const client = makeClient([
        { id: "C001", name: "active" },
        { id: "C002", name: "archived-one", is_archived: true },
      ]);
      const cache = createChannelsCache(client);

      const all = await cache.search("", { includeArchived: true });

      assert.equal(all.length, 2);
    });

    it("filters by scope=public", async () => {
      const client = makeClient([
        { id: "C001", name: "public-one" },
        { id: "C002", name: "private-one", is_private: true },
      ]);
      const cache = createChannelsCache(client);

      const results = await cache.search("one", { scope: "public" });

      assert.equal(results.length, 1);
      assert.equal(results[0].name, "public-one");
    });

    it("filters by scope=private", async () => {
      const client = makeClient([
        { id: "C001", name: "public-one" },
        { id: "C002", name: "private-one", is_private: true },
      ]);
      const cache = createChannelsCache(client);

      const results = await cache.search("one", { scope: "private" });

      assert.equal(results.length, 1);
      assert.equal(results[0].name, "private-one");
    });

    it("respects limit", async () => {
      const channels = Array.from({ length: 10 }, (_, i) => ({
        id: `C${i}`,
        name: `team-${i}`,
      }));
      const client = makeClient(channels);
      const cache = createChannelsCache(client);

      const results = await cache.search("team", { limit: 3 });

      assert.equal(results.length, 3);
    });

    it("caches results and only fetches once", async () => {
      let callCount = 0;
      const client: ChannelsCacheClient = {
        conversations: {
          list: async () => {
            callCount++;
            return { ok: true, channels: [{ id: "C001", name: "general" }] };
          },
          info: async () => ({ ok: false }),
        },
      };
      const cache = createChannelsCache(client);

      await cache.search("general");
      await cache.search("general");

      assert.equal(callCount, 1);
    });

    it("includes topic, purpose, and numMembers when present", async () => {
      const client = makeClient([
        {
          id: "C001",
          name: "general",
          topic: { value: "Main chat" },
          purpose: { value: "General discussion" },
          num_members: 42,
        },
      ]);
      const cache = createChannelsCache(client);

      const results = await cache.search("general");

      assert.equal(results[0].topic, "Main chat");
      assert.equal(results[0].purpose, "General discussion");
      assert.equal(results[0].numMembers, 42);
    });
  });

  describe("resolve", () => {
    it("resolves by channel ID from cache", async () => {
      const client = makeClient([{ id: "C001", name: "general", topic: { value: "Main chat" } }]);
      const cache = createChannelsCache(client);

      const result = await cache.resolve("C001");

      assert.ok(result);
      assert.equal(result.id, "C001");
      assert.equal(result.name, "general");
      assert.equal(result.topic, "Main chat");
    });

    it("falls back to API when ID not in cache", async () => {
      const client = makeClient([]);
      const infoFn = vi.fn(async () => ({
        ok: true,
        channel: { id: "CNEW", name: "new-channel", is_private: false },
      }));
      client.conversations.info = infoFn;
      const cache = createChannelsCache(client);

      const result = await cache.resolve("CNEW");

      assert.ok(result);
      assert.equal(result.name, "new-channel");
      assert.equal(infoFn.mock.calls.length, 1);
    });

    it("returns null when ID not found anywhere", async () => {
      const client = makeClient([]);
      const cache = createChannelsCache(client);

      const result = await cache.resolve("CMISSING");

      assert.equal(result, null);
    });

    it("resolves by exact channel name", async () => {
      const client = makeClient([
        { id: "C001", name: "general" },
        { id: "C002", name: "general-dev" },
      ]);
      const cache = createChannelsCache(client);

      const result = await cache.resolve("general");

      assert.ok(result);
      assert.equal(result.id, "C001");
    });

    it("resolves by name with leading #", async () => {
      const client = makeClient([{ id: "C001", name: "general" }]);
      const cache = createChannelsCache(client);

      const result = await cache.resolve("#general");

      assert.ok(result);
      assert.equal(result.id, "C001");
    });

    it("returns null for empty input", async () => {
      const client = makeClient([]);
      const cache = createChannelsCache(client);

      const result = await cache.resolve("  ");

      assert.equal(result, null);
    });
  });
});
