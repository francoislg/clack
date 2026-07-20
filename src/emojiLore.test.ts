import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setEmojiLoreDeps,
  resetEmojiLoreDeps,
  clearEmojiLoreCache,
  loadEmojiLoreStore,
  listLore,
  upsertLore,
  clearLore,
  toCompactLore,
  loreNeedle,
  matchesLore,
  collectEmojiNames,
  buildLoreHint,
  MAX_LORE_EXAMPLES,
  MAX_HINT_NAMES,
  type EmojiLoreDeps,
  type EmojiLoreEntry,
} from "./emojiLore.js";
import { createFakeEmojiCache } from "./slack/emojiCache.testHelpers.js";

/** In-memory file backing so the store never touches disk and stays isolated per test. */
function inMemoryDeps(now: () => Date): { deps: EmojiLoreDeps; files: Map<string, string> } {
  const files = new Map<string, string>();
  const deps: EmojiLoreDeps = {
    async readFile(path) {
      const content = files.get(path);
      if (content === undefined) throw new Error("ENOENT");
      return content;
    },
    async writeFile(path, data) {
      files.set(path, data);
    },
    async mkdir() {
      return undefined;
    },
    async fileExists(path) {
      return files.has(path);
    },
    now,
  };
  return { deps, files };
}

let fixedNow = new Date("2026-07-20T12:00:00.000Z");
let files: Map<string, string>;

beforeEach(() => {
  clearEmojiLoreCache();
  fixedNow = new Date("2026-07-20T12:00:00.000Z");
  const created = inMemoryDeps(() => fixedNow);
  files = created.files;
  setEmojiLoreDeps(created.deps);
});

afterEach(() => {
  resetEmojiLoreDeps();
  clearEmojiLoreCache();
});

const storePath = () => [...files.keys()].find((k) => k.endsWith("emoji-lore.json"));
const readLore = async (name: string) => (await loadEmojiLoreStore())[name];

describe("emojiLore persistence", () => {
  it("returns an empty store when no file exists", async () => {
    expect(await loadEmojiLoreStore()).toEqual({});
    expect(await listLore()).toEqual([]);
  });

  it("round-trips an entry", async () => {
    await upsertLore({
      name: "team_approved",
      meaning: "Sign-off on a reviewed change",
      tags: ["approval", "code-review"],
      source: "taught",
    });
    clearEmojiLoreCache();

    const entry = await readLore("team_approved");
    expect(entry).toEqual({
      name: "team_approved",
      meaning: "Sign-off on a reviewed change",
      tags: ["approval", "code-review"],
      examples: [],
      source: "taught",
      updatedAt: "2026-07-20T12:00:00.000Z",
    });
  });

  it("stamps updatedAt from the injected clock on each write", async () => {
    await upsertLore({ name: "a", meaning: "first", source: "observed" });
    fixedNow = new Date("2026-08-01T09:30:00.000Z");
    await upsertLore({ name: "a", meaning: "second", source: "observed" });

    expect((await readLore("a"))?.updatedAt).toBe("2026-08-01T09:30:00.000Z");
  });

  it("keeps a malformed entry from taking down the rest of the store", async () => {
    await upsertLore({ name: "good", meaning: "fine", source: "taught" });
    clearEmojiLoreCache();

    const path = storePath();
    expect(path).toBeDefined();
    const raw = JSON.parse(files.get(path!)!);
    raw.entries.bad = { name: 42 };
    files.set(path!, JSON.stringify(raw));
    clearEmojiLoreCache();

    const store = await loadEmojiLoreStore();
    expect(store.good?.meaning).toBe("fine");
    expect(store.bad).toBeUndefined();
  });

  it("loads a legacy entry missing optional fields via schema defaults", async () => {
    await upsertLore({ name: "seed", meaning: "seed", source: "taught" });
    clearEmojiLoreCache();

    const path = storePath()!;
    const raw = JSON.parse(files.get(path)!);
    raw.entries.legacy = { name: "legacy" };
    files.set(path, JSON.stringify(raw));
    clearEmojiLoreCache();

    const entry = (await loadEmojiLoreStore()).legacy;
    expect(entry).toEqual({
      name: "legacy",
      meaning: "",
      tags: [],
      examples: [],
      source: "observed",
      updatedAt: "",
    });
  });

  it("narrows an unrecognized source to the weaker provenance instead of dropping the entry", async () => {
    await upsertLore({ name: "seed", meaning: "seed", source: "taught" });
    clearEmojiLoreCache();

    const path = storePath()!;
    const raw = JSON.parse(files.get(path)!);
    raw.entries.odd = { name: "odd", meaning: "m", source: "TAUGHT" };
    files.set(path, JSON.stringify(raw));
    clearEmojiLoreCache();

    expect((await loadEmojiLoreStore()).odd?.source).toBe("observed");
  });

  it("normalizes the key so one emoji has one entry", async () => {
    await upsertLore({ name: ":Ship_It:", meaning: "ready to deploy", source: "taught" });
    expect(await readLore("ship_it")).toBeDefined();
    expect(Object.keys(await loadEmojiLoreStore())).toEqual(["ship_it"]);
  });

  it("truncates examples to the cap", async () => {
    const result = await upsertLore({
      name: "many",
      meaning: "m",
      source: "observed",
      examples: [{ text: "1" }, { text: "2" }, { text: "3" }, { text: "4" }],
    });
    expect(result.applied).toBe(true);
    expect((await readLore("many"))?.examples).toHaveLength(MAX_LORE_EXAMPLES);
  });
});

describe("emojiLore provenance rule", () => {
  it("blocks an observed write over taught lore and returns the existing entry", async () => {
    await upsertLore({ name: "crisis_cat", meaning: "real incidents", source: "taught" });
    const result = await upsertLore({
      name: "crisis_cat",
      meaning: "just a joke",
      source: "observed",
    });

    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("taught-wins");
      expect(result.existing.meaning).toBe("real incidents");
    }
    expect((await readLore("crisis_cat"))?.meaning).toBe("real incidents");
  });

  it("lets a taught write replace observed lore", async () => {
    await upsertLore({ name: "crisis_cat", meaning: "guessed", source: "observed" });
    const result = await upsertLore({ name: "crisis_cat", meaning: "stated", source: "taught" });

    expect(result.applied).toBe(true);
    expect((await readLore("crisis_cat"))?.meaning).toBe("stated");
    expect((await readLore("crisis_cat"))?.source).toBe("taught");
  });

  it("lets a taught write replace taught lore", async () => {
    await upsertLore({ name: "crisis_cat", meaning: "old", source: "taught" });
    const result = await upsertLore({ name: "crisis_cat", meaning: "corrected", source: "taught" });

    expect(result.applied).toBe(true);
    expect((await readLore("crisis_cat"))?.meaning).toBe("corrected");
  });

  it("lets an observed write refine observed lore", async () => {
    await upsertLore({ name: "crisis_cat", meaning: "vague", source: "observed" });
    const result = await upsertLore({ name: "crisis_cat", meaning: "sharper", source: "observed" });

    expect(result.applied).toBe(true);
    expect((await readLore("crisis_cat"))?.meaning).toBe("sharper");
  });

  it("reports the replaced entry so callers can surface an overwrite", async () => {
    await upsertLore({ name: "x", meaning: "before", source: "taught" });
    const result = await upsertLore({ name: "x", meaning: "after", source: "taught" });
    expect(result.applied && result.previous?.meaning).toBe("before");
  });
});

describe("clearLore", () => {
  it("removes an existing entry", async () => {
    await upsertLore({ name: "crisis_cat", meaning: "on fire", source: "observed" });

    expect(await clearLore("crisis_cat")).toBe(true);
    expect(await readLore("crisis_cat")).toBeUndefined();
  });

  it("removes taught lore — the provenance guard does not apply to deletion", async () => {
    await upsertLore({ name: "crisis_cat", meaning: "stated by a human", source: "taught" });

    expect(await clearLore("crisis_cat")).toBe(true);
    expect(await readLore("crisis_cat")).toBeUndefined();
  });

  it("reports false for a name that was never stored, without throwing", async () => {
    expect(await clearLore("never_existed")).toBe(false);
  });

  it("normalizes the name so a decorated form still deletes", async () => {
    await upsertLore({ name: "ship_it", meaning: "ready", source: "taught" });

    expect(await clearLore(":Ship_It:")).toBe(true);
    expect(await readLore("ship_it")).toBeUndefined();
  });

  it("leaves other entries untouched", async () => {
    await upsertLore({ name: "keep_me", meaning: "still here", source: "taught" });
    await upsertLore({ name: "drop_me", meaning: "gone", source: "taught" });

    await clearLore("drop_me");

    expect(Object.keys(await loadEmojiLoreStore())).toEqual(["keep_me"]);
  });

  it("survives a reload", async () => {
    await upsertLore({ name: "crisis_cat", meaning: "on fire", source: "observed" });
    await clearLore("crisis_cat");
    clearEmojiLoreCache();

    expect(await readLore("crisis_cat")).toBeUndefined();
  });
});

describe("emojiLore projections and matching", () => {
  const entry: EmojiLoreEntry = {
    name: "crisis_cat",
    meaning: "Something is on fire",
    tags: ["incident", "chaos"],
    examples: [{ text: "reacted to an outage notice", link: "https://slack.test/p1" }],
    source: "observed",
    updatedAt: "2026-07-20T12:00:00.000Z",
  };

  it("compact form carries only what's needed to pick an emoji", () => {
    expect(toCompactLore(entry)).toEqual({
      name: "crisis_cat",
      meaning: "Something is on fire",
      tags: ["incident", "chaos"],
    });
    expect(Object.keys(toCompactLore(entry))).toEqual(["name", "meaning", "tags"]);
  });

  it("treats a wildcard-only query as the whole index", () => {
    expect(loreNeedle("*")).toBe("");
    expect(matchesLore(entry, loreNeedle("*"))).toBe(true);
  });

  it("matches on a tag, on meaning, and on name", () => {
    expect(matchesLore(entry, loreNeedle("incident"))).toBe(true);
    expect(matchesLore(entry, loreNeedle("on fire"))).toBe(true);
    expect(matchesLore(entry, loreNeedle("CRISIS"))).toBe(true);
    expect(matchesLore(entry, loreNeedle("celebration"))).toBe(false);
  });
});

describe("collectEmojiNames", () => {
  it("collects from reactions and inline text, deduped", () => {
    const names = collectEmojiNames([
      { text: "nice :ship_it: work", reactions: [{ emoji: "crisis_cat" }] },
      { text: "again :ship_it:", reactions: [{ emoji: "crisis_cat" }, { emoji: "tada" }] },
    ]);
    expect([...names].sort()).toEqual(["crisis_cat", "ship_it", "tada"]);
  });

  it("drops the skin-tone modifier so one emoji is one key", () => {
    expect([...collectEmojiNames([{ reactions: [{ emoji: "thumbsup::skin-tone-4" }] }])]).toEqual([
      "thumbsup",
    ]);
  });

  it("ignores tokens that cannot be emoji shortcodes", () => {
    const names = collectEmojiNames([{ text: "ratio 10:30 and a :bad token: here" }]);
    expect(names.size).toBe(0);
  });

  it("extracts nothing from clock times", () => {
    expect(collectEmojiNames([{ text: "deploy finished at 19:48:30 today" }]).size).toBe(0);
  });

  it("extracts nothing from an ISO timestamp", () => {
    expect(collectEmojiNames([{ text: "at 2026-07-20T19:48:30.383Z it broke" }]).size).toBe(0);
  });

  it("rejects a purely numeric token even at a string edge", () => {
    // Leading `:50:` satisfies the digit lookarounds (nothing precedes it), so the all-numeric
    // rule is what catches it — the two rules are independent for exactly this case.
    expect(collectEmojiNames([{ text: ":50: past the hour" }]).size).toBe(0);
  });

  it("extracts a name at the start of the text", () => {
    expect([...collectEmojiNames([{ text: ":appywave: !" }])]).toEqual(["appywave"]);
  });

  it("extracts names containing digits, hyphens, underscores and plus", () => {
    const names = collectEmojiNames([{ text: ":appy-oh-no: :ship_it2: :c＋: :plus+one:" }]);
    expect([...names].sort()).toEqual(["appy-oh-no", "plus+one", "ship_it2"]);
  });

  it("does not extract a shortcode flanked by a digit", () => {
    // Accepted limitation of the boundary rule: failing toward silence is the safe direction
    // for an advisory hint, and emoji are whitespace-delimited in real messages.
    expect(collectEmojiNames([{ text: "win2:tada:" }]).size).toBe(0);
  });

  it("still collects reaction names regardless of the text rules", () => {
    const names = collectEmojiNames([
      { text: "shipped at 19:48:30", reactions: [{ emoji: "appywave" }] },
    ]);
    expect([...names]).toEqual(["appywave"]);
  });

  it("returns nothing for messages with no emoji", () => {
    expect(collectEmojiNames([{ text: "plain text" }, {}]).size).toBe(0);
  });
});

describe("buildLoreHint", () => {
  it("names custom emoji that have no lore", async () => {
    const hint = await buildLoreHint(["crisis_cat"], createFakeEmojiCache(["crisis_cat"]));
    expect(hint).toContain(":crisis_cat:");
    expect(hint).toContain("describe_emoji");
    expect(hint).toContain("observed");
  });

  it("stays silent when every seen emoji already has lore", async () => {
    await upsertLore({ name: "crisis_cat", meaning: "known", source: "taught" });
    expect(await buildLoreHint(["crisis_cat"], createFakeEmojiCache(["crisis_cat"]))).toBeNull();
  });

  it("stays silent for standard emoji absent from the workspace list", async () => {
    expect(await buildLoreHint(["thumbsup"], createFakeEmojiCache([]))).toBeNull();
  });

  it("stays silent when nothing was seen", async () => {
    expect(await buildLoreHint([], createFakeEmojiCache(["crisis_cat"]))).toBeNull();
  });

  it("caps the names it lists and reports the overflow", async () => {
    const names = Array.from({ length: MAX_HINT_NAMES + 3 }, (_, i) => `custom_${i}`);
    const hint = await buildLoreHint(names, createFakeEmojiCache(names));

    expect(hint).toContain("(+3 more)");
    const listed = names.filter((n) => hint?.includes(`:${n}:`));
    expect(listed).toHaveLength(MAX_HINT_NAMES);
  });
});
