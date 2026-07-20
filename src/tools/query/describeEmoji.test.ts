import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createDescribeEmojiTool,
  type DescribeEmojiDeps,
  type DescribeEmojiResult,
} from "./describeEmoji.js";
import { parseToolResult } from "../testHelpers.js";
import type { EmojiCache } from "../../slack/emojiCache.js";
import type { UpsertLoreResult } from "../../emojiLore.js";
import { createFakeEmojiCache } from "../../slack/emojiCache.testHelpers.js";
import { makeLoreEntry } from "../../emojiLore.testHelpers.js";

interface RunArgs {
  name: string;
  meaning: string;
  tags?: string[];
  examples?: Array<{ text: string; link?: string }>;
  source: "taught" | "observed";
}

async function run(
  cache: EmojiCache,
  deps: DescribeEmojiDeps,
  args: RunArgs,
): Promise<DescribeEmojiResult> {
  const toolDef = createDescribeEmojiTool(cache, deps);
  const result = await toolDef.handler(
    {
      name: args.name,
      meaning: args.meaning,
      tags: args.tags,
      examples: args.examples,
      source: args.source,
    },
    {},
  );
  const payload: DescribeEmojiResult = parseToolResult(result);
  return payload;
}

let cache: EmojiCache;

beforeEach(() => {
  cache = createFakeEmojiCache(["crisis_cat", "team_approved"]);
});

describe("describe_emoji", () => {
  it("saves taught lore and reports success", async () => {
    const saved = makeLoreEntry({ name: "team_approved", meaning: "sign-off", source: "taught" });
    const upsertLore = vi.fn<DescribeEmojiDeps["upsertLore"]>(async () => ({
      applied: true,
      entry: saved,
      previous: undefined,
    }));

    const payload = await run(
      cache,
      { upsertLore },
      {
        name: "team_approved",
        meaning: "sign-off",
        tags: ["approval"],
        source: "taught",
      },
    );

    expect(upsertLore).toHaveBeenCalledWith({
      name: "team_approved",
      meaning: "sign-off",
      tags: ["approval"],
      examples: undefined,
      source: "taught",
    });
    expect(payload.ok).toBe(true);
    expect(payload.name).toBe("team_approved");
    expect(payload.warning).toBeUndefined();
  });

  it("refuses to overwrite taught lore with an observation and hands back the taught entry", async () => {
    const existing = makeLoreEntry({
      name: "crisis_cat",
      meaning: "real incidents",
      source: "taught",
    });
    const conflict: UpsertLoreResult = { applied: false, reason: "taught-wins", existing };
    const upsertLore = vi.fn<DescribeEmojiDeps["upsertLore"]>(async () => conflict);

    const payload = await run(
      cache,
      { upsertLore },
      {
        name: "crisis_cat",
        meaning: "just a joke",
        source: "observed",
      },
    );

    expect(payload.ok).toBe(false);
    expect(payload.existing?.meaning).toBe("real incidents");
    expect(payload.conflict).toMatch(/surface the discrepancy/i);
  });

  it("warns but still saves when the emoji is not in the workspace list", async () => {
    const saved = makeLoreEntry({ name: "brand_new", meaning: "just uploaded", source: "taught" });
    const upsertLore = vi.fn<DescribeEmojiDeps["upsertLore"]>(async () => ({
      applied: true,
      entry: saved,
      previous: undefined,
    }));

    const payload = await run(
      cache,
      { upsertLore },
      {
        name: "brand_new",
        meaning: "just uploaded",
        source: "taught",
      },
    );

    expect(payload.ok).toBe(true);
    expect(upsertLore).toHaveBeenCalled();
    expect(payload.warning).toMatch(/not in the workspace emoji list|No custom emoji named/i);
  });

  it("caps examples in its declared schema so an over-long list never reaches the store", () => {
    const toolDef = createDescribeEmojiTool(cache, { upsertLore: vi.fn() });
    const examples = toolDef.inputSchema.examples;

    expect(examples.safeParse([{ text: "1" }, { text: "2" }, { text: "3" }]).success).toBe(true);
    expect(
      examples.safeParse([{ text: "1" }, { text: "2" }, { text: "3" }, { text: "4" }]).success,
    ).toBe(false);
  });

  it("rejects a source outside the two provenance values", () => {
    const toolDef = createDescribeEmojiTool(cache, { upsertLore: vi.fn() });

    expect(toolDef.inputSchema.source.safeParse("taught").success).toBe(true);
    expect(toolDef.inputSchema.source.safeParse("guessed").success).toBe(false);
  });

  it("surfaces a store failure as an error result rather than throwing", async () => {
    const upsertLore = vi.fn<DescribeEmojiDeps["upsertLore"]>(async () => {
      throw new Error("disk on fire");
    });

    const toolDef = createDescribeEmojiTool(cache, { upsertLore });
    const result = await toolDef.handler(
      {
        name: "crisis_cat",
        meaning: "m",
        tags: undefined,
        examples: undefined,
        source: "observed",
      },
      {},
    );

    expect(result.isError).toBe(true);
  });
});
