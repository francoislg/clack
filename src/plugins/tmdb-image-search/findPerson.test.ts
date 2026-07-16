import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createFindPersonTool, type FindPersonDeps } from "./findPerson.js";
import type { TmdbPersonResult } from "./tmdb.js";

function person(id: number, name?: string, profilePath?: string | null): TmdbPersonResult {
  return { id, name, profile_path: profilePath ?? null };
}

function makeDeps(overrides: Partial<FindPersonDeps> = {}): FindPersonDeps {
  return {
    loadToken: () => "tok",
    search: async () => ({ ok: true, results: [person(287, "Brad Pitt", "/xyz.jpg")] }),
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

async function run(deps: FindPersonDeps, query: string) {
  const r = await createFindPersonTool(deps).handler({ query }, {});
  const textBlock = r.content.find(isTextBlock);
  const parsed = textBlock ? JSON.parse(textBlock.text) : undefined;
  return { result: r, parsed };
}

describe("find_person tool", () => {
  it("returns a data-mode image block + metadata with a tmdb:p- subjectId at h632", async () => {
    const { result: r, parsed } = await run(makeDeps(), "Brad Pitt");
    assert.ok(r.content.find((b) => b.type === "image"));
    assert.equal(parsed.source, "tmdb");
    assert.equal(parsed.subjectId, "tmdb:p-287");
    assert.equal(parsed.title, "Brad Pitt");
    assert.equal(parsed.imageUrl, "https://image.tmdb.org/t/p/h632/xyz.jpg");
    assert.equal(parsed.license, "CC BY-NC 4.0");
    assert.equal(parsed.attribution, "Data and images via TMDB (themoviedb.org)");
    assert.equal(parsed.format, "data");
  });

  it("skips results with a null profile_path", async () => {
    const deps = makeDeps({
      search: async () => ({
        ok: true,
        results: [person(1, "No Photo"), person(2, "Has Photo", "/p.jpg")],
      }),
    });
    const { parsed } = await run(deps, "q");
    assert.equal(parsed.subjectId, "tmdb:p-2");
    assert.equal(parsed.imageUrl, "https://image.tmdb.org/t/p/h632/p.jpg");
  });

  it("returns notFound when no top-10 result has a profile", async () => {
    const results = Array.from({ length: 12 }, (_, n) =>
      person(n, `P${n}`, n === 11 ? "/late.jpg" : null),
    );
    const deps = makeDeps({ search: async () => ({ ok: true, results }) });
    const { result: r, parsed } = await run(deps, "q");
    assert.equal(r.isError, true);
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
    assert.equal(searched, false);
  });

  it("rejects empty and oversized queries", async () => {
    const empty = await run(makeDeps(), "  ");
    assert.equal(empty.parsed.kind, "notFound");
    const oversized = await run(makeDeps(), "a".repeat(201));
    assert.equal(oversized.parsed.kind, "notFound");
  });

  it("passes through search and CDN errors", async () => {
    const searchErr = await run(
      makeDeps({ search: async () => ({ kind: "rateLimit", message: "429" }) }),
      "q",
    );
    assert.equal(searchErr.parsed.kind, "rateLimit");
    const cdnErr = await run(
      makeDeps({ fetchImageBytes: async () => ({ kind: "network", message: "404" }) }),
      "q",
    );
    assert.equal(cdnErr.parsed.kind, "network");
  });
});
