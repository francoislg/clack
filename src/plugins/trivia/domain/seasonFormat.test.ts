import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateFormat, validateQuestionTypes, resolveSlotCategories } from "./seasonFormat.js";

describe("validateFormat", () => {
  it("accepts an empty slot `{}`", () => {
    const r = validateFormat({ questions: [{}] });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value.questions, [{}]);
  });

  it("accepts a fully-specified slot", () => {
    const r = validateFormat({
      questions: [
        {
          label: "History Choice",
          categories: ["History", "Ancient Civilizations"],
          questionTypes: { boolean: 0, choice: 1 },
        },
      ],
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.value.questions[0], {
        label: "History Choice",
        categories: ["History", "Ancient Civilizations"],
        questionTypes: { boolean: 0, choice: 1 },
      });
    }
  });

  it("trims labels", () => {
    const r = validateFormat({ questions: [{ label: "  Spaced  " }] });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.questions[0].label, "Spaced");
  });

  it("dedupes slot categories preserving order", () => {
    const r = validateFormat({
      questions: [{ categories: ["A", "B", "A", "C", "B"] }],
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value.questions[0].categories, ["A", "B", "C"]);
  });

  it("rejects null format", () => {
    const r = validateFormat(null);
    assert.equal(r.ok, false);
  });

  it("rejects undefined format", () => {
    const r = validateFormat(undefined);
    assert.equal(r.ok, false);
  });

  it("rejects format with empty questions array", () => {
    const r = validateFormat({ questions: [] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /non-empty/);
  });

  it("rejects format missing questions field", () => {
    const r = validateFormat({});
    assert.equal(r.ok, false);
  });

  it("rejects slot label that is empty after trim", () => {
    const r = validateFormat({ questions: [{ label: "   " }] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /label.*non-empty/);
  });

  it("rejects slot categories that is an empty array", () => {
    const r = validateFormat({ questions: [{ categories: [] }] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /categories.*non-empty/);
  });

  it("rejects slot categories with only empty strings", () => {
    const r = validateFormat({ questions: [{ categories: ["", ""] }] });
    assert.equal(r.ok, false);
  });

  it("rejects slot questionTypes with all-zero weights", () => {
    const r = validateFormat({
      questions: [{ questionTypes: { boolean: 0, choice: 0 } }],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /positive weight/);
  });

  it("rejects slot questionTypes with unknown keys", () => {
    const r = validateFormat({
      questions: [{ questionTypes: { boolean: 1, essay: 1 } }],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /unknown key/);
  });

  it("identifies which slot failed in the error message", () => {
    const r = validateFormat({
      questions: [{ label: "ok" }, { label: "" }],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /questions\[1\]/);
  });

  it("accepts a multi-slot format", () => {
    const r = validateFormat({
      questions: [
        { label: "Q1" },
        { label: "Q2", categories: ["History"] },
        { label: "Q3", questionTypes: { choice: 1 } },
      ],
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.questions.length, 3);
  });
});

describe("validateQuestionTypes", () => {
  it("accepts a positive boolean weight", () => {
    const r = validateQuestionTypes({ boolean: 1 });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { boolean: 1, choice: 0 });
  });

  it("accepts mixed positive weights", () => {
    const r = validateQuestionTypes({ boolean: 2, choice: 1 });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { boolean: 2, choice: 1 });
  });

  it("rejects all-zero", () => {
    const r = validateQuestionTypes({ boolean: 0, choice: 0 });
    assert.equal(r.ok, false);
  });

  it("rejects unknown keys", () => {
    const r = validateQuestionTypes({ boolean: 1, essay: 1 });
    assert.equal(r.ok, false);
  });

  it("rejects negative values", () => {
    const r = validateQuestionTypes({ boolean: -1 });
    assert.equal(r.ok, false);
  });

  it("rejects non-integer values", () => {
    const r = validateQuestionTypes({ boolean: 1.5 });
    assert.equal(r.ok, false);
  });
});

describe("resolveSlotCategories", () => {
  it("returns slot.categories when set", () => {
    assert.deepEqual(resolveSlotCategories({ categories: ["History"] }, ["Science", "Art"]), [
      "History",
    ]);
  });

  it("falls back to season categories when slot.categories is absent", () => {
    assert.deepEqual(resolveSlotCategories({}, ["Science", "Art"]), ["Science", "Art"]);
  });
});
