import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createReadErrorReportTool } from "./readErrorReport.js";
import { parseToolResult } from "../testHelpers.js";

// The path traversal guard runs before any file I/O, so it can be tested
// without mocking the readErrorReport module function.

function callHandler(filename: string) {
  const toolDef = createReadErrorReportTool();
  return toolDef.handler({ filename }, { sessionId: "test" });
}

describe("readErrorReport — path traversal guard", () => {
  it("rejects filenames containing '..'", async () => {
    const result = await callHandler("../etc/passwd");
    const parsed = parseToolResult(result);
    assert.equal(parsed.error, "Invalid filename");
  });

  it("rejects filenames containing '/'", async () => {
    const result = await callHandler("some/path/file.json");
    const parsed = parseToolResult(result);
    assert.equal(parsed.error, "Invalid filename");
  });

  it("rejects filenames combining both", async () => {
    const result = await callHandler("../../secrets.json");
    const parsed = parseToolResult(result);
    assert.equal(parsed.error, "Invalid filename");
  });

  it("passes a valid filename through to the file read (report not found)", async () => {
    // A valid filename (no traversal) proceeds to readErrorReport, which returns
    // null for a nonexistent file → the tool returns a "not found" error, not
    // the traversal-guard error.
    const result = await callHandler("nonexistent-1700000000000.json");
    const parsed = parseToolResult(result);
    assert.ok(parsed.error !== "Invalid filename", "should not hit traversal guard");
    assert.ok(parsed.error?.includes("not found"), `expected 'not found', got: ${parsed.error}`);
  });
});
