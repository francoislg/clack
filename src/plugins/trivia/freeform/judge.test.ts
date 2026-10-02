import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import {
  buildSingleJudgePrompt,
  DEFAULT_JUDGE_MODEL,
  EVALUATE_JUDGE_MODEL,
  judgeAnswer,
  judgeSubmissions,
  parseSingleVerdict,
  type JudgeSubmission,
} from "./judge.js";
import type { ClackSdk } from "../../../plugins-sdk/sdk.js";
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

describe("buildSingleJudgePrompt — judgeLeniency presets", () => {
  it("defaults to strict-with-typos (typo + loose-writing tolerance) when unstamped", () => {
    const { system } = buildSingleJudgePrompt(makeQuestion({}), "x");
    assert.ok(/Matching forgiveness/i.test(system));
    assert.ok(/~1 character off/i.test(system), "default must carry typo tolerance");
    assert.ok(/homophone/i.test(system), "default must carry loose-writing tolerance");
    assert.ok(/interchangeable renderings/i.test(system));
  });

  it("an explicit strict-with-typos stamp matches the unstamped default byte-for-byte", () => {
    const a = buildSingleJudgePrompt(makeQuestion({}), "x").system;
    const b = buildSingleJudgePrompt(
      makeQuestion({ judgeLeniency: "strict-with-typos" }),
      "x",
    ).system;
    assert.equal(a, b);
  });

  it("strict omits typo + loose-writing but keeps substitution/decade/plural", () => {
    const { system } = buildSingleJudgePrompt(makeQuestion({ judgeLeniency: "strict" }), "x");
    assert.ok(/interchangeable renderings/i.test(system));
    assert.ok(/decade form/i.test(system));
    assert.ok(/singular\/plural/i.test(system));
    assert.ok(!/~1 character off/i.test(system), "strict must NOT carry typo tolerance");
    assert.ok(!/homophone/i.test(system), "strict must NOT carry loose-writing tolerance");
  });

  it("lenient uses the knows-it intent test and drops the typo micro-rules", () => {
    const { system } = buildSingleJudgePrompt(makeQuestion({ judgeLeniency: "lenient" }), "x");
    assert.ok(/demonstrably KNEW/i.test(system));
    assert.ok(/could not plausibly mean a DIFFERENT/i.test(system));
    assert.ok(!/~1 character off/i.test(system));
    assert.ok(!/interchangeable renderings/i.test(system));
  });

  it("keeps the universal integrity guards under every preset", () => {
    for (const judgeLeniency of ["strict", "strict-with-typos", "lenient"] as const) {
      const { system } = buildSingleJudgePrompt(makeQuestion({ judgeLeniency }), "x");
      assert.ok(/multiple-guess/i.test(system), `${judgeLeniency} keeps the multi-guess guard`);
      assert.ok(/STRICT JSON/i.test(system), `${judgeLeniency} keeps the JSON output contract`);
    }
  });
});

const KEY_MATCH_RULES = `You are a strict but fair trivia judge. You are given ONE trivia question, its expected answer, and ONE player's typed answer. Decide whether that single answer is correct.

Universal rules (apply to every question):
- Matching is case- and punctuation-insensitive.
- A single answer carrying a qualifier or parenthetical is fine (e.g. "Tokyo, Japan", "Paris (France)", "rock and roll").
- REJECT (reason: "multiple-guess") any answer that hedges between two or more distinct guesses — "Paris or London", "either A or B", "A | B | C" — EVEN IF one of them is correct. The player must commit to ONE answer.
- ACCEPT (correct: true) when the typed answer is the expected answer expressed differently; REJECT (correct: false) when it is materially different.
- When "Acceptable variants" are listed, treat each as an additional fully-correct answer.
- "Notes" (when present) refine your judgment — honor any explicit tolerance or accepted-form guidance there STRICTLY. They never override the expected answer; they only clarify accepted forms.

Matching forgiveness`;

const KEY_MATCH_PRESETS = ["strict", "strict-with-typos", "lenient"] as const;
const MATERIALLY_DIFFERENT_RULE = /REJECT \(correct: false\) when it is materially different/;
const EVALUATE_BASIS_MARKER = /REFERENCE SOLUTION/;

describe("buildSingleJudgePrompt — judging basis", () => {
  it("key-match presets open with the universal rules followed by the key-match basis", () => {
    for (const judgeLeniency of KEY_MATCH_PRESETS) {
      const { system } = buildSingleJudgePrompt(makeQuestion({ judgeLeniency }), "x");
      assert.ok(system.startsWith(KEY_MATCH_RULES), `${judgeLeniency} carries the key-match rules`);
    }
  });

  it("key-match presets reject materially-different answers and carry no evaluate basis", () => {
    for (const judgeLeniency of KEY_MATCH_PRESETS) {
      const { system } = buildSingleJudgePrompt(makeQuestion({ judgeLeniency }), "x");
      assert.match(system, MATERIALLY_DIFFERENT_RULE);
      assert.match(system, /They never override the expected answer/);
      assert.doesNotMatch(system, EVALUATE_BASIS_MARKER);
      assert.doesNotMatch(system, /alternate-solve/);
    }
  });

  it("evaluate presents the expected answer as a reference solution and drops the key-match rejection", () => {
    const { system } = buildSingleJudgePrompt(makeQuestion({ judgeLeniency: "evaluate" }), "x");
    assert.match(system, EVALUATE_BASIS_MARKER);
    assert.doesNotMatch(system, MATERIALLY_DIFFERENT_RULE);
    assert.doesNotMatch(system, /materially-different/);
    assert.doesNotMatch(system, /They never override the expected answer/);
  });

  it("evaluate composes the knows-it fragment for key matches", () => {
    const { system } = buildSingleJudgePrompt(makeQuestion({ judgeLeniency: "evaluate" }), "x");
    assert.match(system, /demonstrably KNEW/);
    assert.doesNotMatch(system, /~1 character off/);
  });

  it("evaluate keeps the universal integrity rules and the JSON output contract", () => {
    const { system } = buildSingleJudgePrompt(makeQuestion({ judgeLeniency: "evaluate" }), "x");
    assert.match(system, /Matching is case- and punctuation-insensitive/);
    assert.match(system, /qualifier or parenthetical is fine/);
    assert.match(system, /Acceptable variants/);
    assert.match(system, /STRICT JSON/);
  });

  it("hole / 'Credit/Loan': accepts an every-clue fit and treats near-synonyms as one answer", () => {
    const { system, messages } = buildSingleJudgePrompt(
      makeQuestion({
        judgeLeniency: "evaluate",
        statement: "The more you take from me, the bigger I grow",
        expectedAnswer: "hole",
        freeformAnswerShape: "other",
      }),
      "Credit/Loan",
    );
    assert.match(system, /independently satisfies EVERY clue of the question as stated/);
    assert.match(system, /near-synonyms naming ONE idea \("Credit\/Loan"\) are ONE answer/);
    assert.match(system, /"reason": "alternate-solve"/);
    assert.ok(messages[0].content.includes('Player\'s typed answer: "Credit/Loan"'));
  });

  it("coffin / 'Life insurance': rejects when any clue fails or the fit is a stretch", () => {
    const { system } = buildSingleJudgePrompt(
      makeQuestion({
        judgeLeniency: "evaluate",
        statement: "The maker sells me, the buyer never uses me, the user never knows it",
        expectedAnswer: "coffin",
        freeformAnswerShape: "other",
      }),
      "Life insurance",
    );
    assert.match(system, /REJECT \(reason: "clue-fails"\) when ANY clue of the question fails/);
    assert.match(system, /REJECT \(reason: "stretch"\) when the fit depends on a stretch/);
    assert.match(system, /names a category rather than an answer/);
  });

  it("'hole or debt': keeps the multi-guess rejection for two distinct ideas", () => {
    const { system } = buildSingleJudgePrompt(
      makeQuestion({ judgeLeniency: "evaluate", expectedAnswer: "hole" }),
      "hole or debt",
    );
    assert.match(system, /REJECT \(reason: "multiple-guess"\) any answer that hedges/);
    assert.match(system, /Two DISTINCT ideas \("hole or debt"\) are a hedge/);
  });

  it("evaluate scopes every shape block to the key-match test, ahead of its rules", () => {
    const shapes = ["name", "phrase", "date", "countable", "other"] as const;
    for (const freeformAnswerShape of shapes) {
      const { system } = buildSingleJudgePrompt(
        makeQuestion({ judgeLeniency: "evaluate", freeformAnswerShape }),
        "x",
      );
      const scopeAt = system.indexOf("these apply to the KEY MATCH test ONLY");
      const shapeAt = system.indexOf("This answer ");
      assert.ok(scopeAt !== -1, `${freeformAnswerShape} carries the shape scope`);
      assert.ok(
        scopeAt < shapeAt,
        `${freeformAnswerShape} states the scope before the shape rules`,
      );
      assert.match(system, /never overrides an ALTERNATE SOLVE acceptance/);
    }
  });

  it("key-match presets carry no shape scope", () => {
    for (const judgeLeniency of KEY_MATCH_PRESETS) {
      const { system } = buildSingleJudgePrompt(makeQuestion({ judgeLeniency }), "x");
      assert.doesNotMatch(system, /KEY MATCH test ONLY/);
    }
  });

  it("only evaluate lets a correct verdict carry a reason", () => {
    const evaluate = buildSingleJudgePrompt(makeQuestion({ judgeLeniency: "evaluate" }), "x");
    assert.match(evaluate.system, /KEY MATCH, omit "reason"/);
    for (const judgeLeniency of KEY_MATCH_PRESETS) {
      const { system } = buildSingleJudgePrompt(makeQuestion({ judgeLeniency }), "x");
      assert.match(system, /Omit "reason" when correct is true/);
    }
  });
});

describe("buildSingleJudgePrompt — judgeInstructions", () => {
  const INSTRUCTIONS = "Accept any answer naming a kind of debt.";
  const ALL_PRESETS = [...KEY_MATCH_PRESETS, "evaluate"] as const;

  it("adds the instructions to the user message under a labeled heading", () => {
    const body = buildSingleJudgePrompt(makeQuestion({}), "x", INSTRUCTIONS).messages[0].content;
    assert.ok(body.includes(`Judge instructions (from the game admin):\n${INSTRUCTIONS}`));
    assert.ok(
      body.indexOf(INSTRUCTIONS) < body.indexOf("Player's typed answer:"),
      "instructions precede the typed answer",
    );
  });

  it("builds an identical prompt when the instructions are absent or blank", () => {
    for (const judgeLeniency of ALL_PRESETS) {
      const question = makeQuestion({ judgeLeniency });
      const bare = buildSingleJudgePrompt(question, "x");
      assert.deepEqual(buildSingleJudgePrompt(question, "x", undefined), bare);
      assert.deepEqual(buildSingleJudgePrompt(question, "x", "   "), bare);
      assert.doesNotMatch(bare.system, /Judge instructions/);
      assert.doesNotMatch(bare.messages[0].content, /Judge instructions/);
    }
  });

  it("key-match presets let the instructions refine accepted forms only", () => {
    for (const judgeLeniency of KEY_MATCH_PRESETS) {
      const { system } = buildSingleJudgePrompt(makeQuestion({ judgeLeniency }), "x", INSTRUCTIONS);
      assert.match(system, /refine which forms of the expected answer are accepted/);
      assert.match(system, /they never override the expected answer/);
      assert.doesNotMatch(system, /widen or narrow/);
    }
  });

  it("evaluate lets the instructions widen or narrow what counts as a fit", () => {
    const { system } = buildSingleJudgePrompt(
      makeQuestion({ judgeLeniency: "evaluate" }),
      "x",
      INSTRUCTIONS,
    );
    assert.match(system, /may widen or narrow what counts as a fit/);
    assert.doesNotMatch(system, /they never override the expected answer/);
  });

  it("no preset lets the instructions disable the integrity rules or the output format", () => {
    for (const judgeLeniency of ALL_PRESETS) {
      const { system } = buildSingleJudgePrompt(makeQuestion({ judgeLeniency }), "x", INSTRUCTIONS);
      assert.match(
        system,
        /can they disable the universal rules above or change the output format/,
      );
      assert.match(system, /multiple-guess/);
      assert.match(system, /STRICT JSON/);
    }
  });
});

describe("parseSingleVerdict", () => {
  it("keeps the alternate-solve reason on a correct verdict", () => {
    const v = parseSingleVerdict(JSON.stringify({ correct: true, reason: "alternate-solve" }));
    assert.deepEqual(v, { correct: true, reason: "alternate-solve" });
  });

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

/** A `vi.fn` `askClaude` that answers every call with the same response text. */
function mockAskClaude(text: string) {
  return vi.fn<ClackSdk["askClaude"]>().mockResolvedValue({
    text,
    stopReason: "end_turn",
    usage: { inputTokens: 0, outputTokens: 0 },
  });
}

describe("judgeAnswer — model per preset", () => {
  it("uses the Sonnet-tier model for an evaluate question", async () => {
    const ask = mockAskClaude(JSON.stringify({ correct: false, reason: "clue-fails" }));
    await judgeAnswer(ask, makeQuestion({ judgeLeniency: "evaluate" }), "Lyon");
    assert.equal(ask.mock.calls.length, 1);
    assert.equal(ask.mock.calls[0][0].model, EVALUATE_JUDGE_MODEL);
    assert.notEqual(EVALUATE_JUDGE_MODEL, DEFAULT_JUDGE_MODEL);
  });

  it("uses the default model for every other preset and for an unstamped question", async () => {
    for (const judgeLeniency of [undefined, ...KEY_MATCH_PRESETS]) {
      const ask = mockAskClaude(JSON.stringify({ correct: false, reason: "x" }));
      await judgeAnswer(ask, makeQuestion({ judgeLeniency }), "Lyon");
      assert.equal(ask.mock.calls[0][0].model, DEFAULT_JUDGE_MODEL);
    }
  });
});

describe("judgeAnswer — evaluate", () => {
  const hole = () =>
    makeQuestion({
      judgeLeniency: "evaluate",
      statement: "The more you take from me, the bigger I grow",
      expectedAnswer: "hole",
      freeformAnswerShape: "other",
    });

  it("accepts an exact match without calling the model", async () => {
    const ask = mockAskClaude(JSON.stringify({ correct: false }));
    const v = await judgeAnswer(ask, hole(), "  HOLE ");
    assert.deepEqual(v, { correct: true, reason: "exact-match" });
    assert.equal(ask.mock.calls.length, 0);
  });

  it("returns the alternate-solve reason on an accepted off-key answer", async () => {
    const ask = mockAskClaude(JSON.stringify({ correct: true, reason: "alternate-solve" }));
    const v = await judgeAnswer(ask, hole(), "Credit/Loan");
    assert.deepEqual(v, { correct: true, reason: "alternate-solve" });
  });

  it("returns no reason on an on-key acceptance", async () => {
    const ask = mockAskClaude(JSON.stringify({ correct: true }));
    const v = await judgeAnswer(ask, hole(), "a big hole");
    assert.deepEqual(v, { correct: true });
  });
});

describe("judgeAnswer — judgeInstructions", () => {
  it("sends the prompt built with the instructions", async () => {
    const ask = mockAskClaude(JSON.stringify({ correct: true }));
    const question = makeQuestion({ judgeLeniency: "evaluate" });
    await judgeAnswer(ask, question, "Lyon", { judgeInstructions: "Accept any French city." });
    const expected = buildSingleJudgePrompt(question, "Lyon", "Accept any French city.");
    assert.equal(ask.mock.calls[0][0].system, expected.system);
    assert.deepEqual(ask.mock.calls[0][0].messages, expected.messages);
  });

  it("sends the bare prompt when no instructions are given", async () => {
    const ask = mockAskClaude(JSON.stringify({ correct: true }));
    const question = makeQuestion({});
    await judgeAnswer(ask, question, "Lyon");
    const expected = buildSingleJudgePrompt(question, "Lyon");
    assert.equal(ask.mock.calls[0][0].system, expected.system);
    assert.deepEqual(ask.mock.calls[0][0].messages, expected.messages);
  });
});

describe("judgeSubmissions — one verdict per distinct answer", () => {
  it("judges a same-answer pair with one call and shares the verdict", async () => {
    const ask = mockAskClaude(JSON.stringify({ correct: false, reason: "materially-different" }));
    const judged = await judgeSubmissions(ask, makeQuestion({}), [
      { userId: "U1", answerText: "the debt" },
      { userId: "U2", answerText: "The  Debt " },
    ]);
    assert.equal(ask.mock.calls.length, 1);
    assert.ok(ask.mock.calls[0][0].messages[0].content.includes('"the debt"'));
    assert.deepEqual(
      judged.map((j) => [j.submission.userId, j.verdict]),
      [
        ["U1", { correct: false, reason: "materially-different" }],
        ["U2", { correct: false, reason: "materially-different" }],
      ],
    );
  });

  it("judges distinct answers with separate calls and keeps input order", async () => {
    const ask = mockAskClaude(JSON.stringify({ correct: false, reason: "x" }));
    const submissions: JudgeSubmission[] = [
      { userId: "U1", answerText: "Lyon" },
      { userId: "U2", answerText: "London" },
      { userId: "U3", answerText: "lyon" },
      { userId: "U4", answerText: "Rome" },
    ];
    const judged = await judgeSubmissions(ask, makeQuestion({}), submissions);
    assert.equal(ask.mock.calls.length, 3);
    assert.deepEqual(
      judged.map((j) => j.submission),
      submissions,
    );
  });

  it("leaves every row of a group null when its retries are exhausted", async () => {
    const ask = mockAskClaude("never valid");
    const judged = await judgeSubmissions(
      ask,
      makeQuestion({}),
      [
        { userId: "U1", answerText: "London" },
        { userId: "U2", answerText: "london" },
        { userId: "U3", answerText: "LONDON" },
      ],
      { maxAttempts: 2 },
    );
    assert.equal(ask.mock.calls.length, 2);
    assert.deepEqual(
      judged.map((j) => j.verdict),
      [null, null, null],
    );
  });

  it("passes the judge instructions to every group's call", async () => {
    const ask = mockAskClaude(JSON.stringify({ correct: false, reason: "x" }));
    await judgeSubmissions(
      ask,
      makeQuestion({}),
      [
        { userId: "U1", answerText: "Lyon" },
        { userId: "U2", answerText: "London" },
      ],
      { judgeInstructions: "Accept any French city." },
    );
    assert.equal(ask.mock.calls.length, 2);
    for (const [request] of ask.mock.calls) {
      assert.ok(request.messages[0].content.includes("Accept any French city."));
    }
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
