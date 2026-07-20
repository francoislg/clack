import { describe, it, expect, beforeEach, vi } from "vitest";
import { createEmojiCache, type EmojiListClient } from "./emojiCache.js";

const WORKSPACE = {
  partyparrot: "https://emoji.test/partyparrot.gif",
  crisis_cat: "https://emoji.test/crisis_cat.png",
  shipit: "alias:crisis_cat",
};

function fakeClient(emoji: Record<string, string>) {
  const list = vi.fn(async () => ({ ok: true, emoji }));
  const client: EmojiListClient = { emoji: { list } };
  return { client, list };
}

let created: ReturnType<typeof fakeClient>;

beforeEach(() => {
  created = fakeClient(WORKSPACE);
});

describe("EmojiCache.get", () => {
  it("returns the entry for an exact name", async () => {
    const cache = createEmojiCache(created.client);
    expect(await cache.get("partyparrot")).toEqual({
      name: "partyparrot",
      url: "https://emoji.test/partyparrot.gif",
    });
  });

  it("resolves an alias to its target url", async () => {
    const cache = createEmojiCache(created.client);
    expect(await cache.get("shipit")).toEqual({
      name: "shipit",
      url: "https://emoji.test/crisis_cat.png",
      aliasFor: "crisis_cat",
    });
  });

  it("returns undefined for a name the workspace does not have", async () => {
    const cache = createEmojiCache(created.client);
    expect(await cache.get("nope")).toBeUndefined();
  });
});

describe("EmojiCache.has", () => {
  it("is true for an exact name", async () => {
    const cache = createEmojiCache(created.client);
    expect(await cache.has("crisis_cat")).toBe(true);
  });

  it("is false for a substring of an existing name, where search would report a hit", async () => {
    const cache = createEmojiCache(created.client);

    expect(await cache.has("party")).toBe(false);
    expect((await cache.search("party")).total).toBe(1);
  });

  it("is false for a standard Unicode shortcode", async () => {
    const cache = createEmojiCache(created.client);
    expect(await cache.has("thumbsup")).toBe(false);
  });

  it("serves repeat lookups from the cache without refetching", async () => {
    const cache = createEmojiCache(created.client);

    await cache.search("*");
    await cache.has("crisis_cat");
    await cache.has("partyparrot");
    await cache.get("shipit");

    expect(created.list).toHaveBeenCalledTimes(1);
  });

  it("returns false for every name when the emoji list cannot be fetched", async () => {
    const failing: EmojiListClient = {
      emoji: { list: async () => ({ ok: false, error: "not_authed" }) },
    };
    const cache = createEmojiCache(failing);

    expect(await cache.has("crisis_cat")).toBe(false);
  });
});
