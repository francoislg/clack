import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createGetIdeasTool } from "./getIdeas.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaConfig } from "../../core/configTypes.js";
import type { TriviaQuestion, SeasonEntry } from "../../core/types.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

function makeConfig(triviaSeasonsEnabled: boolean): TriviaConfig {
  return triviaSeasonsEnabled ? { seasons: { enabled: true, prompt: "Test prompt" } } : {};
}

function stampedQuestion(season: string | undefined, idx: number): TriviaQuestion {
  return {
    id: `q-${idx}`,
    category: "Science",
    statement: `Stmt ${idx}`,
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["🧪"],
    createdAt: Date.now(),
    ...(season !== undefined ? { season } : {}),
  };
}

function mockSeasonAndQuestions(args: {
  seasonSlug: string;
  theme?: string;
  questionCount: number;
  questionSeason: string | undefined;
}): { seasons: SeasonEntry[]; questions: TriviaQuestion[] } {
  const future = Date.now() - 1 * DAY;
  const questions = Array.from({ length: args.questionCount }, (_, i) =>
    stampedQuestion(args.questionSeason, i),
  );
  return {
    seasons: [
      {
        slug: args.seasonSlug,
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        categories: ["Science", "History"],
        ...(args.theme !== undefined ? { theme: args.theme } : {}),
      },
    ],
    questions,
  };
}

describe("get_ideas — firstFireOfSeason + theme", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: createdData } = createTriviaDataLayer(sdk);
    data = createdData;
    data.loadCategories.mockResolvedValue(["Science", "History", "Geography"]);
  });

  it("firstFireOfSeason: true when zero saved questions carry the current season slug", async () => {
    const mocked = mockSeasonAndQuestions({
      seasonSlug: "season-2026-06",
      questionCount: 0,
      questionSeason: undefined,
    });
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: mocked.seasons,
    });
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue(mocked.questions);
    const tool = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.firstFireOfSeason, true);
  });

  it("firstFireOfSeason flips to false after one question is stamped with the current slug", async () => {
    const mocked = mockSeasonAndQuestions({
      seasonSlug: "season-2026-06",
      questionCount: 1,
      questionSeason: "season-2026-06",
    });
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: mocked.seasons,
    });
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue(mocked.questions);
    const tool = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.firstFireOfSeason, false);
  });

  it("firstFireOfSeason: false when only PRIOR-season questions exist (current slug has zero)", async () => {
    // Questions stamped with a DIFFERENT season slug — should still trigger firstFireOfSeason
    // because the CURRENT slug has zero matching.
    const mocked = mockSeasonAndQuestions({
      seasonSlug: "season-2026-06",
      questionCount: 5,
      questionSeason: "season-2026-05",
    });
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: mocked.seasons,
    });
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue(mocked.questions);
    const tool = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.firstFireOfSeason, true);
  });

  it("firstFireOfSeason: false during a gap (no current season)", async () => {
    const past = Date.now() - 60 * DAY;
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        {
          slug: "season-2026-04",
          startedAt: past,
          expectedEndAt: past + 30 * DAY,
          endedAt: past + 30 * DAY,
          categories: ["Science"],
        },
      ],
    });
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([]);
    const tool = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.firstFireOfSeason, false);
    assert.equal(parsed.theme, undefined);
    assert.ok(!Object.prototype.hasOwnProperty.call(parsed, "theme"));
  });

  it("firstFireOfSeason: false when seasons are disabled", async () => {
    // Seasons disabled — no current season at all. Don't seed seasons.json.
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue(null);
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([]);
    const tool = createGetIdeasTool(data, () => makeConfig(false), fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.firstFireOfSeason, false);
    assert.equal(parsed.theme, undefined);
  });

  it("theme is mirrored verbatim when set on the current season", async () => {
    const mocked = mockSeasonAndQuestions({
      seasonSlug: "season-2026-10",
      theme: "Halloween Spooktacular",
      questionCount: 0,
      questionSeason: undefined,
    });
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: mocked.seasons,
    });
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue(mocked.questions);
    const tool = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.theme, "Halloween Spooktacular");
  });

  it("theme key is OMITTED (not null, not empty) when the current season has no theme", async () => {
    const mocked = mockSeasonAndQuestions({
      seasonSlug: "season-2026-06",
      questionCount: 0,
      questionSeason: undefined,
    });
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: mocked.seasons,
    });
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue(mocked.questions);
    const tool = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.theme, undefined);
    assert.ok(!Object.prototype.hasOwnProperty.call(parsed, "theme"));
  });
});

describe("get_ideas — firstFireOfSeason after a stamped question is saved", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: createdData } = createTriviaDataLayer(sdk);
    data = createdData;
    data.loadCategories.mockResolvedValue(["Science", "History", "Geography"]);
  });

  it("firstFireOfSeason flips false after a question is stamped with the current slug", async () => {
    const past = Date.now() - 1 * DAY;
    const seasonsMock = {
      seasons: [
        {
          slug: "fresh-2026",
          startedAt: past,
          expectedEndAt: past + 60 * DAY,
          categories: ["Science"],
        },
      ],
    };
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue(seasonsMock);
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([]);

    const ideas = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);

    // First call — zero questions exist
    const before = parseToolResult(
      await ideas.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(before.firstFireOfSeason, true);

    // Simulate save_question stamping a question with the current season
    const newQuestion = stampedQuestion("fresh-2026", 0);
    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([newQuestion]);

    // Second call — one question exists for this slug
    const after = parseToolResult(
      await ideas.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(after.firstFireOfSeason, false);
  });
});
