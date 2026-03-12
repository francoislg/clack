import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const mockAccess = mock.fn<(path: string) => Promise<void>>();

mock.module("node:fs/promises", {
  namedExports: {
    access: mockAccess,
  },
});

const { fileExists } = await import("./fs.js");

// ---------------------------------------------------------------------------
// fileExists
// ---------------------------------------------------------------------------

describe("fileExists", () => {
  it("returns true when the file is accessible", async () => {
    mockAccess.mock.mockImplementation(async () => {});

    const result = await fileExists("/some/existing/file.txt");

    assert.equal(result, true);
    assert.equal(mockAccess.mock.callCount(), 1);
    assert.equal(mockAccess.mock.calls[0].arguments[0], "/some/existing/file.txt");
  });

  it("returns false when access throws (file does not exist)", async () => {
    mockAccess.mock.mockImplementation(async () => {
      throw new Error("ENOENT");
    });

    const result = await fileExists("/nonexistent/file.txt");

    assert.equal(result, false);
  });

  it("returns false for any error type (permission denied, etc.)", async () => {
    mockAccess.mock.mockImplementation(async () => {
      throw new Error("EACCES");
    });

    const result = await fileExists("/restricted/file.txt");

    assert.equal(result, false);
  });
});
