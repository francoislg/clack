import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { ModalView, ViewsOpenResponse } from "@slack/web-api";
import { extractQuestionIdFromActionId, installSeeAnswerHandler } from "./seeAnswerHandler.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME } from "../testHelpers.js";
import type { PluginActionHandler } from "../../sdk.js";
import type { TriviaQuestion } from "../core/types.js";

interface CapturedRegistration {
  pattern: string | RegExp;
  handler: PluginActionHandler;
}

interface OpenCall {
  trigger_id: string;
  view: ModalView;
}

function fakeSdk(opens: OpenCall[]) {
  const registrations: CapturedRegistration[] = [];
  return {
    registrations,
    registerAction(pattern: string | RegExp, handler: PluginActionHandler) {
      registrations.push({ pattern, handler });
    },
    getSlackClient() {
      return {
        views: {
          open: async (args: OpenCall): Promise<ViewsOpenResponse> => {
            opens.push(args);
            return { ok: true };
          },
        },
      };
    },
  };
}

interface MinimalActionArgs {
  ack: () => Promise<void>;
  body: { user: { id: string }; trigger_id: string };
  action: { action_id: string };
}
type MinimalActionHandler = (args: MinimalActionArgs) => Promise<void> | void;

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

describe("extractQuestionIdFromActionId", () => {
  it("parses the questionId from a scoped see-answer action_id", () => {
    assert.equal(extractQuestionIdFromActionId("plugin:trivia:reveal-see-answer:Q1"), "Q1");
  });
  it("rejects foreign or malformed action_ids", () => {
    assert.equal(extractQuestionIdFromActionId("plugin:trivia:vote:Q1:true"), null);
    assert.equal(extractQuestionIdFromActionId("plugin:trivia:reveal-see-answer:"), null);
    assert.equal(extractQuestionIdFromActionId("plugin:trivia:reveal-see-answer:Q1:x"), null);
  });
});

describe("installSeeAnswerHandler", () => {
  it("registers exactly one regex action handler", () => {
    const opens: OpenCall[] = [];
    const sdk = fakeSdk(opens);
    installSeeAnswerHandler(sdk, {
      data: createInMemoryDataLayer(),
      getGameNames: () => [FIXTURE_GAME_NAME],
    });
    assert.equal(sdk.registrations.length, 1);
    assert.ok(sdk.registrations[0].pattern instanceof RegExp);
  });

  it("opens a modal with the clicking user's answer and writes nothing", async () => {
    const opens: OpenCall[] = [];
    const sdk = fakeSdk(opens);
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion());
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "Q1",
      answer: false,
      correct: false,
      timestamp: 1,
    });

    installSeeAnswerHandler(sdk, { data, getGameNames: () => [FIXTURE_GAME_NAME] });
    const handler = sdk.registrations[0].handler as MinimalActionHandler;

    const answersBefore = await scoped.loadAnswers();
    await handler({
      ack: async () => {},
      body: { user: { id: "U1" }, trigger_id: "T1" },
      action: { action_id: "plugin:trivia:reveal-see-answer:Q1" },
    });

    assert.equal(opens.length, 1);
    assert.equal(opens[0].trigger_id, "T1");
    const block = opens[0].view.blocks[opens[0].view.blocks.length - 1];
    assert.ok("text" in block && typeof block.text === "object" && block.text !== null);
    assert.match((block.text as { text: string }).text, /👎 FALSE/);

    // Read-only: no answer rows added or changed.
    const answersAfter = await scoped.loadAnswers();
    assert.deepEqual(answersAfter, answersBefore);
  });

  it('shows "did not answer" for a user with no row', async () => {
    const opens: OpenCall[] = [];
    const sdk = fakeSdk(opens);
    const data = createInMemoryDataLayer();
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion(makeQuestion());

    installSeeAnswerHandler(sdk, { data, getGameNames: () => [FIXTURE_GAME_NAME] });
    const handler = sdk.registrations[0].handler as MinimalActionHandler;

    await handler({
      ack: async () => {},
      body: { user: { id: "U_NONE" }, trigger_id: "T1" },
      action: { action_id: "plugin:trivia:reveal-see-answer:Q1" },
    });

    assert.equal(opens.length, 1);
    const block = opens[0].view.blocks[opens[0].view.blocks.length - 1];
    assert.ok("text" in block && typeof block.text === "object" && block.text !== null);
    assert.match((block.text as { text: string }).text, /did not submit an answer/);
  });
});
