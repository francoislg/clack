import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFindChannelTool } from "./findChannel.js";
import { parseToolResult } from "../testHelpers.js";
import type { ChannelsCache, SlackChannelEntry } from "../../slack/channelsCache.js";

function entry(
  overrides: Partial<SlackChannelEntry> & { id: string; name: string },
): SlackChannelEntry {
  return {
    isPrivate: false,
    isArchived: false,
    ...overrides,
  };
}

function makeCache(channels: SlackChannelEntry[]): ChannelsCache {
  return {
    async search(query, options = {}) {
      const { scope = "all", includeArchived = false, limit = 20 } = options;
      const searchName = query.replace(/^#/, "").toLowerCase();
      return channels
        .filter((ch) => {
          if (!includeArchived && ch.isArchived) return false;
          if (scope === "public" && ch.isPrivate) return false;
          if (scope === "private" && !ch.isPrivate) return false;
          return ch.name.toLowerCase().includes(searchName);
        })
        .slice(0, limit);
    },
    async resolve(idOrName) {
      const input = idOrName.trim();
      if (/^[CG][A-Z0-9_]+$/.test(input)) {
        return channels.find((ch) => ch.id === input) ?? null;
      }
      const name = input.replace(/^#/, "").toLowerCase();
      return channels.find((ch) => ch.name.toLowerCase() === name) ?? null;
    },
  };
}

interface ToolArgs {
  query: string;
  scope?: "all" | "public" | "private";
  include_archived?: boolean;
  limit?: number;
  page?: number;
}

function call(cache: ChannelsCache, args: ToolArgs) {
  const toolDef = createFindChannelTool(cache);
  return toolDef.handler(
    {
      query: args.query,
      scope: args.scope,
      include_archived: args.include_archived,
      limit: args.limit,
      page: args.page,
    },
    { sessionId: "test" },
  );
}

describe("findChannel tool", () => {
  it("resolves a channel ID directly", async () => {
    const cache = makeCache([
      entry({ id: "C0A82GNR25V", name: "clack-test", topic: "Testing channel", numMembers: 5 }),
    ]);

    const result = await call(cache, { query: "C0A82GNR25V" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.id, "C0A82GNR25V");
    assert.equal(parsed.name, "clack-test");
    assert.equal(parsed.topic, "Testing channel");
    assert.equal(parsed.num_members, 5);
  });

  it("searches by name with substring matching", async () => {
    const cache = makeCache([
      entry({ id: "C001", name: "dev-team" }),
      entry({ id: "C002", name: "dev-updates" }),
      entry({ id: "C003", name: "general" }),
    ]);

    const result = await call(cache, { query: "dev" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.channels.length, 2);
    assert.equal(parsed.channels[0].name, "dev-team");
    assert.equal(parsed.channels[1].name, "dev-updates");
    assert.equal(parsed.total, 2);
  });

  it("strips leading # from channel name", async () => {
    const cache = makeCache([entry({ id: "C001", name: "general" })]);

    const result = await call(cache, { query: "#general" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.channels.length, 1);
    assert.equal(parsed.channels[0].name, "general");
  });

  it("is case-insensitive", async () => {
    const cache = makeCache([entry({ id: "C001", name: "Dev-Team" })]);

    const result = await call(cache, { query: "dev-team" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.channels.length, 1);
  });

  it("filters by scope=public", async () => {
    const cache = makeCache([
      entry({ id: "C001", name: "public-chat", isPrivate: false }),
      entry({ id: "C002", name: "private-chat", isPrivate: true }),
    ]);

    const result = await call(cache, { query: "chat", scope: "public" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.channels.length, 1);
    assert.equal(parsed.channels[0].name, "public-chat");
  });

  it("filters by scope=private", async () => {
    const cache = makeCache([
      entry({ id: "C001", name: "public-chat", isPrivate: false }),
      entry({ id: "C002", name: "private-chat", isPrivate: true }),
    ]);

    const result = await call(cache, { query: "chat", scope: "private" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.channels.length, 1);
    assert.equal(parsed.channels[0].name, "private-chat");
  });

  it("excludes archived channels by default", async () => {
    const cache = makeCache([
      entry({ id: "C001", name: "active-team" }),
      entry({ id: "C002", name: "archived-team", isArchived: true }),
    ]);

    const result = await call(cache, { query: "team" });

    const parsed = parseToolResult(result);
    assert.equal(parsed.channels.length, 1);
    assert.equal(parsed.channels[0].name, "active-team");
  });

  it("includes archived channels when include_archived=true", async () => {
    const cache = makeCache([
      entry({ id: "C001", name: "active-team" }),
      entry({ id: "C002", name: "archived-team", isArchived: true }),
    ]);

    const result = await call(cache, { query: "team", include_archived: true });

    const parsed = parseToolResult(result);
    assert.equal(parsed.channels.length, 2);
  });

  it("supports pagination with limit and page", async () => {
    const channels = Array.from({ length: 10 }, (_, i) =>
      entry({ id: `C${String(i).padStart(3, "0")}`, name: `team-${i}` }),
    );
    const cache = makeCache(channels);

    const page0 = await call(cache, { query: "team", limit: 3, page: 0 });
    const parsed0 = parseToolResult(page0);
    assert.equal(parsed0.channels.length, 3);
    assert.equal(parsed0.channels[0].name, "team-0");
    assert.equal(parsed0.page, 0);
    assert.equal(parsed0.has_more, true);

    const page1 = await call(cache, { query: "team", limit: 3, page: 1 });
    const parsed1 = parseToolResult(page1);
    assert.equal(parsed1.channels.length, 3);
    assert.equal(parsed1.channels[0].name, "team-3");
    assert.equal(parsed1.has_more, true);
  });

  it("returns error when no channels match", async () => {
    const cache = makeCache([]);

    const result = await call(cache, { query: "nonexistent" });

    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("No channels matching"));
  });

  it("returns error when channel ID not found", async () => {
    const cache = makeCache([]);

    const result = await call(cache, { query: "C999INVALID" });

    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("not found"));
  });

  it("returns error for empty query", async () => {
    const cache = makeCache([]);

    const result = await call(cache, { query: "  " });

    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("empty"));
  });
});
