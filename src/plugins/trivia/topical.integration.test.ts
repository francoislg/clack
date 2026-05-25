import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "./testHelpers.js";
import { createGetIdeasTool } from "./tools/questions/getIdeas.js";
import { createSaveQuestionTool } from "./tools/questions/saveQuestion.js";
import { parseToolResult } from "../../tools/testHelpers.js";
import type { TriviaConfig } from "./core/configTypes.js";
import type { TriviaDataLayer } from "./core/types.js";

const SESSION = { sessionId: "test" };

function makeConfig(trivia?: TriviaConfig): TriviaConfig {
  return trivia ?? {};
}

describe("topical-question end-to-end flow", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Music", "Politics", "Tech"]);
  });

  it("get_ideas with topical-only weights rolls suggestedQuestionType='topical' every time", async () => {
    const cfg = makeConfig({
      questionType: { fact: 0, topical: 1 },
    });
    const getIdeas = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    for (let i = 0; i < 20; i++) {
      const r = parseToolResult(
        await getIdeas.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
      );
      assert.equal(r.suggestedQuestionType, "topical");
    }
  });

  it("get_ideas with contexts configured returns a permutation in contextPriority", async () => {
    const cfg = makeConfig({
      contexts: [{ name: "Quebec", weight: 5 }, { name: "International", weight: 1 }, { name: "" }],
    });
    const getIdeas = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    const r = parseToolResult(
      await getIdeas.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.ok(Array.isArray(r.contextPriority), "contextPriority should be returned");
    assert.equal(r.contextPriority.length, 3);
    assert.deepEqual([...r.contextPriority].sort(), ["", "International", "Quebec"]);
  });

  it("get_ideas without contexts configured omits contextPriority", async () => {
    const cfg = makeConfig({});
    const getIdeas = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    const r = parseToolResult(
      await getIdeas.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(r.contextPriority, undefined);
  });

  it("save_question stores topical fields end-to-end", async () => {
    const cfg = makeConfig({
      questionType: { fact: 0, topical: 1 },
      contexts: [{ name: "Quebec" }],
    });
    const saveQuestion = createSaveQuestionTool(data, () => cfg, fixtureGetGames);
    const saved = parseToolResult(
      await saveQuestion.handler(
        {
          game: FIXTURE_GAME_NAME,
          answersFormat: "boolean",
          questionType: "topical",
          category: "Music",
          statement: "Drake released a surprise album on Tuesday.",
          isTrue: true,
          sourceUrl: "https://example.com/news/drake-album",
          eventDate: "2026-05-19",
          context: "Quebec",
          choices: undefined,
          correctIndex: undefined,
          expectedAnswer: undefined,
          acceptableAnswers: undefined,
          gradingNotes: undefined,
          suggestedDifficulty: "Medium",
          difficulty: 7,
          slot: undefined,
          emojis: ["🎤"],
        },
        SESSION,
      ),
    );
    assert.equal(saved.saved, true);
    assert.equal(saved.question.questionType, "topical");
    assert.equal(saved.question.answersFormat, "boolean");
    assert.equal(saved.question.sourceUrl, "https://example.com/news/drake-album");
    assert.equal(saved.question.eventDate, "2026-05-19");
    assert.equal(saved.question.context, "Quebec");
  });

  it("save_question rejects topical question with no sourceUrl", async () => {
    const cfg = makeConfig({});
    const saveQuestion = createSaveQuestionTool(data, () => cfg, fixtureGetGames);
    const r = parseToolResult(
      await saveQuestion.handler(
        {
          game: FIXTURE_GAME_NAME,
          answersFormat: "boolean",
          questionType: "topical",
          category: "Music",
          statement: "A recent newsworthy thing happened.",
          isTrue: true,
          sourceUrl: undefined,
          eventDate: undefined,
          context: undefined,
          choices: undefined,
          correctIndex: undefined,
          expectedAnswer: undefined,
          acceptableAnswers: undefined,
          gradingNotes: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["📰"],
        },
        SESSION,
      ),
    );
    assert.match(r.error, /sourceUrl/i);
  });

  it("save_question rejects fact question that includes sourceUrl", async () => {
    const cfg = makeConfig({});
    const saveQuestion = createSaveQuestionTool(data, () => cfg, fixtureGetGames);
    const r = parseToolResult(
      await saveQuestion.handler(
        {
          game: FIXTURE_GAME_NAME,
          answersFormat: "boolean",
          questionType: "fact",
          category: "Music",
          statement: "The Beatles came from Liverpool.",
          isTrue: true,
          sourceUrl: "https://en.wikipedia.org/wiki/The_Beatles",
          eventDate: undefined,
          context: undefined,
          choices: undefined,
          correctIndex: undefined,
          expectedAnswer: undefined,
          acceptableAnswers: undefined,
          gradingNotes: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🎶"],
        },
        SESSION,
      ),
    );
    assert.match(r.error, /only permitted on topical/i);
  });

  it("save_question rejects context value not in configured contexts list", async () => {
    const cfg = makeConfig({
      contexts: [{ name: "Quebec" }],
    });
    const saveQuestion = createSaveQuestionTool(data, () => cfg, fixtureGetGames);
    const r = parseToolResult(
      await saveQuestion.handler(
        {
          game: FIXTURE_GAME_NAME,
          answersFormat: "boolean",
          questionType: "fact",
          category: "Music",
          statement: "A perfectly normal fact about music.",
          isTrue: true,
          sourceUrl: undefined,
          eventDate: undefined,
          context: "International",
          choices: undefined,
          correctIndex: undefined,
          expectedAnswer: undefined,
          acceptableAnswers: undefined,
          gradingNotes: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🎵"],
        },
        SESSION,
      ),
    );
    assert.match(r.error, /not in the active contexts list/i);
  });
});
