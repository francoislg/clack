import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { ModalView, ViewsOpenResponse } from "@slack/web-api";
import { installPostGameButtons } from "./postGameButtons.js";
import { seeAnswerButton } from "./seeAnswerButton.js";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  type FakeTriviaDataLayer,
} from "../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../testHelpers.fakeSdk.js";
import type { PluginActionHandler } from "../../sdk.js";
import type { TriviaQuestion } from "../core/types.js";

interface OpenCall {
  trigger_id: string;
  view: ModalView;
}

interface FakeSdk {
  registrations: Array<{ pattern: string | RegExp; handler: PluginActionHandler }>;
  opens: OpenCall[];
  registerAction: (p: string | RegExp, h: PluginActionHandler) => void;
  getSlackClient: () => {
    views: { open: (a: OpenCall) => Promise<ViewsOpenResponse> };
    chat: { update: () => Promise<{ ok?: boolean }> };
  };
  sendMessage: () => Promise<{ ok: true; ts: string; channel: string }>;
  startThreadConversation: () => Promise<void>;
}

function fakeSdk(): FakeSdk {
  const registrations: FakeSdk["registrations"] = [];
  const opens: OpenCall[] = [];
  return {
    registrations,
    opens,
    registerAction(pattern, handler) {
      registrations.push({ pattern, handler });
    },
    getSlackClient() {
      return {
        views: {
          open: async (a: OpenCall) => {
            opens.push(a);
            return { ok: true };
          },
        },
        chat: { update: async () => ({ ok: true }) },
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
  body: { user: { id: string }; trigger_id: string };
  action: { action_id: string };
}
type Handler = (args: ActionArgs) => Promise<void> | void;

function makeQuestion(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return {
    id: "Q1",
    category: "C",
    statement: "S",
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

function install(sdk: FakeSdk, data: FakeTriviaDataLayer): Handler {
  installPostGameButtons(sdk, [seeAnswerButton], {
    data,
    getGameNames: () => [FIXTURE_GAME_NAME],
  });
  return sdk.registrations[0].handler as Handler;
}

describe("seeAnswerButton", () => {
  it("registers exactly one regex action handler", () => {
    const sdk = fakeSdk();
    const { sdk: fakeSDK } = createFakeSdk();
    primeTriviaConfig(fakeSDK);
    const { dataLayer } = createTriviaDataLayer(fakeSDK);
    install(sdk, dataLayer);
    assert.equal(sdk.registrations.length, 1);
    assert.ok(sdk.registrations[0].pattern instanceof RegExp);
  });

  it("opens a modal with the clicking user's answer and writes nothing", async () => {
    const sdk = fakeSdk();
    const { sdk: fakeSDK } = createFakeSdk();
    primeTriviaConfig(fakeSDK);
    const { dataLayer: data } = createTriviaDataLayer(fakeSDK);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion());
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "Q1",
      answer: false,
      correct: false,
      timestamp: 1,
    });
    const handler = install(sdk, data);

    const answersBefore = await scoped.loadAnswers();
    await handler({
      ack: async () => {},
      body: { user: { id: "U1" }, trigger_id: "T1" },
      action: { action_id: "plugin:trivia:reveal-see-answer:Q1" },
    });

    assert.equal(sdk.opens.length, 1);
    assert.equal(sdk.opens[0].trigger_id, "T1");
    const block = sdk.opens[0].view.blocks[sdk.opens[0].view.blocks.length - 1];
    assert.ok("text" in block && typeof block.text === "object" && block.text !== null);
    assert.match((block.text as { text: string }).text, /👎 FALSE/);

    const answersAfter = await scoped.loadAnswers();
    assert.deepEqual(answersAfter, answersBefore);
  });

  it('shows "did not answer" for a user with no row', async () => {
    const sdk = fakeSdk();
    const { sdk: fakeSDK } = createFakeSdk();
    primeTriviaConfig(fakeSDK);
    const { dataLayer: data } = createTriviaDataLayer(fakeSDK);
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion(makeQuestion());
    const handler = install(sdk, data);

    await handler({
      ack: async () => {},
      body: { user: { id: "U_NONE" }, trigger_id: "T1" },
      action: { action_id: "plugin:trivia:reveal-see-answer:Q1" },
    });

    assert.equal(sdk.opens.length, 1);
    const block = sdk.opens[0].view.blocks[sdk.opens[0].view.blocks.length - 1];
    assert.ok("text" in block && typeof block.text === "object" && block.text !== null);
    assert.match((block.text as { text: string }).text, /did not submit an answer/);
  });
});
