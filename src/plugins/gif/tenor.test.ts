import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { searchTenor, TenorError } from "./tenor.js";

interface MockResponseSpec {
  ok: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}

function buildFetchMock(responses: MockResponseSpec[]) {
  const calls: string[] = [];
  let i = 0;
  const fetchFn: typeof fetch = async (input) => {
    calls.push(typeof input === "string" ? input : input.toString());
    const spec = responses[i++];
    const body =
      spec.text !== undefined
        ? spec.text
        : spec.json !== undefined
          ? JSON.stringify(spec.json)
          : "";
    return new Response(body, { status: spec.status ?? (spec.ok ? 200 : 500) });
  };
  return { fetchFn, calls };
}

describe("searchTenor", () => {
  it("parses a successful response and prefers gif.url over mediumgif.url", async () => {
    const { fetchFn } = buildFetchMock([
      {
        ok: true,
        json: {
          results: [
            {
              content_description: "celebrate party",
              media_formats: {
                gif: { url: "https://media.tenor.com/main.gif" },
                mediumgif: { url: "https://media.tenor.com/med.gif" },
                tinygif: { url: "https://media.tenor.com/tiny.gif" },
              },
            },
          ],
        },
      },
    ]);

    const results = await searchTenor({
      query: "party",
      limit: 1,
      apiKey: "k",
      fetchImpl: fetchFn,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].url, "https://media.tenor.com/main.gif");
    assert.equal(results[0].previewUrl, "https://media.tenor.com/tiny.gif");
    assert.equal(results[0].title, "celebrate party");
  });

  it("falls back to mediumgif when gif variant is absent", async () => {
    const { fetchFn } = buildFetchMock([
      {
        ok: true,
        json: {
          results: [
            {
              media_formats: {
                mediumgif: { url: "https://media.tenor.com/med.gif" },
                tinygif: { url: "https://media.tenor.com/tiny.gif" },
              },
            },
          ],
        },
      },
    ]);

    const results = await searchTenor({ query: "x", limit: 1, apiKey: "k", fetchImpl: fetchFn });
    assert.equal(results[0].url, "https://media.tenor.com/med.gif");
  });

  it("skips results with no usable url", async () => {
    const { fetchFn } = buildFetchMock([
      {
        ok: true,
        json: {
          results: [
            { media_formats: {} },
            {
              media_formats: {
                gif: { url: "https://media.tenor.com/ok.gif" },
                tinygif: { url: "https://media.tenor.com/tiny.gif" },
              },
            },
          ],
        },
      },
    ]);

    const results = await searchTenor({ query: "x", limit: 2, apiKey: "k", fetchImpl: fetchFn });
    assert.equal(results.length, 1);
    assert.equal(results[0].url, "https://media.tenor.com/ok.gif");
  });

  it("returns an empty array when Tenor returns no results", async () => {
    const { fetchFn } = buildFetchMock([{ ok: true, json: { results: [] } }]);
    const results = await searchTenor({ query: "x", limit: 1, apiKey: "k", fetchImpl: fetchFn });
    assert.deepEqual(results, []);
  });

  it("throws TenorError on non-200 responses", async () => {
    const { fetchFn } = buildFetchMock([{ ok: false, status: 403, text: "forbidden" }]);
    await assert.rejects(
      () => searchTenor({ query: "x", limit: 1, apiKey: "k", fetchImpl: fetchFn }),
      (err) => err instanceof TenorError && err.status === 403 && err.body === "forbidden",
    );
  });

  it("propagates network errors from fetch", async () => {
    const fetchFn: typeof fetch = async () => {
      throw new Error("network down");
    };
    await assert.rejects(
      () => searchTenor({ query: "x", limit: 1, apiKey: "k", fetchImpl: fetchFn }),
      /network down/,
    );
  });

  it("includes the required query params in the URL", async () => {
    const { fetchFn, calls } = buildFetchMock([{ ok: true, json: { results: [] } }]);
    await searchTenor({ query: "facepalm", limit: 3, apiKey: "test-key", fetchImpl: fetchFn });
    const sent = calls[0];
    assert.ok(sent.includes("q=facepalm"));
    assert.ok(sent.includes("key=test-key"));
    assert.ok(sent.includes("client_key=clack"));
    assert.ok(sent.includes("contentfilter=high"));
    assert.ok(sent.includes("random=true"));
    assert.ok(sent.includes("limit=3"));
  });
});
