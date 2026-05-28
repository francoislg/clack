import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { ActionsBlock, Button, ContextBlock } from "@slack/types";
import type { SlackBlocks } from "../../../../slack/blocks.js";
import type { TriviaQuestion } from "../../core/types.js";
import { applyHintRendering } from "./renderHint.js";

const sdk = {
  t: (key: string, vars?: Record<string, string>): string => {
    if (vars?.text !== undefined) return `${key}:${vars.text}`;
    return key;
  },
  actionId: (key: string): string => `plugin:trivia:${key}`,
};

function makeQuestion(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return {
    id: "Q1",
    category: "Science",
    statement: "...",
    answersFormat: "boolean",
    questionType: "fact",
    emojis: ["🔬"],
    createdAt: 0,
    ...overrides,
  };
}

function makeActionsBlock(elementCount: number): ActionsBlock {
  const elements: Button[] = Array.from({ length: elementCount }, (_, i) => ({
    type: "button",
    text: { type: "plain_text", text: `Option ${i}`, emoji: true },
    action_id: `plugin:trivia:vote:Q1:${i}`,
  }));
  return { type: "actions", elements };
}

describe("applyHintRendering — button mode", () => {
  it("appends the hint button after answer buttons (boolean = 3 total)", () => {
    const blocks: SlackBlocks = [makeActionsBlock(2)];
    const result = applyHintRendering(
      blocks,
      makeQuestion({ hint: { mode: "button", text: "A nudge." } }),
      sdk,
    );
    const actions = result[result.length - 1] as ActionsBlock;
    assert.equal(actions.elements.length, 3);
    const last = actions.elements[2] as Button;
    assert.equal(last.action_id, "plugin:trivia:hint:Q1");
    assert.equal(last.style, undefined);
  });

  it("appends the hint button after 4 choice buttons (choice = 5 total)", () => {
    const blocks: SlackBlocks = [makeActionsBlock(4)];
    const result = applyHintRendering(
      blocks,
      makeQuestion({ hint: { mode: "button", text: "A nudge." } }),
      sdk,
    );
    const actions = result[result.length - 1] as ActionsBlock;
    assert.equal(actions.elements.length, 5);
    const last = actions.elements[4] as Button;
    assert.equal(last.action_id, "plugin:trivia:hint:Q1");
  });

  it("preserves the answer-button order", () => {
    const blocks: SlackBlocks = [makeActionsBlock(2)];
    const result = applyHintRendering(
      blocks,
      makeQuestion({ hint: { mode: "button", text: "A nudge." } }),
      sdk,
    );
    const actions = result[result.length - 1] as ActionsBlock;
    assert.equal((actions.elements[0] as Button).action_id, "plugin:trivia:vote:Q1:0");
    assert.equal((actions.elements[1] as Button).action_id, "plugin:trivia:vote:Q1:1");
  });
});

describe("applyHintRendering — inline mode", () => {
  it("prepends a context block immediately before the actions block", () => {
    const blocks: SlackBlocks = [makeActionsBlock(2)];
    const result = applyHintRendering(
      blocks,
      makeQuestion({ hint: { mode: "inline", text: "A primary color." } }),
      sdk,
    );
    assert.equal(result.length, 2);
    const context = result[0] as ContextBlock;
    assert.equal(context.type, "context");
    const element = context.elements[0];
    assert.equal(element.type, "mrkdwn");
    if (element.type === "mrkdwn") {
      assert.match(element.text, /A primary color/);
    }
    const actions = result[1] as ActionsBlock;
    assert.equal(actions.type, "actions");
    assert.equal(actions.elements.length, 2);
  });
});

describe("applyHintRendering — no hint", () => {
  it("returns the input blocks unchanged when hint is absent", () => {
    const blocks: SlackBlocks = [makeActionsBlock(2)];
    const result = applyHintRendering(blocks, makeQuestion(), sdk);
    assert.equal(result, blocks);
  });
});
