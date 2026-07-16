import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  searchReleaseGroups,
  fetchFrontCover,
  fetchImageBytes,
  frontCoverUrl,
  type MusicBrainzDeps,
} from "./musicbrainz.js";

interface MockResponseSpec {
  status?: number;
  json?: unknown;
  /** Raw body string (e.g. invalid JSON to trigger the malformed-body path). */
  text?: string;
  bytes?: Uint8Array;
  contentType?: string;
  /** When set, the fetch rejects (timeout / connection failure). */
  throws?: boolean;
}

interface CapturedRequest {
  url: string;
  headers: { [name: string]: string };
}

function buildFetch(responses: MockResponseSpec[], captured?: CapturedRequest[]): typeof fetch {
  let i = 0;
  const fetchFn: typeof fetch = async (input, init) => {
    const spec = responses[Math.min(i, responses.length - 1)];
    i++;
    captured?.push({
      url: String(input),
      headers: (init?.headers as { [name: string]: string }) ?? {},
    });
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

// No real timers / no real backoff: sleep is a no-op, jitter is deterministic.
const fastDeps = (fetchImpl: typeof fetch): MusicBrainzDeps => ({
  fetchImpl,
  sleep: async () => {},
  random: () => 0,
});

describe("searchReleaseGroups", () => {
  it("returns the release-groups on a 200", async () => {
    const fetchImpl = buildFetch([
      {
        json: {
          "release-groups": [
            { id: "abc", title: "Nevermind", "artist-credit": [{ name: "Nirvana" }] },
          ],
        },
      },
    ]);
    const result = await searchReleaseGroups("Nirvana Nevermind", fastDeps(fetchImpl));
    assert.ok("ok" in result);
    assert.equal(result.releaseGroups.length, 1);
    assert.equal(result.releaseGroups[0].id, "abc");
    assert.equal(result.releaseGroups[0].title, "Nevermind");
    assert.equal(result.releaseGroups[0]["artist-credit"]?.[0]?.name, "Nirvana");
  });

  it("sends the descriptive User-Agent, Accept header, and encoded query", async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = buildFetch([{ json: { "release-groups": [] } }], captured);
    await searchReleaseGroups("Björk / Homogenic", fastDeps(fetchImpl));
    assert.equal(captured.length, 1);
    assert.match(captured[0].headers["User-Agent"], /^Clack-Trivia-Image-Search\/1\.0 \(.+\)$/);
    assert.equal(captured[0].headers["Accept"], "application/json");
    assert.ok(captured[0].url.includes(`query=${encodeURIComponent("Björk / Homogenic")}`));
    assert.ok(captured[0].url.includes("fmt=json"));
    assert.ok(captured[0].url.includes("limit=10"));
  });

  it("returns ok with an empty list when release-groups is empty", async () => {
    const fetchImpl = buildFetch([{ json: { "release-groups": [] } }]);
    const result = await searchReleaseGroups("X", fastDeps(fetchImpl));
    assert.ok("ok" in result);
    assert.equal(result.releaseGroups.length, 0);
  });

  it("retries a 503 then succeeds", async () => {
    const fetchImpl = buildFetch([{ status: 503 }, { json: { "release-groups": [] } }]);
    const result = await searchReleaseGroups("X", fastDeps(fetchImpl));
    assert.ok("ok" in result);
  });

  it("returns rateLimit after exhausting 429 retries", async () => {
    const fetchImpl = buildFetch([{ status: 429 }, { status: 429 }, { status: 429 }]);
    const result = await searchReleaseGroups("X", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "rateLimit");
  });

  it("retries a 500 once then returns network", async () => {
    const fetchImpl = buildFetch([{ status: 500 }, { status: 500 }]);
    const result = await searchReleaseGroups("X", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "network");
  });

  it("maps a thrown fetch (timeout) to network", async () => {
    const fetchImpl = buildFetch([{ throws: true }]);
    const result = await searchReleaseGroups("X", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "network");
  });

  it("maps malformed JSON to unknown", async () => {
    const fetchImpl = buildFetch([{ text: "not json" }]);
    const result = await searchReleaseGroups("X", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "unknown");
  });

  it("maps a missing release-groups array to unknown", async () => {
    const fetchImpl = buildFetch([{ json: { count: 0 } }]);
    const result = await searchReleaseGroups("X", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "unknown");
  });
});

describe("fetchFrontCover", () => {
  it("returns the canonical front-500 URL on a 200", async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = buildFetch([{ bytes: new Uint8Array([1]) }], captured);
    const result = await fetchFrontCover("abc", fastDeps(fetchImpl));
    assert.ok("ok" in result);
    assert.equal(result.coverUrl, "https://coverartarchive.org/release-group/abc/front-500");
    assert.equal(result.coverUrl, frontCoverUrl("abc"));
    assert.match(captured[0].headers["User-Agent"], /^Clack-Trivia-Image-Search\/1\.0/);
  });

  it("maps a 404 (no cover art) to notFound", async () => {
    const fetchImpl = buildFetch([{ status: 404 }]);
    const result = await fetchFrontCover("abc", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "notFound");
  });

  it("retries a 503 then succeeds", async () => {
    const fetchImpl = buildFetch([{ status: 503 }, { bytes: new Uint8Array([1]) }]);
    const result = await fetchFrontCover("abc", fastDeps(fetchImpl));
    assert.ok("ok" in result);
  });

  it("retries a 500 once then returns network", async () => {
    const fetchImpl = buildFetch([{ status: 500 }, { status: 500 }]);
    const result = await fetchFrontCover("abc", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "network");
  });
});

describe("fetchImageBytes", () => {
  it("returns base64 data and mime from the content-type header", async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = buildFetch(
      [{ bytes: new Uint8Array([1, 2, 3, 4]), contentType: "image/jpeg" }],
      captured,
    );
    const result = await fetchImageBytes(frontCoverUrl("abc"), fastDeps(fetchImpl));
    assert.ok("ok" in result);
    assert.equal(result.mimeType, "image/jpeg");
    assert.equal(result.data, Buffer.from([1, 2, 3, 4]).toString("base64"));
    assert.match(captured[0].headers["User-Agent"], /^Clack-Trivia-Image-Search\/1\.0/);
  });

  it("infers mime from the URL extension when no content-type header", async () => {
    const fetchImpl = buildFetch([{ bytes: new Uint8Array([9]) }]);
    const result = await fetchImageBytes("https://x/cover.jpeg", fastDeps(fetchImpl));
    assert.ok("ok" in result);
    assert.equal(result.mimeType, "image/jpeg");
  });

  it("rejects SVG content with unsupportedFormat", async () => {
    const fetchImpl = buildFetch([{ bytes: new Uint8Array([1]), contentType: "image/svg+xml" }]);
    const result = await fetchImageBytes("https://x/cover", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "unsupportedFormat");
  });

  it("rejects oversized payloads with unsupportedFormat", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    const fetchImpl = buildFetch([{ bytes: big, contentType: "image/png" }]);
    const result = await fetchImageBytes("https://x/cover.png", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "unsupportedFormat");
  });

  it("maps a missing extension with no content-type header to unknown", async () => {
    const fetchImpl = buildFetch([{ bytes: new Uint8Array([1]) }]);
    const result = await fetchImageBytes("https://x/cover", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "unknown");
  });

  it("maps a non-image content-type to unknown", async () => {
    const fetchImpl = buildFetch([{ text: "<html/>", contentType: "text/html" }]);
    const result = await fetchImageBytes("https://x/cover", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "unknown");
  });

  it("maps a transport failure to network", async () => {
    const fetchImpl = buildFetch([{ throws: true }]);
    const result = await fetchImageBytes("https://x/cover.png", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "network");
  });
});
