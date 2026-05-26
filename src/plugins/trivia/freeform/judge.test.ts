import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildJudgePrompt, parseJudgeResponse, type JudgeQuestionGroup } from "./judge.js";
import type { TriviaQuestion } from "../core/types.js";

function makeQuestion(overrides: Partial<TriviaQuestion>): TriviaQuestion {
  return {
    id: "q-1",
    category: "Geography",
    statement: "What is the capital of France?",
    answersFormat: "freeform",
    questionType: "fact",
    expectedAnswer: "Paris",
    emojis: ["🌍"],
    createdAt: 0,
    ...overrides,
  };
}

describe("buildJudgePrompt", () => {
  it("includes statement, expected answer, and each submission with its key", () => {
    const groups: JudgeQuestionGroup[] = [
      {
        question: makeQuestion({}),
        submissions: [
          { key: "1.1", userId: "U1", answerText: "paris" },
          { key: "1.2", userId: "U2", answerText: "Paris or London" },
        ],
      },
    ];
    const prompt = buildJudgePrompt(groups);
    const body = prompt.messages[0].content;
    assert.ok(body.includes("What is the capital of France?"));
    assert.ok(body.includes("Expected answer: Paris"));
    assert.ok(body.includes('[1.1] U1: "paris"'));
    assert.ok(body.includes('[1.2] U2: "Paris or London"'));
  });

  it("includes acceptable variants and grading notes when present", () => {
    const groups: JudgeQuestionGroup[] = [
      {
        question: makeQuestion({
          acceptableAnswers: ["Paris, France"],
          gradingNotes: "Accept any major French city.",
        }),
        submissions: [{ key: "1.1", userId: "U1", answerText: "Paris" }],
      },
    ];
    const body = buildJudgePrompt(groups).messages[0].content;
    assert.ok(body.includes("Acceptable variants: Paris, France"));
    assert.ok(body.includes("Notes: Accept any major French city."));
  });

  it("skips questions with no submissions from the body", () => {
    const groups: JudgeQuestionGroup[] = [
      { question: makeQuestion({ id: "q-with-no-subs" }), submissions: [] },
      {
        question: makeQuestion({ id: "q-with-subs" }),
        submissions: [{ key: "2.1", userId: "U1", answerText: "Paris" }],
      },
    ];
    const body = buildJudgePrompt(groups).messages[0].content;
    assert.ok(body.includes("[2.1]"));
    // The skipped question still has its body absent.
    assert.ok(!body.includes("q-with-no-subs"));
  });

  it("system prompt establishes the multi-guess rule", () => {
    const { system } = buildJudgePrompt([
      {
        question: makeQuestion({}),
        submissions: [{ key: "1.1", userId: "U1", answerText: "ok" }],
      },
    ]);
    assert.ok(/multiple-guess/i.test(system));
    assert.ok(/qualifier/i.test(system));
  });

  it("system prompt accepts bare years for decade questions (format mismatch is not a rejection reason)", () => {
    const { system } = buildJudgePrompt([
      {
        question: makeQuestion({}),
        submissions: [{ key: "1.1", userId: "U1", answerText: "ok" }],
      },
    ]);
    assert.ok(/DATE FORMS/i.test(system), "judge prompt must call out DATE FORMS leniency");
    assert.ok(
      /format mismatch is NEVER a rejection reason/i.test(system),
      "judge prompt must say format mismatch alone is not a rejection reason",
    );
    assert.ok(
      /bare year/i.test(system),
      "judge prompt must explicitly mention bare year as an accepted form for decade questions",
    );
  });

  it("system prompt accepts every spanned decade for multi-decade events", () => {
    const { system } = buildJudgePrompt([
      {
        question: makeQuestion({}),
        submissions: [{ key: "1.1", userId: "U1", answerText: "ok" }],
      },
    ]);
    assert.ok(/DATE SPANS/i.test(system), "judge prompt must call out DATE SPANS leniency");
    assert.ok(
      /every decade that the range touches/i.test(system),
      "judge prompt must say every spanned decade is acceptable",
    );
  });

  it("system prompt accepts cross-language translations of the expected answer", () => {
    const { system } = buildJudgePrompt([
      {
        question: makeQuestion({}),
        submissions: [{ key: "1.1", userId: "U1", answerText: "ok" }],
      },
    ]);
    assert.ok(/LANGUAGE/.test(system), "judge prompt must call out a LANGUAGE rule");
    assert.ok(/translation/i.test(system), "judge prompt must mention translations are acceptable");
    assert.ok(
      /named entit/i.test(system),
      "judge prompt must call out named entities as a covered translation case",
    );
    assert.ok(
      /unambiguous/i.test(system),
      "judge prompt must require the translation to be unambiguous",
    );
    assert.ok(
      /multiple-guess|too-broad|out-of-tolerance/i.test(system),
      "judge prompt must say cross-language acceptance does not relax other rules",
    );
  });
});

describe("parseJudgeResponse", () => {
  it("parses a well-formed JSON response", () => {
    const text = JSON.stringify({
      verdicts: [
        { key: "1.1", correct: true },
        { key: "1.2", correct: false, reason: "multiple-guess" },
      ],
    });
    const verdicts = parseJudgeResponse(text);
    assert.equal(verdicts.length, 2);
    assert.equal(verdicts[0].key, "1.1");
    assert.equal(verdicts[0].correct, true);
    assert.equal(verdicts[1].correct, false);
    assert.equal(verdicts[1].reason, "multiple-guess");
  });

  it("tolerates a markdown code fence around the JSON", () => {
    const fenced =
      "```json\n" + JSON.stringify({ verdicts: [{ key: "x", correct: true }] }) + "\n```";
    const verdicts = parseJudgeResponse(fenced);
    assert.equal(verdicts.length, 1);
    assert.equal(verdicts[0].correct, true);
  });

  it("throws on malformed JSON", () => {
    assert.throws(() => parseJudgeResponse("not json"));
  });

  it("throws when verdicts is missing", () => {
    assert.throws(() => parseJudgeResponse(JSON.stringify({ other: 1 })), /'verdicts'/);
  });

  it("throws when a verdict entry is missing key or correct", () => {
    assert.throws(() => parseJudgeResponse(JSON.stringify({ verdicts: [{ correct: true }] })));
    assert.throws(() => parseJudgeResponse(JSON.stringify({ verdicts: [{ key: "x" }] })));
  });
});
