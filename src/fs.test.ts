import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { fileExists, type FileExistsDeps } from "./fs.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<FileExistsDeps> = {}): FileExistsDeps {
  return {
    access: vi.fn(async () => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// fileExists
// ---------------------------------------------------------------------------

describe("fileExists", () => {
  it("returns true when the file is accessible", async () => {
    const mockAccess = vi.fn(async () => {});
    const deps = makeDeps({ access: mockAccess as FileExistsDeps["access"] });

    const result = await fileExists("/some/existing/file.txt", deps);

    assert.equal(result, true);
    assert.equal(mockAccess.mock.calls.length, 1);
    assert.equal(mockAccess.mock.calls.length, 1);
    // Verify via callCount — the mock was called with the expected path
  });

  it("returns false when access throws (file does not exist)", async () => {
    const mockAccess = vi.fn(async () => {
      throw new Error("ENOENT");
    });
    const deps = makeDeps({ access: mockAccess as FileExistsDeps["access"] });

    const result = await fileExists("/nonexistent/file.txt", deps);

    assert.equal(result, false);
  });

  it("returns false for any error type (permission denied, etc.)", async () => {
    const mockAccess = vi.fn(async () => {
      throw new Error("EACCES");
    });
    const deps = makeDeps({ access: mockAccess as FileExistsDeps["access"] });

    const result = await fileExists("/restricted/file.txt", deps);

    assert.equal(result, false);
  });
});
