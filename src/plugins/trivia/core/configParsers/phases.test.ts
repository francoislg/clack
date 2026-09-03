import { describe, it, expect } from "vitest";
import { PHASE_DISALLOWED_KEYS, parsePhases, phasesStrictZod, phasesZod } from "./phases.js";

describe("phasesZod — valid parsing", () => {
  it("parses a valid duration-chained array", () => {
    const result = phasesZod.safeParse([{ slug: "phase-one", days: 7 }, { slug: "phase-two" }]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(2);
    expect(result.data[0].days).toBe(7);
    expect(result.data[1].days).toBeUndefined();
  });

  it("accepts a per-tier axis field on a slice", () => {
    const result = phasesZod.safeParse([{ slug: "solo", answersFormat: { boolean: 1 } }]);
    expect(result.success).toBe(true);
  });

  it("dedupes categories preserving first-occurrence order", () => {
    const result = phasesZod.safeParse([{ slug: "solo", categories: ["a", "b", "a", "c", "b"] }]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data[0].categories).toEqual(["a", "b", "c"]);
  });

  it("trims theme", () => {
    const result = phasesZod.safeParse([{ slug: "solo", theme: "  Spooky  " }]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data[0].theme).toBe("Spooky");
  });
});

describe("phasesStrictZod — rejections", () => {
  it("rejects duplicate slugs", () => {
    const result = phasesStrictZod.safeParse([{ slug: "dup", days: 1 }, { slug: "dup" }]);
    expect(result.success).toBe(false);
  });

  it("rejects a non-final slice missing days", () => {
    const result = phasesStrictZod.safeParse([{ slug: "a" }, { slug: "b" }]);
    expect(result.success).toBe(false);
  });

  it("rejects the final slice declaring days", () => {
    const result = phasesStrictZod.safeParse([
      { slug: "a", days: 1 },
      { slug: "b", days: 2 },
    ]);
    expect(result.success).toBe(false);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
  ])("rejects a %s days value", (_label, days) => {
    const result = phasesStrictZod.safeParse([{ slug: "a", days }, { slug: "b" }]);
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only theme", () => {
    const result = phasesStrictZod.safeParse([{ slug: "a", days: 1, theme: "   " }, { slug: "b" }]);
    expect(result.success).toBe(false);
  });

  it("rejects an empty categories array", () => {
    const result = phasesStrictZod.safeParse([
      { slug: "a", days: 1, categories: [] },
      { slug: "b" },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects a non-kebab-case slug and names it", () => {
    const result = phasesStrictZod.safeParse([{ slug: "Not_Kebab", days: 1 }, { slug: "b" }]);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain("Not_Kebab");
  });

  it.each(PHASE_DISALLOWED_KEYS)("rejects the structural/scoring key %s and names it", (key) => {
    const result = phasesStrictZod.safeParse([{ slug: "a", days: 1, [key]: {} }, { slug: "b" }]);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain(key);
  });
});

describe("parsePhases — lenient reader", () => {
  it("returns the parsed array with no issues for a valid chain", () => {
    const { phases, issues } = parsePhases([{ slug: "a", days: 1 }, { slug: "b" }], "season-x");
    expect(issues).toHaveLength(0);
    expect(phases).toHaveLength(2);
  });

  it("drops a disallowed key field-by-field and keeps the slice", () => {
    const { phases, issues } = parsePhases(
      [{ slug: "a", days: 1, teams: [{ name: "Red", userIds: ["U1"] }] }, { slug: "b" }],
      "season-x",
    );
    expect(phases).toHaveLength(2);
    expect(phases?.[0]).not.toHaveProperty("teams");
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("seasons[season-x].phases[0].teams");
  });

  it("drops the whole array on a chaining-invariant violation", () => {
    const { phases, issues } = parsePhases([{ slug: "a" }, { slug: "b" }], "season-x");
    expect(phases).toBeUndefined();
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("seasons[season-x].phases[0].days");
  });

  it("drops the whole array when raw is not an array", () => {
    const { phases, issues } = parsePhases("not-an-array", "season-x");
    expect(phases).toBeUndefined();
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("seasons[season-x].phases");
  });

  it("drops the whole array on a duplicate slug", () => {
    const { phases, issues } = parsePhases([{ slug: "dup", days: 1 }, { slug: "dup" }], "season-x");
    expect(phases).toBeUndefined();
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].field).toBe("seasons[season-x].phases[1].slug");
  });

  it("normalizes a partial weight map (fills the missing keys)", () => {
    const { phases, issues } = parsePhases(
      [{ slug: "solo", answersFormat: { choice: 3 } }],
      "season-x",
    );
    expect(issues).toHaveLength(0);
    expect(phases?.[0].answersFormat).toEqual({ boolean: 0, choice: 3, freeform: 0 });
  });

  it("drops only a blank theme field, keeping the slice and the rest of the array", () => {
    const { phases, issues } = parsePhases(
      [
        { slug: "a", days: 5 },
        { slug: "b", days: 5, theme: "   ", answersFormat: { boolean: 1 } },
        { slug: "c" },
      ],
      "season-x",
    );
    expect(phases).toHaveLength(3);
    expect(phases?.[1]).not.toHaveProperty("theme");
    expect(phases?.[1].answersFormat).toEqual({ boolean: 1, choice: 0, freeform: 0 });
    expect(issues.some((iss) => iss.field === "seasons[season-x].phases[1].theme")).toBe(true);
  });

  it("drops only an empty categories field, keeping the slice and the rest of the array", () => {
    const { phases, issues } = parsePhases(
      [{ slug: "a", days: 5 }, { slug: "b", days: 5, categories: [], theme: "Mid" }, { slug: "c" }],
      "season-x",
    );
    expect(phases).toHaveLength(3);
    expect(phases?.[1]).not.toHaveProperty("categories");
    expect(phases?.[1].theme).toBe("Mid");
    expect(issues.some((iss) => iss.field === "seasons[season-x].phases[1].categories")).toBe(true);
  });

  it("drops only a bad axis value (all-zero weight map), keeping the slice", () => {
    const { phases, issues } = parsePhases(
      [
        { slug: "a", days: 5 },
        { slug: "b", days: 5, answersFormat: { boolean: 0, choice: 0, freeform: 0 }, theme: "Mid" },
        { slug: "c" },
      ],
      "season-x",
    );
    expect(phases).toHaveLength(3);
    expect(phases?.[1]).not.toHaveProperty("answersFormat");
    expect(phases?.[1].theme).toBe("Mid");
    expect(issues.some((iss) => iss.field === "seasons[season-x].phases[1].answersFormat")).toBe(
      true,
    );
  });

  it("drops only an invalid days field on the final slice, keeping the array", () => {
    const { phases, issues } = parsePhases(
      [
        { slug: "a", days: 5 },
        { slug: "b", days: 5 },
        { slug: "c", days: 0, theme: "Finale" },
      ],
      "season-x",
    );
    expect(phases).toHaveLength(3);
    expect(phases?.[2]).not.toHaveProperty("days");
    expect(phases?.[2].theme).toBe("Finale");
    expect(issues.some((iss) => iss.field === "seasons[season-x].phases[2].days")).toBe(true);
  });

  it("drops the whole array when a non-final slice declares no days", () => {
    const { phases } = parsePhases([{ slug: "a" }, { slug: "b" }], "season-x");
    expect(phases).toBeUndefined();
  });

  it("drops the whole array when the final slice declares days", () => {
    const { phases, issues } = parsePhases(
      [
        { slug: "a", days: 5 },
        { slug: "b", days: 5 },
      ],
      "season-x",
    );
    expect(phases).toBeUndefined();
    expect(issues.some((iss) => iss.field === "seasons[season-x].phases[1].days")).toBe(true);
  });

  it("drops the whole array on an invalid slug", () => {
    const { phases, issues } = parsePhases([{ slug: "Not_Kebab", days: 1 }, { slug: "b" }], "s");
    expect(phases).toBeUndefined();
    expect(issues[0].field).toBe("seasons[s].phases[0].slug");
  });

  it("drops the whole array on a missing slug", () => {
    const { phases, issues } = parsePhases([{ days: 1 }, { slug: "b" }], "s");
    expect(phases).toBeUndefined();
    expect(issues[0].field).toBe("seasons[s].phases[0].slug");
  });
});
