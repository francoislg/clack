import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  loadBraveApiKey,
  searchImages,
  fetchImageBytes,
  selectRenderableResult,
  type BraveDeps,
  type BraveImageResult,
} from "./brave.js";

interface MockResponseSpec {
  status?: number;
  json?: unknown;
  text?: string;
  bytes?: Uint8Array;
  contentType?: string;
  throws?: boolean;
}

function buildFetch(responses: MockResponseSpec[]): typeof fetch {
  let i = 0;
  const fetchFn: typeof fetch = async () => {
    const spec = responses[Math.min(i, responses.length - 1)];
    i++;
    if (spec.throws) throw new Error("aborted");
    const headers: { [k: string]: string } = {};
    if (spec.contentType) headers["content-type"] = spec.contentType;
    const body =
      spec.bytes !== undefined
        ? spec.bytes
        : spec.text !== undefined
          ? spec.text
          : spec.json !== undefined
            ? JSON.stringify(spec.json)
            : "";
    return new Response(body, { status: spec.status ?? 200, headers });
  };
  return fetchFn;
}

const fastDeps = (fetchImpl: typeof fetch): BraveDeps => ({
  fetchImpl,
  sleep: async () => {},
  random: () => 0,
});

function result(url: string, source?: string, title?: string): BraveImageResult {
  return { properties: { url }, source, title };
}

describe("loadBraveApiKey", () => {
  it("returns the key when present", () => {
    assert.equal(loadBraveApiKey({ BRAVE_API_KEY: "abc" }), "abc");
  });
  it("returns null when absent or blank", () => {
    assert.equal(loadBraveApiKey({}), null);
    assert.equal(loadBraveApiKey({ BRAVE_API_KEY: "   " }), null);
  });
});

describe("searchImages", () => {
  it("returns the results array on a 200", async () => {
    const fetchImpl = buildFetch([{ json: { results: [result("https://x/a.jpg")] } }]);
    const r = await searchImages("q", "k", fastDeps(fetchImpl));
    assert.ok("ok" in r);
    assert.equal(r.results.length, 1);
  });

  it("retries a 429 then succeeds", async () => {
    const fetchImpl = buildFetch([
      { status: 429 },
      { json: { results: [result("https://x/a.jpg")] } },
    ]);
    const r = await searchImages("q", "k", fastDeps(fetchImpl));
    assert.ok("ok" in r);
  });

  it("returns rateLimit when the 429 retry also fails", async () => {
    const fetchImpl = buildFetch([{ status: 429 }, { status: 429 }]);
    const r = await searchImages("q", "k", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "rateLimit");
  });

  it("retries a 500 once then returns network", async () => {
    const fetchImpl = buildFetch([{ status: 500 }, { status: 500 }]);
    const r = await searchImages("q", "k", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "network");
  });

  it("maps a thrown fetch (timeout) to network", async () => {
    const fetchImpl = buildFetch([{ throws: true }]);
    const r = await searchImages("q", "k", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "network");
  });

  it("maps empty results to notFound", async () => {
    const fetchImpl = buildFetch([{ json: { results: [] } }]);
    const r = await searchImages("q", "k", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "notFound");
  });

  it("maps a missing results field to unknown", async () => {
    const fetchImpl = buildFetch([{ json: { somethingElse: true } }]);
    const r = await searchImages("q", "k", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "unknown");
  });
});

describe("selectRenderableResult", () => {
  it("skips an SVG and selects the next JPEG", () => {
    const selected = selectRenderableResult([result("https://x/a.svg"), result("https://x/b.jpg")]);
    assert.equal(selected?.imageUrl, "https://x/b.jpg");
  });

  it("accepts renderable extensions case-insensitively with query strings", () => {
    const selected = selectRenderableResult([result("https://x/b.PNG?w=320")]);
    assert.equal(selected?.imageUrl, "https://x/b.PNG?w=320");
  });

  it("returns undefined when no top-10 result is renderable", () => {
    const svgs = Array.from({ length: 12 }, (_, n) => result(`https://x/${n}.svg`));
    assert.equal(selectRenderableResult(svgs), undefined);
  });

  it("does not consider results past index 10", () => {
    const padded = [
      ...Array.from({ length: 10 }, (_, n) => result(`https://x/${n}.svg`)),
      result("https://x/winner.jpg"),
    ];
    assert.equal(selectRenderableResult(padded), undefined);
  });
});

describe("fetchImageBytes", () => {
  it("returns base64 data + mime from the content-type header", async () => {
    const fetchImpl = buildFetch([{ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" }]);
    const r = await fetchImageBytes("https://x/a.jpg", fastDeps(fetchImpl));
    assert.ok("ok" in r);
    assert.equal(r.mimeType, "image/jpeg");
    assert.equal(r.data, Buffer.from([1, 2, 3]).toString("base64"));
  });

  it("rejects SVG as unsupportedFormat", async () => {
    const fetchImpl = buildFetch([{ bytes: new Uint8Array([1]), contentType: "image/svg+xml" }]);
    const r = await fetchImageBytes("https://x/a", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "unsupportedFormat");
  });

  it("maps a download failure to network", async () => {
    const fetchImpl = buildFetch([{ throws: true }]);
    const r = await fetchImageBytes("https://x/a.jpg", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "network");
  });

  it("retries a 500 once then returns network", async () => {
    const fetchImpl = buildFetch([{ status: 500 }, { status: 500 }]);
    const r = await fetchImageBytes("https://x/a.jpg", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "network");
  });

  it("recovers when the 500 retry succeeds", async () => {
    const fetchImpl = buildFetch([
      { status: 500 },
      { bytes: new Uint8Array([1]), contentType: "image/jpeg" },
    ]);
    const r = await fetchImageBytes("https://x/a.jpg", fastDeps(fetchImpl));
    assert.ok("ok" in r);
  });
});
