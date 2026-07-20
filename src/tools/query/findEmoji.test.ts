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

interface FindEmojiLore {
  meaning: string;
  tags: string[];
  source?: string;
  updatedAt?: string;
}

interface FindEmojiPayload {
  emojis: Array<{ name: string; url?: string; lore?: FindEmojiLore }>;
  total: number;
  truncated: boolean;
}

/** `missing_lore` answers a question about absence, so its payload is names only. */
interface FindEmojiNamesPayload {
  emojis: string[];
  total: number;
  truncated: boolean;
}

interface RunArgs {
  query: string;
  limit?: number;
  lore_only?: boolean;
  missing_lore?: boolean;
  sort?: "oldest";
}

function toolArgs(args: RunArgs) {
  return {
    query: args.query,
    limit: args.limit,
    lore_only: args.lore_only,
    missing_lore: args.missing_lore,
    sort: args.sort,
  };
}

async function run(
  cache: EmojiCache,
  deps: FindEmojiDeps,
  args: RunArgs,
): Promise<FindEmojiPayload> {
  const toolDef = createFindEmojiTool(cache, deps);
  const result = await toolDef.handler(toolArgs(args), {});
  const payload: FindEmojiPayload = parseToolResult(result);
  return payload;
}

async function runNames(
  cache: EmojiCache,
  deps: FindEmojiDeps,
  args: RunArgs,
): Promise<FindEmojiNamesPayload> {
  const toolDef = createFindEmojiTool(cache, deps);
  const result = await toolDef.handler(toolArgs(args), {});
  const payload: FindEmojiNamesPayload = parseToolResult(result);
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

describe("find_emoji lore provenance", () => {
  it("full results carry source and updatedAt", async () => {
    const deps = depsWith([
      makeLoreEntry({
        name: "crisis_cat",
        meaning: "on fire",
        tags: ["incident"],
        source: "observed",
        updatedAt: "2026-07-20T12:00:00.000Z",
      }),
    ]);

    const payload = await run(cache, deps, { query: "crisis" });

    expect(payload.emojis[0].lore).toEqual({
      meaning: "on fire",
      tags: ["incident"],
      examples: [],
      source: "observed",
      updatedAt: "2026-07-20T12:00:00.000Z",
    });
  });

  it("the compact projection stays lean", async () => {
    const deps = depsWith([makeLoreEntry({ name: "crisis_cat", meaning: "on fire" })]);

    const payload = await run(cache, deps, { query: "*", lore_only: true });

    expect(Object.keys(payload.emojis[0])).toEqual(["name", "meaning", "tags"]);
  });
});

describe("find_emoji missing_lore", () => {
  it("lists workspace emoji that have no lore, names only", async () => {
    const deps = depsWith([makeLoreEntry({ name: "crisis_cat", meaning: "on fire" })]);

    const payload = await runNames(cache, deps, { query: "*", missing_lore: true });

    expect(payload.emojis).toEqual(["partyparrot", "partytime", "team_approved"]);
    expect(payload.total).toBe(3);
  });

  it("honors a narrowing query", async () => {
    const deps = depsWith([]);

    const payload = await runNames(cache, deps, { query: "party*", missing_lore: true });

    expect(payload.emojis).toEqual(["partyparrot", "partytime"]);
  });

  it("is empty when every emoji is documented", async () => {
    const deps = depsWith(
      ["crisis_cat", "partyparrot", "partytime", "team_approved"].map((name) =>
        makeLoreEntry({ name, meaning: "documented" }),
      ),
    );

    const payload = await runNames(cache, deps, { query: "*", missing_lore: true });

    expect(payload).toEqual({ emojis: [], total: 0, truncated: false });
  });

  it("returns everything when the store is empty", async () => {
    const payload = await runNames(cache, depsWith([]), { query: "*", missing_lore: true });

    expect(payload.total).toBe(4);
  });

  it("truncates past an explicit limit", async () => {
    const payload = await runNames(cache, depsWith([]), {
      query: "*",
      missing_lore: true,
      limit: 2,
    });

    expect(payload.emojis).toHaveLength(2);
    expect(payload.total).toBe(4);
    expect(payload.truncated).toBe(true);
  });
});

describe("find_emoji sort: oldest", () => {
  const staggered = [
    makeLoreEntry({ name: "partyparrot", meaning: "a", updatedAt: "2026-07-01T00:00:00.000Z" }),
    makeLoreEntry({ name: "crisis_cat", meaning: "b", updatedAt: "2026-05-01T00:00:00.000Z" }),
    makeLoreEntry({ name: "team_approved", meaning: "c", updatedAt: "2026-06-01T00:00:00.000Z" }),
  ];

  it("orders the index stalest-first", async () => {
    const payload = await run(cache, depsWith(staggered), {
      query: "*",
      lore_only: true,
      sort: "oldest",
    });

    expect(payload.emojis.map((e) => e.name)).toEqual([
      "crisis_cat",
      "team_approved",
      "partyparrot",
    ]);
  });

  it("orders before truncating so limit 1 yields the stalest", async () => {
    const payload = await run(cache, depsWith(staggered), {
      query: "*",
      lore_only: true,
      sort: "oldest",
      limit: 1,
    });

    expect(payload.emojis.map((e) => e.name)).toEqual(["crisis_cat"]);
    expect(payload.total).toBe(3);
    expect(payload.truncated).toBe(true);
  });

  it("does not add updatedAt to the compact shape", async () => {
    const payload = await run(cache, depsWith(staggered), {
      query: "*",
      lore_only: true,
      sort: "oldest",
    });

    expect(Object.keys(payload.emojis[0])).toEqual(["name", "meaning", "tags"]);
  });

  it("sorts an entry with no timestamp as the stalest", async () => {
    // "" is the graceful schema's default for a legacy entry — no recorded update means it is the
    // one most in need of review, so first is the right place for it.
    const withLegacy = [
      makeLoreEntry({ name: "partyparrot", meaning: "a", updatedAt: "2026-07-01T00:00:00.000Z" }),
      makeLoreEntry({ name: "crisis_cat", meaning: "b", updatedAt: "" }),
    ];

    const payload = await run(cache, depsWith(withLegacy), {
      query: "*",
      lore_only: true,
      sort: "oldest",
    });

    expect(payload.emojis.map((e) => e.name)).toEqual(["crisis_cat", "partyparrot"]);
  });

  it("leaves the default order untouched without sort", async () => {
    const payload = await run(cache, depsWith(staggered), { query: "*", lore_only: true });

    expect(payload.emojis.map((e) => e.name)).toEqual([
      "partyparrot",
      "crisis_cat",
      "team_approved",
    ]);
  });
});

describe("find_emoji argument conflicts", () => {
  it("rejects lore_only combined with missing_lore", async () => {
    const toolDef = createFindEmojiTool(cache, depsWith([]));

    const result = await toolDef.handler(
      toolArgs({ query: "*", lore_only: true, missing_lore: true }),
      {},
    );

    expect(result.isError).toBe(true);
  });

  it("rejects sort without lore_only", async () => {
    const toolDef = createFindEmojiTool(cache, depsWith([]));

    const result = await toolDef.handler(toolArgs({ query: "*", sort: "oldest" }), {});

    expect(result.isError).toBe(true);
  });
});
