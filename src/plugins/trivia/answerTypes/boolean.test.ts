import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { booleanAnswerHandler } from "./boolean.js";
import { isClickableHandler } from "./registry.js";
import { composeWithKey } from "../questionTypes/compose.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME } from "../testHelpers.js";
import type { TriviaQuestion } from "../core/types.js";
import type { ProcessRevealDeps } from "./types.js";
import type { SlackReactionLike } from "../tools/reveal/types.js";

const actionIdFn = (k: string): string => `plugin:trivia:${k}`;

function makeQuestion(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return {
    id: "QB",
    category: "C",
    statement: "s",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["⚡"],
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
  if (!Array.isArray(elements)) {
    throw new Error("expected actions.elements to be an array");
  }
  const out: ButtonElement[] = [];
  for (const el of elements) {
    if (el && typeof el === "object" && "type" in el) {
      out.push(el as ButtonElement);
    }
  }
  return out;
}

describe("booleanAnswerHandler", () => {
  it("is recognized as clickable by the registry type guard", () => {
    assert.equal(isClickableHandler(booleanAnswerHandler), true);
  });

  describe("appendActionsBlock", () => {
    it("emits two vote buttons in TRUE/FALSE order", () => {
      const blocks = booleanAnswerHandler.appendActionsBlock([], actionIdFn, makeQuestion());
      assert.equal(blocks.length, 1);
      const [trueBtn, falseBtn] = getActionButtons(blocks[0]);
      assert.equal(trueBtn.action_id, "plugin:trivia:vote:QB:true");
      assert.equal(trueBtn.text?.text, "👍 TRUE");
      assert.equal(trueBtn.style, "primary");
      assert.equal(falseBtn.action_id, "plugin:trivia:vote:QB:false");
      assert.equal(falseBtn.text?.text, "👎 FALSE");
      assert.equal(falseBtn.style, "danger");
    });
  });

  describe("resolveClick", () => {
    it("returns correct=true when answer matches isTrue", () => {
      assert.deepEqual(booleanAnswerHandler.resolveClick("true", makeQuestion({ isTrue: true })), {
        payload: { answer: true },
        correct: true,
      });
    });

    it("returns correct=false when answer mismatches isTrue", () => {
      assert.deepEqual(booleanAnswerHandler.resolveClick("false", makeQuestion({ isTrue: true })), {
        payload: { answer: false },
        correct: false,
      });
    });

    it("rejects non-boolean values", () => {
      assert.equal(booleanAnswerHandler.resolveClick("maybe", makeQuestion()), null);
      assert.equal(booleanAnswerHandler.resolveClick("", makeQuestion()), null);
      assert.equal(booleanAnswerHandler.resolveClick("0", makeQuestion()), null);
    });
  });

  describe("rosterGroupKey", () => {
    it('returns "true" for a true row, "false" for a false row', () => {
      assert.equal(
        booleanAnswerHandler.rosterGroupKey({
          userId: "U1",
          questionId: "Q",
          answer: true,
          timestamp: 0,
        }),
        "true",
      );
      assert.equal(
        booleanAnswerHandler.rosterGroupKey({
          userId: "U1",
          questionId: "Q",
          answer: false,
          timestamp: 0,
        }),
        "false",
      );
    });

    it("returns null when the row doesn't carry a boolean answer", () => {
      assert.equal(
        booleanAnswerHandler.rosterGroupKey({
          userId: "U1",
          questionId: "Q",
          answerIndex: 0,
          timestamp: 0,
        }),
        null,
      );
    });
  });

  describe("rosterGroupLabel", () => {
    it("renders 👍 for the true group, 👎 for false", () => {
      assert.equal(
        booleanAnswerHandler.rosterGroupLabel({ groupKey: "true", rows: [] }, makeQuestion()),
        "👍",
      );
      assert.equal(
        booleanAnswerHandler.rosterGroupLabel({ groupKey: "false", rows: [] }, makeQuestion()),
        "👎",
      );
    });
  });

  describe("buildRevealAnswer", () => {
    it("emits the boolean descriptor with isTrue", () => {
      assert.deepEqual(booleanAnswerHandler.buildRevealAnswer(makeQuestion({ isTrue: true })), {
        type: "boolean",
        isTrue: true,
      });
      assert.deepEqual(booleanAnswerHandler.buildRevealAnswer(makeQuestion({ isTrue: false })), {
        type: "boolean",
        isTrue: false,
      });
    });
  });

  describe("processReveal", () => {
    function makeDeps(
      reactions: SlackReactionLike[] = [],
      overrides: Partial<ProcessRevealDeps> = {},
    ): ProcessRevealDeps {
      const data = createInMemoryDataLayer();
      return {
        scoped: data.forGame(FIXTURE_GAME_NAME),
        data,
        users: new Map(),
        botUserId: "",
        fetchMessageReactions: async () => reactions,
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

    it("fails when messageLink is missing", async () => {
      const result = await booleanAnswerHandler.processReveal(
        makeQuestion({ messageLink: undefined, postedAt: undefined }),
        makeDeps(),
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /missing postedAt\/messageLink/);
    });

    it("emits 'yes' voter buckets and stamps processedAt", async () => {
      const deps = makeDeps();
      const question = makeQuestion();
      // Seed a scored answer to confirm it lands in the correct bucket.
      await deps.scoped.saveQuestion(question);
      await deps.scoped.saveAnswer({
        userId: "U1",
        questionId: question.id,
        answer: true,
        correct: true,
        timestamp: 100,
      });
      const result = await booleanAnswerHandler.processReveal(question, deps);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.entry.voters.revealResponses, "yes");
        if (result.entry.voters.revealResponses === "yes") {
          assert.equal(result.entry.voters.correct.length, 1);
          assert.equal(result.entry.voters.correct[0].userId, "U1");
        }
      }
      const stored = (await deps.scoped.loadQuestions()).find((q) => q.id === question.id);
      assert.equal(stored?.processedAt, 5000);
    });

    it("emits 'no' voter buckets when stamped revealResponses is 'no'", async () => {
      const deps = makeDeps();
      const question = makeQuestion({ revealResponses: "no" });
      await deps.scoped.saveQuestion(question);
      await deps.scoped.saveAnswer({
        userId: "U1",
        questionId: question.id,
        answer: true,
        correct: true,
        timestamp: 100,
      });
      const result = await booleanAnswerHandler.processReveal(question, deps);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.entry.voters.revealResponses, "no");
        assert.equal("correct" in result.entry.voters, false);
      }
    });
  });

  describe("getSavedQuestion", () => {
    const base = {
      id: "X",
      category: "C",
      statement: "S",
      answersFormat: "boolean" as const,
      questionType: "fact" as const,
      emojis: ["⚡"],
      createdAt: 0,
    };

    it("validates and composes a happy-path boolean record", () => {
      const out = composeWithKey(
        booleanAnswerHandler,
        base,
        {
          answersFormat: "boolean",
          questionType: "fact",
          category: "C",
          statement: "S",
          isTrue: true,
          emojis: ["⚡"],
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
        assert.equal(out.question.isTrue, true);
        assert.equal(out.question.choices, undefined);
        assert.equal(out.question.expectedAnswer, undefined);
      }
    });

    it("rejects when isTrue is missing", () => {
      const out = composeWithKey(
        booleanAnswerHandler,
        base,
        {
          answersFormat: "boolean",
          questionType: "fact",
          category: "C",
          statement: "S",
          emojis: ["⚡"],
        },
        {
          config: null,
          resolvedChoiceBounds: { min: 4, max: 4 },
          resolvedJudgeLeniency: "strict-with-typos",
          resolvedChoiceEmojiStyle: "numbers",
        },
      );
      assert.equal(out.ok, false);
      if (!out.ok) assert.match(out.error, /isTrue/);
    });

    // Cross-format collision checks (e.g. choices/correctIndex/expectedAnswer
    // on a boolean) live in save_question's central loop, not in the handler.
    // Per-format handler tests assert only the handler's positive requirements.
  });

  describe("rollGenerationSuggestions", () => {
    it("returns a boolean suggestedAnswer", () => {
      const out = booleanAnswerHandler.rollGenerationSuggestions({
        cascadeCtx: {
          seasonSlot: null,
          gameSlot: null,
          slotIndex: null,
          season: null,
          game: null,
          config: null,
        },
      });
      assert.equal(typeof out.suggestedAnswer, "boolean");
      assert.equal(Object.keys(out).length, 1);
    });
  });

  describe("toAnswerPatch", () => {
    it("emits answer + correct, clearing siblings", () => {
      const patch = booleanAnswerHandler.toAnswerPatch({
        payload: { answer: false },
        correct: true,
      });
      assert.equal(patch.answer, false);
      assert.equal(patch.answerIndex, undefined);
      assert.equal(patch.answerText, undefined);
      assert.equal(patch.correct, true);
    });
  });

  describe("buildHistoryResult", () => {
    interface BoolHistoryEntry {
      userId: string;
      displayName: string;
      answer: boolean;
      correct?: boolean;
    }
    interface BoolHistoryResult {
      answersFormat: "boolean";
      isTrue: boolean;
      responses: BoolHistoryEntry[];
    }

    function isBoolHistoryResult(v: unknown): v is BoolHistoryResult {
      if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
      const o = v as { answersFormat?: unknown; isTrue?: unknown; responses?: unknown };
      return (
        o.answersFormat === "boolean" && typeof o.isTrue === "boolean" && Array.isArray(o.responses)
      );
    }

    it("returns boolean shape with responses and per-row correct", () => {
      const q = makeQuestion({ isTrue: true });
      const result = booleanAnswerHandler.buildHistoryResult(
        q,
        [
          { userId: "U1", questionId: q.id, answer: true, correct: true, timestamp: 1 },
          { userId: "U2", questionId: q.id, answer: false, correct: false, timestamp: 2 },
        ],
        new Map([["U1", { userId: "U1", displayName: "Alice", joinedAt: 0 }]]),
      );
      assert.ok(isBoolHistoryResult(result));
      assert.equal(result.isTrue, true);
      assert.equal(result.responses.length, 2);
      assert.equal(result.responses[0].displayName, "Alice");
      assert.equal(result.responses[0].answer, true);
      assert.equal(result.responses[0].correct, true);
      assert.equal(result.responses[1].displayName, "U2");
      assert.equal(result.responses[1].answer, false);
      assert.equal(result.responses[1].correct, false);
    });

    it("omits correct when the row is pending", () => {
      const q = makeQuestion();
      const result = booleanAnswerHandler.buildHistoryResult(
        q,
        [{ userId: "U1", questionId: q.id, answer: true, timestamp: 1 }],
        new Map(),
      );
      assert.ok(isBoolHistoryResult(result));
      assert.equal(result.responses[0].correct, undefined);
    });
  });

  describe("answer projections", () => {
    it("formatCorrectAnswer renders TRUE/FALSE from isTrue", () => {
      assert.equal(
        booleanAnswerHandler.formatCorrectAnswer(makeQuestion({ isTrue: true })),
        "👍 TRUE",
      );
      assert.equal(
        booleanAnswerHandler.formatCorrectAnswer(makeQuestion({ isTrue: false })),
        "👎 FALSE",
      );
    });

    it("formatSubmittedAnswer renders the user's pick", () => {
      const q = makeQuestion();
      assert.equal(
        booleanAnswerHandler.formatSubmittedAnswer(q, {
          userId: "U1",
          questionId: q.id,
          answer: true,
          timestamp: 1,
        }),
        "👍 TRUE",
      );
      assert.equal(
        booleanAnswerHandler.formatSubmittedAnswer(q, {
          userId: "U1",
          questionId: q.id,
          answer: false,
          timestamp: 1,
        }),
        "👎 FALSE",
      );
    });

    it("formatSubmittedAnswer returns empty when the row has no boolean answer", () => {
      const q = makeQuestion();
      assert.equal(
        booleanAnswerHandler.formatSubmittedAnswer(q, {
          userId: "U1",
          questionId: q.id,
          timestamp: 1,
        }),
        "",
      );
    });
  });
});
