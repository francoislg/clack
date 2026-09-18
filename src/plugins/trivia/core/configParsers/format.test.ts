import { describe, it, expect } from "vitest";
import { validateFormat, validateSlotConfig, validateSlotOverrides } from "./format.js";

describe("validateSlotConfig", () => {
  it("accepts a partial slot (only one axis set; others inherit)", () => {
    const r = validateSlotConfig({ promptMedium: { text: 1, image: 0 } }, "slot");
    expect(r).toEqual({ ok: true, value: { promptMedium: { text: 1, image: 0 } } });
  });

  it("accepts an empty slot (full inheritance)", () => {
    const r = validateSlotConfig({}, "slot");
    expect(r).toEqual({ ok: true, value: {} });
  });

  it("trims a label and rejects a blank one", () => {
    const trimmed = validateSlotConfig({ label: "  Q1  " }, "slot");
    expect(trimmed).toMatchObject({ ok: true, value: { label: "Q1" } });

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
    expect(r).toMatchObject({
      ok: false,
      error: expect.stringContaining("format.questions[2].answersFormat"),
    });
  });
});

describe("validateFormat flexible flag", () => {
  it("carries flexible: true through", () => {
    const r = validateFormat({ questions: [{}, {}], flexible: true });
    expect(r).toEqual({ ok: true, value: { questions: [{}, {}], flexible: true } });
  });

  it("carries flexible: false through", () => {
    const r = validateFormat({ questions: [{}], flexible: false });
    expect(r).toMatchObject({ ok: true, value: { flexible: false } });
  });

  it("omits flexible when absent (reads as fixed)", () => {
    const r = validateFormat({ questions: [{}] });
    expect(r).toStrictEqual({ ok: true, value: { questions: [{}] } });
  });

  it("rejects a non-boolean flexible with a labeled error", () => {
    const r = validateFormat({ questions: [{}], flexible: "yes" }, "format");
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("format.flexible") });
  });

  it("still rejects an empty questions array regardless of flexible", () => {
    const r = validateFormat({ questions: [], flexible: true });
    expect(r.ok).toBe(false);
  });
});

describe("validateSlotOverrides", () => {
  it("normalizes string keys to numbers and validates each entry", () => {
    const r = validateSlotOverrides({
      "0": { promptMedium: { text: 0, image: 1 } },
      "2": { answersFormat: { boolean: 0, choice: 1, freeform: 0 } },
    });
    expect(r).toEqual({
      ok: true,
      value: {
        0: { promptMedium: { text: 0, image: 1 } },
        2: { answersFormat: { boolean: 0, choice: 1, freeform: 0 } },
      },
    });
  });

  it("rejects when any entry's axis bag is invalid, with the slot index in the label", () => {
    const r = validateSlotOverrides({
      "3": { answersFormat: { boolean: 0, choice: 0, freeform: 0 } },
    });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("slotOverrides.3") });
  });

  it("accepts an empty map", () => {
    const r = validateSlotOverrides({});
    expect(r).toEqual({ ok: true, value: {} });
  });
});
