import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createFindTvTool, type FindTvDeps } from "./findTv.js";
import type { TmdbTvResult } from "./tmdb.js";

function tv(id: number, name?: string, backdropPath?: string | null): TmdbTvResult {
  return { id, name, backdrop_path: backdropPath ?? null };
}

function makeDeps(overrides: Partial<FindTvDeps> = {}): FindTvDeps {
  return {
    loadToken: () => "tok",
    search: async () => ({ ok: true, results: [tv(1399, "Game of Thrones")] }),
    fetchTextlessBackdrops: async () => ({
      ok: true,
      backdrops: [{ file_path: "/got.jpg", vote_average: 8 }],
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

async function run(deps: FindTvDeps, query: string) {
  const r = await createFindTvTool(deps).handler({ query }, {});
  const textBlock = r.content.find(isTextBlock);
  const parsed = textBlock ? JSON.parse(textBlock.text) : undefined;
  return { result: r, parsed };
}

describe("find_tv tool", () => {
  it("returns a data-mode image block + metadata with a tmdb:tv- subjectId at w780", async () => {
    const { result: r, parsed } = await run(makeDeps(), "Game of Thrones");
    assert.ok(r.content.find((b) => b.type === "image"));
    assert.equal(parsed.source, "tmdb");
    assert.equal(parsed.subjectId, "tmdb:tv-1399");
    assert.equal(parsed.title, "Game of Thrones");
    assert.equal(parsed.imageUrl, "https://image.tmdb.org/t/p/w780/got.jpg");
    assert.equal(parsed.license, "CC BY-NC 4.0");
    assert.equal(parsed.attribution, "Data and images via TMDB (themoviedb.org)");
    assert.equal(parsed.format, "data");
  });

  it("queries the tv kind on the /images hop", async () => {
    const kinds: string[] = [];
    const deps = makeDeps({
      fetchTextlessBackdrops: async (kind) => {
        kinds.push(kind);
        return { ok: true, backdrops: [{ file_path: "/x.jpg", vote_average: 1 }] };
      },
    });
    await run(deps, "q");
    assert.deepEqual(kinds, ["tv"]);
  });

  it("uses result.name as the title", async () => {
    const deps = makeDeps({ search: async () => ({ ok: true, results: [tv(7, "Dark")] }) });
    const { parsed } = await run(deps, "q");
    assert.equal(parsed.title, "Dark");
    assert.equal(parsed.subjectId, "tmdb:tv-7");
  });

  it("returns notFound (never a poster) when no textless backdrop exists", async () => {
    const deps = makeDeps({
      fetchTextlessBackdrops: async () => ({ ok: true, backdrops: [] }),
    });
    const { result: r, parsed } = await run(deps, "q");
    assert.equal(r.isError, true);
    assert.equal(parsed.kind, "notFound");
  });

  it("returns keyMissing when the token is unset", async () => {
    const { parsed } = await run(makeDeps({ loadToken: () => null }), "q");
    assert.equal(parsed.kind, "keyMissing");
  });
});
