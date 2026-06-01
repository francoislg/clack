import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createFindImageTool, type FindImageDeps } from "./findImage.js";
import type { BraveImageResult, SourceError } from "./brave.js";

function result(url: string, source?: string, title?: string): BraveImageResult {
  return { properties: { url }, source, title };
}

function makeDeps(overrides: Partial<FindImageDeps> = {}): FindImageDeps {
  return {
    loadApiKey: () => "test-key",
    searchImages: async () => ({
      ok: true,
      results: [
        result("https://cdn.example.com/a.jpg", "https://en.wikipedia.org/wiki/Foo", "Foo"),
      ],
    }),
    fetchImageBytes: async () => ({ ok: true, data: "QUJD", mimeType: "image/jpeg" }),
    ...overrides,
  };
}

interface TextBlock {
  type: "text";
  text: string;
}
function isTextBlock(block: { type: string }): block is TextBlock {
  return block.type === "text";
}

async function run(deps: FindImageDeps, query: string) {
  const r = await createFindImageTool(deps).handler({ query }, {});
  const textBlock = r.content.find(isTextBlock);
  const parsed = textBlock ? JSON.parse(textBlock.text) : undefined;
  return { result: r, parsed };
}

describe("find_image tool", () => {
  it("returns a data-mode image block + metadata with a brave: subjectId", async () => {
    const { result: r, parsed } = await run(makeDeps(), "Foo");
    assert.ok(r.content.find((b) => b.type === "image"));
    assert.equal(parsed.source, "brave");
    assert.match(parsed.subjectId, /^brave:[0-9a-f]{12}$/);
    assert.equal(parsed.title, "Foo");
    assert.equal(parsed.imageUrl, "https://cdn.example.com/a.jpg");
    assert.equal(parsed.license, "unknown");
    assert.equal(parsed.attribution, "via en.wikipedia.org");
    assert.equal(parsed.format, "data");
  });

  it("computes a deterministic subjectId for the same URL", async () => {
    const a = await run(makeDeps(), "Foo");
    const b = await run(makeDeps(), "Foo");
    assert.equal(a.parsed.subjectId, b.parsed.subjectId);
  });

  it("computes different subjectIds for different URLs", async () => {
    const a = await run(makeDeps(), "Foo");
    const b = await run(
      makeDeps({
        searchImages: async () => ({
          ok: true,
          results: [result("https://cdn.example.com/b.jpg")],
        }),
      }),
      "Bar",
    );
    assert.notEqual(a.parsed.subjectId, b.parsed.subjectId);
  });

  it("falls back to 'via Brave Search' for a malformed source URL", async () => {
    const deps = makeDeps({
      searchImages: async () => ({ ok: true, results: [result("https://x/a.jpg", "not a url")] }),
    });
    const { parsed } = await run(deps, "Foo");
    assert.equal(parsed.attribution, "via Brave Search");
  });

  it("skips an SVG and selects the JPEG", async () => {
    const deps = makeDeps({
      searchImages: async () => ({
        ok: true,
        results: [result("https://x/a.svg"), result("https://x/b.jpg", "https://imdb.com/x")],
      }),
    });
    const { parsed } = await run(deps, "Foo");
    assert.equal(parsed.imageUrl, "https://x/b.jpg");
    assert.equal(parsed.attribution, "via imdb.com");
  });

  it("returns notFound when no top-10 result is renderable", async () => {
    const deps = makeDeps({
      searchImages: async () => ({ ok: true, results: [result("https://x/a.svg")] }),
    });
    const { parsed } = await run(deps, "Foo");
    assert.equal(parsed.kind, "notFound");
  });

  it("returns keyMissing without making any HTTP request", async () => {
    let searched = false;
    const deps = makeDeps({
      loadApiKey: () => null,
      searchImages: async () => {
        searched = true;
        return { kind: "network", message: "x" };
      },
    });
    const { result: r, parsed } = await run(deps, "Foo");
    assert.equal(r.isError, true);
    assert.equal(parsed.kind, "keyMissing");
    assert.equal(searched, false);
  });

  it("rejects an empty query", async () => {
    const { result: r, parsed } = await run(makeDeps(), "   ");
    assert.equal(r.isError, true);
    assert.equal(parsed.kind, "notFound");
  });

  it("rejects an oversized query", async () => {
    const { result: r } = await run(makeDeps(), "a".repeat(201));
    assert.equal(r.isError, true);
  });

  it("passes through a rateLimit from search", async () => {
    const err: SourceError = { kind: "rateLimit", message: "429" };
    const { parsed } = await run(makeDeps({ searchImages: async () => err }), "Foo");
    assert.equal(parsed.kind, "rateLimit");
  });

  it("passes through a failure to download the selected image", async () => {
    const deps = makeDeps({
      fetchImageBytes: async () => ({ kind: "network", message: "timeout" }),
    });
    const { result: r, parsed } = await run(deps, "Foo");
    assert.equal(r.isError, true);
    assert.equal(parsed.kind, "network");
  });
});
