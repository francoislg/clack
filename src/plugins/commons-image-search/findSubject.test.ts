import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createFindSubjectTool, type FindSubjectDeps } from "./findSubject.js";
import type { PageSummary, SourceError } from "./wikimedia.js";

const PNG_THUMB =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Flag.svg/320px-Flag.svg.png";

function summaryOk(summary: PageSummary): { ok: true; summary: PageSummary } {
  return { ok: true, summary };
}

function makeDeps(overrides: Partial<FindSubjectDeps> = {}): FindSubjectDeps {
  return {
    fetchPageSummary: async () =>
      summaryOk({
        title: "Flag of Ecuador",
        wikibase_item: "Q243",
        thumbnail: { source: PNG_THUMB },
      }),
    fetchImageInfo: async () => ({ ok: true, license: "CC BY-SA 4.0", attribution: "Alice" }),
    fetchImageBytes: async () => ({ ok: true, data: "QUJD", mimeType: "image/png" }),
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

async function run(deps: FindSubjectDeps, query: string) {
  const result = await createFindSubjectTool(deps).handler({ query }, {});
  const textBlock = result.content.find(isTextBlock);
  const parsed = textBlock ? JSON.parse(textBlock.text) : undefined;
  return { result, parsed };
}

describe("find_subject tool", () => {
  it("returns a data-mode image block + metadata with a Wikidata subjectId", async () => {
    const { result, parsed } = await run(makeDeps(), "Flag of Ecuador");
    const imageBlock = result.content.find((b) => b.type === "image");
    assert.ok(imageBlock);
    assert.equal(parsed.subjectId, "wikidata:Q243");
    assert.equal(parsed.title, "Flag of Ecuador");
    assert.equal(parsed.imageUrl, PNG_THUMB);
    assert.equal(parsed.format, "data");
    assert.equal(parsed.source, "commons");
    assert.equal(parsed.license, "CC BY-SA 4.0");
    assert.equal(parsed.attribution, "Alice");
  });

  it("falls back to a wikipedia: slug when wikibase_item is absent", async () => {
    const deps = makeDeps({
      fetchPageSummary: async () =>
        summaryOk({ title: "Some Stub Article", thumbnail: { source: PNG_THUMB } }),
    });
    const { parsed } = await run(deps, "Some Stub Article");
    assert.equal(parsed.subjectId, "wikipedia:Some_Stub_Article");
  });

  it("returns the PNG thumbnail even when the master is SVG", async () => {
    const deps = makeDeps({
      fetchPageSummary: async () =>
        summaryOk({
          title: "Flag of Ecuador",
          wikibase_item: "Q243",
          thumbnail: { source: PNG_THUMB },
          originalimage: { source: "https://x/Flag_of_Ecuador.svg" },
        }),
    });
    const { parsed } = await run(deps, "Flag of Ecuador");
    assert.ok(parsed.imageUrl.endsWith(".png"));
  });

  it("rejects an empty query with notFound", async () => {
    const { result, parsed } = await run(makeDeps(), "   ");
    assert.equal(result.isError, true);
    assert.equal(parsed.kind, "notFound");
  });

  it("rejects an oversized query", async () => {
    const { result } = await run(makeDeps(), "a".repeat(201));
    assert.equal(result.isError, true);
  });

  it("passes through a notFound from the page summary", async () => {
    const err: SourceError = { kind: "notFound", message: "404" };
    const { result, parsed } = await run(makeDeps({ fetchPageSummary: async () => err }), "X");
    assert.equal(result.isError, true);
    assert.equal(parsed.kind, "notFound");
  });

  it("passes through a rateLimit from the page summary", async () => {
    const err: SourceError = { kind: "rateLimit", message: "429" };
    const { parsed } = await run(makeDeps({ fetchPageSummary: async () => err }), "X");
    assert.equal(parsed.kind, "rateLimit");
  });

  it("returns unknown when the summary has no thumbnail.source", async () => {
    const deps = makeDeps({
      fetchPageSummary: async () => summaryOk({ title: "No Image", wikibase_item: "Q1" }),
    });
    const { parsed } = await run(deps, "No Image");
    assert.equal(parsed.kind, "unknown");
  });

  it("returns unsupportedFormat when thumbnail.source is itself an SVG, without downloading", async () => {
    let bytesCalled = false;
    const deps = makeDeps({
      fetchPageSummary: async () =>
        summaryOk({ title: "X", thumbnail: { source: "https://x/Foo.svg" } }),
      fetchImageBytes: async () => {
        bytesCalled = true;
        return { ok: true, data: "x", mimeType: "image/png" };
      },
    });
    const { parsed } = await run(deps, "X");
    assert.equal(parsed.kind, "unsupportedFormat");
    assert.equal(bytesCalled, false);
  });

  it("degrades to default license/attribution when imageinfo fails", async () => {
    const deps = makeDeps({
      fetchImageInfo: async () => ({ kind: "network", message: "down" }),
    });
    const { result, parsed } = await run(deps, "Flag of Ecuador");
    assert.notEqual(result.isError, true);
    assert.equal(parsed.license, "unknown");
    assert.equal(parsed.attribution, "via Wikimedia Commons");
  });

  it("passes through a failure to download the thumbnail bytes", async () => {
    const deps = makeDeps({
      fetchImageBytes: async () => ({ kind: "network", message: "timeout" }),
    });
    const { result, parsed } = await run(deps, "Flag of Ecuador");
    assert.equal(result.isError, true);
    assert.equal(parsed.kind, "network");
  });
});
