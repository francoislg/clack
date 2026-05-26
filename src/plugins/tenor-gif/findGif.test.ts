import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createFindGifTool } from "./findGif.js";
import { parseToolResult } from "../../tools/testHelpers.js";
import { TenorError, type SearchTenorParams } from "./tenor.js";
import type { GifResult } from "./types.js";

const SESSION = { sessionId: "test" };

describe("find_gif tool", () => {
  it("returns an error when the API key is missing", async () => {
    const tool = createFindGifTool({
      getApiKey: () => undefined,
      searchTenor: async () => [],
    });
    const result = await tool.handler({ query: "x", limit: undefined }, SESSION);
    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("GIF_TENOR_API_KEY"));
    assert.ok(parsed.error.includes("data/auth/.env"));
  });

  it("returns an array of gif results on success", async () => {
    const fake: GifResult[] = [
      { url: "https://x/main.gif", previewUrl: "https://x/tiny.gif", title: "party" },
    ];
    const tool = createFindGifTool({
      getApiKey: () => "real-key",
      searchTenor: async () => fake,
    });
    const result = await tool.handler({ query: "party", limit: undefined }, SESSION);
    assert.equal(result.isError, undefined);
    const parsed = parseToolResult(result);
    assert.deepEqual(parsed, fake);
  });

  it("defaults limit to 1 when unset", async () => {
    let receivedLimit: number | undefined;
    const tool = createFindGifTool({
      getApiKey: () => "k",
      searchTenor: async (params: SearchTenorParams) => {
        receivedLimit = params.limit;
        return [];
      },
    });
    await tool.handler({ query: "x", limit: undefined }, SESSION);
    assert.equal(receivedLimit, 1);
  });

  it("passes an explicit limit through to Tenor", async () => {
    let receivedLimit: number | undefined;
    const tool = createFindGifTool({
      getApiKey: () => "k",
      searchTenor: async (params: SearchTenorParams) => {
        receivedLimit = params.limit;
        return [];
      },
    });
    await tool.handler({ query: "x", limit: 5 }, SESSION);
    assert.equal(receivedLimit, 5);
  });

  it("returns an error envelope when Tenor throws TenorError", async () => {
    const tool = createFindGifTool({
      getApiKey: () => "k",
      searchTenor: async () => {
        throw new TenorError("boom", 500, "server error");
      },
    });
    const result = await tool.handler({ query: "x", limit: undefined }, SESSION);
    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("HTTP 500"));
  });

  it("returns an error envelope on generic errors", async () => {
    const tool = createFindGifTool({
      getApiKey: () => "k",
      searchTenor: async () => {
        throw new Error("network down");
      },
    });
    const result = await tool.handler({ query: "x", limit: undefined }, SESSION);
    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error.includes("network down"));
  });
});
