import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "./testHelpers.js";
import { createUpsertSeasonTool } from "./tools/seasons/upsertSeason.js";
import { createGetIdeasTool } from "./tools/questions/getIdeas.js";
import { createSaveQuestionTool } from "./tools/questions/saveQuestion.js";
import {
  createPostQuestionsTool,
  type PostQuestionsSlackDeps,
} from "./tools/questions/postQuestions.js";
import { parseToolResult } from "../../tools/testHelpers.js";
import type { TriviaConfig } from "./core/configTypes.js";
import type { TriviaDataLayer } from "./core/types.js";
import type { ClackSdk } from "../sdk.js";
import { applySeasonRollover } from "./tools/reveal/rollover.js";

function fakeSdk(): Pick<ClackSdk, "getSlackClient" | "actionId" | "t"> {
  return {
    getSlackClient: () => null,
    actionId: (key: string) => `plugin:trivia:${key}`,
    t: (key: string) => key,
  };
}

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

function makeConfig(trivia?: TriviaConfig): TriviaConfig {
  return trivia ?? {};
}

function postQuestionsDeps(): PostQuestionsSlackDeps {
  let counter = 0;
  return {
    isAvailable() {
      return null;
    },
    async postBlocks(args) {
      counter++;
      const ts = `170000000${counter}.000000`;
      return {
        ts,
        permalink: `https://test.slack.com/archives/${args.channel}/p170000000${counter}000000`,
      };
    },
  };
}

const SEASONS_ON = makeConfig({
  seasons: { enabled: true, prompt: "Monthly" },
  answersFormat: { boolean: 1, choice: 0, freeform: 0 },
});

describe("Trivia question-format end-to-end flow", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History", "Geography", "Sports"]);
  });

  it("upsert_season(format) → get_ideas-per-slot → save_question(slot) → post_questions(N items)", async () => {
    // 1. Admin sets up a 2-slot format on the active season
    const now = Date.now();
    await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({
      seasons: [
        {
          slug: "active",
          startedAt: now - 10 * DAY,
          expectedEndAt: now + 20 * DAY,
          categories: ["Science", "History", "Geography", "Sports"],
        },
      ],
    });

    const upsert = createUpsertSeasonTool(data, fixtureGetGames);
    const upsertRes = parseToolResult(
      await upsert.handler(
        {
          game: FIXTURE_GAME_NAME,
          slug: "active",
          startedAt: undefined,
          expectedEndAt: undefined,
          endedAt: undefined,
          categories: undefined,
          answersFormat: undefined,
          questionType: undefined,
          promptMedium: undefined,
          freeformAnswerShape: undefined,
          contexts: undefined,
          difficulty: undefined,
          difficultyRatio: undefined,
          theme: undefined,
          format: {
            questions: [
              { label: "GK Boolean" },
              { label: "History Choice", categories: ["History"] },
            ],
          },
          liveAnswersVisible: undefined,
          revealResponses: undefined,
          instructions: undefined,
          additionalInstructions: undefined,
          hint: undefined,
          judgeLeniency: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(upsertRes.action, "updated");
    assert.equal(upsertRes.hasFormat, true);
    assert.equal(upsertRes.slotCount, 2);

    // 2. get_ideas(slot: 0) — sees format meta and slot 0's pool (= season's pool)
    const getIdeas = createGetIdeasTool(data, () => SEASONS_ON, fixtureGetGames);
    const slot0 = parseToolResult(
      await getIdeas.handler({ game: FIXTURE_GAME_NAME, slot: 0 }, SESSION),
    );
    assert.equal(slot0.format.slotCount, 2);
    assert.equal(slot0.format.slots[0].label, "GK Boolean");
    assert.equal(slot0.slot, 0);
    assert.equal(slot0.suggestedAnswersFormat, "boolean");
    assert.equal(slot0.categories.total, 4);

    // 3. save_question for slot 0 with a Science boolean
    const saveQuestion = createSaveQuestionTool(data, () => SEASONS_ON, fixtureGetGames);
    const save0 = parseToolResult(
      await saveQuestion.handler(
        {
          game: FIXTURE_GAME_NAME,
          answersFormat: "boolean",
          questionType: "fact",
          promptMedium: undefined,
          media: undefined,
          sourceUrl: undefined,
          eventDate: undefined,
          context: undefined,
          expectedAnswer: undefined,
          acceptableAnswers: undefined,
          gradingNotes: undefined,
          freeformAnswerShape: undefined,
          category: "Science",
          statement: "Water freezes at zero Celsius at sea level.",
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: { index: 0, label: undefined },
          hint: undefined,
          emojis: ["💧"],
        },
        SESSION,
      ),
    );
    assert.equal(save0.saved, true);
    assert.equal(save0.question.slot.index, 0);
    assert.equal(save0.question.slot.label, "GK Boolean");

    // 4. get_ideas(slot: 1) — narrows to slot 1's pool ["History"]
    const slot1 = parseToolResult(
      await getIdeas.handler({ game: FIXTURE_GAME_NAME, slot: 1 }, SESSION),
    );
    assert.equal(slot1.slot, 1);
    assert.equal(slot1.categories.total, 1);
    assert.deepEqual(slot1.categories.ideas, ["History"]);

    // 5. save_question for slot 1 — wrong-pool category is rejected
    const wrongCat = parseToolResult(
      await saveQuestion.handler(
        {
          game: FIXTURE_GAME_NAME,
          answersFormat: "boolean",
          questionType: "fact",
          promptMedium: undefined,
          media: undefined,
          sourceUrl: undefined,
          eventDate: undefined,
          context: undefined,
          expectedAnswer: undefined,
          acceptableAnswers: undefined,
          gradingNotes: undefined,
          freeformAnswerShape: undefined,
          category: "Sports", // not in slot 1's narrowed pool
          statement: "Some plausible statement here.",
          isTrue: false,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: { index: 1, label: undefined },
          hint: undefined,
          emojis: ["⚽"],
        },
        SESSION,
      ),
    );
    const wrongCatPayload = JSON.parse(wrongCat.error);
    assert.equal(wrongCatPayload.code, "CATEGORY_NOT_IN_POOL");
    assert.equal(wrongCatPayload.source, "slot");

    // 5b. Correct category for slot 1
    const save1 = parseToolResult(
      await saveQuestion.handler(
        {
          game: FIXTURE_GAME_NAME,
          answersFormat: "boolean",
          questionType: "fact",
          promptMedium: undefined,
          media: undefined,
          sourceUrl: undefined,
          eventDate: undefined,
          context: undefined,
          expectedAnswer: undefined,
          acceptableAnswers: undefined,
          gradingNotes: undefined,
          freeformAnswerShape: undefined,
          category: "History",
          statement: "Napoleon was crowned Emperor in 1804.",
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: { index: 1, label: undefined },
          hint: undefined,
          emojis: ["🗿"],
        },
        SESSION,
      ),
    );
    assert.equal(save1.saved, true);
    assert.equal(save1.question.slot.index, 1);
    assert.equal(save1.question.slot.label, "History Choice");

    // 6. post_questions with both items
    const postQuestions = createPostQuestionsTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      postQuestionsDeps(),
    );
    const postRes = parseToolResult(
      await postQuestions.handler(
        {
          game: FIXTURE_GAME_NAME,
          items: [
            {
              questionId: save0.question.id,
              blocks: [{ type: "section", text: { type: "mrkdwn", text: "Q1" } }],
            },
            {
              questionId: save1.question.id,
              blocks: [{ type: "section", text: { type: "mrkdwn", text: "Q2" } }],
            },
          ],
          appendToPreviousBatch: undefined,
          suppress_unfurls: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(postRes.results.length, 2);
    assert.equal(postRes.results[0].ok, true);
    assert.equal(postRes.results[1].ok, true);

    // 7. Verify both saved question records carry their slot stamps
    const questions = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
    assert.equal(questions.length, 2);
    const byCategory = new Map(questions.map((q) => [q.category, q]));
    assert.equal(byCategory.get("Science")?.slot?.index, 0);
    assert.equal(byCategory.get("Science")?.slot?.label, "GK Boolean");
    assert.equal(byCategory.get("History")?.slot?.index, 1);
    assert.equal(byCategory.get("History")?.slot?.label, "History Choice");

    // Both share the active season tag
    assert.equal(byCategory.get("Science")?.season, "active");
    assert.equal(byCategory.get("History")?.season, "active");
  });

  it("auto-rollover continuation resets season-level categories to cascade but inherits answersFormat and format", async () => {
    const now = Date.UTC(2026, 4, 31, 12, 0, 0, 0); // May 31, 2026 — last day of month
    const state = {
      seasons: [
        {
          slug: "season-2026-05",
          startedAt: now - 30 * DAY,
          expectedEndAt: now + 1,
          categories: ["Marine Biology", "Cephalopods", "Tides"],
          answersFormat: { boolean: 0, choice: 1, freeform: 0 } as const,
          format: {
            questions: [
              { label: "GK", answersFormat: { boolean: 1, choice: 0, freeform: 0 } },
              { label: "History", categories: ["Marine Biology"] },
            ],
          },
        },
      ],
    };

    applySeasonRollover(state, "season-2026-05", now);

    assert.equal(state.seasons.length, 2);
    const continuation = state.seasons[1];
    assert.equal(continuation.slug, "season-2026-06");
    // Season-level categories are NOT carried forward — the themed pool is a
    // one-month deviation, so the continuation omits the field and resolves via
    // the cascade (game -> global) instead of re-baking the theme.
    assert.equal(continuation.categories, undefined);
    // answersFormat inherited (structural)
    assert.deepEqual(continuation.answersFormat, { boolean: 0, choice: 1, freeform: 0 });
    // format inherited (deep-copied), INCLUDING slot-level categories which are
    // structural slot composition, not a theme.
    assert.equal(continuation.format?.questions.length, 2);
    assert.equal(continuation.format?.questions[0].label, "GK");
    assert.deepEqual(continuation.format?.questions[1].categories, ["Marine Biology"]);
  });
});
