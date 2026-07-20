import { describe, it, expect, beforeEach } from "vitest";
import { createFindEmojiTool, type FindEmojiDeps } from "./findEmoji.js";
import { parseToolResult } from "../testHelpers.js";
import type { EmojiCache } from "../../slack/emojiCache.js";
import type { EmojiLoreEntry } from "../../emojiLore.js";
import { createFakeEmojiCache } from "../../slack/emojiCache.testHelpers.js";
import { makeLoreEntry } from "../../emojiLore.testHelpers.js";

function depsWith(entries: EmojiLoreEntry[]): FindEmojiDeps {
  return { listLore: async () => entries };
}

interface FindEmojiPayload {
  emojis: Array<{ name: string; url?: string; lore?: { meaning: string; tags: string[] } }>;
  total: number;
  truncated: boolean;
}

async function run(
  cache: EmojiCache,
  deps: FindEmojiDeps,
  args: { query: string; limit?: number; lore_only?: boolean },
): Promise<FindEmojiPayload> {
  const toolDef = createFindEmojiTool(cache, deps);
  const result = await toolDef.handler(
    { query: args.query, limit: args.limit, lore_only: args.lore_only },
    {},
  );
  const payload: FindEmojiPayload = parseToolResult(result);
  return payload;
}

let cache: EmojiCache;

beforeEach(() => {
  cache = createFakeEmojiCache(["crisis_cat", "partyparrot", "partytime", "team_approved"]);
});

describe("find_emoji lore search", () => {
  it("finds an emoji by a lore tag its name does not contain", async () => {
    const deps = depsWith([
      makeLoreEntry({ name: "crisis_cat", meaning: "Something is on fire", tags: ["incident"] }),
    ]);
    const payload = await run(cache, deps, { query: "incident" });

    expect(payload.emojis.map((e) => e.name)).toEqual(["crisis_cat"]);
    expect(payload.emojis[0].lore?.meaning).toBe("Something is on fire");
  });

  it("ranks lore matches ahead of name-only matches and never duplicates one emoji", async () => {
    const deps = depsWith([makeLoreEntry({ name: "crisis_cat", tags: ["party"] })]);
    const payload = await run(cache, deps, { query: "party" });

    expect(payload.emojis[0].name).toBe("crisis_cat");
    expect(payload.emojis.map((e) => e.name).sort()).toEqual([
      "crisis_cat",
      "partyparrot",
      "partytime",
    ]);
    expect(new Set(payload.emojis.map((e) => e.name)).size).toBe(payload.emojis.length);
  });

  it("attaches lore to an emoji that matched by name", async () => {
    const deps = depsWith([makeLoreEntry({ name: "partyparrot", meaning: "celebration" })]);
    const payload = await run(cache, deps, { query: "partyparrot" });

    expect(payload.emojis[0].lore?.meaning).toBe("celebration");
  });

  it("skips lore whose emoji no longer exists in the workspace", async () => {
    const deps = depsWith([makeLoreEntry({ name: "deleted_emoji", tags: ["incident"] })]);
    const payload = await run(cache, deps, { query: "incident" });

    expect(payload.emojis).toEqual([]);
    expect(payload.total).toBe(0);
  });
});

describe("find_emoji legacy parity", () => {
  it("returns exactly the pre-lore shape when no lore exists", async () => {
    const payload = await run(cache, depsWith([]), { query: "party" });

    expect(payload).toEqual({
      emojis: [
        { name: "partyparrot", url: "https://emoji.test/partyparrot.png" },
        { name: "partytime", url: "https://emoji.test/partytime.png" },
      ],
      total: 2,
      truncated: false,
    });
    for (const emoji of payload.emojis) {
      expect(Object.keys(emoji)).toEqual(["name", "url"]);
    }
  });

  it("honors the wildcard and the limit", async () => {
    const payload = await run(cache, depsWith([]), { query: "*" });
    expect(payload.total).toBe(4);

    const limited = await run(cache, depsWith([]), { query: "*", limit: 2 });
    expect(limited.emojis).toHaveLength(2);
    expect(limited.total).toBe(4);
    expect(limited.truncated).toBe(true);
  });

  it("returns an empty set when nothing matches by name or lore", async () => {
    const payload = await run(cache, depsWith([]), { query: "nothing_here" });
    expect(payload).toEqual({ emojis: [], total: 0, truncated: false });
  });
});

describe("find_emoji lore_only", () => {
  const entries = [
    makeLoreEntry({ name: "crisis_cat", meaning: "on fire", tags: ["incident"] }),
    makeLoreEntry({ name: "team_approved", meaning: "sign-off", tags: ["approval"] }),
  ];

  it("returns the whole index in compact form, excluding emojis without lore", async () => {
    const payload = await run(cache, depsWith(entries), { query: "*", lore_only: true });

    expect(payload.total).toBe(2);
    expect(payload.emojis).toEqual([
      { name: "crisis_cat", meaning: "on fire", tags: ["incident"] },
      { name: "team_approved", meaning: "sign-off", tags: ["approval"] },
    ]);
  });

  it("still honors a narrowing query", async () => {
    const payload = await run(cache, depsWith(entries), { query: "incident", lore_only: true });
    expect(payload.emojis.map((e) => e.name)).toEqual(["crisis_cat"]);
  });

  it("defaults to a limit large enough for a whole index", async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      makeLoreEntry({ name: `e${i}`, meaning: "m" }),
    );
    const wideCache = createFakeEmojiCache(many.map((e) => e.name));
    const payload = await run(wideCache, depsWith(many), { query: "*", lore_only: true });

    expect(payload.emojis).toHaveLength(120);
    expect(payload.truncated).toBe(false);
  });

  it("truncates past an explicit limit", async () => {
    const payload = await run(cache, depsWith(entries), { query: "*", lore_only: true, limit: 1 });

    expect(payload.emojis).toHaveLength(1);
    expect(payload.total).toBe(2);
    expect(payload.truncated).toBe(true);
  });

  it("returns an empty index when no lore is recorded", async () => {
    const payload = await run(cache, depsWith([]), { query: "*", lore_only: true });
    expect(payload).toEqual({ emojis: [], total: 0, truncated: false });
  });
});
