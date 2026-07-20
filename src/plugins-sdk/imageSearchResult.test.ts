import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { imageAndTextResult, sourceErrorResult, validateQuery } from "./imageSearchResult.js";

describe("imageAndTextResult", () => {
  it("returns a data-mode image block followed by a pretty-printed metadata text block", () => {
    const r = imageAndTextResult("QUJD", "image/jpeg", { source: "tmdb", title: "Fight Club" });
    assert.equal(r.content.length, 2);
    assert.deepEqual(r.content[0], { type: "image", data: "QUJD", mimeType: "image/jpeg" });
    assert.equal(r.content[1].type, "text");
    const parsed = JSON.parse((r.content[1] as { type: "text"; text: string }).text);
    assert.deepEqual(parsed, { source: "tmdb", title: "Fight Club" });
  });
});

describe("sourceErrorResult", () => {
  it("returns a single JSON text block flagged isError", () => {
    const r = sourceErrorResult({ kind: "notFound", message: "zero results" });
    assert.equal(r.isError, true);
    assert.equal(r.content.length, 1);
    assert.deepEqual(JSON.parse(r.content[0].text), { kind: "notFound", message: "zero results" });
  });
});

describe("validateQuery", () => {
  it("returns the trimmed query on success", () => {
    assert.deepEqual(validateQuery("  Fight Club  "), { ok: true, query: "Fight Club" });
  });

  it("rejects empty and whitespace-only queries as notFound", () => {
    const empty = validateQuery("");
    assert.ok(!empty.ok && empty.error.kind === "notFound");
    const blank = validateQuery(" \t ");
    assert.ok(!blank.ok && blank.error.kind === "notFound");
  });

  it("rejects a query over the length bound (trimmed length)", () => {
    const oversized = validateQuery("a".repeat(201));
    assert.ok(!oversized.ok && oversized.error.kind === "notFound");
    assert.match(!oversized.ok ? oversized.error.message : "", /200/);
    assert.ok(validateQuery("a".repeat(200)).ok);
    assert.ok(validateQuery("  " + "a".repeat(200) + "  ").ok);
  });

  it("honors a custom bound", () => {
    assert.ok(!validateQuery("abcdef", 5).ok);
    assert.ok(validateQuery("abcde", 5).ok);
  });
});
