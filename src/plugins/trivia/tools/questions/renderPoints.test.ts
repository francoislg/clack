import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { ActionsBlock, Button, ContextBlock, SectionBlock } from "@slack/types";
import type { SlackBlocks } from "../../../../plugins-sdk/sdk.js";
import type { TriviaQuestion } from "../../core/types.js";
import { createFakeSdk } from "../../testHelpers.fakeSdk.js";
import { applyPointsRendering } from "./renderPoints.js";

const { sdk } = createFakeSdk();

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

function makeActionsBlock(): ActionsBlock {
  const elements: Button[] = [
    { type: "button", text: { type: "plain_text", text: "True" }, action_id: "vote:Q1:0" },
    { type: "button", text: { type: "plain_text", text: "False" }, action_id: "vote:Q1:1" },
  ];
  return { type: "actions", elements };
}

const questionSection: SectionBlock = {
  type: "section",
  text: { type: "mrkdwn", text: "The statement" },
};

describe("applyPointsRendering", () => {
  it("inserts the worth line directly above the answer buttons", () => {
    const blocks: SlackBlocks = [questionSection, makeActionsBlock()];
    const result = applyPointsRendering(blocks, makeQuestion({ points: 2 }), sdk);

    assert.equal(result.length, 3);
    assert.equal(result[0], questionSection);
    const context = result[1] as ContextBlock;
    assert.equal(context.type, "context");
    assert.equal((context.elements[0] as { text: string }).text, "points.worth:2");
    assert.equal(result[2].type, "actions", "the actions block stays last");
  });

  it("passes the stamped value through to the string, not a hardcoded number", () => {
    const result = applyPointsRendering([makeActionsBlock()], makeQuestion({ points: 5 }), sdk);
    const context = result[0] as ContextBlock;
    assert.equal((context.elements[0] as { text: string }).text, "points.worth:5");
  });

  it("renders nothing for a question with no stamped points (worth 1)", () => {
    const blocks: SlackBlocks = [questionSection, makeActionsBlock()];
    const result = applyPointsRendering(blocks, makeQuestion(), sdk);
    assert.deepEqual(result, blocks, "pre-feature cards stay byte-identical");
  });

  it("renders nothing for an explicitly 1-point question", () => {
    const blocks: SlackBlocks = [questionSection, makeActionsBlock()];
    const result = applyPointsRendering(blocks, makeQuestion({ points: 1 }), sdk);
    assert.deepEqual(result, blocks);
  });

  it("appends when the card has no actions block (locked / no affordances)", () => {
    const blocks: SlackBlocks = [questionSection];
    const result = applyPointsRendering(blocks, makeQuestion({ points: 3 }), sdk);
    assert.equal(result.length, 2);
    assert.equal(result[1].type, "context");
  });
});
