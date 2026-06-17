import { describe, it, expect } from "vitest";
import { idlerSlotSchema, parseSlot } from "./slice.js";

describe("parseSlot", () => {
  it("returns null for absent/invalid slices", () => {
    expect(parseSlot(undefined)).toBeNull();
    expect(parseSlot(null)).toBeNull();
    expect(parseSlot(42)).toBeNull();
  });

  it("round-trips a slice carrying ignoredAt", () => {
    const slot = parseSlot({ priority: 3, open: false, ignoredAt: "2026-06-16T12:00:00.000Z" });
    expect(slot).toMatchObject({ priority: 3, open: false, ignoredAt: "2026-06-16T12:00:00.000Z" });
  });

  it("parses a legacy slice lacking ignoredAt (no marker set)", () => {
    const slot = parseSlot({ priority: 1, open: true, whereWeAre: "in PR" });
    expect(slot).not.toBeNull();
    expect(slot?.ignoredAt).toBeUndefined();
  });

  it("applies permissive defaults to a partial slice", () => {
    expect(idlerSlotSchema.parse({})).toEqual({
      priority: 0,
      open: true,
      whereWeAre: "",
      cursorsByRefId: {},
    });
  });
});
