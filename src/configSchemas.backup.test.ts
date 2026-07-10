import { describe, it, expect } from "vitest";
import { backupZod } from "./configSchemas.js";

describe("backupZod", () => {
  it("returns defaults when the block is absent", () => {
    const r = backupZod.safeParse(undefined);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({
        enabled: true,
        folders: ["state"],
        timezone: "America/Montreal",
      });
    }
  });

  it("accepts a fully-specified valid block", () => {
    const r = backupZod.safeParse({
      enabled: false,
      folders: ["state", "configuration"],
      timezone: "America/New_York",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({
        enabled: false,
        folders: ["state", "configuration"],
        timezone: "America/New_York",
      });
    }
  });

  it("rejects an invalid IANA timezone", () => {
    const r = backupZod.safeParse({ timezone: "Not/AZone" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/timezone/i);
  });

  it("rejects a non-boolean enabled", () => {
    expect(backupZod.safeParse({ enabled: "yes" }).success).toBe(false);
  });

  it("rejects an unknown key", () => {
    expect(backupZod.safeParse({ retentionDays: 7 }).success).toBe(false);
  });

  it("rejects an empty folders array", () => {
    expect(backupZod.safeParse({ folders: [] }).success).toBe(false);
  });

  it("rejects non-string folder entries", () => {
    expect(backupZod.safeParse({ folders: [1] }).success).toBe(false);
  });

  it.each([
    ["", "empty string"],
    [".", "dot"],
    ["/etc", "absolute"],
    ["backups", "the backups tree"],
    ["backups/sub", "under the backups tree"],
    ["..", "parent escape"],
    ["../secrets", "escaping ancestor"],
    ["state/../backups", "normalizes into backups"],
  ])("rejects unsafe folder entry %j (%s)", (entry) => {
    const r = backupZod.safeParse({ folders: [entry] });
    expect(r.success).toBe(false);
  });

  it("accepts a safe nested relative folder", () => {
    const r = backupZod.safeParse({ folders: ["state", "configuration/user"] });
    expect(r.success).toBe(true);
  });
});
