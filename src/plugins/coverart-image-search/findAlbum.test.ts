import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createFindAlbumTool, type FindAlbumDeps } from "./findAlbum.js";
import { frontCoverUrl, type ReleaseGroup, type SourceError } from "./musicbrainz.js";

function searchOk(releaseGroups: ReleaseGroup[]): { ok: true; releaseGroups: ReleaseGroup[] } {
  return { ok: true, releaseGroups };
}

const DARK_SIDE: ReleaseGroup = {
  id: "abc",
  title: "The Dark Side of the Moon",
  "artist-credit": [{ name: "Pink Floyd" }],
};

function makeDeps(overrides: Partial<FindAlbumDeps> = {}): FindAlbumDeps {
  return {
    searchReleaseGroups: async () => searchOk([DARK_SIDE]),
    fetchFrontCover: async (mbid) => ({ ok: true, coverUrl: frontCoverUrl(mbid) }),
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

async function run(deps: FindAlbumDeps, query: string) {
  const result = await createFindAlbumTool(deps).handler({ query }, {});
  const textBlock = result.content.find(isTextBlock);
  const parsed = textBlock ? JSON.parse(textBlock.text) : undefined;
  return { result, parsed };
}

describe("find_album tool", () => {
  it("returns a data-mode image block + metadata for the top release-group", async () => {
    const { result, parsed } = await run(makeDeps(), "Pink Floyd Dark Side of the Moon");
    const imageBlock = result.content.find((b) => b.type === "image");
    assert.ok(imageBlock);
    assert.equal(parsed.source, "coverart");
    assert.equal(parsed.subjectId, "coverart:rg-abc");
    assert.equal(parsed.title, "Pink Floyd – The Dark Side of the Moon");
    assert.equal(parsed.imageUrl, frontCoverUrl("abc"));
    assert.equal(parsed.license, "unknown");
    assert.equal(parsed.attribution, "via Cover Art Archive");
    assert.equal(parsed.format, "data");
  });

  it("advances to the 2nd candidate when the top release-group has no cover", async () => {
    const noCover: SourceError = { kind: "notFound", message: "404" };
    const deps = makeDeps({
      searchReleaseGroups: async () =>
        searchOk([
          { id: "a", title: "First" },
          { id: "b", title: "Second", "artist-credit": [{ name: "Band" }] },
        ]),
      fetchFrontCover: async (mbid) =>
        mbid === "a" ? noCover : { ok: true, coverUrl: frontCoverUrl(mbid) },
    });
    const { parsed } = await run(deps, "X");
    assert.equal(parsed.subjectId, "coverart:rg-b");
    assert.equal(parsed.title, "Band – Second");
  });

  it("returns notFound when the first 3 candidates all lack covers", async () => {
    const noCover: SourceError = { kind: "notFound", message: "404" };
    const fetchFrontCover = vi.fn(async () => noCover);
    const deps = makeDeps({
      searchReleaseGroups: async () =>
        searchOk([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]),
      fetchFrontCover,
    });
    const { result, parsed } = await run(deps, "X");
    assert.equal(result.isError, true);
    assert.equal(parsed.kind, "notFound");
    assert.equal(fetchFrontCover.mock.calls.length, 3);
  });

  it("returns notFound when MusicBrainz has zero results", async () => {
    const { result, parsed } = await run(
      makeDeps({ searchReleaseGroups: async () => searchOk([]) }),
      "X",
    );
    assert.equal(result.isError, true);
    assert.equal(parsed.kind, "notFound");
  });

  it("falls back to the release-group title when there is no artist credit", async () => {
    const deps = makeDeps({
      searchReleaseGroups: async () => searchOk([{ id: "a", title: "Untitled" }]),
    });
    const { parsed } = await run(deps, "Untitled");
    assert.equal(parsed.title, "Untitled");
  });

  it("uses only the first artist-credit name for multi-artist albums", async () => {
    const deps = makeDeps({
      searchReleaseGroups: async () =>
        searchOk([
          {
            id: "a",
            title: "Under Pressure",
            "artist-credit": [{ name: "Queen" }, { name: "David Bowie" }],
          },
        ]),
    });
    const { parsed } = await run(deps, "Under Pressure");
    assert.equal(parsed.title, "Queen – Under Pressure");
  });

  it("rejects an empty query without hitting the network", async () => {
    const searchReleaseGroups = vi.fn(async () => searchOk([DARK_SIDE]));
    const { result, parsed } = await run(makeDeps({ searchReleaseGroups }), "   ");
    assert.equal(result.isError, true);
    assert.equal(parsed.kind, "notFound");
    assert.equal(searchReleaseGroups.mock.calls.length, 0);
  });

  it("rejects an oversized query", async () => {
    const { result, parsed } = await run(makeDeps(), "a".repeat(201));
    assert.equal(result.isError, true);
    assert.equal(parsed.kind, "notFound");
  });

  it("passes through a search error", async () => {
    const err: SourceError = { kind: "rateLimit", message: "429" };
    const { result, parsed } = await run(makeDeps({ searchReleaseGroups: async () => err }), "X");
    assert.equal(result.isError, true);
    assert.equal(parsed.kind, "rateLimit");
  });

  it("aborts on a non-notFound CAA error instead of advancing", async () => {
    const err: SourceError = { kind: "network", message: "CAA down" };
    const fetchFrontCover = vi.fn(async () => err);
    const deps = makeDeps({
      searchReleaseGroups: async () => searchOk([{ id: "a" }, { id: "b" }]),
      fetchFrontCover,
    });
    const { result, parsed } = await run(deps, "X");
    assert.equal(result.isError, true);
    assert.equal(parsed.kind, "network");
    assert.equal(fetchFrontCover.mock.calls.length, 1);
  });

  it("passes through a byte-download error", async () => {
    const err: SourceError = { kind: "unsupportedFormat", message: "too big" };
    const { result, parsed } = await run(makeDeps({ fetchImageBytes: async () => err }), "X");
    assert.equal(result.isError, true);
    assert.equal(parsed.kind, "unsupportedFormat");
  });

  it("performs fresh round-trips on every call — no caching", async () => {
    const searchReleaseGroups = vi.fn(async () => searchOk([DARK_SIDE]));
    const fetchFrontCover = vi.fn(async (mbid: string) => ({
      ok: true as const,
      coverUrl: frontCoverUrl(mbid),
    }));
    const fetchImageBytes = vi.fn(async () => ({
      ok: true as const,
      data: "QUJD",
      mimeType: "image/jpeg",
    }));
    const deps = makeDeps({ searchReleaseGroups, fetchFrontCover, fetchImageBytes });
    await run(deps, "Pink Floyd");
    await run(deps, "Pink Floyd");
    assert.equal(searchReleaseGroups.mock.calls.length, 2);
    assert.equal(fetchFrontCover.mock.calls.length, 2);
    assert.equal(fetchImageBytes.mock.calls.length, 2);
  });
});
