import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { KnownBlock } from "@slack/types";
import { installPostGameButtons } from "./postGameButtons.js";
import { tellMeMoreButton } from "./tellMeMoreButton.js";
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
  registerAction: (p: string | RegExp, h: PluginActionHandler) => void;
  getSlackClient: () => {
    views: { open: () => Promise<{ ok: boolean }> };
    chat: { update: (a: UpdateCall) => Promise<{ ok?: boolean }> };
  } | null;
  sendMessage: (a: SendCall) => Promise<{ ok: true; ts: string; channel: string }>;
  startThreadConversation: (a: StartCall) => Promise<void>;
}

function fakeSdk(opts: { client?: boolean } = {}): FakeSdk {
  const registrations: FakeSdk["registrations"] = [];
  const updates: UpdateCall[] = [];
  const sends: SendCall[] = [];
  const starts: StartCall[] = [];
  return {
    registrations,
    updates,
    sends,
    starts,
    registerAction(pattern, handler) {
      registrations.push({ pattern, handler });
    },
    getSlackClient() {
      if (opts.client === false) return null;
      return {
        views: { open: async () => ({ ok: true }) },
        chat: {
          update: async (a: UpdateCall) => {
            updates.push(a);
            return { ok: true };
          },
        },
      };
    },
    async sendMessage(a: SendCall) {
      sends.push(a);
      return { ok: true as const, ts: "9.9", channel: a.channel };
    },
    async startThreadConversation(a: StartCall) {
      starts.push(a);
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
    { type: "actions", block_id: "reveal-see-answer-actions:Q1", elements: [] },
  ];
  if (withTellMeMore) {
    blocks.push({ type: "actions", block_id: "reveal-tell-me-more-actions:Q1", elements: [] });
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

function install(sdk: FakeSdk, data: ReturnType<typeof createInMemoryDataLayer>): Handler {
  installPostGameButtons(sdk, [tellMeMoreButton], {
    data,
    getGameNames: () => [FIXTURE_GAME_NAME],
  });
  return sdk.registrations[0].handler as Handler;
}

describe("tellMeMoreButton", () => {
  it("registers exactly one regex action handler", () => {
    const sdk = fakeSdk();
    install(sdk, createInMemoryDataLayer());
    assert.equal(sdk.registrations.length, 1);
    assert.ok(sdk.registrations[0].pattern instanceof RegExp);
  });

  it("removes the button, posts a tagging intro, and starts a thread conversation", async () => {
    const sdk = fakeSdk();
    const data = createInMemoryDataLayer();
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion(makeQuestion());
    const handler = install(sdk, data);

    await handler({
      ack: async () => {},
      body: clickBody(cardBlocks(true)),
      action: { action_id: "plugin:trivia:tell-me-more:Q1" },
    });

    assert.equal(sdk.updates.length, 1);
    const ids = sdk.updates[0].blocks.map((b) => b.block_id);
    assert.ok(!ids.includes("reveal-tell-me-more-actions:Q1"));
    assert.ok(ids.includes("reveal-see-answer-actions:Q1"));

    assert.equal(sdk.sends.length, 1);
    assert.equal(sdk.sends[0].threadTs, "1700000000.000000");
    assert.match(sdk.sends[0].text ?? "", /<@U1>/);

    assert.equal(sdk.starts.length, 1);
    const start = sdk.starts[0];
    assert.equal(start.channel, "C1");
    assert.equal(start.threadTs, "1700000000.000000");
    assert.equal(start.userId, "U1");
    assert.equal(start.attentionLevel, "high");
    assert.match(start.additionalSystemPrompt ?? "", /Nile is the longest river/);
    assert.match(start.additionalSystemPrompt ?? "", /Do NOT lower `attention_level`/);
  });

  it("is a no-op when the button is already gone (race / double-click)", async () => {
    const sdk = fakeSdk();
    const data = createInMemoryDataLayer();
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion(makeQuestion());
    const handler = install(sdk, data);

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
    const handler = install(sdk, data);

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
    const handler = install(sdk, data);

    await handler({
      ack: async () => {},
      body: clickBody(cardBlocks(true)),
      action: { action_id: "plugin:trivia:vote:Q1:true" },
    });

    assert.equal(sdk.updates.length, 0);
    assert.equal(sdk.starts.length, 0);
  });
});
