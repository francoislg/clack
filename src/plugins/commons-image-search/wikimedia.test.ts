import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  fetchPageSummary,
  fetchImageInfo,
  fetchImageBytes,
  sourceFilenameFromThumbUrl,
  type WikimediaDeps,
} from "./wikimedia.js";

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

// No real timers / no real backoff: sleep is a no-op, jitter is deterministic.
const fastDeps = (fetchImpl: typeof fetch): WikimediaDeps => ({
  fetchImpl,
  sleep: async () => {},
  random: () => 0,
});

describe("fetchPageSummary", () => {
  it("returns the parsed summary on a 200", async () => {
    const fetchImpl = buildFetch([{ json: { title: "Eiffel Tower", wikibase_item: "Q243" } }]);
    const result = await fetchPageSummary("Eiffel Tower", fastDeps(fetchImpl));
    assert.ok("ok" in result);
    assert.equal(result.summary.title, "Eiffel Tower");
    assert.equal(result.summary.wikibase_item, "Q243");
  });

  it("retries a 429 then succeeds", async () => {
    const fetchImpl = buildFetch([{ status: 429 }, { json: { title: "X" } }]);
    const result = await fetchPageSummary("X", fastDeps(fetchImpl));
    assert.ok("ok" in result);
  });

  it("returns rateLimit after exhausting 429 retries", async () => {
    const fetchImpl = buildFetch([{ status: 429 }, { status: 429 }, { status: 429 }]);
    const result = await fetchPageSummary("X", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "rateLimit");
  });

  it("returns rateLimit after exhausting 503 retries", async () => {
    const fetchImpl = buildFetch([{ status: 503 }, { status: 503 }, { status: 503 }]);
    const result = await fetchPageSummary("X", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "rateLimit");
  });

  it("retries a 500 once then returns network", async () => {
    const fetchImpl = buildFetch([{ status: 500 }, { status: 500 }]);
    const result = await fetchPageSummary("X", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "network");
  });

  it("maps 404 to notFound", async () => {
    const fetchImpl = buildFetch([{ status: 404 }]);
    const result = await fetchPageSummary("X", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "notFound");
  });

  it("maps a thrown fetch (timeout) to network", async () => {
    const fetchImpl = buildFetch([{ throws: true }]);
    const result = await fetchPageSummary("X", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "network");
  });

  it("maps malformed JSON to unknown", async () => {
    const fetchImpl = buildFetch([{ text: "not json" }]);
    const result = await fetchPageSummary("X", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "unknown");
  });
});

function imageInfoResponse(extmetadata: unknown): unknown {
  return { query: { pages: { "123": { imageinfo: [{ extmetadata }] } } } };
}

describe("fetchImageInfo", () => {
  it("populates license and attribution, stripping HTML", async () => {
    const fetchImpl = buildFetch([
      {
        json: imageInfoResponse({
          LicenseShortName: { value: "CC BY-SA 4.0" },
          Artist: { value: '<a href="x">Alice Photographer</a>' },
        }),
      },
    ]);
    const result = await fetchImageInfo("Foo.jpg", fastDeps(fetchImpl));
    assert.ok("ok" in result);
    assert.equal(result.license, "CC BY-SA 4.0");
    assert.equal(result.attribution, "Alice Photographer");
  });

  it("falls back LicenseShortName -> UsageTerms and Artist -> Credit", async () => {
    const fetchImpl = buildFetch([
      {
        json: imageInfoResponse({
          UsageTerms: { value: "Public domain" },
          Credit: { value: "Some Archive" },
        }),
      },
    ]);
    const result = await fetchImageInfo("Foo.jpg", fastDeps(fetchImpl));
    assert.ok("ok" in result);
    assert.equal(result.license, "Public domain");
    assert.equal(result.attribution, "Some Archive");
  });

  it("defaults license and attribution when extmetadata is empty", async () => {
    const fetchImpl = buildFetch([{ json: imageInfoResponse({}) }]);
    const result = await fetchImageInfo("Foo.jpg", fastDeps(fetchImpl));
    assert.ok("ok" in result);
    assert.equal(result.license, "unknown");
    assert.equal(result.attribution, "via Wikimedia Commons");
  });
});

describe("fetchImageBytes", () => {
  it("returns base64 data and mime from the content-type header", async () => {
    const fetchImpl = buildFetch([
      { bytes: new Uint8Array([1, 2, 3, 4]), contentType: "image/png" },
    ]);
    const result = await fetchImageBytes("https://x/thumb/a/Foo.png", fastDeps(fetchImpl));
    assert.ok("ok" in result);
    assert.equal(result.mimeType, "image/png");
    assert.equal(result.data, Buffer.from([1, 2, 3, 4]).toString("base64"));
  });

  it("infers mime from the URL extension when no content-type header", async () => {
    const fetchImpl = buildFetch([{ bytes: new Uint8Array([9]) }]);
    const result = await fetchImageBytes("https://x/Foo.jpeg", fastDeps(fetchImpl));
    assert.ok("ok" in result);
    assert.equal(result.mimeType, "image/jpeg");
  });

  it("rejects SVG content as unsupportedFormat", async () => {
    const fetchImpl = buildFetch([{ bytes: new Uint8Array([1]), contentType: "image/svg+xml" }]);
    const result = await fetchImageBytes("https://x/Foo", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "unsupportedFormat");
  });

  it("rejects oversized payloads as unsupportedFormat", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    const fetchImpl = buildFetch([{ bytes: big, contentType: "image/png" }]);
    const result = await fetchImageBytes("https://x/Foo.png", fastDeps(fetchImpl));
    assert.equal("ok" in result ? "ok" : result.kind, "unsupportedFormat");
  });
});

describe("sourceFilenameFromThumbUrl", () => {
  it("extracts the source file from a thumbnail URL", () => {
    const url =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Flag_of_Ecuador.svg/320px-Flag_of_Ecuador.svg.png";
    assert.equal(sourceFilenameFromThumbUrl(url), "Flag_of_Ecuador.svg");
  });

  it("URL-decodes the source filename", () => {
    const url =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Caf%C3%A9_de_Flore.jpg/320px-Caf%C3%A9_de_Flore.jpg";
    assert.equal(sourceFilenameFromThumbUrl(url), "Café_de_Flore.jpg");
  });

  it("falls back to the last segment for non-thumb URLs", () => {
    const url = "https://upload.wikimedia.org/wikipedia/commons/a/a1/Foo.png";
    assert.equal(sourceFilenameFromThumbUrl(url), "Foo.png");
  });
});
