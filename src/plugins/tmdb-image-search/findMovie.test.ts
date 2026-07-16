import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createFindMovieTool, type FindMovieDeps } from "./findMovie.js";
import type { SourceError, TmdbMovieResult } from "./tmdb.js";

function movie(id: number, title?: string, backdropPath?: string | null): TmdbMovieResult {
  return { id, title, backdrop_path: backdropPath ?? null };
}

function makeDeps(overrides: Partial<FindMovieDeps> = {}): FindMovieDeps {
  return {
    loadToken: () => "tok",
    search: async () => ({ ok: true, results: [movie(550, "Fight Club")] }),
    fetchTextlessBackdrops: async () => ({
      ok: true,
      backdrops: [
        { file_path: "/a.jpg", vote_average: 5.2 },
        { file_path: "/b.jpg", vote_average: 7.8 },
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

async function run(deps: FindMovieDeps, query: string) {
  const r = await createFindMovieTool(deps).handler({ query }, {});
  const textBlock = r.content.find(isTextBlock);
  const parsed = textBlock ? JSON.parse(textBlock.text) : undefined;
  return { result: r, parsed };
}

describe("find_movie tool", () => {
  it("returns a data-mode image block + metadata with a tmdb:m- subjectId at w780", async () => {
    const { result: r, parsed } = await run(makeDeps(), "Fight Club");
    assert.ok(r.content.find((b) => b.type === "image"));
    assert.equal(parsed.source, "tmdb");
    assert.equal(parsed.subjectId, "tmdb:m-550");
    assert.equal(parsed.title, "Fight Club");
    assert.equal(parsed.imageUrl, "https://image.tmdb.org/t/p/w780/b.jpg");
    assert.equal(parsed.license, "CC BY-NC 4.0");
    assert.equal(parsed.attribution, "Data and images via TMDB (themoviedb.org)");
    assert.equal(parsed.format, "data");
  });

  it("selects the highest-vote backdrop", async () => {
    const { parsed } = await run(makeDeps(), "Fight Club");
    assert.equal(parsed.imageUrl, "https://image.tmdb.org/t/p/w780/b.jpg");
  });

  it("advances to the second candidate when the first yields no backdrop", async () => {
    const calls: number[] = [];
    const deps = makeDeps({
      search: async () => ({ ok: true, results: [movie(1, "Dry"), movie(2, "Wet")] }),
      fetchTextlessBackdrops: async (_kind, id) => {
        calls.push(id);
        return id === 2
          ? { ok: true, backdrops: [{ file_path: "/w.jpg", vote_average: 1 }] }
          : { ok: true, backdrops: [] };
      },
    });
    const { parsed } = await run(deps, "q");
    assert.deepEqual(calls, [1, 2]);
    assert.equal(parsed.subjectId, "tmdb:m-2");
    assert.equal(parsed.title, "Wet");
  });

  it("uses the search backdrop_path when /images is empty", async () => {
    const deps = makeDeps({
      search: async () => ({ ok: true, results: [movie(3, "Fallback", "/c.jpg")] }),
      fetchTextlessBackdrops: async () => ({ ok: true, backdrops: [] }),
    });
    const { parsed } = await run(deps, "q");
    assert.equal(parsed.imageUrl, "https://image.tmdb.org/t/p/w780/c.jpg");
  });

  it("returns notFound (never a poster) when no candidate yields a backdrop", async () => {
    const deps = makeDeps({
      search: async () => ({
        ok: true,
        results: [movie(1, "PosterOnly"), movie(2, "PosterOnly2")],
      }),
      fetchTextlessBackdrops: async () => ({ ok: true, backdrops: [] }),
    });
    const { result: r, parsed } = await run(deps, "q");
    assert.equal(r.isError, true);
    assert.equal(parsed.kind, "notFound");
  });

  it("attempts the /images hop on at most the first 3 candidates", async () => {
    const calls: number[] = [];
    const deps = makeDeps({
      search: async () => ({
        ok: true,
        results: [movie(1), movie(2), movie(3), movie(4, "HasArt")],
      }),
      fetchTextlessBackdrops: async (_kind, id) => {
        calls.push(id);
        return { ok: true, backdrops: [] };
      },
    });
    const { parsed } = await run(deps, "q");
    assert.deepEqual(calls, [1, 2, 3]);
    assert.equal(parsed.kind, "notFound");
  });

  it("returns notFound on zero search results", async () => {
    const deps = makeDeps({ search: async () => ({ ok: true, results: [] }) });
    const { parsed } = await run(deps, "q");
    assert.equal(parsed.kind, "notFound");
  });

  it("returns keyMissing naming TMDB_READ_TOKEN without any HTTP request", async () => {
    let searched = false;
    const deps = makeDeps({
      loadToken: () => null,
      search: async () => {
        searched = true;
        return { kind: "network", message: "x" };
      },
    });
    const { result: r, parsed } = await run(deps, "q");
    assert.equal(r.isError, true);
    assert.equal(parsed.kind, "keyMissing");
    assert.match(parsed.message, /TMDB_READ_TOKEN/);
    assert.match(parsed.message, /data\/auth\/\.env/);
    assert.equal(searched, false);
  });

  it("rejects an empty and a whitespace-only query", async () => {
    const empty = await run(makeDeps(), "");
    assert.equal(empty.result.isError, true);
    assert.equal(empty.parsed.kind, "notFound");
    const blank = await run(makeDeps(), "   ");
    assert.equal(blank.result.isError, true);
    assert.equal(blank.parsed.kind, "notFound");
  });

  it("rejects an oversized query", async () => {
    const { result: r, parsed } = await run(makeDeps(), "a".repeat(201));
    assert.equal(r.isError, true);
    assert.equal(parsed.kind, "notFound");
  });

  it("passes through a search error", async () => {
    const err: SourceError = { kind: "rateLimit", message: "429" };
    const { parsed } = await run(makeDeps({ search: async () => err }), "q");
    assert.equal(parsed.kind, "rateLimit");
  });

  it("passes through an /images error", async () => {
    const deps = makeDeps({
      fetchTextlessBackdrops: async () => ({ kind: "network", message: "500" }),
    });
    const { result: r, parsed } = await run(deps, "q");
    assert.equal(r.isError, true);
    assert.equal(parsed.kind, "network");
  });

  it("passes through a CDN download error", async () => {
    const deps = makeDeps({
      fetchImageBytes: async () => ({ kind: "tooLarge", message: "big" }),
    });
    const { result: r, parsed } = await run(deps, "q");
    assert.equal(r.isError, true);
    assert.equal(parsed.kind, "tooLarge");
  });
});
