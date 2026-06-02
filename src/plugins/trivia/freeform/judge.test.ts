import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  buildSingleJudgePrompt,
  judgeAnswer,
  judgeSubmissions,
  parseSingleVerdict,
  type JudgeSubmission,
} from "./judge.js";
import type { ClackSdk } from "../../sdk.js";
import type { TriviaQuestion } from "../core/types.js";

function makeQuestion(overrides: Partial<TriviaQuestion>): TriviaQuestion {
  return {
    id: "q-1",
    category: "Geography",
    statement: "What is the capital of France?",
    answersFormat: "freeform",
    questionType: "fact",
    expectedAnswer: "Paris",
    freeformAnswerShape: "place",
    emojis: ["🌍"],
    createdAt: 0,
    ...overrides,
  };
}

/** A scripted `askClaude` that returns each text in sequence, then throws. */
function scriptedAskClaude(texts: string[]): ClackSdk["askClaude"] {
  let i = 0;
  return async () => {
    const text = i < texts.length ? texts[i++] : "boom-out-of-script";
    return { text, stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0 } };
  };
}

describe("buildSingleJudgePrompt", () => {
  it("includes statement, expected answer, and the single typed answer", () => {
    const prompt = buildSingleJudgePrompt(makeQuestion({}), "paris");
    const body = prompt.messages[0].content;
    assert.ok(body.includes("Question: What is the capital of France?"));
    assert.ok(body.includes("Expected answer: Paris"));
    assert.ok(body.includes('Player\'s typed answer: "paris"'));
  });

  it("includes acceptable variants and grading notes when present", () => {
    const body = buildSingleJudgePrompt(
      makeQuestion({
        acceptableAnswers: ["Paris, France"],
        gradingNotes: "Accept any major French city.",
      }),
      "Paris",
    ).messages[0].content;
    assert.ok(body.includes("Acceptable variants: Paris, France"));
    assert.ok(body.includes("Notes: Accept any major French city."));
  });

  it("selects the DATE rule block (inclusive tolerance, format-agnostic) for date questions", () => {
    const { system } = buildSingleJudgePrompt(
      makeQuestion({ freeformAnswerShape: "date", expectedAnswer: "2000" }),
      "1995",
    );
    assert.ok(/DATE \/ TIME PERIOD/i.test(system), "date question must use the date rule block");
    assert.ok(
      /INCLUSIVE OF BOTH ENDPOINTS/i.test(system),
      "date rules must state the tolerance window is inclusive",
    );
    assert.ok(/out-of-tolerance/i.test(system));
    assert.ok(/bare year/i.test(system), "date rules must accept bare years regardless of format");
  });

  it("selects the named-entity rule block (typos + translations) for name/place/title", () => {
    for (const shape of ["name", "place", "title"] as const) {
      const { system } = buildSingleJudgePrompt(makeQuestion({ freeformAnswerShape: shape }), "x");
      assert.ok(/SPECIFIC ENTITY/i.test(system), `${shape} must use the named-entity block`);
      assert.ok(/typo-too-far/i.test(system));
      assert.ok(/translation/i.test(system));
    }
  });

  it("every prompt forbids multi-guess answers and demands strict JSON output", () => {
    const { system } = buildSingleJudgePrompt(makeQuestion({}), "x");
    assert.ok(/multiple-guess/i.test(system));
    assert.ok(/STRICT JSON/i.test(system));
    assert.ok(/"correct"/.test(system));
  });
});

describe("parseSingleVerdict", () => {
  it("parses a well-formed correct verdict", () => {
    const v = parseSingleVerdict(JSON.stringify({ correct: true }));
    assert.equal(v.correct, true);
    assert.equal(v.reason, undefined);
  });

  it("parses an incorrect verdict with a reason", () => {
    const v = parseSingleVerdict(JSON.stringify({ correct: false, reason: "out-of-tolerance" }));
    assert.equal(v.correct, false);
    assert.equal(v.reason, "out-of-tolerance");
  });

  it("tolerates a markdown code fence around the JSON", () => {
    const v = parseSingleVerdict("```json\n" + JSON.stringify({ correct: true }) + "\n```");
    assert.equal(v.correct, true);
  });

  it("throws on malformed JSON", () => {
    assert.throws(() => parseSingleVerdict("not json"));
  });

  it("throws when 'correct' is missing or non-boolean", () => {
    assert.throws(() => parseSingleVerdict(JSON.stringify({ reason: "x" })));
    assert.throws(() => parseSingleVerdict(JSON.stringify({ correct: "yes" })));
  });
});

describe("judgeAnswer", () => {
  it("returns the verdict on the first clean response", async () => {
    // "Lyon" is not the expected answer, so it falls through to the model path.
    const ask = scriptedAskClaude([JSON.stringify({ correct: true })]);
    const v = await judgeAnswer(ask, makeQuestion({}), "Lyon");
    assert.equal(v.correct, true);
  });

  it("re-asks when the model returns something other than a yes/no, then succeeds", async () => {
    const ask = scriptedAskClaude([
      "I think this is probably right?",
      "```\noops still prose\n```",
      JSON.stringify({ correct: false, reason: "materially-different" }),
    ]);
    const v = await judgeAnswer(ask, makeQuestion({}), "London", { maxAttempts: 4 });
    assert.equal(v.correct, false);
    assert.equal(v.reason, "materially-different");
  });

  it("throws after exhausting the re-ask budget (never silently scores)", async () => {
    const ask = scriptedAskClaude(["nope", "still nope", "nope again"]);
    await assert.rejects(
      () => judgeAnswer(ask, makeQuestion({}), "London", { maxAttempts: 3 }),
      /no usable verdict after 3 attempts/,
    );
  });
});

describe("judgeAnswer exact-match short-circuit", () => {
  /** An `askClaude` that fails the test if the model is ever consulted. */
  const askThatMustNotRun: ClackSdk["askClaude"] = async () => {
    throw new Error("askClaude should not be called for an exact match");
  };

  it("accepts an exact canonical answer without calling the model", async () => {
    const v = await judgeAnswer(askThatMustNotRun, makeQuestion({}), "Paris");
    assert.deepEqual(v, { correct: true, reason: "exact-match" });
  });

  it("accepts a case- and whitespace-variant match without calling the model", async () => {
    const v = await judgeAnswer(
      askThatMustNotRun,
      makeQuestion({ expectedAnswer: "The Roman Empire" }),
      "  the   ROMAN empire ",
    );
    assert.deepEqual(v, { correct: true, reason: "exact-match" });
  });

  it("accepts a match against an acceptable variant without calling the model", async () => {
    const v = await judgeAnswer(
      askThatMustNotRun,
      makeQuestion({ expectedAnswer: "New York City", acceptableAnswers: ["NYC", "New York"] }),
      "nyc",
    );
    assert.deepEqual(v, { correct: true, reason: "exact-match" });
  });

  it("falls through to the model when the answer is not an exact match", async () => {
    let calls = 0;
    const ask: ClackSdk["askClaude"] = async () => {
      calls++;
      return {
        text: JSON.stringify({ correct: true }),
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    };
    const v = await judgeAnswer(ask, makeQuestion({}), "Tokyo, Japan");
    assert.equal(calls, 1);
    assert.equal(v.correct, true);
    assert.equal(v.reason, undefined);
  });
});

describe("judgeSubmissions", () => {
  const subs: JudgeSubmission[] = [
    { userId: "U1", answerText: "Paris" },
    { userId: "U2", answerText: "London" },
  ];

  it("judges each submission independently against its own typed answer", async () => {
    // Branch on the typed answer embedded in the prompt — proves per-answer calls.
    const ask: ClackSdk["askClaude"] = async (opts) => {
      const correct = opts.messages[0].content.includes('"Paris"');
      return {
        text: JSON.stringify(correct ? { correct: true } : { correct: false, reason: "x" }),
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    };
    const judged = await judgeSubmissions(ask, makeQuestion({}), subs);
    const byUser = new Map(judged.map((j) => [j.submission.userId, j.verdict]));
    assert.equal(byUser.get("U1")?.correct, true);
    assert.equal(byUser.get("U2")?.correct, false);
  });

  it("returns verdict: null for a submission whose retries all fail, without blocking the rest", async () => {
    const ask: ClackSdk["askClaude"] = async (opts) => {
      const text = opts.messages[0].content.includes('"Paris"')
        ? JSON.stringify({ correct: true })
        : "never valid";
      return { text, stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0 } };
    };
    const judged = await judgeSubmissions(ask, makeQuestion({}), subs, { maxAttempts: 2 });
    const byUser = new Map(judged.map((j) => [j.submission.userId, j.verdict]));
    assert.equal(byUser.get("U1")?.correct, true);
    assert.equal(byUser.get("U2"), null);
  });
});
