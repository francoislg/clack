import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { KnownBlock } from "@slack/types";
import { extractQuestionIdFromActionId, installTellMeMoreHandler } from "./tellMeMoreHandler.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME } from "../testHelpers.js";
import type { PluginActionHandler, SettableAttentionLevel } from "../../sdk.js";
import type { TriviaQuestion } from "../core/types.js";

interface UpdateCall {
  channel: string;
  ts: string;
  blocks: KnownBlock[];
}
interface SendCall {
  channel: string;
  threadTs?: string;
  text?: string;
}
interface StartCall {
  channel: string;
  threadTs: string;
  userId: string;
  prompt: string;
  additionalSystemPrompt?: string;
  attentionLevel?: SettableAttentionLevel;
}

interface FakeSdk {
  registrations: Array<{ pattern: string | RegExp; handler: PluginActionHandler }>;
  updates: UpdateCall[];
  sends: SendCall[];
  starts: StartCall[];
}

function fakeSdk(opts: { client?: boolean } = {}): FakeSdk & {
  registerAction: (p: string | RegExp, h: PluginActionHandler) => void;
  getSlackClient: () => { chat: { update: (a: UpdateCall) => Promise<{ ok?: boolean }> } } | null;
  sendMessage: (a: SendCall) => Promise<{ ok: true; ts: string; channel: string }>;
  startThreadConversation: (a: StartCall) => Promise<void>;
} {
  const state: FakeSdk = { registrations: [], updates: [], sends: [], starts: [] };
  return {
    ...state,
    registerAction(pattern: string | RegExp, handler: PluginActionHandler) {
      state.registrations.push({ pattern, handler });
    },
    getSlackClient() {
      if (opts.client === false) return null;
      return {
        chat: {
          update: async (a: UpdateCall) => {
            state.updates.push(a);
            return { ok: true };
          },
        },
      };
    },
    async sendMessage(a: SendCall) {
      state.sends.push(a);
      return { ok: true as const, ts: "9.9", channel: a.channel };
    },
    async startThreadConversation(a: StartCall) {
      state.starts.push(a);
    },
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

function cardBlocks(withTellMeMore: boolean): KnownBlock[] {
  const blocks: KnownBlock[] = [
    { type: "section", block_id: "card:Q1", text: { type: "mrkdwn", text: "S" } },
    {
      type: "actions",
      block_id: "reveal-see-answer-actions:Q1",
      elements: [
        {
          type: "button",
          action_id: "plugin:trivia:reveal-see-answer:Q1",
          text: { type: "plain_text", text: "See" },
        },
      ],
    },
  ];
  if (withTellMeMore) {
    blocks.push({
      type: "actions",
      block_id: "reveal-tell-me-more-actions:Q1",
      elements: [
        {
          type: "button",
          action_id: "plugin:trivia:tell-me-more:Q1",
          text: { type: "plain_text", text: "More" },
        },
      ],
    });
  }
  return blocks;
}

function clickBody(blocks: KnownBlock[], userId = "U1"): ActionArgs["body"] {
  return {
    user: { id: userId },
    channel: { id: "C1" },
    message: { ts: "1700000000.000000", blocks },
  };
}

describe("extractQuestionIdFromActionId", () => {
  it("parses the questionId from a scoped tell-me-more action_id", () => {
    assert.equal(extractQuestionIdFromActionId("plugin:trivia:tell-me-more:Q1"), "Q1");
  });
  it("rejects foreign or malformed action_ids", () => {
    assert.equal(extractQuestionIdFromActionId("plugin:trivia:reveal-see-answer:Q1"), null);
    assert.equal(extractQuestionIdFromActionId("plugin:trivia:tell-me-more:"), null);
    assert.equal(extractQuestionIdFromActionId("plugin:trivia:tell-me-more:Q1:x"), null);
  });
});

describe("installTellMeMoreHandler", () => {
  it("registers exactly one regex action handler", () => {
    const sdk = fakeSdk();
    installTellMeMoreHandler(sdk, {
      data: createInMemoryDataLayer(),
      getGameNames: () => [FIXTURE_GAME_NAME],
    });
    assert.equal(sdk.registrations.length, 1);
    assert.ok(sdk.registrations[0].pattern instanceof RegExp);
  });

  it("removes the button, posts a tagging intro, and starts a thread conversation", async () => {
    const sdk = fakeSdk();
    const data = createInMemoryDataLayer();
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion(makeQuestion());
    installTellMeMoreHandler(sdk, { data, getGameNames: () => [FIXTURE_GAME_NAME] });
    const handler = sdk.registrations[0].handler as Handler;

    await handler({
      ack: async () => {},
      body: clickBody(cardBlocks(true)),
      action: { action_id: "plugin:trivia:tell-me-more:Q1" },
    });

    // Button removed via chat.update (tell-me-more block gone, see-answer kept).
    assert.equal(sdk.updates.length, 1);
    const ids = sdk.updates[0].blocks.map((b) => b.block_id);
    assert.ok(!ids.includes("reveal-tell-me-more-actions:Q1"));
    assert.ok(ids.includes("reveal-see-answer-actions:Q1"));

    // Intro posted into the thread, tagging the clicker.
    assert.equal(sdk.sends.length, 1);
    assert.equal(sdk.sends[0].threadTs, "1700000000.000000");
    assert.match(sdk.sends[0].text ?? "", /<@U1>/);

    // Streamed kickoff with the question + answer in the system prompt.
    assert.equal(sdk.starts.length, 1);
    const start = sdk.starts[0];
    assert.equal(start.channel, "C1");
    assert.equal(start.threadTs, "1700000000.000000");
    assert.equal(start.userId, "U1");
    assert.equal(start.attentionLevel, "high");
    assert.match(start.additionalSystemPrompt ?? "", /Nile is the longest river/);
    // The seeded "high" must survive the first turn — instruct Claude not to lower it.
    assert.match(start.additionalSystemPrompt ?? "", /Do NOT lower `attention_level`/);
  });

  it("is a no-op when the button is already gone (race / double-click)", async () => {
    const sdk = fakeSdk();
    const data = createInMemoryDataLayer();
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion(makeQuestion());
    installTellMeMoreHandler(sdk, { data, getGameNames: () => [FIXTURE_GAME_NAME] });
    const handler = sdk.registrations[0].handler as Handler;

    await handler({
      ack: async () => {},
      body: clickBody(cardBlocks(false)),
      action: { action_id: "plugin:trivia:tell-me-more:Q1" },
    });

    assert.equal(sdk.updates.length, 0);
    assert.equal(sdk.sends.length, 0);
    assert.equal(sdk.starts.length, 0);
  });

  it("does nothing when the Slack client is not connected", async () => {
    const sdk = fakeSdk({ client: false });
    const data = createInMemoryDataLayer();
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion(makeQuestion());
    installTellMeMoreHandler(sdk, { data, getGameNames: () => [FIXTURE_GAME_NAME] });
    const handler = sdk.registrations[0].handler as Handler;

    await handler({
      ack: async () => {},
      body: clickBody(cardBlocks(true)),
      action: { action_id: "plugin:trivia:tell-me-more:Q1" },
    });

    assert.equal(sdk.sends.length, 0);
    assert.equal(sdk.starts.length, 0);
  });

  it("does nothing for an unparseable action_id", async () => {
    const sdk = fakeSdk();
    const data = createInMemoryDataLayer();
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion(makeQuestion());
    installTellMeMoreHandler(sdk, { data, getGameNames: () => [FIXTURE_GAME_NAME] });
    const handler = sdk.registrations[0].handler as Handler;

    await handler({
      ack: async () => {},
      body: clickBody(cardBlocks(true)),
      action: { action_id: "plugin:trivia:vote:Q1:true" },
    });

    assert.equal(sdk.updates.length, 0);
    assert.equal(sdk.starts.length, 0);
  });
});
