import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeErrorReport, readErrorReport, type ErrorReport } from "./errorReports.js";

const originalCwd = process.cwd;

function sampleReport(overrides?: Partial<ErrorReport>): ErrorReport {
  return {
    sessionId: "S1",
    errorMessage: "boom",
    conversationTrace: [],
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe("errorReports — readErrorReport", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "er-test-"));
    await mkdir(join(tempDir, "data", "error-reports"), { recursive: true });
    process.cwd = () => tempDir;
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("round-trips a written report", async () => {
    const path = await writeErrorReport(sampleReport({ analysis: "root cause" }));
    const filename = path.split(/[\\/]/).pop() as string;

    const loaded = await readErrorReport(filename);

    assert.ok(loaded);
    assert.equal(loaded.sessionId, "S1");
    assert.equal(loaded.errorMessage, "boom");
    assert.equal(loaded.analysis, "root cause");
    assert.deepEqual(loaded.conversationTrace, []);
  });

  it("returns null for a missing file", async () => {
    const loaded = await readErrorReport("does-not-exist.json");
    assert.equal(loaded, null);
  });

  it("returns null for invalid JSON", async () => {
    const filename = "corrupt.json";
    await writeFile(resolve(tempDir, "data", "error-reports", filename), "{not json");

    const loaded = await readErrorReport(filename);
    assert.equal(loaded, null);
  });

  it("returns null when required scalar fields are missing", async () => {
    const filename = "partial.json";
    await writeFile(
      resolve(tempDir, "data", "error-reports", filename),
      JSON.stringify({ sessionId: "S1" }),
    );

    const loaded = await readErrorReport(filename);
    assert.equal(loaded, null);
  });
});
