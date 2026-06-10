import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { choiceAnswerHandler } from "./choice.js";
import { isClickableHandler } from "./registry.js";
import { composeWithKey } from "../questionTypes/compose.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME } from "../testHelpers.js";
import type { TriviaQuestion } from "../core/types.js";
import type { ProcessRevealDeps } from "./types.js";

const actionIdFn = (k: string): string => `plugin:trivia:${k}`;

function makeQuestion(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return {
    id: "QC",
    category: "Music",
    statement: "Who wrote 'Sunshine of Your Love'?",
    answersFormat: "choice",
    questionType: "fact",
    choices: ["The Beatles", "Led Zeppelin", "Cream", "The Who"],
    correctIndex: 2,
    emojis: ["🎸"],
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

describe("choiceAnswerHandler", () => {
  it("is recognized as clickable by the registry type guard", () => {
    assert.equal(isClickableHandler(choiceAnswerHandler), true);
  });

  describe("appendActionsBlock", () => {
    it("emits one button per choice with numbered emoji prefix", () => {
      const blocks = choiceAnswerHandler.appendActionsBlock([], actionIdFn, makeQuestion());
      const buttons = getActionButtons(blocks[0]);
      assert.equal(buttons.length, 4);
      assert.equal(buttons[0].action_id, "plugin:trivia:vote:QC:0");
      assert.equal(buttons[0].text?.text, "1️⃣ The Beatles");
      assert.equal(buttons[3].action_id, "plugin:trivia:vote:QC:3");
      assert.equal(buttons[3].text?.text, "4️⃣ The Who");
    });

    it("sizes buttons to choices.length for shorter lists", () => {
      const blocks = choiceAnswerHandler.appendActionsBlock(
        [],
        actionIdFn,
        makeQuestion({ choices: ["A", "B"] }),
      );
      assert.equal(getActionButtons(blocks[0]).length, 2);
    });
  });

  describe("resolveClick", () => {
    it("returns correct=true when answerIndex matches", () => {
      const result = choiceAnswerHandler.resolveClick("2", makeQuestion({ correctIndex: 2 }));
      assert.deepEqual(result, { payload: { answerIndex: 2 }, correct: true });
    });

    it("returns correct=false when answerIndex mismatches", () => {
      const result = choiceAnswerHandler.resolveClick("0", makeQuestion({ correctIndex: 2 }));
      assert.deepEqual(result, { payload: { answerIndex: 0 }, correct: false });
    });

    it("rejects out-of-range index", () => {
      assert.equal(choiceAnswerHandler.resolveClick("-1", makeQuestion()), null);
      assert.equal(choiceAnswerHandler.resolveClick("4", makeQuestion()), null);
      assert.equal(
        choiceAnswerHandler.resolveClick("3", makeQuestion({ choices: ["A", "B"] })),
        null,
      );
    });

    it("rejects non-integer values", () => {
      assert.equal(choiceAnswerHandler.resolveClick("two", makeQuestion()), null);
      assert.equal(choiceAnswerHandler.resolveClick("", makeQuestion()), null);
    });
  });

  describe("rosterGroupKey", () => {
    it("returns the answerIndex as a string", () => {
      assert.equal(
        choiceAnswerHandler.rosterGroupKey({
          userId: "U1",
          questionId: "Q",
          answerIndex: 2,
          timestamp: 0,
        }),
        "2",
      );
    });

    it("returns null when the row doesn't carry an answerIndex", () => {
      assert.equal(
        choiceAnswerHandler.rosterGroupKey({
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
    it("renders the numbered emoji for each indexed group", () => {
      const q = makeQuestion();
      assert.equal(choiceAnswerHandler.rosterGroupLabel({ groupKey: "0", rows: [] }, q), "1️⃣");
      assert.equal(choiceAnswerHandler.rosterGroupLabel({ groupKey: "1", rows: [] }, q), "2️⃣");
      assert.equal(choiceAnswerHandler.rosterGroupLabel({ groupKey: "2", rows: [] }, q), "3️⃣");
      assert.equal(choiceAnswerHandler.rosterGroupLabel({ groupKey: "3", rows: [] }, q), "4️⃣");
    });

    it("falls back to a #-prefixed marker for out-of-range keys", () => {
      assert.equal(
        choiceAnswerHandler.rosterGroupLabel({ groupKey: "5", rows: [] }, makeQuestion()),
        "#5",
      );
    });
  });

  describe("buildRevealAnswer", () => {
    it("emits the choice descriptor with choices + correctIndex", () => {
      assert.deepEqual(choiceAnswerHandler.buildRevealAnswer(makeQuestion()), {
        type: "choice",
        choices: ["The Beatles", "Led Zeppelin", "Cream", "The Who"],
        correctIndex: 2,
      });
    });
  });

  describe("processReveal", () => {
    function makeDeps(overrides: Partial<ProcessRevealDeps> = {}): ProcessRevealDeps {
      const data = createInMemoryDataLayer();
      return {
        scoped: data.forGame(FIXTURE_GAME_NAME),
        data,
        users: new Map(),
        botUserId: "",
        fetchMessageReactions: async () => [],
        askClaude: async () => ({
          text: "",
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
        now: 5000,
        isReprocessMode: false,
        ...overrides,
      };
    }

    it("rejects a question missing correctIndex", async () => {
      const result = await choiceAnswerHandler.processReveal(
        makeQuestion({ correctIndex: undefined }),
        makeDeps(),
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /correctIndex/);
    });

    it("emits buckets with each voter in their answer's group", async () => {
      const deps = makeDeps();
      const question = makeQuestion();
      await deps.scoped.saveQuestion(question);
      await deps.scoped.saveAnswer({
        userId: "U1",
        questionId: question.id,
        answerIndex: 2,
        correct: true,
        timestamp: 100,
      });
      await deps.scoped.saveAnswer({
        userId: "U2",
        questionId: question.id,
        answerIndex: 0,
        correct: false,
        timestamp: 200,
      });
      const result = await choiceAnswerHandler.processReveal(question, deps);
      assert.equal(result.ok, true);
      if (result.ok && result.entry.voters.revealResponses === "yes") {
        assert.equal(result.entry.voters.correct.length, 1);
        assert.equal(result.entry.voters.correct[0].userId, "U1");
        assert.equal(result.entry.voters.incorrect.length, 1);
        assert.equal(result.entry.voters.incorrect[0].userId, "U2");
      }
    });
  });

  describe("getSavedQuestion", () => {
    const base = {
      id: "X",
      category: "Music",
      statement: "S",
      answersFormat: "choice" as const,
      questionType: "fact" as const,
      emojis: ["🎸"],
      createdAt: 0,
    };

    it("validates and composes a happy-path choice record", () => {
      const out = composeWithKey(
        choiceAnswerHandler,
        base,
        {
          answersFormat: "choice",
          questionType: "fact",
          category: "Music",
          statement: "S",
          choices: ["A", "B", "C", "D"],
          correctIndex: 2,
          emojis: ["🎸"],
        },
        { config: { choices: { min: 2, max: 4 } }, resolvedJudgeLeniency: "strict-with-typos" },
      );
      assert.equal(out.ok, true);
      if (out.ok) {
        assert.deepEqual(out.question.choices, ["A", "B", "C", "D"]);
        assert.equal(out.question.correctIndex, 2);
      }
    });

    it("rejects when correctIndex is out of range", () => {
      const out = composeWithKey(
        choiceAnswerHandler,
        base,
        {
          answersFormat: "choice",
          questionType: "fact",
          category: "Music",
          statement: "S",
          choices: ["A", "B"],
          correctIndex: 5,
          emojis: ["🎸"],
        },
        { config: { choices: { min: 2, max: 4 } }, resolvedJudgeLeniency: "strict-with-typos" },
      );
      assert.equal(out.ok, false);
      if (!out.ok) assert.match(out.error, /correctIndex \(5\)/);
    });

    it("rejects duplicate choices after case-folding", () => {
      const out = composeWithKey(
        choiceAnswerHandler,
        base,
        {
          answersFormat: "choice",
          questionType: "fact",
          category: "Music",
          statement: "S",
          choices: ["Paris", "PARIS", "Rome"],
          correctIndex: 0,
          emojis: ["🎸"],
        },
        { config: { choices: { min: 2, max: 4 } }, resolvedJudgeLeniency: "strict-with-typos" },
      );
      assert.equal(out.ok, false);
      if (!out.ok) assert.match(out.error, /unique/);
    });

    it("rejects choices outside the active bounds", () => {
      const out = composeWithKey(
        choiceAnswerHandler,
        base,
        {
          answersFormat: "choice",
          questionType: "fact",
          category: "Music",
          statement: "S",
          choices: ["A", "B", "C", "D", "E", "F"],
          correctIndex: 0,
          emojis: ["🎸"],
        },
        { config: { choices: { min: 2, max: 4 } }, resolvedJudgeLeniency: "strict-with-typos" },
      );
      assert.equal(out.ok, false);
      if (!out.ok) assert.match(out.error, /between 2 and 4/);
    });
  });

  describe("rollGenerationSuggestions", () => {
    it("returns suggestedChoiceCount and suggestedCorrectIndex within active bounds", () => {
      const out = choiceAnswerHandler.rollGenerationSuggestions({
        cascadeCtx: {
          seasonSlot: null,
          gameSlot: null,
          slotIndex: null,
          season: null,
          game: null,
          config: { choices: { min: 3, max: 4 } },
        },
      });
      const count = out.suggestedChoiceCount;
      const idx = out.suggestedCorrectIndex;
      assert.equal(typeof count, "number");
      assert.equal(typeof idx, "number");
      if (typeof count === "number" && typeof idx === "number") {
        assert.ok(count >= 3 && count <= 4);
        assert.ok(idx >= 0 && idx < count);
      }
    });
  });

  describe("toAnswerPatch", () => {
    it("emits answerIndex + correct, clearing siblings", () => {
      const patch = choiceAnswerHandler.toAnswerPatch({
        payload: { answerIndex: 2 },
        correct: true,
      });
      assert.equal(patch.answerIndex, 2);
      assert.equal(patch.answer, undefined);
      assert.equal(patch.answerText, undefined);
      assert.equal(patch.correct, true);
    });
  });

  describe("buildHistoryResult", () => {
    interface ChoiceHistoryEntry {
      userId: string;
      displayName: string;
      answerIndex: number;
      correct?: boolean;
    }
    interface ChoiceHistoryResult {
      answersFormat: "choice";
      choices: string[];
      correctIndex: number;
      responses: ChoiceHistoryEntry[];
    }

    function isChoiceHistoryResult(v: unknown): v is ChoiceHistoryResult {
      if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
      const o = v as {
        answersFormat?: unknown;
        choices?: unknown;
        correctIndex?: unknown;
        responses?: unknown;
      };
      return (
        o.answersFormat === "choice" &&
        Array.isArray(o.choices) &&
        typeof o.correctIndex === "number" &&
        Array.isArray(o.responses)
      );
    }

    it("returns choice shape with responses carrying answerIndex", () => {
      const q = makeQuestion();
      const result = choiceAnswerHandler.buildHistoryResult(
        q,
        [
          { userId: "U1", questionId: q.id, answerIndex: 2, correct: true, timestamp: 1 },
          { userId: "U2", questionId: q.id, answerIndex: 0, correct: false, timestamp: 2 },
        ],
        new Map(),
      );
      assert.ok(isChoiceHistoryResult(result));
      assert.deepEqual(result.choices, ["The Beatles", "Led Zeppelin", "Cream", "The Who"]);
      assert.equal(result.correctIndex, 2);
      assert.equal(result.responses[0].answerIndex, 2);
      assert.equal(result.responses[1].answerIndex, 0);
    });
  });

  describe("answer projections", () => {
    it("formatCorrectAnswer renders the correct option text", () => {
      assert.equal(choiceAnswerHandler.formatCorrectAnswer(makeQuestion()), "Cream");
    });

    it("formatCorrectAnswer returns empty when correctIndex is out of range", () => {
      assert.equal(choiceAnswerHandler.formatCorrectAnswer(makeQuestion({ correctIndex: 9 })), "");
    });

    it("formatSubmittedAnswer renders the chosen option text", () => {
      const q = makeQuestion();
      assert.equal(
        choiceAnswerHandler.formatSubmittedAnswer(q, {
          userId: "U1",
          questionId: q.id,
          answerIndex: 0,
          timestamp: 1,
        }),
        "The Beatles",
      );
    });

    it("formatSubmittedAnswer returns empty for an out-of-range or missing index", () => {
      const q = makeQuestion();
      assert.equal(
        choiceAnswerHandler.formatSubmittedAnswer(q, {
          userId: "U1",
          questionId: q.id,
          answerIndex: 99,
          timestamp: 1,
        }),
        "",
      );
      assert.equal(
        choiceAnswerHandler.formatSubmittedAnswer(q, {
          userId: "U1",
          questionId: q.id,
          timestamp: 1,
        }),
        "",
      );
    });
  });
});
