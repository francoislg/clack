import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { KnownBlock } from "@slack/types";
import { editRevealIntoCard } from "./editCard.js";
import type { TriviaQuestion } from "../core/types.js";
import type { ProcessRevealEntry } from "../tools/reveal/types.js";

const actionId = (k: string): string => `plugin:trivia:${k}`;

function postedBlocks(): KnownBlock[] {
  return [
    { type: "header", block_id: "hdr:Q1", text: { type: "plain_text", text: "Trivia!" } },
    { type: "section", block_id: "card:Q1", text: { type: "mrkdwn", text: "Statement" } },
    {
      type: "actions",
      block_id: "vote-actions:Q1",
      elements: [
        {
          type: "button",
          action_id: "plugin:trivia:vote:Q1:true",
          text: { type: "plain_text", text: "👍 TRUE" },
        },
      ],
    },
  ];
}

function makeQuestion(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return {
    id: "Q1",
    category: "C",
    statement: "Statement",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["🎯"],
    createdAt: 0,
    postedAt: 1000,
    messageLink: "https://x.slack.com/archives/C100/p1700000000000000",
    revealResponses: "yes",
    postedBlocks: postedBlocks(),
    ...overrides,
  };
}

function makeEntry(): ProcessRevealEntry {
  return {
    questionId: "Q1",
    statement: "Statement",
    category: "C",
    emojis: ["🎯"],
    messageLink: "https://x.slack.com/archives/C100/p1700000000000000",
    wasReprocessed: false,
    answer: { type: "boolean", isTrue: true },
    voters: {
      revealResponses: "yes",
      correct: [{ userId: "U_A", displayName: "A" }],
      incorrect: [],
      noAnswer: [],
      reactions: [],
    },
  };
}

interface Captured {
  channel: string;
  ts: string;
  blocks: KnownBlock[];
}

function blockIds(blocks: KnownBlock[]): string[] {
  return blocks.map((b) => b.block_id ?? "");
}

describe("editRevealIntoCard", () => {
  it("preserves the body, strips the answer-actions block, appends footer + see-answer button", async () => {
    let captured: Captured | undefined;
    await editRevealIntoCard({
      updateMessage: async (channel, ts, blocks) => {
        captured = { channel, ts, blocks };
      },
      question: makeQuestion(),
      entry: makeEntry(),
      actionId,
      game: null,
      config: null,
    });

    assert.ok(captured !== undefined);
    assert.equal(captured.channel, "C100");
    assert.equal(captured.ts, "1700000000.000000");

    const ids = blockIds(captured.blocks);
    // Original body preserved.
    assert.ok(ids.includes("hdr:Q1"));
    assert.ok(ids.includes("card:Q1"));
    // Vote buttons removed.
    assert.ok(!ids.includes("vote-actions:Q1"));
    // Results footer + see-answer button appended.
    assert.ok(ids.includes("reveal-results-divider:Q1"));
    assert.ok(ids.includes("reveal-results:Q1"));
    assert.ok(ids.includes("reveal-see-answer-actions:Q1"));

    const button = captured.blocks.find((b) => b.block_id === "reveal-see-answer-actions:Q1");
    assert.ok(button !== undefined && button.type === "actions");
    assert.equal(button.elements.length, 1);
    const el = button.elements[0];
    assert.ok(el.type === "button");
    assert.equal(el.action_id, "plugin:trivia:reveal-see-answer:Q1");
  });

  it("strips a freeform-answer-actions block too", async () => {
    let captured: Captured | undefined;
    const blocks: KnownBlock[] = [
      { type: "section", block_id: "card:Q1", text: { type: "mrkdwn", text: "S" } },
      {
        type: "actions",
        block_id: "freeform-answer-actions:Q1",
        elements: [
          {
            type: "button",
            action_id: "plugin:trivia:freeform-answer:Q1",
            text: { type: "plain_text", text: "Answer" },
          },
        ],
      },
    ];
    await editRevealIntoCard({
      updateMessage: async (channel, ts, b) => {
        captured = { channel, ts, blocks: b };
      },
      question: makeQuestion({
        answersFormat: "freeform",
        expectedAnswer: "Paris",
        postedBlocks: blocks,
      }),
      entry: makeEntry(),
      actionId,
      game: null,
      config: null,
    });
    assert.ok(captured !== undefined);
    assert.ok(!blockIds(captured.blocks).includes("freeform-answer-actions:Q1"));
  });

  it("skips the edit when the question has no postedBlocks", async () => {
    let called = false;
    await editRevealIntoCard({
      updateMessage: async () => {
        called = true;
      },
      question: makeQuestion({ postedBlocks: undefined }),
      entry: makeEntry(),
      actionId,
      game: null,
      config: null,
    });
    assert.equal(called, false);
  });

  it("skips the edit when the messageLink is unparseable", async () => {
    let called = false;
    await editRevealIntoCard({
      updateMessage: async () => {
        called = true;
      },
      question: makeQuestion({ messageLink: "not-a-permalink" }),
      entry: makeEntry(),
      actionId,
      game: null,
      config: null,
    });
    assert.equal(called, false);
  });

  it("appends a Tell me more button when tellMeMore is enabled", async () => {
    let captured: Captured | undefined;
    await editRevealIntoCard({
      updateMessage: async (channel, ts, blocks) => {
        captured = { channel, ts, blocks };
      },
      question: makeQuestion(),
      entry: makeEntry(),
      actionId,
      game: null,
      config: { tellMeMore: { enabled: true } },
    });

    assert.ok(captured !== undefined);
    const ids = blockIds(captured.blocks);
    assert.ok(ids.includes("reveal-see-answer-actions:Q1"));
    assert.ok(ids.includes("reveal-tell-me-more-actions:Q1"));

    const block = captured.blocks.find((b) => b.block_id === "reveal-tell-me-more-actions:Q1");
    assert.ok(block !== undefined && block.type === "actions");
    const el = block.elements[0];
    assert.ok(el.type === "button");
    assert.equal(el.action_id, "plugin:trivia:tell-me-more:Q1");
  });

  it("omits the Tell me more button when tellMeMore is disabled", async () => {
    let captured: Captured | undefined;
    await editRevealIntoCard({
      updateMessage: async (channel, ts, blocks) => {
        captured = { channel, ts, blocks };
      },
      question: makeQuestion(),
      entry: makeEntry(),
      actionId,
      game: null,
      config: null,
    });

    assert.ok(captured !== undefined);
    assert.ok(!blockIds(captured.blocks).includes("reveal-tell-me-more-actions:Q1"));
  });

  it("swallows an updateMessage failure (non-fatal)", async () => {
    await assert.doesNotReject(
      editRevealIntoCard({
        updateMessage: async () => {
          throw new Error("rate limited");
        },
        question: makeQuestion(),
        entry: makeEntry(),
        actionId,
        game: null,
        config: null,
      }),
    );
  });
});
