import assert from "node:assert/strict";
import { describe, it, expect } from "vitest";
import { MANAGED_FILES_DEFAULT_RETENTION, managedFilesZod } from "./configSchemas.js";

describe("managedFilesZod", () => {
  it("returns defaults when the block is absent", () => {
    const r = managedFilesZod.safeParse(undefined);
    expect(r).toEqual({
      success: true,
      data: {
        retention: {
          downloads: { keepUploadedHours: 168, keepUnuploadedHours: 24 },
          recordings: { keepUploadedHours: 336, keepUnuploadedHours: 24 },
        },
      },
    });
  });

  it("returns defaults when retention is absent", () => {
    const r = managedFilesZod.safeParse({});
    expect(r).toEqual({ success: true, data: { retention: MANAGED_FILES_DEFAULT_RETENTION } });
  });

  it("fills a partially-specified window from that root's defaults", () => {
    const r = managedFilesZod.safeParse({ retention: { downloads: { keepUploadedHours: 48 } } });
    expect(r).toEqual({
      success: true,
      data: {
        retention: {
          downloads: { keepUploadedHours: 48, keepUnuploadedHours: 24 },
          recordings: { keepUploadedHours: 336, keepUnuploadedHours: 24 },
        },
      },
    });
  });

  it("applies a recordings override", () => {
    const r = managedFilesZod.safeParse({
      retention: { recordings: { keepUploadedHours: 720, keepUnuploadedHours: 0.5 } },
    });
    expect(r).toEqual({
      success: true,
      data: {
        retention: {
          downloads: { keepUploadedHours: 168, keepUnuploadedHours: 24 },
          recordings: { keepUploadedHours: 720, keepUnuploadedHours: 0.5 },
        },
      },
    });
  });

  it.each([
    [0, "zero"],
    [-5, "negative"],
    ["NaN", "NaN string"],
    ["12", "numeric string"],
    [true, "boolean"],
    [null, "null"],
  ])("rejects keepUploadedHours %j (%s)", (value, _label) => {
    const r = managedFilesZod.safeParse({ retention: { downloads: { keepUploadedHours: value } } });
    assert.ok(!r.success);
    expect(r.error.issues[0].message).toBe(
      "Config 'managedFiles.retention.downloads.keepUploadedHours' must be a positive number",
    );
  });

  it("rejects a non-positive recordings keepUnuploadedHours", () => {
    const r = managedFilesZod.safeParse({ retention: { recordings: { keepUnuploadedHours: 0 } } });
    assert.ok(!r.success);
    expect(r.error.issues[0].message).toBe(
      "Config 'managedFiles.retention.recordings.keepUnuploadedHours' must be a positive number",
    );
  });

  it("rejects an unknown top-level key", () => {
    const r = managedFilesZod.safeParse({ retentionDays: 7 });
    assert.ok(!r.success);
    expect(r.error.issues[0].message).toBe(
      "Config 'managedFiles' contains unknown key 'retentionDays'",
    );
  });

  it("rejects an unknown retention root", () => {
    const r = managedFilesZod.safeParse({ retention: { uploads: {} } });
    assert.ok(!r.success);
    expect(r.error.issues[0].message).toBe(
      "Config 'managedFiles.retention' contains unknown key 'uploads'",
    );
  });

  it("rejects an unknown window field", () => {
    const r = managedFilesZod.safeParse({ retention: { downloads: { keepHours: 1 } } });
    assert.ok(!r.success);
    expect(r.error.issues[0].message).toBe(
      "Config 'managedFiles.retention.downloads' contains unknown key 'keepHours'",
    );
  });

  it.each([
    [[], "managedFiles"],
    ["yes", "managedFiles"],
    [{ retention: [] }, "managedFiles.retention"],
    [{ retention: { downloads: 24 } }, "managedFiles.retention.downloads"],
  ])("rejects non-object %j at '%s'", (raw, path) => {
    const r = managedFilesZod.safeParse(raw);
    assert.ok(!r.success);
    expect(r.error.issues[0].message).toBe(`Config '${path}' must be an object`);
  });
});
