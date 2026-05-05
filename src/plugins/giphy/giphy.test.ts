import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { searchGiphy, GiphyError, type GiphyGifLike, type GiphySearchClient } from "./giphy.js";
import type { SearchOptions } from "@giphy/js-fetch-api";

interface RecordedCall {
  apiKey: string;
  term: string;
  options?: SearchOptions;
}

function buildClientMock(data: GiphyGifLike[] | (() => Promise<never>)) {
  const calls: RecordedCall[] = [];
  const factory = (apiKey: string): GiphySearchClient => ({
    async search(term, options) {
      calls.push({ apiKey, term, options });
      if (typeof data === "function") return data();
      return { data };
    },
  });
  return { factory, calls };
}

describe("searchGiphy", () => {
  it("parses a successful response and prefers original.url over downsized_medium.url", async () => {
    const { factory } = buildClientMock([
      {
        title: "celebrate party",
        images: {
          original: { url: "https://media.giphy.com/main.gif" },
          downsized_medium: { url: "https://media.giphy.com/med.gif" },
          fixed_width_small: { url: "https://media.giphy.com/tiny.gif" },
          preview_gif: { url: "https://media.giphy.com/preview.gif" },
        },
      },
    ]);

    const results = await searchGiphy({
      query: "party",
      limit: 1,
      apiKey: "k",
      clientFactory: factory,
      randomImpl: () => 0,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].url, "https://media.giphy.com/main.gif");
    assert.equal(results[0].previewUrl, "https://media.giphy.com/tiny.gif");
    assert.equal(results[0].title, "celebrate party");
  });

  it("falls back to downsized_medium when original is absent", async () => {
    const { factory } = buildClientMock([
      {
        images: {
          downsized_medium: { url: "https://media.giphy.com/med.gif" },
          fixed_width_small: { url: "https://media.giphy.com/tiny.gif" },
        },
      },
    ]);

    const results = await searchGiphy({
      query: "x",
      limit: 1,
      apiKey: "k",
      clientFactory: factory,
    });
    assert.equal(results[0].url, "https://media.giphy.com/med.gif");
  });

  it("falls back to preview_gif when fixed_width_small is absent", async () => {
    const { factory } = buildClientMock([
      {
        images: {
          original: { url: "https://media.giphy.com/main.gif" },
          preview_gif: { url: "https://media.giphy.com/preview.gif" },
        },
      },
    ]);

    const results = await searchGiphy({
      query: "x",
      limit: 1,
      apiKey: "k",
      clientFactory: factory,
    });
    assert.equal(results[0].previewUrl, "https://media.giphy.com/preview.gif");
  });

  it("skips results with no usable url", async () => {
    const { factory } = buildClientMock([
      { images: {} },
      {
        images: {
          original: { url: "https://media.giphy.com/ok.gif" },
          fixed_width_small: { url: "https://media.giphy.com/tiny.gif" },
        },
      },
    ]);

    const results = await searchGiphy({
      query: "x",
      limit: 2,
      apiKey: "k",
      clientFactory: factory,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].url, "https://media.giphy.com/ok.gif");
  });

  it("returns an empty array when Giphy returns no results", async () => {
    const { factory } = buildClientMock([]);
    const results = await searchGiphy({
      query: "x",
      limit: 1,
      apiKey: "k",
      clientFactory: factory,
    });
    assert.deepEqual(results, []);
  });

  it("propagates errors thrown by the SDK", async () => {
    const factory = (_apiKey: string): GiphySearchClient => ({
      async search() {
        throw new GiphyError("forbidden", "https://api.giphy.com/...", 403, "Forbidden");
      },
    });
    await assert.rejects(
      () =>
        searchGiphy({
          query: "x",
          limit: 1,
          apiKey: "k",
          clientFactory: factory,
        }),
      (err) => err instanceof GiphyError && err.status === 403,
    );
  });

  it("forwards limit, rating, lang, sort, type, channel, and a randomized offset", async () => {
    const { factory, calls } = buildClientMock([]);
    await searchGiphy({
      query: "facepalm",
      limit: 3,
      apiKey: "test-key",
      type: "stickers",
      sort: "recent",
      lang: "fr",
      rating: "pg",
      channel: "nba",
      clientFactory: factory,
      randomImpl: () => 0.5,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].apiKey, "test-key");
    assert.equal(calls[0].term, "facepalm");
    assert.equal(calls[0].options?.limit, 3);
    assert.equal(calls[0].options?.rating, "pg");
    assert.equal(calls[0].options?.lang, "fr");
    assert.equal(calls[0].options?.sort, "recent");
    assert.equal(calls[0].options?.type, "stickers");
    assert.equal(calls[0].options?.channel, "nba");
    assert.equal(calls[0].options?.offset, 12);
  });

  it("applies SFW defaults when optional params are omitted", async () => {
    const { factory, calls } = buildClientMock([]);
    await searchGiphy({
      query: "x",
      limit: 1,
      apiKey: "k",
      clientFactory: factory,
      randomImpl: () => 0,
    });
    assert.equal(calls[0].options?.rating, "g");
    assert.equal(calls[0].options?.lang, "en");
    assert.equal(calls[0].options?.sort, "relevant");
    assert.equal(calls[0].options?.type, "gifs");
    assert.equal(calls[0].options?.channel, undefined);
  });
});
