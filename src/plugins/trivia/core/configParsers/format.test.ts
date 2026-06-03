import { describe, it, expect } from "vitest";
import { validateSlotConfig, validateSlotOverrides } from "./format.js";

describe("validateSlotConfig", () => {
  it("accepts a partial slot (only one axis set; others inherit)", () => {
    const r = validateSlotConfig({ promptMedium: { text: 1, image: 0 } }, "slot");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ promptMedium: { text: 1, image: 0 } });
  });

  it("accepts an empty slot (full inheritance)", () => {
    const r = validateSlotConfig({}, "slot");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });

  it("trims a label and rejects a blank one", () => {
    const trimmed = validateSlotConfig({ label: "  Q1  " }, "slot");
    expect(trimmed.ok).toBe(true);
    if (trimmed.ok) expect(trimmed.value.label).toBe("Q1");

    const blank = validateSlotConfig({ label: "   " }, "slot");
    expect(blank.ok).toBe(false);
  });

  it("rejects a zero-weight answersFormat map (needs ≥1 positive)", () => {
    const r = validateSlotConfig({ answersFormat: { boolean: 0, choice: 0, freeform: 0 } }, "slot");
    expect(r.ok).toBe(false);
  });

  it("propagates a labeled error from a nested axis", () => {
    const r = validateSlotConfig(
      { answersFormat: { boolean: 0, choice: 0, freeform: 0 } },
      "format.questions[2]",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("format.questions[2].answersFormat");
  });
});

describe("validateSlotOverrides", () => {
  it("normalizes string keys to numbers and validates each entry", () => {
    const r = validateSlotOverrides({
      "0": { promptMedium: { text: 0, image: 1 } },
      "2": { answersFormat: { boolean: 0, choice: 1, freeform: 0 } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0]).toEqual({ promptMedium: { text: 0, image: 1 } });
      expect(r.value[2]).toEqual({ answersFormat: { boolean: 0, choice: 1, freeform: 0 } });
    }
  });

  it("rejects when any entry's axis bag is invalid, with the slot index in the label", () => {
    const r = validateSlotOverrides({
      "3": { answersFormat: { boolean: 0, choice: 0, freeform: 0 } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("slotOverrides.3");
  });

  it("accepts an empty map", () => {
    const r = validateSlotOverrides({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });
});
