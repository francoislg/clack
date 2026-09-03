import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createFakeSdk,
  createFakeRevealSlackDeps,
  primeTriviaConfig,
} from "../testHelpers.fakeSdk.js";
import { createTriviaDataLayer, type FakeTriviaDataLayer } from "../testHelpers.js";
import { createGetIdeasTool } from "./questions/getIdeas.js";
import { createSaveQuestionTool } from "./questions/saveQuestion.js";
import { createExplainCascadeTool } from "./games/explainCascade.js";
import { createComputeAnswersTool } from "./reveal/computeAnswers.js";
import { parseToolResult } from "../../../plugins-sdk/testHelpers.js";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";

const SESSION = { sessionId: "test" };
const DAY_MS = 86_400_000;

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
    points: undefined,
    slot: undefined,
    hint: undefined,
    promptMedium: undefined,
    media: undefined,
    emojis: ["💧"],
    choiceEmojis: undefined,
    ...overrides,
  };
}

describe("cascade parity — explain_cascade ≡ get_ideas ≡ save_question (game format, no season)", () => {
  let data: FakeTriviaDataLayer;
  let sdk: ReturnType<typeof createFakeSdk>["sdk"];
  let testHelpers: ReturnType<typeof createFakeSdk>["testHelpers"];

  beforeEach(async () => {
    ({ sdk, testHelpers } = createFakeSdk());
    primeTriviaConfig(sdk);
    ({ dataLayer: data } = createTriviaDataLayer(sdk));
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
    testHelpers.saveUser({ userId: "U1", displayName: "Alice" });
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 500,
    });

    const reveal = createComputeAnswersTool(
      data,
      sdk,
      getGames,
      createFakeRevealSlackDeps(),
      getConfig,
    );
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

// A single-slot game with an ACTIVE season phase that owns `answersFormat`. Neither
// the game slot, season, nor workspace sets it, so the phase WINS the cascade — the
// resolution surfaces `tier: "seasonPhase"`, and all three consumers must agree.
const PHASED_GAME: TriviaGame = {
  name: "phased",
  channel: "C1",
  questionCron: "0 9 * * *",
  revealCron: "0 17 * * *",
  timezone: "UTC",
  enabled: true,
  format: { questions: [{}] },
};

const PHASED_CONFIG: TriviaConfig = { seasons: { enabled: true, prompt: "Escalating" } };
const getPhasedConfig = (): TriviaConfig => PHASED_CONFIG;
const getPhasedGames = (): TriviaGame[] => [PHASED_GAME];

describe("cascade parity — explain_cascade ≡ get_ideas ≡ save_question (active phase)", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const created = createFakeSdk();
    primeTriviaConfig(created.sdk, PHASED_CONFIG);
    ({ dataLayer: data } = createTriviaDataLayer(created.sdk));
    await data.saveCategories(["Science", "History"]);
    // A season whose single (final) phase is live right now — its derived window
    // spans the whole season, so `{ at: Date.now() }` always lands inside it.
    await data.forGame("phased").saveSeasonsState({
      seasons: [
        {
          slug: "escalating",
          startedAt: 0,
          expectedEndAt: Date.now() + 365 * DAY_MS,
          phases: [{ slug: "gauntlet", answersFormat: { boolean: 0, choice: 1, freeform: 0 } }],
        },
      ],
    });
  });

  it("all three resolve the phase's answersFormat identically, at tier seasonPhase", async () => {
    const explain = createExplainCascadeTool(data, getPhasedConfig, getPhasedGames);
    const getIdeas = createGetIdeasTool(data, getPhasedConfig, getPhasedGames);
    const save = createSaveQuestionTool(data, getPhasedConfig, getPhasedGames);

    // 1. explain_cascade: the phase is live and answersFormat resolves to the
    //    phase's choice-only weights AT the seasonPhase tier.
    const audit = parseToolResult(
      await explain.handler({ game: "phased", slot: 0, answersFormat: undefined }, SESSION),
    );
    assert.equal(audit.activePhase.slug, "gauntlet");
    const coord = audit.coordinates.find((c: { slot: number }) => c.slot === 0);
    // answersFormat is the axis the phase wins — value AND tier — so at least one
    // axis at this coordinate reports the seasonPhase tier (the whole point).
    assert.deepEqual(coord.axes.answersFormat.value, { boolean: 0, choice: 1, freeform: 0 });
    assert.equal(coord.axes.answersFormat.tier, "seasonPhase");

    // 2. get_ideas rolls the same weights the audit reported — choice-only means
    //    the suggested format is deterministically "choice".
    const ideas = parseToolResult(await getIdeas.handler({ game: "phased", slot: 0 }, SESSION));
    assert.equal(ideas.suggestedAnswersFormat, "choice");

    // 3. save_question enforces the same resolution: it rejects "boolean" (zero
    //    weight under the phase) and accepts "choice", stamping the live phase.
    const rejected = parseToolResult(
      await save.handler(
        makeSaveArgs({
          game: "phased",
          slot: { index: 0 },
          answersFormat: "boolean",
          statement: "The sky is blue today.",
          isTrue: true,
        }),
        SESSION,
      ),
    );
    assert.match(rejected.error, /does not permit "boolean"/);

    const accepted = parseToolResult(
      await save.handler(
        makeSaveArgs({
          game: "phased",
          slot: { index: 0 },
          answersFormat: "choice",
          questionType: "fact",
          statement: "Which planet is closest to the Sun?",
          isTrue: undefined,
          choices: ["Mercury", "Venus", "Earth", "Mars"],
          correctIndex: 0,
          emojis: ["🪐"],
        }),
        SESSION,
      ),
    );
    assert.equal(accepted.saved, true);
    assert.equal(accepted.question.phase, "gauntlet");
  });
});
