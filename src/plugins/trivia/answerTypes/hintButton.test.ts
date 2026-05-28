import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { ChatPostEphemeralResponse } from "@slack/web-api";
import { extractQuestionIdFromActionId, installHintButtonHandler } from "./hintButton.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME } from "../testHelpers.js";
import type { PluginActionHandler } from "../../sdk.js";
import type { TriviaDataLayer, TriviaQuestion } from "../core/types.js";

interface CapturedRegistration {
  pattern: string | RegExp;
  handler: PluginActionHandler;
}

interface EphemeralCall {
  channel: string;
  user: string;
  text: string;
  thread_ts?: string;
}

interface FakeSdk {
  registrations: CapturedRegistration[];
  ephemerals: EphemeralCall[];
  registerAction(pattern: string | RegExp, handler: PluginActionHandler): void;
  getSlackClient(): {
    chat: { postEphemeral: (call: EphemeralCall) => Promise<ChatPostEphemeralResponse> };
  };
  t(key: string, vars?: Record<string, string>): string;
}

function fakeSdk(): FakeSdk {
  const registrations: CapturedRegistration[] = [];
  const ephemerals: EphemeralCall[] = [];
  return {
    registrations,
    ephemerals,
    registerAction(pattern, handler) {
      registrations.push({ pattern, handler });
    },
    getSlackClient() {
      return {
        chat: {
          postEphemeral: async (call: EphemeralCall): Promise<ChatPostEphemeralResponse> => {
            ephemerals.push(call);
            return { ok: true };
          },
        },
      };
    },
    t(key, vars) {
      if (vars?.text !== undefined) return `${key}:${vars.text}`;
      return key;
    },
  };
}

interface MinimalActionArgs {
  ack: () => Promise<void>;
  body: {
    user: { id: string };
    channel: { id: string };
    message: { ts: string };
  };
  action: { action_id: string };
}

type MinimalActionHandler = (args: MinimalActionArgs) => Promise<void> | void;

async function invokeAction(
  reg: CapturedRegistration,
  opts: { questionId: string; userId: string },
): Promise<{ ackCalled: boolean }> {
  let ackCalled = false;
  const args: MinimalActionArgs = {
    ack: async () => {
      ackCalled = true;
    },
    body: {
      user: { id: opts.userId },
      channel: { id: "C100000000" },
      message: { ts: "1700000000.000001" },
    },
    action: { action_id: `plugin:trivia:hint:${opts.questionId}` },
  };
  const narrowed = reg.handler as MinimalActionHandler;
  await narrowed(args);
  return { ackCalled };
}

function makeQuestion(overrides: Partial<TriviaQuestion>): TriviaQuestion {
  return {
    id: "QH1",
    category: "Science",
    statement: "Water boils at 100 C at sea level.",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["💧"],
    createdAt: 0,
    ...overrides,
  };
}

describe("extractQuestionIdFromActionId", () => {
  it("parses a well-formed action id", () => {
    assert.equal(extractQuestionIdFromActionId("plugin:trivia:hint:Q1"), "Q1");
  });
  it("rejects unrelated action ids", () => {
    assert.equal(extractQuestionIdFromActionId("plugin:trivia:vote:Q1:true"), null);
  });
  it("rejects empty id", () => {
    assert.equal(extractQuestionIdFromActionId("plugin:trivia:hint:"), null);
  });
  it("rejects ids with a trailing colon (would suggest extra segments)", () => {
    assert.equal(extractQuestionIdFromActionId("plugin:trivia:hint:a:b"), null);
  });
});

describe("installHintButtonHandler — button-mode hint", () => {
  let data: TriviaDataLayer;
  let sdk: FakeSdk;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science"]);
    sdk = fakeSdk();
    installHintButtonHandler(sdk, { data, getGameNames: () => [FIXTURE_GAME_NAME] });
  });

  it("acknowledges before doing async work", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ hint: { mode: "button", text: "A primary color." } }));
    const result = await invokeAction(sdk.registrations[0], {
      questionId: "QH1",
      userId: "U1",
    });
    assert.equal(result.ackCalled, true);
  });

  it("first click posts ephemeral and adds user to clickedBy", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ hint: { mode: "button", text: "A primary color." } }));
    await invokeAction(sdk.registrations[0], { questionId: "QH1", userId: "U1" });
    assert.equal(sdk.ephemerals.length, 1);
    const ephemeral = sdk.ephemerals[0];
    assert.equal(ephemeral.user, "U1");
    assert.equal(ephemeral.channel, "C100000000");
    assert.equal(ephemeral.thread_ts, "1700000000.000001");
    assert.match(ephemeral.text, /A primary color/);
    const updated = (await scoped.loadQuestions()).find((q) => q.id === "QH1");
    assert.deepEqual(updated?.hint?.clickedBy, ["U1"]);
  });

  it("repeat click from same user posts fresh ephemeral, clickedBy unchanged", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ hint: { mode: "button", text: "A primary color.", clickedBy: ["U1"] } }),
    );
    await invokeAction(sdk.registrations[0], { questionId: "QH1", userId: "U1" });
    assert.equal(sdk.ephemerals.length, 1);
    const updated = (await scoped.loadQuestions()).find((q) => q.id === "QH1");
    assert.deepEqual(updated?.hint?.clickedBy, ["U1"]);
  });

  it("click from different user appends to clickedBy", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ hint: { mode: "button", text: "A primary color.", clickedBy: ["U1"] } }),
    );
    await invokeAction(sdk.registrations[0], { questionId: "QH1", userId: "U2" });
    const updated = (await scoped.loadQuestions()).find((q) => q.id === "QH1");
    assert.deepEqual(updated?.hint?.clickedBy?.sort(), ["U1", "U2"]);
  });

  it("missing-hint fallback posts no-hint ephemeral and skips clickedBy update", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({}));
    await invokeAction(sdk.registrations[0], { questionId: "QH1", userId: "U1" });
    assert.equal(sdk.ephemerals.length, 1);
    assert.equal(sdk.ephemerals[0].text, "hint.missing");
    const updated = (await scoped.loadQuestions()).find((q) => q.id === "QH1");
    assert.equal(updated?.hint, undefined);
  });

  it("question text precedes hint label in ephemeral body", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ hint: { mode: "button", text: "A primary color." } }));
    await invokeAction(sdk.registrations[0], { questionId: "QH1", userId: "U1" });
    const lines = sdk.ephemerals[0].text.split("\n");
    assert.match(lines[0], /Water boils/);
    assert.match(lines[1], /A primary color/);
  });
});
