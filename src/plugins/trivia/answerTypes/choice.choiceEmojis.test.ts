import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { choiceAnswerHandler } from "./choice.js";
import { composeWithKey } from "../questionTypes/compose.js";
import { buildCascadeContext } from "../domain/cascadeContext.js";
import type { TriviaGame } from "../core/configTypes.js";
import type { TriviaQuestion } from "../core/types.js";
import type { SaveValidationContext } from "./types.js";

const actionIdFn = (k: string): string => `plugin:trivia:${k}`;

const THEMED_EMOJIS = ["🌊", "🧊", "🏝️", "🌋"];

function makeQuestion(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return {
    id: "QE",
    category: "Geography",
    statement: "Which is the largest ocean?",
    answersFormat: "choice",
    questionType: "fact",
    choices: ["Pacific", "Arctic", "Indian", "Atlantic"],
    correctIndex: 0,
    emojis: ["🌍"],
    createdAt: 0,
    postedAt: 1000,
    messageLink: "https://x.slack.com/archives/C1/p1700000000000000",
    ...overrides,
  };
}

function makeGame(overrides: Partial<TriviaGame> = {}): TriviaGame {
  return {
    name: "main",
    channel: "C123",
    questionCron: "0 9 * * 1-5",
    revealCron: "0 15 * * 1-5",
    timezone: "America/Montreal",
    ...overrides,
  };
}

const baseRecord = {
  id: "X",
  category: "Geography",
  statement: "Which is the largest ocean?",
  answersFormat: "choice" as const,
  questionType: "fact" as const,
  emojis: ["🌍"],
  createdAt: 0,
};

const baseArgs = {
  answersFormat: "choice" as const,
  questionType: "fact" as const,
  category: "Geography",
  statement: "Which is the largest ocean?",
  choices: ["Pacific", "Arctic", "Indian", "Atlantic"],
  correctIndex: 0,
  emojis: ["🌍"],
};

function themedCtx(overrides: Partial<SaveValidationContext> = {}): SaveValidationContext {
  return {
    config: null,
    resolvedChoiceBounds: { min: 2, max: 4 },
    resolvedJudgeLeniency: "strict-with-typos",
    resolvedChoiceEmojiStyle: "themed",
    ...overrides,
  };
}

function buttonTexts(blocks: ReturnType<typeof choiceAnswerHandler.appendActionsBlock>): string[] {
  const block = blocks[0] as { elements: Array<{ text: { text: string } }> };
  return block.elements.map((el) => el.text.text);
}

describe("choiceAnswerHandler — themed choiceEmojis", () => {
  describe("appendActionsBlock", () => {
    it("prefixes buttons with the stamped emojis", () => {
      const blocks = choiceAnswerHandler.appendActionsBlock(
        [],
        actionIdFn,
        makeQuestion({ choiceEmojis: THEMED_EMOJIS }),
      );
      assert.deepEqual(buttonTexts(blocks), [
        "🌊 Pacific",
        "🧊 Arctic",
        "🏝️ Indian",
        "🌋 Atlantic",
      ]);
    });

    it("falls back to numbered prefixes when choiceEmojis is absent", () => {
      const blocks = choiceAnswerHandler.appendActionsBlock([], actionIdFn, makeQuestion());
      assert.deepEqual(buttonTexts(blocks), [
        "1️⃣ Pacific",
        "2️⃣ Arctic",
        "3️⃣ Indian",
        "4️⃣ Atlantic",
      ]);
    });
  });

  describe("rosterGroupLabel", () => {
    it("renders the stamped emoji for each indexed group", () => {
      const q = makeQuestion({ choiceEmojis: THEMED_EMOJIS });
      assert.equal(choiceAnswerHandler.rosterGroupLabel({ groupKey: "0", rows: [] }, q), "🌊");
      assert.equal(choiceAnswerHandler.rosterGroupLabel({ groupKey: "3", rows: [] }, q), "🌋");
    });

    it("falls back to the numbered emoji when choiceEmojis is absent", () => {
      const q = makeQuestion();
      assert.equal(choiceAnswerHandler.rosterGroupLabel({ groupKey: "0", rows: [] }, q), "1️⃣");
    });

    it("falls back to #key for an out-of-range group", () => {
      const q = makeQuestion({ choiceEmojis: THEMED_EMOJIS });
      assert.equal(choiceAnswerHandler.rosterGroupLabel({ groupKey: "9", rows: [] }, q), "#9");
    });
  });

  describe("composeStatic via composeWithKey", () => {
    it("stamps trimmed choiceEmojis when the resolved style is themed", () => {
      const out = composeWithKey(
        choiceAnswerHandler,
        baseRecord,
        { ...baseArgs, choiceEmojis: ["🌊 ", "🧊", "🏝️", "🌋"] },
        themedCtx(),
      );
      assert.equal(out.ok, true);
      if (out.ok) assert.deepEqual(out.question.choiceEmojis, THEMED_EMOJIS);
    });

    it("omits the field when choiceEmojis is not provided (themed)", () => {
      const out = composeWithKey(choiceAnswerHandler, baseRecord, baseArgs, themedCtx());
      assert.equal(out.ok, true);
      if (out.ok) assert.equal(out.question.choiceEmojis, undefined);
    });

    it('rejects choiceEmojis when the resolved style is "numbers"', () => {
      const out = composeWithKey(
        choiceAnswerHandler,
        baseRecord,
        { ...baseArgs, choiceEmojis: THEMED_EMOJIS },
        themedCtx({ resolvedChoiceEmojiStyle: "numbers" }),
      );
      assert.equal(out.ok, false);
      if (!out.ok) assert.match(out.error, /only permitted.*themed/);
    });

    it("rejects a count mismatch with choices", () => {
      const out = composeWithKey(
        choiceAnswerHandler,
        baseRecord,
        { ...baseArgs, choiceEmojis: ["🌊", "🧊"] },
        themedCtx(),
      );
      assert.equal(out.ok, false);
      if (!out.ok) assert.match(out.error, /one emoji per option/);
    });

    it("rejects duplicate emojis", () => {
      const out = composeWithKey(
        choiceAnswerHandler,
        baseRecord,
        { ...baseArgs, choiceEmojis: ["🌊", "🌊", "🏝️", "🌋"] },
        themedCtx(),
      );
      assert.equal(out.ok, false);
      if (!out.ok) assert.match(out.error, /unique/);
    });

    it("rejects plain-text entries (no Unicode emoji)", () => {
      const out = composeWithKey(
        choiceAnswerHandler,
        baseRecord,
        { ...baseArgs, choiceEmojis: ["🌊", ":ice:", "🏝️", "🌋"] },
        themedCtx(),
      );
      assert.equal(out.ok, false);
      if (!out.ok) assert.match(out.error, /Unicode emoji/);
    });

    it("rejects an over-long entry", () => {
      const out = composeWithKey(
        choiceAnswerHandler,
        baseRecord,
        { ...baseArgs, choiceEmojis: ["🌊🌊🌊🌊🌊🌊🌊🌊🌊", "🧊", "🏝️", "🌋"] },
        themedCtx(),
      );
      assert.equal(out.ok, false);
      if (!out.ok) assert.match(out.error, /single emoji/);
    });
  });

  describe("rollGenerationSuggestions", () => {
    it('surfaces suggestedChoiceEmojiStyle "numbers" with no guidance by default', () => {
      const ctx = buildCascadeContext(null, makeGame(), null, null);
      const rolled = choiceAnswerHandler.rollGenerationSuggestions({ cascadeCtx: ctx });
      assert.equal(rolled.suggestedChoiceEmojiStyle, "numbers");
      assert.equal(rolled.choiceEmojiGuidance, undefined);
    });

    it('surfaces "themed" plus guidance when the game tier opts in', () => {
      const ctx = buildCascadeContext(null, makeGame({ choiceEmojiStyle: "themed" }), null, null);
      const rolled = choiceAnswerHandler.rollGenerationSuggestions({ cascadeCtx: ctx });
      assert.equal(rolled.suggestedChoiceEmojiStyle, "themed");
      assert.match(String(rolled.choiceEmojiGuidance), /one Unicode emoji per option/i);
    });

    it("honors the workspace tier when no game override exists", () => {
      const ctx = buildCascadeContext(null, makeGame(), null, { choiceEmojiStyle: "themed" });
      const rolled = choiceAnswerHandler.rollGenerationSuggestions({ cascadeCtx: ctx });
      assert.equal(rolled.suggestedChoiceEmojiStyle, "themed");
    });
  });
});
