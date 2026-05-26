import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createFindGifTool } from "./findGif.js";
import { parseToolResult } from "../../tools/testHelpers.js";
import { GiphyError, type SearchGiphyParams } from "./giphy.js";
import type { GifResult } from "./types.js";

const SESSION = { sessionId: "test" };

const BASE_ARGS = {
  query: "x",
  limit: undefined,
  type: undefined,
  sort: undefined,
  lang: undefined,
  rating: undefined,
  channel: undefined,
};

describe("find_gif tool (giphy)", () => {
  it("returns an error when the API key is missing", async () => {
    const tool = createFindGifTool({
      getApiKey: () => undefined,
      searchGiphy: async () => [],
    });
    const result = await tool.handler(BASE_ARGS, SESSION);
    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("GIPHY_API_KEY"));
    assert.ok(parsed.error.includes("data/auth/.env"));
  });

  it("returns an array of gif results on success", async () => {
    const fake: GifResult[] = [
      { url: "https://x/main.gif", previewUrl: "https://x/tiny.gif", title: "party" },
    ];
    const tool = createFindGifTool({
      getApiKey: () => "real-key",
      searchGiphy: async () => fake,
    });
    const result = await tool.handler({ ...BASE_ARGS, query: "party" }, SESSION);
    assert.equal(result.isError, undefined);
    const parsed = parseToolResult(result);
    assert.deepEqual(parsed, fake);
  });

  it("defaults limit to 1 when unset", async () => {
    let receivedLimit: number | undefined;
    const tool = createFindGifTool({
      getApiKey: () => "k",
      searchGiphy: async (params: SearchGiphyParams) => {
        receivedLimit = params.limit;
        return [];
      },
    });
    await tool.handler(BASE_ARGS, SESSION);
    assert.equal(receivedLimit, 1);
  });

  it("passes an explicit limit through to Giphy", async () => {
    let receivedLimit: number | undefined;
    const tool = createFindGifTool({
      getApiKey: () => "k",
      searchGiphy: async (params: SearchGiphyParams) => {
        receivedLimit = params.limit;
        return [];
      },
    });
    await tool.handler({ ...BASE_ARGS, limit: 5 }, SESSION);
    assert.equal(receivedLimit, 5);
  });

  it("forwards type/sort/lang/rating/channel through to searchGiphy", async () => {
    let received: SearchGiphyParams | undefined;
    const tool = createFindGifTool({
      getApiKey: () => "k",
      searchGiphy: async (params: SearchGiphyParams) => {
        received = params;
        return [];
      },
    });
    await tool.handler(
      {
        ...BASE_ARGS,
        type: "stickers",
        sort: "recent",
        lang: "fr",
        rating: "pg",
        channel: "nba",
      },
      SESSION,
    );
    assert.equal(received?.type, "stickers");
    assert.equal(received?.sort, "recent");
    assert.equal(received?.lang, "fr");
    assert.equal(received?.rating, "pg");
    assert.equal(received?.channel, "nba");
  });

  it("returns an error envelope when Giphy throws GiphyError", async () => {
    const tool = createFindGifTool({
      getApiKey: () => "k",
      searchGiphy: async () => {
        throw new GiphyError("boom", "https://api.giphy.com/...", 500, "Server Error");
      },
    });
    const result = await tool.handler(BASE_ARGS, SESSION);
    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("HTTP 500"));
  });

  it("returns an error envelope on generic errors", async () => {
    const tool = createFindGifTool({
      getApiKey: () => "k",
      searchGiphy: async () => {
        throw new Error("network down");
      },
    });
    const result = await tool.handler(BASE_ARGS, SESSION);
    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("network down"));
  });
});
