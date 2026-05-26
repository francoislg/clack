import { describe, it } from "vitest";
import assert from "node:assert/strict";

// The filename parsing logic lives inside the tool handler callback:
//   const match = filename.match(/^(.+)-(\d+)\.json$/);
//   const sessionId = match?.[1] ?? filename;
//   const timestamp = match?.[2] ? Number(match[2]) : undefined;
// These tests verify the regex and derived values directly.

const FILENAME_REGEX = /^(.+)-(\d+)\.json$/;

function parseFilename(filename: string) {
  const match = filename.match(FILENAME_REGEX);
  const sessionId = match?.[1] ?? filename;
  const timestamp = match?.[2] ? Number(match[2]) : undefined;
  return { sessionId, timestamp, date: timestamp ? new Date(timestamp).toISOString() : undefined };
}

describe("error report filename parsing", () => {
  it("parses a standard sessionId-timestamp.json filename", () => {
    const result = parseFilename("abc123-1700000000000.json");
    assert.equal(result.sessionId, "abc123");
    assert.equal(result.timestamp, 1700000000000);
    assert.ok(result.date?.startsWith("2023-"));
  });

  it("parses a filename with hyphens in session id (greedy match takes all but last segment)", () => {
    const result = parseFilename("session-id-with-hyphens-1700000000000.json");
    assert.equal(result.sessionId, "session-id-with-hyphens");
    assert.equal(result.timestamp, 1700000000000);
  });

  it("falls back to the full filename when no timestamp suffix", () => {
    const result = parseFilename("no-timestamp-here.json");
    // "here" is not all digits, so match will succeed only if suffix is numeric
    // "no-timestamp-here.json" → match[1]="no-timestamp", match[2]="here" (not numeric but regex requires \d+)
    // Actually "here" is not \d+, so no match → sessionId = full filename
    assert.equal(result.sessionId, "no-timestamp-here.json");
    assert.equal(result.timestamp, undefined);
    assert.equal(result.date, undefined);
  });

  it("falls back to the full filename for a non-json extension", () => {
    const result = parseFilename("session-1700000000000.txt");
    assert.equal(result.sessionId, "session-1700000000000.txt");
    assert.equal(result.timestamp, undefined);
  });
});

describe("limit slicing", () => {
  it("slices to the given limit", () => {
    const files = ["a-1.json", "b-2.json", "c-3.json", "d-4.json", "e-5.json"];
    assert.equal(files.slice(0, 3).length, 3);
    assert.deepEqual(files.slice(0, 3), ["a-1.json", "b-2.json", "c-3.json"]);
  });

  it("returns all files when limit exceeds file count", () => {
    const files = ["a-1.json", "b-2.json"];
    assert.equal(files.slice(0, 20).length, 2);
  });

  it("returns empty array when no files", () => {
    assert.equal(([] as string[]).slice(0, 20).length, 0);
  });
});
