import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer } from "../testHelpers.js";
import { createGetIdeasTool } from "./questions/getIdeas.js";
import { createSaveQuestionTool } from "./questions/saveQuestion.js";
import { createExplainCascadeTool } from "./games/explainCascade.js";
import { createComputeAnswersTool, type RevealSlackDeps } from "./reveal/computeAnswers.js";
import { parseToolResult } from "../../../tools/testHelpers.js";
import type { ClackSdk } from "../../sdk.js";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import type { TriviaDataLayer } from "../core/types.js";

const SESSION = { sessionId: "test" };

function fakeSdk(): Pick<ClackSdk, "getSlackClient" | "askClaude" | "actionId"> {
  return {
    getSlackClient: () => null,
    askClaude: async () => ({
      text: "",
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
    actionId: (key: string) => `plugin:trivia:${key}`,
  };
}

function fakeSlackDeps(): RevealSlackDeps {
  return {
    isAvailable: () => null,
    fetchBotUserId: async () => "UBOT",
    fetchMessageReactions: async () => [],
    fetchUserDisplayName: async () => null,
    updateMessage: async () => {},
  };
}

// A game that owns its question composition via `format`, with one-hot per-slot axis
// weights so generation rolls are deterministic. NO season is active (seasons disabled),
// so the game-format slots are the only per-question tier.
const GAME: TriviaGame = {
  name: "parity",
  channel: "C1",
  questionCron: "0 9 * * *",
  revealCron: "0 17 * * *",
  timezone: "UTC",
  enabled: true,
  format: {
    questions: [
      {
        answersFormat: { boolean: 0, choice: 1, freeform: 0 },
        questionType: { fact: 0, topical: 1, prediction: 0 },
        promptMedium: { text: 0, image: 1 },
        instructions: "slot-0 instructions",
        additionalInstructions: "slot-0 add",
      },
      {
        answersFormat: { boolean: 0, choice: 0, freeform: 1 },
        freeformAnswerShape: {
          name: 0,
          place: 1,
          phrase: 0,
          title: 0,
          date: 0,
          countable: 0,
          other: 0,
        },
      },
    ],
  },
};

const CONFIG: TriviaConfig = {};
const getConfig = (): TriviaConfig => CONFIG;
const getGames = (): TriviaGame[] => [GAME];

type SaveArgs = Parameters<ReturnType<typeof createSaveQuestionTool>["handler"]>[0];

function makeSaveArgs(overrides: Partial<SaveArgs>): SaveArgs {
  return {
    game: "parity",
    answersFormat: "boolean",
    questionType: "fact",
    category: "Science",
    statement: "A statement.",
    isTrue: true,
    sourceUrl: undefined,
    eventDate: undefined,
    context: undefined,
    expectedAnswer: undefined,
    acceptableAnswers: undefined,
    gradingNotes: undefined,
    freeformAnswerShape: undefined,
    choices: undefined,
    correctIndex: undefined,
    suggestedDifficulty: undefined,
    difficulty: undefined,
    slot: undefined,
    hint: undefined,
    promptMedium: undefined,
    media: undefined,
    emojis: ["💧"],
    ...overrides,
  };
}

describe("cascade parity — explain_cascade ≡ get_ideas ≡ save_question (game format, no season)", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History"]);
  });

  it("8.1a generation: get_ideas rolls the game-slot weights explain_cascade reports", async () => {
    const getIdeas = createGetIdeasTool(data, getConfig, getGames);
    const explain = createExplainCascadeTool(data, getConfig, getGames);

    const ideas0 = parseToolResult(await getIdeas.handler({ game: "parity", slot: 0 }, SESSION));
    assert.equal(ideas0.suggestedAnswersFormat, "choice");
    assert.equal(ideas0.suggestedQuestionType, "topical");
    assert.equal(ideas0.suggestedPromptMedium, "image");

    const ideas1 = parseToolResult(await getIdeas.handler({ game: "parity", slot: 1 }, SESSION));
    assert.equal(ideas1.suggestedAnswersFormat, "freeform");
    assert.equal(ideas1.suggestedFreeformAnswerShape, "place");

    const audit = parseToolResult(
      await explain.handler({ game: "parity", slot: undefined, answersFormat: undefined }, SESSION),
    );
    const slot0 = audit.coordinates.find((c: { slot: number }) => c.slot === 0);
    const slot1 = audit.coordinates.find((c: { slot: number }) => c.slot === 1);
    assert.deepEqual(slot0.axes.answersFormat.value, { boolean: 0, choice: 1, freeform: 0 });
    assert.equal(slot0.axes.answersFormat.tier, "gameSlot");
    assert.deepEqual(slot0.axes.promptMedium.value, { text: 0, image: 1 });
    assert.equal(slot1.axes.freeformAnswerShape.value.place, 1);
  });

  it("8.1b validation: save_question honors the game-slot answersFormat weights", async () => {
    const save = createSaveQuestionTool(data, getConfig, getGames);

    const rejected = parseToolResult(
      await save.handler(
        makeSaveArgs({
          slot: { index: 0 },
          answersFormat: "boolean",
          statement: "The sky is blue.",
          isTrue: true,
        }),
        SESSION,
      ),
    );
    assert.match(rejected.error, /does not permit "boolean"/);

    const accepted = parseToolResult(
      await save.handler(
        makeSaveArgs({
          slot: { index: 0 },
          answersFormat: "choice",
          questionType: "topical",
          statement: "Which is a planet?",
          isTrue: undefined,
          choices: ["Mars", "Pluto-ish", "Moon", "Sun"],
          correctIndex: 0,
          sourceUrl: "https://example.com/space",
          emojis: ["🪐"],
        }),
        SESSION,
      ),
    );
    assert.equal(accepted.saved, true);
  });

  it("8.1c reveal: process_reveal_answers resolves the game-slot instruction axes", async () => {
    const scoped = data.forGame("parity");
    await scoped.saveQuestion({
      id: "q1",
      category: "Science",
      statement: "stmt",
      answersFormat: "boolean",
      questionType: "fact",
      isTrue: true,
      emojis: ["🎯"],
      createdAt: 0,
      postedAt: 1_000,
      messageLink: "https://x.slack.com/archives/C100000000/p1700000000000000",
      revealResponses: "yes",
      slot: { index: 0 },
    });
    await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 0 });
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 500,
    });

    const reveal = createComputeAnswersTool(data, fakeSdk(), getGames, fakeSlackDeps(), getConfig);
    const res = parseToolResult(
      await reveal.handler(
        {
          game: "parity",
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(res.instructions, "slot-0 instructions");
    assert.equal(res.additionalInstructions, "[Game Slot 0] slot-0 add");
  });
});
