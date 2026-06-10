/**
 * Characterization test — the parity gate for `collapse-trivia-config-validation-onto-zod`.
 *
 * It snapshots the EXACT accept/reject behavior and error strings of today's
 * hand-rolled validators. The schema migration must keep these byte-for-byte.
 * After the migration this file is re-pointed at the zod-backed path (via the
 * same `validate*` signatures) and MUST still pass unchanged.
 *
 * Do not "fix" an assertion to match new output — a diff here means the
 * migration changed observable behavior, which is exactly what must not happen.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  validateAnswersFormatMap,
  validateQuestionTypeMap,
  validatePromptMediumMap,
  validateFreeformAnswerShapeMap,
  validateContextsList,
  validateDifficultyRangesMap,
  validateTriviaDifficultyMap,
  validateDifficultyBucketWeights,
  validateTriviaDifficultyRatioMap,
  validateTriviaChoicesConfig,
  validateHintConfig,
  validateAllTimeRowMode,
  validateFinalRevealSummary,
  validateJudgeLeniency,
} from "./axes.js";
import { type Result } from "../../../zodResult.js";
import {
  validateFormat,
  validateSlotConfig,
  validateSlotOverrides,
  normalizeTheme,
  normalizeInstructions,
  normalizeAdditionalInstructions,
  normalizeCategories,
} from "./format.js";

/** A rejection case: input + the exact error string today's validator returns. */
interface RejectCase {
  name: string;
  input: unknown;
  error: string;
}
/** An accept case: input + the exact normalized value today's validator returns. */
interface AcceptCase {
  name: string;
  input: unknown;
  value: unknown;
}

function runValidator<T>(
  label: string,
  fn: (raw: unknown, label: string) => Result<T>,
  fieldLabel: string,
  accept: AcceptCase[],
  reject: RejectCase[],
): void {
  describe(label, () => {
    for (const c of accept) {
      it(`accepts: ${c.name}`, () => {
        const r = fn(c.input, fieldLabel);
        assert.ok(r.ok, `expected ok for ${c.name}, got error: ${r.ok ? "" : r.error}`);
        assert.deepEqual(r.value, c.value);
      });
    }
    for (const c of reject) {
      it(`rejects: ${c.name}`, () => {
        const r = fn(c.input, fieldLabel);
        assert.ok(!r.ok, `expected rejection for ${c.name}`);
        assert.equal(r.error, c.error);
      });
    }
  });
}

// --- Weight maps -----------------------------------------------------------

runValidator(
  "validateAnswersFormatMap",
  validateAnswersFormatMap,
  "answersFormat",
  [
    {
      name: "full map",
      input: { boolean: 1, choice: 2, freeform: 3 },
      value: { boolean: 1, choice: 2, freeform: 3 },
    },
    {
      name: "partial map normalizes missing to 0",
      input: { choice: 5 },
      value: { boolean: 0, choice: 5, freeform: 0 },
    },
  ],
  [
    { name: "non-object", input: null, error: "'answersFormat' must be an object" },
    { name: "array", input: [1, 2], error: "'answersFormat' must be an object" },
    {
      name: "unknown key",
      input: { boolean: 1, bogus: 1 },
      error: "'answersFormat' contains unknown key 'bogus' (allowed: boolean, choice, freeform)",
    },
    {
      name: "non-integer weight",
      input: { boolean: 1.5 },
      error: "'answersFormat.boolean' must be a non-negative integer (got 1.5)",
    },
    {
      name: "negative weight",
      input: { choice: -1 },
      error: "'answersFormat.choice' must be a non-negative integer (got -1)",
    },
    {
      name: "all-zero",
      input: { boolean: 0, choice: 0 },
      error: "'answersFormat' must have at least one strictly positive weight",
    },
  ],
);

runValidator(
  "validateQuestionTypeMap",
  validateQuestionTypeMap,
  "questionType",
  [
    {
      name: "full map",
      input: { fact: 1, topical: 0 },
      value: { fact: 1, topical: 0, prediction: 0 },
    },
  ],
  [
    {
      name: "unknown key",
      input: { fact: 1, nope: 1 },
      error: "'questionType' contains unknown key 'nope' (allowed: fact, topical, prediction)",
    },
    {
      name: "all-zero",
      input: { fact: 0 },
      error: "'questionType' must have at least one strictly positive weight",
    },
  ],
);

runValidator(
  "validatePromptMediumMap",
  validatePromptMediumMap,
  "promptMedium",
  [{ name: "partial", input: { image: 1 }, value: { text: 0, image: 1 } }],
  [
    {
      name: "unknown key",
      input: { text: 1, audio: 1 },
      error: "'promptMedium' contains unknown key 'audio' (allowed: text, image)",
    },
  ],
);

runValidator(
  "validateFreeformAnswerShapeMap",
  validateFreeformAnswerShapeMap,
  "freeformAnswerShape",
  [
    {
      name: "partial normalizes the seven keys",
      input: { name: 2 },
      value: { name: 2, place: 0, phrase: 0, title: 0, date: 0, countable: 0, other: 0 },
    },
  ],
  [
    {
      name: "unknown key",
      input: { name: 1, color: 1 },
      error:
        "'freeformAnswerShape' contains unknown key 'color' (allowed: name, place, phrase, title, date, countable, other)",
    },
  ],
);

// --- Contexts --------------------------------------------------------------

runValidator(
  "validateContextsList",
  validateContextsList,
  "contexts",
  [
    {
      name: "names only",
      input: [{ name: "a" }, { name: "b" }],
      value: [{ name: "a" }, { name: "b" }],
    },
    { name: "with weight", input: [{ name: "a", weight: 2 }], value: [{ name: "a", weight: 2 }] },
  ],
  [
    { name: "non-array", input: {}, error: "'contexts' must be an array" },
    { name: "empty", input: [], error: "'contexts' must be non-empty when present" },
    { name: "entry not object", input: ["x"], error: "'contexts[0]' must be an object" },
    { name: "name not string", input: [{ name: 1 }], error: "'contexts[0].name' must be a string" },
    {
      name: "duplicate name",
      input: [{ name: "a" }, { name: "a" }],
      error: "'contexts[1]' has duplicate name 'a'",
    },
    {
      name: "non-positive weight",
      input: [{ name: "a", weight: 0 }],
      error: "'contexts[0].weight' must be a positive number (got 0)",
    },
  ],
);

// --- Difficulty ranges -----------------------------------------------------

runValidator(
  "validateDifficultyRangesMap",
  validateDifficultyRangesMap,
  "difficulty.boolean",
  [
    {
      name: "valid buckets",
      input: { easy: [1, 3], hard: [7, 10] },
      value: { easy: [1, 3], hard: [7, 10] },
    },
  ],
  [
    {
      name: "unknown bucket",
      input: { trivial: [1, 2] },
      error: "'difficulty.boolean' contains unknown key 'trivial' (allowed: easy, medium, hard)",
    },
    {
      name: "not a tuple",
      input: { easy: [1] },
      error: "'difficulty.boolean.easy' must be a [min, max] tuple",
    },
    {
      name: "min out of range",
      input: { easy: [0, 3] },
      error: "'difficulty.boolean.easy[0]' must be an integer in [1, 10] (got 0)",
    },
    {
      name: "max out of range",
      input: { easy: [1, 11] },
      error: "'difficulty.boolean.easy[1]' must be an integer in [1, 10] (got 11)",
    },
    {
      name: "min > max",
      input: { easy: [5, 3] },
      error: "'difficulty.boolean.easy' min (5) must be <= max (3)",
    },
  ],
);

runValidator(
  "validateTriviaDifficultyMap",
  validateTriviaDifficultyMap,
  "difficulty",
  [
    {
      name: "per-format",
      input: { boolean: { easy: [1, 2] } },
      value: { boolean: { easy: [1, 2] } },
    },
  ],
  [
    {
      name: "unknown format",
      input: { picture: {} },
      error: "'difficulty' contains unknown key 'picture' (allowed: boolean, choice, freeform)",
    },
  ],
);

runValidator(
  "validateDifficultyBucketWeights",
  validateDifficultyBucketWeights,
  "difficultyRatio.boolean",
  [{ name: "partial", input: { easy: 3 }, value: { easy: 3, medium: 0, hard: 0 } }],
  [
    {
      name: "all-zero",
      input: { easy: 0 },
      error: "'difficultyRatio.boolean' must have at least one strictly positive weight",
    },
    {
      name: "unknown bucket",
      input: { easy: 1, vhard: 1 },
      error: "'difficultyRatio.boolean' contains unknown key 'vhard' (allowed: easy, medium, hard)",
    },
  ],
);

runValidator(
  "validateTriviaDifficultyRatioMap",
  validateTriviaDifficultyRatioMap,
  "difficultyRatio",
  [
    {
      name: "per-format buckets",
      input: { choice: { hard: 2 } },
      value: { choice: { easy: 0, medium: 0, hard: 2 } },
    },
  ],
  [
    {
      name: "unknown format",
      input: { audio: { easy: 1 } },
      error: "'difficultyRatio' contains unknown key 'audio' (allowed: boolean, choice, freeform)",
    },
  ],
);

// --- Choices / hint / enums ------------------------------------------------

runValidator(
  "validateTriviaChoicesConfig",
  validateTriviaChoicesConfig,
  "choices",
  [{ name: "valid", input: { min: 2, max: 4 }, value: { min: 2, max: 4 } }],
  [
    {
      name: "min out of range",
      input: { min: 1, max: 4 },
      error: "'choices.min' must be an integer in [2, 4] (got 1)",
    },
    {
      name: "max out of range",
      input: { min: 2, max: 5 },
      error: "'choices.max' must be an integer in [2, 4] (got 5)",
    },
    { name: "min > max", input: { min: 4, max: 2 }, error: "'choices' min (4) must be <= max (2)" },
  ],
);

runValidator(
  "validateHintConfig",
  validateHintConfig,
  "hint",
  [
    { name: "mode only", input: { mode: "button" }, value: { mode: "button" } },
    {
      name: "with minDifficulty",
      input: { mode: "inline", minDifficulty: "hard" },
      value: { mode: "inline", minDifficulty: "hard" },
    },
  ],
  [
    {
      name: "unknown key",
      input: { mode: "none", extra: 1 },
      error: "'hint' contains unknown key 'extra' (allowed: mode, minDifficulty)",
    },
    {
      name: "bad mode",
      input: { mode: "loud" },
      error: "'hint.mode' must be one of none, button, inline (got \"loud\")",
    },
    {
      name: "bad minDifficulty",
      input: { mode: "inline", minDifficulty: "trivial" },
      error: "'hint.minDifficulty' must be one of easy, medium, hard (got \"trivial\")",
    },
  ],
);

runValidator(
  "validateAllTimeRowMode",
  validateAllTimeRowMode,
  "allTimeRow",
  [{ name: "valid", input: "always", value: "always" }],
  [
    {
      name: "bad value",
      input: "sometimes",
      error: "'allTimeRow' must be one of always, never, end-of-season-only (got \"sometimes\")",
    },
  ],
);

runValidator(
  "validateFinalRevealSummary",
  validateFinalRevealSummary,
  "finalRevealSummary",
  [{ name: "valid", input: "in-thread", value: "in-thread" }],
  [
    {
      name: "bad value",
      input: "maybe",
      error: "'finalRevealSummary' must be one of yes, no, in-thread (got \"maybe\")",
    },
  ],
);

runValidator(
  "validateJudgeLeniency",
  validateJudgeLeniency,
  "judgeLeniency",
  [{ name: "valid", input: "lenient", value: "lenient" }],
  [
    {
      name: "bad value",
      input: "loose",
      error: "'judgeLeniency' must be one of strict, strict-with-typos, lenient (got \"loose\")",
    },
  ],
);

// --- normalize* (string fields) --------------------------------------------

describe("normalize* string fields", () => {
  it("normalizeTheme trims", () => {
    const r = normalizeTheme("  Movies  ");
    assert.ok(r.ok);
    assert.equal(r.value, "Movies");
  });
  it("normalizeTheme rejects empty", () => {
    const r = normalizeTheme("   ");
    assert.ok(!r.ok);
    assert.equal(r.error, "theme must be non-empty (pass null to clear).");
  });
  it("normalizeInstructions rejects empty", () => {
    const r = normalizeInstructions("");
    assert.ok(!r.ok);
    assert.equal(r.error, "instructions must be non-empty (pass null to clear).");
  });
  it("normalizeAdditionalInstructions rejects empty", () => {
    const r = normalizeAdditionalInstructions("  ");
    assert.ok(!r.ok);
    assert.equal(r.error, "additionalInstructions must be non-empty (pass null to clear).");
  });
  it("normalizeCategories trims, dedupes preserving order", () => {
    const r = normalizeCategories([" a ", "b", "a", ""]);
    assert.ok(r.ok);
    assert.deepEqual(r.value, ["a", "b"]);
  });
  it("normalizeCategories rejects all-empty", () => {
    const r = normalizeCategories(["", "   "]);
    assert.ok(!r.ok);
    assert.equal(r.error, "categories must contain at least one non-empty string.");
  });
});

// --- format / slot ---------------------------------------------------------

describe("validateFormat", () => {
  it("accepts a one-slot format", () => {
    const r = validateFormat({ questions: [{ label: "Q1" }] }, "format");
    assert.ok(r.ok);
    assert.deepEqual(r.value, { questions: [{ label: "Q1" }] });
  });
  it("rejects null", () => {
    const r = validateFormat(null, "format");
    assert.ok(!r.ok);
    assert.equal(r.error, "'format' must be an object");
  });
  it("rejects empty questions", () => {
    const r = validateFormat({ questions: [] }, "format");
    assert.ok(!r.ok);
    assert.equal(r.error, "'format.questions' must be a non-empty array");
  });
  it("propagates slot error with indexed label", () => {
    const r = validateFormat(
      { questions: [{ label: "ok" }, { answersFormat: { boolean: 0 } }] },
      "format",
    );
    assert.ok(!r.ok);
    assert.equal(
      r.error,
      "'format.questions[1].answersFormat' must have at least one strictly positive weight",
    );
  });
});

describe("validateSlotConfig", () => {
  it("accepts and normalizes categories", () => {
    const r = validateSlotConfig({ categories: ["a", "a", "b"] }, "format.questions[0]");
    assert.ok(r.ok);
    assert.deepEqual(r.value, { categories: ["a", "b"] });
  });
  it("rejects empty label", () => {
    const r = validateSlotConfig({ label: "  " }, "format.questions[0]");
    assert.ok(!r.ok);
    assert.equal(r.error, "'format.questions[0].label' must be non-empty after trim");
  });
  it("rejects empty categories array", () => {
    const r = validateSlotConfig({ categories: [] }, "format.questions[0]");
    assert.ok(!r.ok);
    assert.equal(
      r.error,
      "'format.questions[0].categories' must be a non-empty array when provided",
    );
  });
  it("rejects bad revealResponses", () => {
    const r = validateSlotConfig({ revealResponses: "maybe" }, "format.questions[0]");
    assert.ok(!r.ok);
    assert.equal(
      r.error,
      '\'format.questions[0].revealResponses\' must be one of "no", "just-winners", "just-correctness", "yes"',
    );
  });
  it("rejects non-boolean liveAnswersVisible", () => {
    // Pass JSON-shaped input (untyped) — mirrors the runtime path where slots
    // arrive as parsed JSON, not as a typed RawSlot.
    const badSlot = JSON.parse('{"liveAnswersVisible":"yes"}');
    const r = validateSlotConfig(badSlot, "format.questions[0]");
    assert.ok(!r.ok);
    assert.equal(r.error, "'format.questions[0].liveAnswersVisible' must be a boolean");
  });
});

describe("validateSlotOverrides", () => {
  it("validates each slot under its key", () => {
    const r = validateSlotOverrides({ "0": { label: "A" }, "2": { categories: ["x"] } });
    assert.ok(r.ok);
    assert.deepEqual(r.value, { 0: { label: "A" }, 2: { categories: ["x"] } });
  });
  it("propagates error with keyed label", () => {
    const r = validateSlotOverrides({ "3": { answersFormat: { boolean: 0 } } });
    assert.ok(!r.ok);
    assert.equal(
      r.error,
      "'slotOverrides.3.answersFormat' must have at least one strictly positive weight",
    );
  });
});
