import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  validateAnswersFormat,
  validateQuestionType,
  validateContexts,
  resolveSlotCategories,
} from "./seasonFormat.js";
import { validateFormat } from "../core/configParsers/format.js";

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
          answersFormat: { boolean: 0, choice: 1 },
          questionType: { fact: 1, topical: 0 },
          contexts: [{ name: "academic", weight: 2 }],
        },
      ],
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.value.questions[0], {
        label: "History Choice",
        categories: ["History", "Ancient Civilizations"],
        answersFormat: { boolean: 0, choice: 1, freeform: 0 },
        questionType: { fact: 1, topical: 0 },
        contexts: [{ name: "academic", weight: 2 }],
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

  it("rejects slot answersFormat with all-zero weights", () => {
    const r = validateFormat({
      questions: [{ answersFormat: { boolean: 0, choice: 0 } }],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /positive weight/);
  });

  it("rejects slot answersFormat with unknown keys", () => {
    const r = validateFormat({
      questions: [{ answersFormat: { boolean: 1, essay: 1 } }],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /unknown key/);
  });

  it("rejects slot questionType with all-zero weights", () => {
    const r = validateFormat({
      questions: [{ questionType: { fact: 0, topical: 0 } }],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /positive weight/);
  });

  it("rejects slot contexts with empty array", () => {
    const r = validateFormat({ questions: [{ contexts: [] }] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /non-empty/);
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
        { label: "Q3", answersFormat: { choice: 1 } },
      ],
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.questions.length, 3);
  });
});

describe("validateAnswersFormat", () => {
  it("accepts a positive boolean weight", () => {
    const r = validateAnswersFormat({ boolean: 1 });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { boolean: 1, choice: 0, freeform: 0 });
  });

  it("accepts mixed positive weights", () => {
    const r = validateAnswersFormat({ boolean: 2, choice: 1 });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { boolean: 2, choice: 1, freeform: 0 });
  });

  it("rejects all-zero", () => {
    const r = validateAnswersFormat({ boolean: 0, choice: 0 });
    assert.equal(r.ok, false);
  });

  it("rejects unknown keys", () => {
    const r = validateAnswersFormat({ boolean: 1, essay: 1 });
    assert.equal(r.ok, false);
  });

  it("rejects negative values", () => {
    const r = validateAnswersFormat({ boolean: -1 });
    assert.equal(r.ok, false);
  });

  it("rejects non-integer values", () => {
    const r = validateAnswersFormat({ boolean: 1.5 });
    assert.equal(r.ok, false);
  });
});

describe("validateQuestionType", () => {
  it("accepts a positive fact weight", () => {
    const r = validateQuestionType({ fact: 1 });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { fact: 1, topical: 0 });
  });

  it("accepts mixed positive weights", () => {
    const r = validateQuestionType({ fact: 3, topical: 1 });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { fact: 3, topical: 1 });
  });

  it("rejects all-zero", () => {
    const r = validateQuestionType({ fact: 0, topical: 0 });
    assert.equal(r.ok, false);
  });

  it("rejects unknown keys", () => {
    const r = validateQuestionType({ fact: 1, news: 1 });
    assert.equal(r.ok, false);
  });
});

describe("validateContexts", () => {
  it("accepts a single-entry list", () => {
    const r = validateContexts([{ name: "Quebec" }]);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, [{ name: "Quebec" }]);
  });

  it("accepts entries with weights", () => {
    const r = validateContexts([
      { name: "Quebec", weight: 5 },
      { name: "International", weight: 1 },
    ]);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.value, [
        { name: "Quebec", weight: 5 },
        { name: "International", weight: 1 },
      ]);
    }
  });

  it("accepts the empty-string name as a first-class entry", () => {
    const r = validateContexts([{ name: "Quebec", weight: 3 }, { name: "" }]);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.length, 2);
  });

  it("rejects an empty array", () => {
    const r = validateContexts([]);
    assert.equal(r.ok, false);
  });

  it("rejects duplicate names", () => {
    const r = validateContexts([{ name: "Quebec" }, { name: "Quebec" }]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /duplicate/);
  });

  it("rejects non-positive weights", () => {
    const r = validateContexts([{ name: "Quebec", weight: 0 }]);
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
