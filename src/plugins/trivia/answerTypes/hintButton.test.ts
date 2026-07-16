import { describe, it, beforeEach, vi } from "vitest";
import type { Mock } from "vitest";
import assert from "node:assert/strict";
import type { ModalView, ViewsOpenResponse } from "@slack/web-api";
import { extractQuestionIdFromActionId, installHintButtonHandler } from "./hintButton.js";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  type FakeTriviaDataLayer,
} from "../testHelpers.js";
import { createFakeSdk, primeTriviaConfig, type FakeSdk } from "../testHelpers.fakeSdk.js";
import type { PluginActionHandler } from "../../sdk.js";
import type { TriviaQuestion } from "../core/types.js";

interface ViewsOpenCall {
  trigger_id: string;
  view: ModalView;
}

interface MinimalActionArgs {
  ack: () => Promise<void>;
  body: {
    user: { id: string };
    channel: { id: string };
    message: { ts: string };
    trigger_id?: string;
  };
  action: { action_id: string };
}

type MinimalActionHandler = (args: MinimalActionArgs) => Promise<void> | void;

async function invokeAction(
  handler: PluginActionHandler,
  opts: { questionId: string; userId: string; triggerId?: string | null },
): Promise<{ ackCalled: boolean }> {
  let ackCalled = false;
  const triggerId = opts.triggerId === undefined ? "trig.123" : opts.triggerId;
  const args: MinimalActionArgs = {
    ack: async () => {
      ackCalled = true;
    },
    body: {
      user: { id: opts.userId },
      channel: { id: "C100000000" },
      message: { ts: "1700000000.000001" },
      ...(triggerId !== null ? { trigger_id: triggerId } : {}),
    },
    action: { action_id: `plugin:trivia:hint:${opts.questionId}` },
  };
  const narrowed = handler as MinimalActionHandler;
  await narrowed(args);
  return { ackCalled };
}

function modalText(view: ModalView): string {
  return view.blocks
    .filter((b): b is Extract<typeof b, { type: "section" }> => b.type === "section")
    .map((b) => ("text" in b && b.text !== undefined ? b.text.text : ""))
    .join("\n");
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
  let data: FakeTriviaDataLayer;
  let sdk: FakeSdk;
  let viewsOpen: Mock<(call: ViewsOpenCall) => Promise<ViewsOpenResponse>>;

  /** The action handler the installer registered, read from the mock's history. */
  function registeredHandler(): PluginActionHandler {
    return sdk.registerAction.mock.calls[0][1];
  }

  function openedCall(index: number): ViewsOpenCall {
    return viewsOpen.mock.calls[index][0];
  }

  beforeEach(async () => {
    ({ sdk } = createFakeSdk());
    primeTriviaConfig(sdk);
    ({ dataLayer: data } = createTriviaDataLayer(sdk));
    await data.saveCategories(["Science"]);

    viewsOpen = vi.fn<(call: ViewsOpenCall) => Promise<ViewsOpenResponse>>(async () => ({
      ok: true,
    }));
    // The installer types getSlackClient against its own narrow views.open subset,
    // so the test threads the canonical sdk's members plus a mock client through it.
    installHintButtonHandler(
      {
        registerAction: sdk.registerAction,
        t: sdk.t,
        getSlackClient: () => ({ views: { open: viewsOpen } }),
      },
      { data, getGameNames: () => [FIXTURE_GAME_NAME] },
    );
  });

  it("acknowledges before doing async work", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ hint: { mode: "button", text: "A primary color." } }));
    const result = await invokeAction(registeredHandler(), {
      questionId: "QH1",
      userId: "U1",
    });
    assert.equal(result.ackCalled, true);
  });

  it("first click opens a modal and adds user to clickedBy", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ hint: { mode: "button", text: "A primary color." } }));
    await invokeAction(registeredHandler(), { questionId: "QH1", userId: "U1" });
    assert.equal(viewsOpen.mock.calls.length, 1);
    const call = openedCall(0);
    assert.equal(call.trigger_id, "trig.123");
    assert.equal(call.view.type, "modal");
    assert.match(modalText(call.view), /A primary color/);
    const updated = (await scoped.loadQuestions()).find((q) => q.id === "QH1");
    assert.deepEqual(updated?.hint?.clickedBy, ["U1"]);
  });

  it("repeat click from same user opens fresh modal, clickedBy unchanged", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ hint: { mode: "button", text: "A primary color.", clickedBy: ["U1"] } }),
    );
    await invokeAction(registeredHandler(), { questionId: "QH1", userId: "U1" });
    assert.equal(viewsOpen.mock.calls.length, 1);
    const updated = (await scoped.loadQuestions()).find((q) => q.id === "QH1");
    assert.deepEqual(updated?.hint?.clickedBy, ["U1"]);
  });

  it("click from different user appends to clickedBy", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ hint: { mode: "button", text: "A primary color.", clickedBy: ["U1"] } }),
    );
    await invokeAction(registeredHandler(), { questionId: "QH1", userId: "U2" });
    const updated = (await scoped.loadQuestions()).find((q) => q.id === "QH1");
    assert.deepEqual(updated?.hint?.clickedBy?.sort(), ["U1", "U2"]);
  });

  it("missing-hint fallback opens a no-hint modal and skips clickedBy update", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({}));
    await invokeAction(registeredHandler(), { questionId: "QH1", userId: "U1" });
    assert.equal(viewsOpen.mock.calls.length, 1);
    assert.match(modalText(openedCall(0).view), /hint\.missing/);
    const updated = (await scoped.loadQuestions()).find((q) => q.id === "QH1");
    assert.equal(updated?.hint, undefined);
  });

  it("question text precedes hint label in the modal body", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ hint: { mode: "button", text: "A primary color." } }));
    await invokeAction(registeredHandler(), { questionId: "QH1", userId: "U1" });
    const lines = modalText(openedCall(0).view).split("\n");
    assert.match(lines[0], /Water boils/);
    assert.match(lines[lines.length - 1], /A primary color/);
  });

  it("missing trigger_id — warns and returns without opening a modal", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ hint: { mode: "button", text: "A primary color." } }));
    const result = await invokeAction(registeredHandler(), {
      questionId: "QH1",
      userId: "U1",
      triggerId: null,
    });
    assert.equal(result.ackCalled, true);
    assert.equal(viewsOpen.mock.calls.length, 0);
    const updated = (await scoped.loadQuestions()).find((q) => q.id === "QH1");
    assert.deepEqual(updated?.hint?.clickedBy, undefined);
  });
});
