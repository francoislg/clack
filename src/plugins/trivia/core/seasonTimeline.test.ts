import { describe, it, expect } from "vitest";
import { validateSeasonSlug, validateSeasonWindow } from "./seasonTimeline.js";

describe("validateSeasonSlug", () => {
  it("accepts non-empty kebab-case slugs", () => {
    for (const good of ["kickoff", "kickoff-2026", "a", "s1-q2-final"]) {
      expect(validateSeasonSlug(good)).toEqual({ ok: true });
    }
  });

  it("rejects non-kebab-case slugs", () => {
    for (const bad of ["", "Kickoff", "has space", "trailing-", "-leading", "doub--le", "UPPER"]) {
      const result = validateSeasonSlug(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/kebab-case/);
    }
  });

  it("uses the supplied label in the error message", () => {
    const result = validateSeasonSlug("Bad", "initialSeason.slug");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('initialSeason.slug "Bad"');
  });
});

describe("validateSeasonWindow", () => {
  it("accepts a window whose start is strictly before its end", () => {
    expect(validateSeasonWindow(1, 2)).toEqual({ ok: true });
  });

  it("rejects equal or inverted bounds", () => {
    for (const [start, end] of [
      [5, 5],
      [9, 1],
    ]) {
      const result = validateSeasonWindow(start, end);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/strictly less than expectedEndAt/);
    }
  });

  it("uses the supplied label in the error message", () => {
    const result = validateSeasonWindow(9, 1, "initialSeason.startedAt");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("initialSeason.startedAt (9)");
  });
});
