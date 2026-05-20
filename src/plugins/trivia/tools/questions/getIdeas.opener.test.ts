import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createGetIdeasTool } from "./getIdeas.js";
import { createUpsertSeasonTool } from "../seasons/upsertSeason.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { Config } from "../../../../config.js";
import type { TriviaDataLayer, TriviaQuestion } from "../../core/types.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

function makeConfig(triviaSeasonsEnabled: boolean): Config {
  return {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      signingSecret: "secret",
      fetchAndStoreUsername: false,
      sendErrorsAsDM: false,
    },
    reactions: { trigger: "robot_face" },
    directMessages: { enabled: false },
    mentions: { enabled: false },
    repositories: [],
    git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
    sessions: { cleanupIntervalMinutes: 60 },
    claudeCode: { model: "sonnet" },
    trivia: triviaSeasonsEnabled ? { seasons: { enabled: true, prompt: "Test prompt" } } : {},
  };
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

async function seedSeasonAndQuestions(
  data: TriviaDataLayer,
  args: {
    seasonSlug: string;
    theme?: string;
    questionCount: number;
    questionSeason: string | undefined;
  },
): Promise<void> {
  const future = Date.now() - 1 * DAY;
  await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({
    seasons: [
      {
        slug: args.seasonSlug,
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        categories: ["Science", "History"],
        ...(args.theme !== undefined ? { theme: args.theme } : {}),
      },
    ],
  });
  for (let i = 0; i < args.questionCount; i++) {
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion(stampedQuestion(args.questionSeason, i));
  }
}

describe("get_ideas — firstFireOfSeason + theme", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History", "Geography"]);
  });

  it("firstFireOfSeason: true when zero saved questions carry the current season slug", async () => {
    await seedSeasonAndQuestions(data, {
      seasonSlug: "season-2026-06",
      questionCount: 0,
      questionSeason: undefined,
    });
    const tool = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.firstFireOfSeason, true);
  });

  it("firstFireOfSeason flips to false after one question is stamped with the current slug", async () => {
    await seedSeasonAndQuestions(data, {
      seasonSlug: "season-2026-06",
      questionCount: 1,
      questionSeason: "season-2026-06",
    });
    const tool = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.firstFireOfSeason, false);
  });

  it("firstFireOfSeason: false when only PRIOR-season questions exist (current slug has zero)", async () => {
    // Questions stamped with a DIFFERENT season slug — should still trigger firstFireOfSeason
    // because the CURRENT slug has zero matching.
    await seedSeasonAndQuestions(data, {
      seasonSlug: "season-2026-06",
      questionCount: 5,
      questionSeason: "season-2026-05",
    });
    const tool = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.firstFireOfSeason, true);
  });

  it("firstFireOfSeason: false during a gap (no current season)", async () => {
    const past = Date.now() - 60 * DAY;
    await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({
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
    const tool = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.firstFireOfSeason, false);
    assert.equal(parsed.theme, undefined);
    assert.ok(!Object.prototype.hasOwnProperty.call(parsed, "theme"));
  });

  it("firstFireOfSeason: false when seasons are disabled", async () => {
    // Seasons disabled — no current season at all. Don't seed seasons.json.
    const tool = createGetIdeasTool(data, () => makeConfig(false), fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.firstFireOfSeason, false);
    assert.equal(parsed.theme, undefined);
  });

  it("theme is mirrored verbatim when set on the current season", async () => {
    await seedSeasonAndQuestions(data, {
      seasonSlug: "season-2026-10",
      theme: "Halloween Spooktacular",
      questionCount: 0,
      questionSeason: undefined,
    });
    const tool = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.theme, "Halloween Spooktacular");
  });

  it("theme key is OMITTED (not null, not empty) when the current season has no theme", async () => {
    await seedSeasonAndQuestions(data, {
      seasonSlug: "season-2026-06",
      questionCount: 0,
      questionSeason: undefined,
    });
    const tool = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.theme, undefined);
    assert.ok(!Object.prototype.hasOwnProperty.call(parsed, "theme"));
  });
});

describe("get_ideas — integration with upsert_season theme", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History", "Geography"]);
  });

  it("theme set via upsert_season surfaces on the next get_ideas call", async () => {
    const past = Date.now() - 1 * DAY;
    // Seed an active season (cannot create via upsert_season because startedAt is in the past
    // when starting fresh; use direct seeding for the active season).
    await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({
      seasons: [
        {
          slug: "active-2026",
          startedAt: past,
          expectedEndAt: past + 60 * DAY,
          categories: ["Science", "History"],
        },
      ],
    });

    // Add a theme via upsert_season (UPDATE)
    const upsert = createUpsertSeasonTool(data, fixtureGetGames);
    const upsertRes = parseToolResult(
      await upsert.handler(
        {
          game: FIXTURE_GAME_NAME,
          slug: "active-2026",
          startedAt: undefined,
          expectedEndAt: undefined,
          endedAt: undefined,
          categories: undefined,
          theme: "Halloween Spooktacular",
          answersFormat: undefined,
          questionType: undefined,
          contexts: undefined,
          format: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(upsertRes.action, "updated");
    assert.equal(upsertRes.hasTheme, true);

    const ideas = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);
    const result = await ideas.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.theme, "Halloween Spooktacular");
    assert.equal(parsed.firstFireOfSeason, true);
  });

  it("smoke: firstFireOfSeason flips false after save_question writes a stamped question", async () => {
    const past = Date.now() - 1 * DAY;
    await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({
      seasons: [
        {
          slug: "fresh-2026",
          startedAt: past,
          expectedEndAt: past + 60 * DAY,
          categories: ["Science"],
        },
      ],
    });

    const ideas = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);

    // First call — zero questions exist
    const before = parseToolResult(
      await ideas.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(before.firstFireOfSeason, true);

    // Simulate save_question stamping a question with the current season
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion(stampedQuestion("fresh-2026", 0));

    // Second call — one question exists for this slug
    const after = parseToolResult(
      await ideas.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(after.firstFireOfSeason, false);
  });
});
