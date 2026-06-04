import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { KnownBlock } from "@slack/types";
import {
  installPostGameButtons,
  removePostGameButton,
  renderPostGameButtons,
  type OneShotPostGameButton,
  type PostGameButtonContext,
} from "./postGameButtons.js";
import { POST_GAME_BUTTONS } from "./postGameRegistry.js";
import { seeAnswerButton } from "./seeAnswerButton.js";
import { tellMeMoreButton } from "./tellMeMoreButton.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME } from "../testHelpers.js";
import type { PluginActionHandler } from "../../sdk.js";
import type { TriviaQuestion } from "../core/types.js";

const actionId = (k: string): string => `plugin:trivia:${k}`;

function makeQuestion(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return {
    id: "Q1",
    category: "Geography",
    statement: "The Nile is the longest river.",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["🎯"],
    createdAt: 0,
    postedAt: 1000,
    processedAt: 2000,
    messageLink: "https://x.slack.com/archives/C1/p1700000000000000",
    revealResponses: "yes",
    ...overrides,
  };
}

function ctx(overrides: Partial<PostGameButtonContext> = {}): PostGameButtonContext {
  return { question: makeQuestion(), game: null, config: null, ...overrides };
}

describe("renderPostGameButtons", () => {
  it("renders only the always-on see-answer button when tell-me-more is disabled", () => {
    const blocks = renderPostGameButtons(POST_GAME_BUTTONS, ctx(), actionId);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].block_id, "reveal-see-answer-actions:Q1");
  });

  it("renders both buttons, in registry order, when tell-me-more is enabled", () => {
    const blocks = renderPostGameButtons(
      POST_GAME_BUTTONS,
      ctx({ config: { tellMeMore: { enabled: true } } }),
      actionId,
    );
    assert.deepEqual(
      blocks.map((b) => b.block_id),
      ["reveal-see-answer-actions:Q1", "reveal-tell-me-more-actions:Q1"],
    );
  });

  it("preserves each entry's verbatim block_id and action_id", () => {
    const blocks = renderPostGameButtons(
      POST_GAME_BUTTONS,
      ctx({ config: { tellMeMore: { enabled: true } } }),
      actionId,
    );
    const see = blocks.find((b) => b.block_id === "reveal-see-answer-actions:Q1");
    const more = blocks.find((b) => b.block_id === "reveal-tell-me-more-actions:Q1");
    assert.ok(see?.type === "actions" && see.elements[0].type === "button");
    assert.equal(see.elements[0].action_id, "plugin:trivia:reveal-see-answer:Q1");
    assert.ok(more?.type === "actions" && more.elements[0].type === "button");
    assert.equal(more.elements[0].action_id, "plugin:trivia:tell-me-more:Q1");
  });
});

describe("removePostGameButton", () => {
  function cardWithBoth(): KnownBlock[] {
    return [
      { type: "section", block_id: "card:Q1", text: { type: "mrkdwn", text: "S" } },
      { type: "actions", block_id: "reveal-see-answer-actions:Q1", elements: [] },
      { type: "actions", block_id: "reveal-tell-me-more-actions:Q1", elements: [] },
    ];
  }

  it("drops only the target block and keeps siblings", () => {
    const { blocks, removed } = removePostGameButton(cardWithBoth(), tellMeMoreButton, "Q1");
    assert.equal(removed, true);
    const ids = blocks.map((b) => b.block_id);
    assert.ok(!ids.includes("reveal-tell-me-more-actions:Q1"));
    assert.ok(ids.includes("reveal-see-answer-actions:Q1"));
    assert.ok(ids.includes("card:Q1"));
  });

  it("reports removed:false when the target block is already absent", () => {
    const without = cardWithBoth().filter((b) => b.block_id !== "reveal-tell-me-more-actions:Q1");
    const { blocks, removed } = removePostGameButton(without, tellMeMoreButton, "Q1");
    assert.equal(removed, false);
    assert.equal(blocks.length, without.length);
  });
});

interface UpdateCall {
  channel: string;
  ts: string;
  blocks: KnownBlock[];
}

interface FakeSdk {
  registrations: Array<{ pattern: string | RegExp; handler: PluginActionHandler }>;
  updates: UpdateCall[];
  order: string[];
  registerAction: (p: string | RegExp, h: PluginActionHandler) => void;
  getSlackClient: () => {
    views: { open: () => Promise<{ ok: boolean }> };
    chat: { update: (a: UpdateCall) => Promise<{ ok?: boolean }> };
  };
  sendMessage: () => Promise<{ ok: true; ts: string; channel: string }>;
  startThreadConversation: () => Promise<void>;
}

function fakeSdk(): FakeSdk {
  const registrations: FakeSdk["registrations"] = [];
  const updates: UpdateCall[] = [];
  const order: string[] = [];
  return {
    registrations,
    updates,
    order,
    registerAction(pattern, handler) {
      registrations.push({ pattern, handler });
    },
    getSlackClient() {
      return {
        views: { open: async () => ({ ok: true }) },
        chat: {
          update: async (a: UpdateCall) => {
            updates.push(a);
            order.push("update");
            return { ok: true };
          },
        },
      };
    },
    async sendMessage() {
      return { ok: true as const, ts: "9.9", channel: "C1" };
    },
    async startThreadConversation() {},
  };
}

interface ActionArgs {
  ack: () => Promise<void>;
  body: {
    user?: { id?: string };
    channel?: { id?: string };
    message?: { ts?: string; blocks?: KnownBlock[] };
  };
  action: { action_id: string };
}
type Handler = (args: ActionArgs) => Promise<void> | void;

function syntheticOneShot(order: string[]): OneShotPostGameButton & { clicks: number } {
  const entry: OneShotPostGameButton & { clicks: number } = {
    key: "x-test",
    actionRe: /^x-test:[^:]+$/,
    actionPrefix: "plugin:trivia:x-test:",
    actionIdSuffix: (q) => `x-test:${q}`,
    blockId: (q) => `x-test-actions:${q}`,
    label: () => "X",
    lifecycle: "one-shot",
    enabled: () => true,
    clicks: 0,
    onClick: async () => {
      entry.clicks += 1;
      order.push("click");
    },
  };
  return entry;
}

function clickBody(blocks: KnownBlock[]): ActionArgs["body"] {
  return {
    user: { id: "U1" },
    channel: { id: "C1" },
    message: { ts: "1700000000.000000", blocks },
  };
}

describe("installPostGameButtons (one-shot wrapper)", () => {
  it("removes the block via chat.update, then runs onClick", async () => {
    const sdk = fakeSdk();
    const data = createInMemoryDataLayer();
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion(makeQuestion());
    const button = syntheticOneShot(sdk.order);
    installPostGameButtons(sdk, [button], { data, getGameNames: () => [FIXTURE_GAME_NAME] });
    const handler = sdk.registrations[0].handler as Handler;

    const blocks: KnownBlock[] = [
      { type: "section", block_id: "keep:Q1", text: { type: "mrkdwn", text: "S" } },
      { type: "actions", block_id: "x-test-actions:Q1", elements: [] },
    ];
    await handler({
      ack: async () => {},
      body: clickBody(blocks),
      action: { action_id: "plugin:trivia:x-test:Q1" },
    });

    assert.equal(sdk.updates.length, 1);
    const ids = sdk.updates[0].blocks.map((b) => b.block_id);
    assert.ok(!ids.includes("x-test-actions:Q1"));
    assert.ok(ids.includes("keep:Q1"));
    assert.equal(button.clicks, 1);
    assert.deepEqual(sdk.order, ["update", "click"]);
  });

  it("is a no-op when the block is already gone (race / double-click)", async () => {
    const sdk = fakeSdk();
    const data = createInMemoryDataLayer();
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion(makeQuestion());
    const button = syntheticOneShot(sdk.order);
    installPostGameButtons(sdk, [button], { data, getGameNames: () => [FIXTURE_GAME_NAME] });
    const handler = sdk.registrations[0].handler as Handler;

    await handler({
      ack: async () => {},
      body: clickBody([
        { type: "section", block_id: "keep:Q1", text: { type: "mrkdwn", text: "S" } },
      ]),
      action: { action_id: "plugin:trivia:x-test:Q1" },
    });

    assert.equal(sdk.updates.length, 0);
    assert.equal(button.clicks, 0);
  });
});

describe("POST_GAME_BUTTONS registry", () => {
  it("contains see-answer (persistent) then tell-me-more (one-shot)", () => {
    assert.deepEqual(
      POST_GAME_BUTTONS.map((b) => [b.key, b.lifecycle]),
      [
        ["see-answer", "persistent"],
        ["tell-me-more", "one-shot"],
      ],
    );
    assert.equal(POST_GAME_BUTTONS[0], seeAnswerButton);
    assert.equal(POST_GAME_BUTTONS[1], tellMeMoreButton);
  });
});
