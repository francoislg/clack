import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { freeformAnswerHandler } from "./freeform.js";
import { isClickableHandler } from "./registry.js";
import { composeWithKey } from "../questionTypes/compose.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME } from "../testHelpers.js";
import type { TriviaQuestion } from "../core/types.js";
import type { ProcessRevealDeps } from "./types.js";

const actionIdFn = (k: string): string => `plugin:trivia:${k}`;

function makeQuestion(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return {
    id: "QF",
    category: "Geography",
    statement: "What is the capital of France?",
    answersFormat: "freeform",
    questionType: "fact",
    expectedAnswer: "Paris",
    emojis: ["🇫🇷"],
    createdAt: 0,
    postedAt: 1000,
    messageLink: "https://x.slack.com/archives/C1/p1700000000000000",
    ...overrides,
  };
}

interface ButtonElement {
  type: string;
  action_id?: string;
  text?: { type?: string; text?: string };
  style?: string;
}

function getActionButtons(block: { type: string }): ButtonElement[] {
  if (block.type !== "actions" || !("elements" in block)) {
    throw new Error("expected an actions block");
  }
  const elements = (block as { elements: unknown }).elements;
  if (!Array.isArray(elements)) throw new Error("elements not an array");
  const out: ButtonElement[] = [];
  for (const el of elements) {
    if (el && typeof el === "object" && "type" in el) out.push(el as ButtonElement);
  }
  return out;
}

describe("freeformAnswerHandler", () => {
  it("is NOT recognized as clickable (modal-driven, not button-driven)", () => {
    assert.equal(isClickableHandler(freeformAnswerHandler), false);
  });

  describe("appendActionsBlock", () => {
    it("emits a single primary Answer button", () => {
      const blocks = freeformAnswerHandler.appendActionsBlock([], actionIdFn, makeQuestion());
      const buttons = getActionButtons(blocks[0]);
      assert.equal(buttons.length, 1);
      assert.equal(buttons[0].action_id, "plugin:trivia:freeform-answer:QF");
      assert.equal(buttons[0].text?.text, "Answer");
      assert.equal(buttons[0].style, "primary");
    });
  });

  describe("rosterGroupKey", () => {
    it("returns the trimmed lowercased answerText", () => {
      assert.equal(
        freeformAnswerHandler.rosterGroupKey({
          userId: "U1",
          questionId: "Q",
          answerText: " Paris ",
          timestamp: 0,
        }),
        "paris",
      );
      assert.equal(
        freeformAnswerHandler.rosterGroupKey({
          userId: "U2",
          questionId: "Q",
          answerText: "PARIS",
          timestamp: 0,
        }),
        "paris",
      );
    });

    it("returns null when the row carries no answerText", () => {
      assert.equal(
        freeformAnswerHandler.rosterGroupKey({
          userId: "U1",
          questionId: "Q",
          answer: true,
          timestamp: 0,
        }),
        null,
      );
    });
  });

  describe("rosterGroupLabel", () => {
    it("surfaces the original casing of a representative row, quoted", () => {
      const label = freeformAnswerHandler.rosterGroupLabel(
        {
          groupKey: "paris",
          rows: [
            {
              userId: "U1",
              questionId: "Q",
              answerText: "Paris",
              timestamp: 0,
            },
          ],
        },
        makeQuestion(),
      );
      assert.equal(label, '"Paris"');
    });

    it("falls back to the group key when no representative row text exists", () => {
      const label = freeformAnswerHandler.rosterGroupLabel(
        { groupKey: "paris", rows: [] },
        makeQuestion(),
      );
      assert.equal(label, '"paris"');
    });

    it("truncates long answers with an ellipsis", () => {
      const long = "a".repeat(60);
      const label = freeformAnswerHandler.rosterGroupLabel(
        {
          groupKey: long,
          rows: [{ userId: "U1", questionId: "Q", answerText: long, timestamp: 0 }],
        },
        makeQuestion(),
      );
      assert.ok(label.endsWith('…"'));
      assert.ok(label.length < long.length + 2);
    });
  });

  describe("buildRevealAnswer", () => {
    it("emits the freeform descriptor with expectedAnswer + optional fields", () => {
      assert.deepEqual(freeformAnswerHandler.buildRevealAnswer(makeQuestion()), {
        type: "freeform",
        expectedAnswer: "Paris",
      });
      assert.deepEqual(
        freeformAnswerHandler.buildRevealAnswer(
          makeQuestion({
            acceptableAnswers: ["paris", "Paris, France"],
            gradingNotes: "lower-case is fine",
          }),
        ),
        {
          type: "freeform",
          expectedAnswer: "Paris",
          acceptableAnswers: ["paris", "Paris, France"],
          gradingNotes: "lower-case is fine",
        },
      );
    });
  });

  describe("keywordHaystack", () => {
    it("returns the expected answer plus acceptable answers and grading notes", () => {
      assert.deepEqual(
        freeformAnswerHandler.keywordHaystack(
          makeQuestion({
            acceptableAnswers: ["paris", "Paris, France"],
            gradingNotes: "lower-case is fine",
          }),
        ),
        ["Paris", "paris", "Paris, France", "lower-case is fine"],
      );
    });

    it("omits absent optional answer fields", () => {
      assert.deepEqual(freeformAnswerHandler.keywordHaystack(makeQuestion()), ["Paris"]);
    });

    it("drops an empty expectedAnswer rather than emitting a blank string", () => {
      assert.deepEqual(
        freeformAnswerHandler.keywordHaystack(makeQuestion({ expectedAnswer: "" })),
        [],
      );
    });
  });

  describe("processReveal", () => {
    // The judge now runs ONE call per submission. `judge` maps a typed answer to
    // the raw judge text; the default treats "Paris" as correct, anything else
    // incorrect. Pass a string to force the same text for every submission.
    function makeDeps(
      judge: string | ((answerText: string) => string) = (a) =>
        JSON.stringify(a.toLowerCase() === "paris" ? { correct: true } : { correct: false }),
      overrides: Partial<ProcessRevealDeps> = {},
    ): ProcessRevealDeps {
      const data = createInMemoryDataLayer();
      const judgeFn = typeof judge === "string" ? () => judge : judge;
      return {
        scoped: data.forGame(FIXTURE_GAME_NAME),
        data,
        users: new Map(),
        botUserId: "",
        fetchMessageReactions: async () => [],
        askClaude: async (opts) => {
          // The per-answer prompt embeds the typed text as JSON; recover it.
          const match = opts.messages[0].content.match(/Player's typed answer: (".*")\n/);
          const answerText = match ? (JSON.parse(match[1]) as string) : "";
          return {
            text: judgeFn(answerText),
            stopReason: "end_turn",
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        },
        now: 5000,
        isReprocessMode: false,
        ...overrides,
      };
    }

    it("reprocess re-judges an already-judged answer, overwriting its verdict in place", async () => {
      const deps = makeDeps('{"correct":true}', { isReprocessMode: true });
      const question = makeQuestion();
      await deps.scoped.saveQuestion(question);
      // A prior reveal already scored U1 incorrect; reprocess must re-judge it.
      // Use a non-exact-match answer so the model judge (not the pre-check) decides.
      await deps.scoped.saveAnswer({
        userId: "U1",
        questionId: question.id,
        answerText: "Lyon",
        correct: false,
        judgeReason: "stale verdict",
        timestamp: 100,
      });

      const result = await freeformAnswerHandler.processReveal(question, deps);
      assert.equal(result.ok, true);

      const rows = (await deps.scoped.loadAnswers()).filter((a) => a.questionId === question.id);
      assert.equal(rows.length, 1, "answer row retained");
      assert.equal(rows[0].answerText, "Lyon", "typed answer never modified");
      assert.equal(rows[0].correct, true, "verdict re-judged under current leniency");
      assert.equal(rows[0].judgeReason, undefined, "stale judgeReason overwritten by the re-judge");
    });

    it("reprocess keeps the prior verdict (no processedAt) when the re-judge exhausts retries", async () => {
      // Unparseable judge text → no verdict after retries. Non-exact-match
      // answer so the pre-check doesn't short-circuit to a verdict.
      const deps = makeDeps("", { isReprocessMode: true });
      const question = makeQuestion();
      await deps.scoped.saveQuestion(question);
      await deps.scoped.saveAnswer({
        userId: "U1",
        questionId: question.id,
        answerText: "Lyon",
        correct: true,
        timestamp: 100,
      });

      const result = await freeformAnswerHandler.processReveal(question, deps);
      assert.equal(result.ok, false);

      const stored = (await deps.scoped.loadQuestions()).find((q) => q.id === question.id);
      assert.equal(
        stored?.processedAt,
        undefined,
        "processedAt not stamped when a row could not be re-judged",
      );
      const row = (await deps.scoped.loadAnswers()).find((a) => a.questionId === question.id);
      assert.equal(
        row?.correct,
        true,
        "prior verdict left intact when the re-judge fails (not blanked)",
      );
    });

    it("default mode judges only pending rows in a mixed batch, leaving judged verdicts intact", async () => {
      const deps = makeDeps('{"correct":true}'); // isReprocessMode: false
      const question = makeQuestion();
      await deps.scoped.saveQuestion(question);
      await deps.scoped.saveAnswer({
        userId: "U1",
        questionId: question.id,
        answerText: "London",
        correct: false,
        timestamp: 1,
      });
      await deps.scoped.saveAnswer({
        userId: "U2",
        questionId: question.id,
        answerText: "Rome",
        correct: true,
        timestamp: 2,
      });
      await deps.scoped.saveAnswer({
        userId: "U3",
        questionId: question.id,
        answerText: "Paris",
        timestamp: 3,
      });

      await freeformAnswerHandler.processReveal(question, deps);

      const rows = await deps.scoped.loadAnswers();
      const verdict = (userId: string) =>
        rows.find((r) => r.userId === userId && r.questionId === question.id)?.correct;
      assert.equal(verdict("U1"), false, "already-judged incorrect row untouched");
      assert.equal(verdict("U2"), true, "already-judged correct row untouched");
      assert.equal(verdict("U3"), true, "pending row judged");
    });

    it("emits an empty 'yes' bucket when no pending submissions exist", async () => {
      const deps = makeDeps();
      const question = makeQuestion();
      await deps.scoped.saveQuestion(question);
      const result = await freeformAnswerHandler.processReveal(question, deps);
      assert.equal(result.ok, true);
      if (result.ok && result.entry.voters.revealResponses === "yes") {
        assert.equal(result.entry.voters.correct.length, 0);
        assert.equal(result.entry.voters.incorrect.length, 0);
      }
    });

    it("strips freeform answerText in 'just-correctness' mode", async () => {
      const deps = makeDeps('{"correct":true}');
      const question = makeQuestion({ revealResponses: "just-correctness" });
      await deps.scoped.saveQuestion(question);
      await deps.scoped.saveAnswer({
        userId: "U1",
        questionId: question.id,
        answerText: "Paris",
        timestamp: 100,
      });
      const result = await freeformAnswerHandler.processReveal(question, deps);
      assert.equal(result.ok, true);
      if (result.ok && result.entry.voters.revealResponses === "just-correctness") {
        assert.equal(result.entry.voters.correct.length, 1);
        assert.equal(result.entry.voters.correct[0].userId, "U1");
        assert.equal(result.entry.voters.correct[0].answerText, undefined);
      }
    });

    it("keeps the winner's answerText but reduces missers to a count in 'just-winners' mode", async () => {
      // Default judge: "Paris" correct, "London" incorrect — one call per answer.
      const deps = makeDeps();
      const question = makeQuestion({ revealResponses: "just-winners" });
      await deps.scoped.saveQuestion(question);
      await deps.scoped.saveAnswer({
        userId: "U1",
        questionId: question.id,
        answerText: "Paris",
        timestamp: 100,
      });
      await deps.scoped.saveAnswer({
        userId: "U2",
        questionId: question.id,
        answerText: "London",
        timestamp: 200,
      });
      const result = await freeformAnswerHandler.processReveal(question, deps);
      assert.equal(result.ok, true);
      if (result.ok && result.entry.voters.revealResponses === "just-winners") {
        // Winner is named AND keeps their (correct) typed answer.
        assert.equal(result.entry.voters.correct.length, 1);
        assert.equal(result.entry.voters.correct[0].userId, "U1");
        assert.equal(result.entry.voters.correct[0].answerText, "Paris");
        // Misser is reduced to an anonymous count — their text never appears.
        assert.equal(result.entry.voters.incorrectCount, 1);
        assert.equal(result.entry.voters.noAnswerCount, 0);
      }
      // The misser's typed string must not leak anywhere in the payload.
      assert.equal(JSON.stringify(result).includes("London"), false);
    });

    it("accepts a year on the inclusive edge of a date tolerance window", async () => {
      // The real-world miss: expected 2000, window [1995, 2005], player typed 1995.
      // The judge (here, a faithful stub) returns correct for the boundary value.
      const deps = makeDeps((a) => JSON.stringify({ correct: a.trim() === "1995" }));
      const question = makeQuestion({
        statement: "In what year was this star born? (within 5 years)",
        freeformAnswerShape: "date",
        expectedAnswer: "2000",
        gradingNotes: "Accept any year in [1995, 2005] (±5 of 2000).",
      });
      await deps.scoped.saveQuestion(question);
      await deps.scoped.saveAnswer({
        userId: "U1",
        questionId: question.id,
        answerText: "1995",
        timestamp: 100,
      });
      const result = await freeformAnswerHandler.processReveal(question, deps);
      assert.equal(result.ok, true);
      const stored = (await deps.scoped.loadAnswers()).find((a) => a.userId === "U1");
      assert.equal(stored?.correct, true);
    });

    it("leaves a row pending (never scores it wrong) when the judge never returns a valid verdict", async () => {
      const deps = makeDeps("not valid json at all");
      const question = makeQuestion();
      await deps.scoped.saveQuestion(question);
      await deps.scoped.saveAnswer({
        userId: "U1",
        questionId: question.id,
        // Not the expected answer, so it reaches the (broken) judge rather than
        // being accepted by the exact-match pre-check.
        answerText: "Lyon",
        timestamp: 100,
      });
      const result = await freeformAnswerHandler.processReveal(question, deps);
      // Surfaced as an error rather than silently committed.
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /could not score 1 submission/);
      // The row stays pending so a re-reveal can recover it — NOT marked wrong.
      const stored = (await deps.scoped.loadAnswers()).find((a) => a.userId === "U1");
      assert.equal(stored?.correct, undefined);
      // processedAt is NOT stamped, so the question is eligible for re-reveal.
      const q = (await deps.scoped.loadQuestions()).find((x) => x.id === question.id);
      assert.equal(q?.processedAt, undefined);
    });
  });

  describe("getSavedQuestion", () => {
    const base = {
      id: "X",
      category: "Geography",
      statement: "S",
      answersFormat: "freeform" as const,
      questionType: "fact" as const,
      emojis: ["🇫🇷"],
      createdAt: 0,
    };

    it("validates and composes a happy-path freeform record", () => {
      const out = composeWithKey(
        freeformAnswerHandler,
        base,
        {
          answersFormat: "freeform",
          questionType: "fact",
          category: "Geography",
          statement: "S",
          expectedAnswer: "Paris",
          freeformAnswerShape: "place",
          emojis: ["🇫🇷"],
        },
        {
          config: null,
          resolvedChoiceBounds: { min: 4, max: 4 },
          resolvedJudgeLeniency: "strict-with-typos",
          resolvedChoiceEmojiStyle: "numbers",
        },
      );
      assert.equal(out.ok, true);
      if (out.ok) {
        assert.equal(out.question.expectedAnswer, "Paris");
        assert.equal(out.question.freeformAnswerShape, "place");
        assert.equal(out.question.acceptableAnswers, undefined);
      }
    });

    it("rejects when expectedAnswer is missing", () => {
      const out = composeWithKey(
        freeformAnswerHandler,
        base,
        {
          answersFormat: "freeform",
          questionType: "fact",
          category: "Geography",
          statement: "S",
          freeformAnswerShape: "place",
          emojis: ["🇫🇷"],
        },
        {
          config: null,
          resolvedChoiceBounds: { min: 4, max: 4 },
          resolvedJudgeLeniency: "strict-with-typos",
          resolvedChoiceEmojiStyle: "numbers",
        },
      );
      assert.equal(out.ok, false);
      if (!out.ok) assert.match(out.error, /expectedAnswer/);
    });

    it("rejects expectedAnswer over 200 chars", () => {
      const long = "a".repeat(201);
      const out = composeWithKey(
        freeformAnswerHandler,
        base,
        {
          answersFormat: "freeform",
          questionType: "fact",
          category: "Geography",
          statement: "S",
          expectedAnswer: long,
          freeformAnswerShape: "phrase",
          emojis: ["🇫🇷"],
        },
        {
          config: null,
          resolvedChoiceBounds: { min: 4, max: 4 },
          resolvedJudgeLeniency: "strict-with-typos",
          resolvedChoiceEmojiStyle: "numbers",
        },
      );
      assert.equal(out.ok, false);
      if (!out.ok) assert.match(out.error, /200 characters/);
    });

    it("rejects when freeformAnswerShape is missing", () => {
      const out = composeWithKey(
        freeformAnswerHandler,
        base,
        {
          answersFormat: "freeform",
          questionType: "fact",
          category: "Geography",
          statement: "S",
          expectedAnswer: "Paris",
          emojis: ["🇫🇷"],
        },
        {
          config: null,
          resolvedChoiceBounds: { min: 4, max: 4 },
          resolvedJudgeLeniency: "strict-with-typos",
          resolvedChoiceEmojiStyle: "numbers",
        },
      );
      assert.equal(out.ok, false);
      if (!out.ok) assert.match(out.error, /freeformAnswerShape/);
    });

    // Cross-format collision checks (isTrue on a freeform, etc.) live in
    // save_question's central loop, not in the handler.

    it("composes optional fields when supplied", () => {
      const out = composeWithKey(
        freeformAnswerHandler,
        base,
        {
          answersFormat: "freeform",
          questionType: "fact",
          category: "Geography",
          statement: "S",
          expectedAnswer: "Paris",
          acceptableAnswers: ["Paris, France"],
          gradingNotes: "Accept any reasonable form.",
          freeformAnswerShape: "place",
          emojis: ["🇫🇷"],
        },
        {
          config: null,
          resolvedChoiceBounds: { min: 4, max: 4 },
          resolvedJudgeLeniency: "strict-with-typos",
          resolvedChoiceEmojiStyle: "numbers",
        },
      );
      assert.equal(out.ok, true);
      if (out.ok) {
        assert.deepEqual(out.question.acceptableAnswers, ["Paris, France"]);
        assert.equal(out.question.gradingNotes, "Accept any reasonable form.");
      }
    });
  });

  describe("rollGenerationSuggestions", () => {
    it("returns suggestedFreeformAnswerShape", () => {
      const out = freeformAnswerHandler.rollGenerationSuggestions({
        cascadeCtx: {
          seasonSlot: null,
          gameSlot: null,
          slotIndex: null,
          season: null,
          game: null,
          config: null,
        },
      });
      assert.equal(typeof out.suggestedFreeformAnswerShape, "string");
      assert.equal(Object.keys(out).length, 1);
    });
  });

  describe("buildHistoryResult", () => {
    interface FreeformHistoryEntry {
      userId: string;
      displayName: string;
      answerText: string;
      correct?: boolean;
      judgeReason?: string;
    }
    interface FreeformHistoryResult {
      answersFormat: "freeform";
      expectedAnswer: string;
      acceptableAnswers?: string[];
      gradingNotes?: string;
      responses: FreeformHistoryEntry[];
    }

    function isFreeformHistoryResult(v: unknown): v is FreeformHistoryResult {
      if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
      const o = v as {
        answersFormat?: unknown;
        expectedAnswer?: unknown;
        responses?: unknown;
      };
      return (
        o.answersFormat === "freeform" &&
        typeof o.expectedAnswer === "string" &&
        Array.isArray(o.responses)
      );
    }

    it("returns freeform shape with answerText, correct, and judgeReason", () => {
      const q = makeQuestion({
        acceptableAnswers: ["Paris, France"],
        gradingNotes: "Accept any major Canadian city.",
      });
      const result = freeformAnswerHandler.buildHistoryResult(
        q,
        [
          { userId: "U1", questionId: q.id, answerText: "Paris", correct: true, timestamp: 1 },
          {
            userId: "U2",
            questionId: q.id,
            answerText: "London or Paris",
            correct: false,
            judgeReason: "multiple-guess",
            timestamp: 2,
          },
        ],
        new Map(),
      );
      assert.ok(isFreeformHistoryResult(result));
      assert.equal(result.expectedAnswer, "Paris");
      assert.deepEqual(result.acceptableAnswers, ["Paris, France"]);
      assert.equal(result.gradingNotes, "Accept any major Canadian city.");
      assert.equal(result.responses[0].answerText, "Paris");
      assert.equal(result.responses[0].correct, true);
      assert.equal(result.responses[0].judgeReason, undefined);
      assert.equal(result.responses[1].correct, false);
      assert.equal(result.responses[1].judgeReason, "multiple-guess");
    });

    it("omits correct AND judgeReason on pending rows (the historical bug-fix path)", () => {
      const q = makeQuestion();
      const result = freeformAnswerHandler.buildHistoryResult(
        q,
        [{ userId: "U1", questionId: q.id, answerText: "Paris", timestamp: 1 }],
        new Map(),
      );
      assert.ok(isFreeformHistoryResult(result));
      assert.equal(result.responses[0].answerText, "Paris");
      assert.equal(result.responses[0].correct, undefined);
      assert.equal(result.responses[0].judgeReason, undefined);
    });

    it("omits acceptableAnswers and gradingNotes when absent on the question", () => {
      const q = makeQuestion();
      const result = freeformAnswerHandler.buildHistoryResult(q, [], new Map());
      assert.ok(isFreeformHistoryResult(result));
      assert.equal(result.acceptableAnswers, undefined);
      assert.equal(result.gradingNotes, undefined);
    });
  });

  describe("answer projections", () => {
    it("formatCorrectAnswer renders the expected answer", () => {
      assert.equal(freeformAnswerHandler.formatCorrectAnswer(makeQuestion()), "Paris");
    });

    it("formatSubmittedAnswer renders the typed text", () => {
      const q = makeQuestion();
      assert.equal(
        freeformAnswerHandler.formatSubmittedAnswer(q, {
          userId: "U1",
          questionId: q.id,
          answerText: "Lyon",
          timestamp: 1,
        }),
        "Lyon",
      );
    });

    it("formatSubmittedAnswer returns empty when no text was typed", () => {
      const q = makeQuestion();
      assert.equal(
        freeformAnswerHandler.formatSubmittedAnswer(q, {
          userId: "U1",
          questionId: q.id,
          timestamp: 1,
        }),
        "",
      );
    });
  });
});
