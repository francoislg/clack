import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { freeformAnswerHandler } from "./freeform.js";
import { isClickableHandler } from "./registry.js";
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

  describe("processReveal", () => {
    function makeDeps(
      judgeText: string = "",
      overrides: Partial<ProcessRevealDeps> = {},
    ): ProcessRevealDeps {
      const data = createInMemoryDataLayer();
      return {
        scoped: data.forGame(FIXTURE_GAME_NAME),
        data,
        users: new Map(),
        botUserId: "",
        fetchMessageReactions: async () => [],
        askClaude: async () => ({
          text: judgeText,
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
        now: 5000,
        isReprocessMode: false,
        ...overrides,
      };
    }

    it("rejects in reprocess mode", async () => {
      const result = await freeformAnswerHandler.processReveal(
        makeQuestion(),
        makeDeps("", { isReprocessMode: true }),
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /reprocess mode is not supported/);
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
      const deps = makeDeps('{"verdicts":[{"key":"1.1","correct":true}]}');
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
      const deps = makeDeps(
        '{"verdicts":[{"key":"1.1","correct":true},{"key":"1.2","correct":false}]}',
      );
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
      const out = freeformAnswerHandler.getSavedQuestion(
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
        { config: null },
      );
      assert.equal(out.ok, true);
      if (out.ok) {
        assert.equal(out.question.expectedAnswer, "Paris");
        assert.equal(out.question.freeformAnswerShape, "place");
        assert.equal(out.question.acceptableAnswers, undefined);
      }
    });

    it("rejects when expectedAnswer is missing", () => {
      const out = freeformAnswerHandler.getSavedQuestion(
        base,
        {
          answersFormat: "freeform",
          questionType: "fact",
          category: "Geography",
          statement: "S",
          freeformAnswerShape: "place",
          emojis: ["🇫🇷"],
        },
        { config: null },
      );
      assert.equal(out.ok, false);
      if (!out.ok) assert.match(out.error, /expectedAnswer/);
    });

    it("rejects expectedAnswer over 200 chars", () => {
      const long = "a".repeat(201);
      const out = freeformAnswerHandler.getSavedQuestion(
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
        { config: null },
      );
      assert.equal(out.ok, false);
      if (!out.ok) assert.match(out.error, /200 characters/);
    });

    it("rejects when freeformAnswerShape is missing", () => {
      const out = freeformAnswerHandler.getSavedQuestion(
        base,
        {
          answersFormat: "freeform",
          questionType: "fact",
          category: "Geography",
          statement: "S",
          expectedAnswer: "Paris",
          emojis: ["🇫🇷"],
        },
        { config: null },
      );
      assert.equal(out.ok, false);
      if (!out.ok) assert.match(out.error, /freeformAnswerShape/);
    });

    // Cross-format collision checks (isTrue on a freeform, etc.) live in
    // save_question's central loop, not in the handler.

    it("composes optional fields when supplied", () => {
      const out = freeformAnswerHandler.getSavedQuestion(
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
        { config: null },
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
        config: null,
        currentSeason: null,
        slotIndex: null,
        game: {
          name: "main",
          channel: "C",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          enabled: true,
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
});
