import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  loadTmdbReadToken,
  searchMovies,
  searchTv,
  searchPerson,
  fetchTextlessBackdrops,
  pickBestBackdrop,
  cdnUrl,
  fetchImageBytes,
  type TmdbDeps,
} from "./tmdb.js";

interface MockResponseSpec {
  status?: number;
  json?: unknown;
  text?: string;
  bytes?: Uint8Array;
  contentType?: string;
  throws?: boolean;
}

interface CapturedRequest {
  url: string;
  headers: { [name: string]: string };
}

function buildFetch(responses: MockResponseSpec[], captured: CapturedRequest[] = []): typeof fetch {
  let i = 0;
  const fetchFn: typeof fetch = async (input, init) => {
    captured.push({
      url: String(input),
      headers: { ...((init?.headers ?? {}) as { [name: string]: string }) },
    });
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

const fastDeps = (fetchImpl: typeof fetch): TmdbDeps => ({
  fetchImpl,
  sleep: async () => {},
  random: () => 0,
});

describe("loadTmdbReadToken", () => {
  it("returns the token when present", () => {
    assert.equal(loadTmdbReadToken({ TMDB_READ_TOKEN: "tok" }), "tok");
  });
  it("returns null when absent or blank", () => {
    assert.equal(loadTmdbReadToken({}), null);
    assert.equal(loadTmdbReadToken({ TMDB_READ_TOKEN: "   " }), null);
  });
});

describe("searchMovies / searchTv / searchPerson", () => {
  it("returns the results array on a 200 and sends Bearer auth", async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = buildFetch(
      [{ json: { results: [{ id: 550, title: "Fight Club" }] } }],
      captured,
    );
    const r = await searchMovies("Fight Club", "tok", fastDeps(fetchImpl));
    assert.ok("ok" in r);
    assert.equal(r.results[0].id, 550);
    assert.equal(captured[0].headers.Authorization, "Bearer tok");
    assert.match(captured[0].url, /\/search\/movie\?/);
    assert.match(captured[0].url, /include_adult=false/);
    assert.doesNotMatch(captured[0].url, /api_key=/);
  });

  it("hits the tv and person endpoints", async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = buildFetch([{ json: { results: [] } }], captured);
    await searchTv("GoT", "tok", fastDeps(fetchImpl));
    await searchPerson("Brad", "tok", fastDeps(fetchImpl));
    assert.match(captured[0].url, /\/search\/tv\?/);
    assert.match(captured[1].url, /\/search\/person\?/);
    assert.equal(captured[0].headers.Authorization, "Bearer tok");
    assert.equal(captured[1].headers.Authorization, "Bearer tok");
  });

  it("returns an empty results array as-is (zero-result handling is the tool's)", async () => {
    const fetchImpl = buildFetch([{ json: { results: [] } }]);
    const r = await searchMovies("q", "tok", fastDeps(fetchImpl));
    assert.ok("ok" in r);
    assert.equal(r.results.length, 0);
  });

  it("retries a 429 then succeeds", async () => {
    const fetchImpl = buildFetch([{ status: 429 }, { json: { results: [{ id: 1 }] } }]);
    const r = await searchMovies("q", "tok", fastDeps(fetchImpl));
    assert.ok("ok" in r);
  });

  it("returns rateLimit when the 429 retry also fails", async () => {
    const fetchImpl = buildFetch([{ status: 429 }, { status: 429 }]);
    const r = await searchMovies("q", "tok", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "rateLimit");
  });

  it("retries a 500 once then returns network", async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = buildFetch([{ status: 500 }, { status: 500 }], captured);
    const r = await searchMovies("q", "tok", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "network");
    assert.equal(captured.length, 2);
  });

  it("maps a thrown fetch (timeout) to network without retrying", async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = buildFetch([{ throws: true }], captured);
    const r = await searchMovies("q", "tok", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "network");
    assert.equal(captured.length, 1);
  });

  it("maps a missing results field to unknown", async () => {
    const fetchImpl = buildFetch([{ json: { somethingElse: true } }]);
    const r = await searchMovies("q", "tok", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "unknown");
  });

  it("maps a non-JSON 200 body to unknown", async () => {
    const fetchImpl = buildFetch([{ text: "<html>oops</html>" }]);
    const r = await searchMovies("q", "tok", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "unknown");
  });
});

describe("fetchTextlessBackdrops", () => {
  it("requests include_image_language=null with Bearer auth and returns backdrops", async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = buildFetch(
      [{ json: { backdrops: [{ file_path: "/a.jpg", vote_average: 5 }] } }],
      captured,
    );
    const r = await fetchTextlessBackdrops("movie", 550, "tok", fastDeps(fetchImpl));
    assert.ok("ok" in r);
    assert.equal(r.backdrops[0].file_path, "/a.jpg");
    assert.match(captured[0].url, /\/movie\/550\/images\?include_image_language=null/);
    assert.equal(captured[0].headers.Authorization, "Bearer tok");
  });

  it("uses the tv path for tv lookups", async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = buildFetch([{ json: { backdrops: [] } }], captured);
    await fetchTextlessBackdrops("tv", 1399, "tok", fastDeps(fetchImpl));
    assert.match(captured[0].url, /\/tv\/1399\/images\?include_image_language=null/);
  });

  it("maps a missing backdrops field to unknown", async () => {
    const fetchImpl = buildFetch([{ json: {} }]);
    const r = await fetchTextlessBackdrops("movie", 550, "tok", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "unknown");
  });

  it("retries a 500 once then returns network", async () => {
    const fetchImpl = buildFetch([{ status: 500 }, { status: 500 }]);
    const r = await fetchTextlessBackdrops("movie", 550, "tok", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "network");
  });
});

describe("pickBestBackdrop", () => {
  it("picks the highest vote_average", () => {
    const picked = pickBestBackdrop(
      [
        { file_path: "/a.jpg", vote_average: 5.2 },
        { file_path: "/b.jpg", vote_average: 7.8 },
      ],
      null,
    );
    assert.equal(picked, "/b.jpg");
  });

  it("breaks ties by array order", () => {
    const picked = pickBestBackdrop(
      [
        { file_path: "/a.jpg", vote_average: 7 },
        { file_path: "/b.jpg", vote_average: 7 },
      ],
      null,
    );
    assert.equal(picked, "/a.jpg");
  });

  it("falls back to the search backdrop_path when backdrops is empty", () => {
    assert.equal(pickBestBackdrop([], "/c.jpg"), "/c.jpg");
  });

  it("returns null when backdrops is empty and no search fallback exists", () => {
    assert.equal(pickBestBackdrop([], null), null);
  });
});

describe("cdnUrl", () => {
  it("joins base, size and path", () => {
    assert.equal(cdnUrl("w780", "/b.jpg"), "https://image.tmdb.org/t/p/w780/b.jpg");
  });
});

describe("fetchImageBytes", () => {
  it("returns base64 data + mime from the content-type header, with Bearer auth", async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = buildFetch(
      [{ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" }],
      captured,
    );
    const r = await fetchImageBytes(
      "https://image.tmdb.org/t/p/w780/a.jpg",
      "tok",
      fastDeps(fetchImpl),
    );
    assert.ok("ok" in r);
    assert.equal(r.mimeType, "image/jpeg");
    assert.equal(r.data, Buffer.from([1, 2, 3]).toString("base64"));
    assert.equal(captured[0].headers.Authorization, "Bearer tok");
  });

  it("falls back to image/jpeg when Content-Type is absent", async () => {
    const fetchImpl = buildFetch([{ bytes: new Uint8Array([1]) }]);
    const r = await fetchImageBytes("https://x/a.jpg", "tok", fastDeps(fetchImpl));
    assert.ok("ok" in r);
    assert.equal(r.mimeType, "image/jpeg");
  });

  it("maps a CDN 404 to network", async () => {
    const fetchImpl = buildFetch([{ status: 404 }]);
    const r = await fetchImageBytes("https://x/a.jpg", "tok", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "network");
  });

  it("retries a CDN 500 once then returns network", async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = buildFetch([{ status: 500 }, { status: 500 }], captured);
    const r = await fetchImageBytes("https://x/a.jpg", "tok", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "network");
    assert.equal(captured.length, 2);
  });

  it("recovers when the CDN 500 retry succeeds", async () => {
    const fetchImpl = buildFetch([
      { status: 500 },
      { bytes: new Uint8Array([1]), contentType: "image/png" },
    ]);
    const r = await fetchImageBytes("https://x/a.png", "tok", fastDeps(fetchImpl));
    assert.ok("ok" in r);
    assert.equal(r.mimeType, "image/png");
  });

  it("rejects an oversized image as tooLarge", async () => {
    const fetchImpl = buildFetch([
      { bytes: new Uint8Array(5 * 1024 * 1024 + 1), contentType: "image/jpeg" },
    ]);
    const r = await fetchImageBytes("https://x/a.jpg", "tok", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "tooLarge");
  });

  it("rejects an HTML Content-Type as unsupportedFormat", async () => {
    const fetchImpl = buildFetch([{ text: "<html/>", contentType: "text/html" }]);
    const r = await fetchImageBytes("https://x/a.jpg", "tok", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "unsupportedFormat");
  });

  it("rejects SVG as unsupportedFormat", async () => {
    const fetchImpl = buildFetch([{ bytes: new Uint8Array([1]), contentType: "image/svg+xml" }]);
    const r = await fetchImageBytes("https://x/a.svg", "tok", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "unsupportedFormat");
  });

  it("maps a download failure to network", async () => {
    const fetchImpl = buildFetch([{ throws: true }]);
    const r = await fetchImageBytes("https://x/a.jpg", "tok", fastDeps(fetchImpl));
    assert.equal("ok" in r ? "ok" : r.kind, "network");
  });
});
