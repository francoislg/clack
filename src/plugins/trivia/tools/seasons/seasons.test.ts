import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createUpsertSeasonTool } from "./upsertSeason.js";
import { createDeleteSeasonTool } from "./deleteSeason.js";
import { createListSeasonsTool } from "./listSeasons.js";
import { createCheckSeasonStatusTool } from "./checkSeasonStatus.js";
import type { CronJob } from "../../../../cronJobs.js";
import { createRetrieveScoresTool } from "../answers/retrieveScores.js";
import { createFindPreviousQuestionsTool } from "../questions/findPreviousQuestions.js";
import { createSaveQuestionTool } from "../questions/saveQuestion.js";
import { createAddCategoriesTool } from "../categories/addCategories.js";
import { createRemoveCategoriesTool } from "../categories/removeCategories.js";
import { createGetIdeasTool } from "../questions/getIdeas.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import {
  findCurrentSeason,
  findNextSeason,
  findSeasonBySlug,
  validateNoOverlap,
} from "../../core/seasonTimeline.js";
import {
  PROCESS_REVEAL_INSTRUCTIONS,
  CREATE_SCHEDULES_INSTRUCTIONS,
} from "../../prompts/scheduledPrompts.js";
import { getTriviaCheckInstruction } from "../../prompts/triviaCheckInstruction.js";
import type { TriviaDataLayer, SeasonEntry } from "../../core/types.js";

const SESSION = { sessionId: "test" };

const DAY = 24 * 60 * 60 * 1000;

/** Seed the timeline with the given entries, in order. */
async function seedTimeline(data: TriviaDataLayer, entries: SeasonEntry[]): Promise<void> {
  await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({ seasons: entries });
}

/** Convenience: seed a single "currently active" season. */
async function seedSingleActive(
  data: TriviaDataLayer,
  overrides: Partial<SeasonEntry> = {},
): Promise<SeasonEntry> {
  const now = Date.now();
  const entry: SeasonEntry = {
    slug: "spring-2026",
    startedAt: now - 10 * DAY,
    expectedEndAt: now + 20 * DAY,
    categories: ["Science", "History", "Geography"],
    ...overrides,
  };
  await seedTimeline(data, [entry]);
  return entry;
}

/** Seed a single boolean question stamped to the given season slug. */
async function seedStampedQuestion(data: TriviaDataLayer, seasonSlug: string): Promise<void> {
  await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
    id: `q-${seasonSlug}`,
    category: "Science",
    statement: "Water boils at 100°C at sea level.",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["✅", "❌"],
    createdAt: Date.now(),
    season: seasonSlug,
  });
}

// =============================================================================
// Pure helpers — findCurrentSeason, findNextSeason, validateNoOverlap
// =============================================================================

describe("findCurrentSeason / findNextSeason / validateNoOverlap", () => {
  const a: SeasonEntry = {
    slug: "a",
    startedAt: 1000,
    expectedEndAt: 2000,
    categories: ["x"],
  };
  const b: SeasonEntry = {
    slug: "b",
    startedAt: 2000,
    expectedEndAt: 3000,
    categories: ["y"],
  };
  const c: SeasonEntry = {
    slug: "c",
    startedAt: 4000,
    expectedEndAt: 5000,
    categories: ["z"],
  };

  it("findCurrentSeason returns the season whose window contains now", () => {
    const state = { seasons: [a, b] };
    assert.equal(findCurrentSeason(state, 1500)?.slug, "a");
    assert.equal(findCurrentSeason(state, 2500)?.slug, "b");
  });

  it("findCurrentSeason returns null in a gap (before, between, after)", () => {
    const state = { seasons: [a, c] };
    assert.equal(findCurrentSeason(state, 500), null);
    assert.equal(findCurrentSeason(state, 3500), null);
    assert.equal(findCurrentSeason(state, 6000), null);
  });

  it("findCurrentSeason uses endedAt over expectedEndAt when set (and after endedAt returns null)", () => {
    const ended: SeasonEntry = { ...a, endedAt: 1500 };
    const state = { seasons: [ended] };
    assert.equal(findCurrentSeason(state, 1400)?.slug, "a");
    assert.equal(findCurrentSeason(state, 1500), null);
    assert.equal(findCurrentSeason(state, 1800), null);
  });

  it("findCurrentSeason handles boundary half-open intervals correctly", () => {
    const state = { seasons: [a, b] };
    // a's window is [1000, 2000); 2000 belongs to b.
    assert.equal(findCurrentSeason(state, 1000)?.slug, "a");
    assert.equal(findCurrentSeason(state, 1999)?.slug, "a");
    assert.equal(findCurrentSeason(state, 2000)?.slug, "b");
  });

  it("findCurrentSeason returns null for null state", () => {
    assert.equal(findCurrentSeason(null, 1500), null);
  });

  it("findNextSeason returns the entry with smallest startedAt > now", () => {
    const state = { seasons: [a, b, c] };
    assert.equal(findNextSeason(state, 0)?.slug, "a");
    assert.equal(findNextSeason(state, 1500)?.slug, "b");
    assert.equal(findNextSeason(state, 3500)?.slug, "c");
    assert.equal(findNextSeason(state, 5500), null);
  });

  it("findSeasonBySlug returns the matching entry or null", () => {
    const state = { seasons: [a, b] };
    assert.equal(findSeasonBySlug(state, "a"), a);
    assert.equal(findSeasonBySlug(state, "missing"), null);
    assert.equal(findSeasonBySlug(null, "a"), null);
  });

  it("validateNoOverlap permits back-to-back seasons (touching)", () => {
    const state = { seasons: [a] };
    // b starts exactly when a ends — half-open intervals, no overlap.
    assert.doesNotThrow(() => validateNoOverlap(state, b));
  });

  it("validateNoOverlap rejects overlapping seasons", () => {
    const state = { seasons: [a] };
    const overlapper: SeasonEntry = { ...a, slug: "ovr", startedAt: 1500, expectedEndAt: 2500 };
    assert.throws(() => validateNoOverlap(state, overlapper), /overlap/);
  });

  it("validateNoOverlap excludes self by slug on update", () => {
    const state = { seasons: [a, b] };
    const updatedA: SeasonEntry = { ...a, expectedEndAt: 1800 };
    assert.doesNotThrow(() => validateNoOverlap(state, updatedA, "a"));
  });
});

// =============================================================================
// upsert_season tool
// =============================================================================

describe("upsert_season tool", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History", "Geography"]);
  });

  it("create: appends a new entry to the timeline", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "test-season",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.slug, "test-season");
    assert.equal(parsed.action, "created");

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.equal(state?.seasons.length, 1);
    assert.equal(state?.seasons[0].slug, "test-season");
    assert.deepEqual(state?.seasons[0].categories, ["Science", "History", "Geography"]);
  });

  it("create: provided categories REPLACE baseline (not augment), deduped", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "marine",
        startedAt: Date.now() + 10 * DAY,
        expectedEndAt: Date.now() + 40 * DAY,
        endedAt: undefined,
        categories: ["Cephalopods", "Cephalopods", "Tides"], // duplicate is dropped
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    parseToolResult(result);
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    // Baseline ["Science", "History", "Geography"] is NOT included — only the provided list.
    assert.deepEqual(state?.seasons[0].categories, ["Cephalopods", "Tides"]);
  });

  it("create: omitting categories falls back to baseline (categories.json)", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "default-pool",
        startedAt: Date.now() + 50 * DAY,
        expectedEndAt: Date.now() + 80 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    parseToolResult(result);
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const created = state?.seasons.find((s) => s.slug === "default-pool");
    assert.deepEqual(created?.categories, ["Science", "History", "Geography"]);
  });

  it("create: empty categories array also falls back to baseline", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "empty-cat-arg",
        startedAt: Date.now() + 90 * DAY,
        expectedEndAt: Date.now() + 120 * DAY,
        endedAt: undefined,
        categories: [],
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    parseToolResult(result);
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const created = state?.seasons.find((s) => s.slug === "empty-cat-arg");
    assert.deepEqual(created?.categories, ["Science", "History", "Geography"]);
  });

  it("create: rejects empty resulting pool", async () => {
    const freshData = createInMemoryDataLayer();
    // No categories.json, no themeExtras.
    const tool = createUpsertSeasonTool(freshData);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "empty-season",
        startedAt: Date.now() + DAY,
        expectedEndAt: Date.now() + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.ok(parsed.error || parsed.isError);
  });

  it("create: rejects overlap with existing season", async () => {
    await seedSingleActive(data);
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "overlapper",
        startedAt: Date.now() - DAY, // overlaps the seeded active season
        expectedEndAt: Date.now() + DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.ok(parsed.error || parsed.isError);
  });

  it("create: permits back-to-back season (no overlap)", async () => {
    const seeded = await seedSingleActive(data);
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "next",
        startedAt: seeded.expectedEndAt,
        expectedEndAt: seeded.expectedEndAt + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "created");
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.equal(state?.seasons.length, 2);
  });

  it("update: sets endedAt on existing entry (idempotent rollover marker)", async () => {
    const seeded = await seedSingleActive(data);
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const endedAt = Date.now();
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: seeded.slug,
        startedAt: undefined,
        expectedEndAt: undefined,
        endedAt,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "updated");
    assert.equal(parsed.endedAt, endedAt);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.equal(state?.seasons[0].endedAt, endedAt);
  });

  it("update: rejects mutating startedAt of an already-started season once it has questions", async () => {
    const seeded = await seedSingleActive(data);
    await seedStampedQuestion(data, seeded.slug);
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: seeded.slug,
        startedAt: seeded.startedAt + 2 * DAY, // attempt to shift the past
        expectedEndAt: undefined,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.ok(parsed.error || parsed.isError);
  });

  it("update: permits shifting startedAt of an already-started season when it has no questions yet", async () => {
    const seeded = await seedSingleActive(data);
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const newStartedAt = seeded.startedAt + 2 * DAY;
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: seeded.slug,
        startedAt: newStartedAt,
        expectedEndAt: undefined,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "updated");
    assert.equal(parsed.startedAt, newStartedAt);
  });

  it("update: permits shifting startedAt of a not-yet-started season", async () => {
    const now = Date.now();
    const future: SeasonEntry = {
      slug: "future",
      startedAt: now + 10 * DAY,
      expectedEndAt: now + 40 * DAY,
      categories: ["X"],
    };
    await seedTimeline(data, [future]);
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "future",
        startedAt: now + 15 * DAY, // not yet started, OK to shift
        expectedEndAt: undefined,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "updated");
    assert.equal(parsed.startedAt, now + 15 * DAY);
  });

  it("update: rejects move that would overlap another season", async () => {
    const now = Date.now();
    await seedTimeline(data, [
      { slug: "a", startedAt: now + 10 * DAY, expectedEndAt: now + 20 * DAY, categories: ["X"] },
      { slug: "b", startedAt: now + 30 * DAY, expectedEndAt: now + 40 * DAY, categories: ["Y"] },
    ]);
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "a",
        startedAt: undefined,
        expectedEndAt: now + 35 * DAY, // would overlap b
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.ok(parsed.error || parsed.isError);
  });

  it("rejects invalid slug formats", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    for (const bad of ["", "Has Spaces", "UPPER", "trailing-", "-leading", "doub--le"]) {
      const result = await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          slug: bad,
          startedAt: Date.now() + DAY,
          expectedEndAt: Date.now() + 30 * DAY,
          endedAt: undefined,
          categories: undefined,
          answersFormat: undefined,
          questionType: undefined,
          freeformAnswerShape: undefined,
          contexts: undefined,
          difficulty: undefined,
          difficultyRatio: undefined,
          theme: undefined,
          format: undefined,
          liveAnswersVisible: undefined,
          revealResponses: undefined,
        },
        SESSION,
      );
      const parsed = parseToolResult(result);
      assert.ok(parsed.error || parsed.isError, `expected error for slug "${bad}"`);
    }
  });

  it("slug is the key — calling upsert with same slug is an update, not duplicate", async () => {
    const seeded = await seedSingleActive(data);
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: seeded.slug,
        startedAt: undefined,
        expectedEndAt: seeded.expectedEndAt + 5 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "updated");
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.equal(state?.seasons.length, 1);
    assert.equal(state?.seasons[0].expectedEndAt, seeded.expectedEndAt + 5 * DAY);
  });

  it("multi-prepare: two future seasons coexist", async () => {
    await seedSingleActive(data);
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const now = Date.now();
    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "future-a",
        startedAt: now + 40 * DAY,
        expectedEndAt: now + 70 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "future-b",
        startedAt: now + 80 * DAY,
        expectedEndAt: now + 110 * DAY,
        endedAt: undefined,
        categories: ["Marine"],
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.equal(state?.seasons.length, 3);
    const slugs = state?.seasons.map((s) => s.slug);
    assert.ok(slugs?.includes("future-a"));
    assert.ok(slugs?.includes("future-b"));
  });
});

// =============================================================================
// delete_season tool
// =============================================================================

describe("delete_season tool", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science"]);
  });

  it("deletes a not-yet-started future season", async () => {
    const now = Date.now();
    await seedTimeline(data, [
      {
        slug: "active",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        categories: ["X"],
      },
      {
        slug: "future",
        startedAt: now + 30 * DAY,
        expectedEndAt: now + 60 * DAY,
        categories: ["Y"],
      },
    ]);
    const tool = createDeleteSeasonTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slug: "future" }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.deleted, "future");
    assert.equal(parsed.remaining, 1);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.equal(state?.seasons.length, 1);
    assert.equal(state?.seasons[0].slug, "active");
  });

  it("rejects deleting an already-started season once it has questions", async () => {
    const now = Date.now();
    await seedTimeline(data, [
      {
        slug: "active",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        categories: ["X"],
      },
      {
        slug: "future",
        startedAt: now + 30 * DAY,
        expectedEndAt: now + 60 * DAY,
        categories: ["Y"],
      },
    ]);
    await seedStampedQuestion(data, "active");
    const tool = createDeleteSeasonTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slug: "active" }, SESSION);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error || parsed.isError);
  });

  it("permits deleting an already-started season when it has no questions yet", async () => {
    const now = Date.now();
    await seedTimeline(data, [
      {
        slug: "active",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        categories: ["X"],
      },
      {
        slug: "future",
        startedAt: now + 30 * DAY,
        expectedEndAt: now + 60 * DAY,
        categories: ["Y"],
      },
    ]);
    const tool = createDeleteSeasonTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slug: "active" }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.deleted, "active");
    assert.equal(parsed.remaining, 1);
  });

  it("rejects deleting the only season on the timeline", async () => {
    const now = Date.now();
    await seedTimeline(data, [
      {
        slug: "future-only",
        startedAt: now + DAY,
        expectedEndAt: now + 30 * DAY,
        categories: ["X"],
      },
    ]);
    const tool = createDeleteSeasonTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slug: "future-only" }, SESSION);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error || parsed.isError);
  });

  it("rejects unknown slug", async () => {
    await seedSingleActive(data);
    const tool = createDeleteSeasonTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slug: "missing" }, SESSION);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error || parsed.isError);
  });
});

// =============================================================================
// list_seasons tool
// =============================================================================

describe("list_seasons tool", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science"]);
  });

  it("rejects when seasons.json is missing", async () => {
    const tool = createListSeasonsTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error || parsed.isError);
  });

  it("returns every season with full category lists and status flags", async () => {
    const now = Date.now();
    await seedTimeline(data, [
      {
        slug: "past-spring",
        startedAt: now - 60 * DAY,
        expectedEndAt: now - 30 * DAY,
        endedAt: now - 30 * DAY,
        categories: ["A", "B"],
      },
      {
        slug: "active-may",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        categories: ["X", "Y", "Z"],
      },
      {
        slug: "queued-june",
        startedAt: now + 30 * DAY,
        expectedEndAt: now + 60 * DAY,
        categories: ["Marine", "Coral"],
      },
    ]);
    const tool = createListSeasonsTool(data, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION);
    const parsed = parseToolResult(result);

    assert.equal(parsed.total, 3);
    interface ListedSeason {
      slug: string;
      status: "past" | "current" | "future";
      categories: string[];
    }
    const bySlug = new Map<string, ListedSeason>(
      parsed.seasons.map((s: ListedSeason) => [s.slug, s]),
    );

    assert.equal(bySlug.get("past-spring")?.status, "past");
    assert.deepEqual(bySlug.get("past-spring")?.categories, ["A", "B"]);

    assert.equal(bySlug.get("active-may")?.status, "current");
    assert.deepEqual(bySlug.get("active-may")?.categories, ["X", "Y", "Z"]);

    assert.equal(bySlug.get("queued-june")?.status, "future");
    assert.deepEqual(bySlug.get("queued-june")?.categories, ["Marine", "Coral"]);
  });
});

// =============================================================================
// list_seasons — surfaces per-tier axis config
// =============================================================================

describe("list_seasons — axis-config surfacing", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science"]);
  });

  it("omits theme and axis fields when the season set none of them", async () => {
    const now = Date.now();
    await seedTimeline(data, [
      {
        slug: "bare",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        categories: ["Science"],
      },
    ]);
    const tool = createListSeasonsTool(data, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION));
    const bare = parsed.seasons[0];
    assert.equal("theme" in bare, false);
    assert.equal("answersFormat" in bare, false);
    assert.equal("questionType" in bare, false);
    assert.equal("freeformAnswerShape" in bare, false);
    assert.equal("contexts" in bare, false);
    assert.equal("difficulty" in bare, false);
    assert.equal("format" in bare, false);
  });

  it("surfaces freeformAnswerShape when the season sets only that", async () => {
    const now = Date.now();
    const shape = {
      name: 3,
      place: 0,
      phrase: 0,
      title: 0,
      date: 0,
      countable: 0,
      other: 0,
    } as const;
    await seedTimeline(data, [
      {
        slug: "name-only",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        categories: ["Science"],
        freeformAnswerShape: shape,
      },
    ]);
    const tool = createListSeasonsTool(data, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION));
    const entry = parsed.seasons[0];
    assert.deepEqual(entry.freeformAnswerShape, shape);
    assert.equal("questionType" in entry, false);
    assert.equal("answersFormat" in entry, false);
  });

  it("surfaces theme when set; absent otherwise", async () => {
    const now = Date.now();
    await seedTimeline(data, [
      {
        slug: "themed",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        categories: ["Science"],
        theme: "Halloween Spooktacular",
      },
      {
        slug: "plain",
        startedAt: now + 30 * DAY,
        expectedEndAt: now + 60 * DAY,
        categories: ["Science"],
      },
    ]);
    const tool = createListSeasonsTool(data, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION));
    interface ListedSeason {
      slug: string;
      theme?: string;
    }
    const bySlug = new Map<string, ListedSeason>(
      parsed.seasons.map((s: ListedSeason) => [s.slug, s]),
    );
    assert.equal(bySlug.get("themed")?.theme, "Halloween Spooktacular");
    assert.equal("theme" in (bySlug.get("plain") ?? {}), false);
  });

  it("surfaces format with per-slot overrides — slot 0 untouched, slot 1 sets only one axis", async () => {
    const now = Date.now();
    const slotShape = {
      name: 1,
      place: 0,
      phrase: 0,
      title: 0,
      date: 0,
      countable: 0,
      other: 0,
    } as const;
    await seedTimeline(data, [
      {
        slug: "formatted",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        categories: ["Science"],
        format: {
          questions: [{}, { label: "Lightning", freeformAnswerShape: slotShape }],
        },
      },
    ]);
    const tool = createListSeasonsTool(data, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION));
    const entry = parsed.seasons[0];
    assert.equal(entry.format.questions.length, 2);
    assert.deepEqual(entry.format.questions[0], {});
    assert.equal(entry.format.questions[1].label, "Lightning");
    assert.deepEqual(entry.format.questions[1].freeformAnswerShape, slotShape);
    assert.equal("answersFormat" in entry.format.questions[1], false);
    assert.equal("questionType" in entry.format.questions[1], false);
    assert.equal("difficulty" in entry.format.questions[1], false);
  });
});

// =============================================================================
// check_season_status tool
// =============================================================================

function revealJob(cron: string, timezone = "UTC"): CronJob {
  return {
    id: "reveal",
    cronExpression: cron,
    channel: "C123",
    prompt: "Call process_responses_instructions and follow the returned instructions exactly.",
    createdBy: "U0",
    createdAt: new Date().toISOString(),
    enabled: true,
    timezone,
    plugin: "trivia",
  };
}

describe("check_season_status tool", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science"]);
  });

  it("missing seasons.json returns a structured error", async () => {
    const tool = createCheckSeasonStatusTool(data, async () => [], fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error || parsed.isError);
  });

  it("returns isInGap when now is in a gap (no current season)", async () => {
    const now = Date.now();
    await seedTimeline(data, [
      {
        slug: "future",
        startedAt: now + 30 * DAY,
        expectedEndAt: now + 60 * DAY,
        categories: ["X"],
      },
    ]);
    const tool = createCheckSeasonStatusTool(data, async () => [], fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.currentSlug, null);
    assert.equal(parsed.isInGap, true);
    assert.equal(parsed.nextSeasonSlug, "future");
  });

  it("returns nextSeasonSlug when a future season is queued", async () => {
    const now = Date.now();
    await seedTimeline(data, [
      {
        slug: "active",
        startedAt: now - 5 * DAY,
        expectedEndAt: now + 25 * DAY,
        categories: ["X"],
      },
      {
        slug: "queued",
        startedAt: now + 25 * DAY,
        expectedEndAt: now + 55 * DAY,
        categories: ["Y"],
      },
    ]);
    const tool = createCheckSeasonStatusTool(
      data,
      async () => [revealJob("0 18 * * *")],
      fixtureGetGames,
    );
    const result = await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.currentSlug, "active");
    assert.equal(parsed.nextSeasonSlug, "queued");
    assert.equal(parsed.isInGap, false);
  });

  it("returns nulls for next when no future season is queued", async () => {
    await seedSingleActive(data);
    const tool = createCheckSeasonStatusTool(
      data,
      async () => [revealJob("0 18 * * *")],
      fixtureGetGames,
    );
    const result = await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.nextSeasonSlug, null);
    assert.equal(parsed.nextSeasonStartsAt, null);
  });

  it("no trivia reveal cron warns and defaults isLastFireOfSeason to false", async () => {
    await seedSingleActive(data);
    const tool = createCheckSeasonStatusTool(data, async () => [], fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.isLastFireOfSeason, false);
    assert.ok(parsed.warning);
  });

  it("season already expired: no next fire before expectedEnd → last fire", async () => {
    // Active season with expectedEndAt deep in the past.
    await seedTimeline(data, [
      {
        slug: "expired",
        startedAt: Date.UTC(2020, 0, 1),
        expectedEndAt: Date.UTC(2020, 11, 31),
        categories: ["X"],
      },
    ]);
    // Note: this season is expired so findCurrentSeason returns null → isInGap path.
    const tool = createCheckSeasonStatusTool(
      data,
      async () => [revealJob("0 18 * * 1-5")],
      fixtureGetGames,
    );
    const result = await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION);
    const parsed = parseToolResult(result);
    // Gap is hit because the only season's window is in the past.
    assert.equal(parsed.isInGap, true);
  });
});

// =============================================================================
// retrieve_scores with timeline-based current
// =============================================================================

describe("retrieve_scores with timeline-based current", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science"]);
    await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 0 });
    await data.saveUser({ userId: "U2", displayName: "Bob", joinedAt: 0 });

    for (let i = 0; i < 5; i++) {
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: `q-spring-${i}`,
        answer: true,
        correct: true,
        timestamp: i,
        season: "spring-2026",
      });
    }
    for (let i = 0; i < 3; i++) {
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U1",
        questionId: `q-summer-${i}`,
        answer: true,
        correct: true,
        timestamp: 100 + i,
        season: "summer-2026",
      });
    }
    for (let i = 0; i < 2; i++) {
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U2",
        questionId: `q-spring-u2-${i}`,
        answer: true,
        correct: true,
        timestamp: i,
        season: "spring-2026",
      });
    }
    for (let i = 0; i < 7; i++) {
      await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
        userId: "U2",
        questionId: `q-summer-u2-${i}`,
        answer: true,
        correct: true,
        timestamp: 100 + i,
        season: "summer-2026",
      });
    }
  });

  it("default season filter resolves to current via findCurrentSeason", async () => {
    // Make summer-2026 the active season.
    await seedSingleActive(data, { slug: "summer-2026" });
    const tool = createRetrieveScoresTool(data, fixtureGetGames);
    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, limit: undefined, sortBy: undefined, season: undefined },
      SESSION,
    );
    const parsed = parseToolResult(result);

    // Sorted by summer-2026 correct: U2=7, U1=3.
    assert.equal(parsed.leaderboard[0].userId, "U2");
    assert.equal(parsed.leaderboard[0].currentSeasonCorrect, 7);
    assert.equal(parsed.leaderboard[0].totalCorrect, 9);
    assert.equal(parsed.leaderboard[1].userId, "U1");
    assert.equal(parsed.leaderboard[1].currentSeasonCorrect, 3);
    assert.equal(parsed.leaderboard[1].totalCorrect, 8);
  });

  it("historical season slug filters by that slug, all-time totals unchanged", async () => {
    await seedSingleActive(data, { slug: "summer-2026" });
    const tool = createRetrieveScoresTool(data, fixtureGetGames);
    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, limit: undefined, sortBy: undefined, season: "spring-2026" },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const u1 = parsed.leaderboard.find((e: { userId: string }) => e.userId === "U1");
    assert.equal(u1.totalCorrect, 8);
  });

  it("seasons disabled (no seasons.json): season arg ignored", async () => {
    const tool = createRetrieveScoresTool(data, fixtureGetGames);
    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, limit: undefined, sortBy: undefined, season: "spring-2026" },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const u1 = parsed.leaderboard.find((e: { userId: string }) => e.userId === "U1");
    assert.equal(u1.totalCorrect, 8);
    assert.equal(u1.currentSeasonCorrect, undefined);
  });
});

// =============================================================================
// find_previous_questions — season filter via findCurrentSeason
// =============================================================================

describe("find_previous_questions with timeline-based current", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Marine"]);
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "q1",
      category: "Marine",
      statement: "Octopuses have three hearts",
      isTrue: true,
      emojis: ["🐙"],
      createdAt: 1,
      season: "spring-2026",
    });
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion({
      id: "q2",
      category: "Marine",
      statement: "Sharks have no bones",
      isTrue: true,
      emojis: ["🦈"],
      createdAt: 2,
      season: "summer-2026",
    });
  });

  it('default "all" returns both seasons\' matches', async () => {
    await seedSingleActive(data, { slug: "summer-2026" });
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: undefined,
        text: "octopus",
        season: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.questions[0].id, "q1");
  });

  it('"current" scopes to whatever findCurrentSeason returns', async () => {
    await seedSingleActive(data, { slug: "summer-2026" });
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: "Marine",
        text: undefined,
        season: "current",
        recentBatchFromNow: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.questions[0].id, "q2");
  });

  it('"current" during a gap returns empty', async () => {
    const now = Date.now();
    await seedTimeline(data, [
      {
        slug: "future",
        startedAt: now + 10 * DAY,
        expectedEndAt: now + 40 * DAY,
        categories: ["Marine"],
        answersFormat: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
    ]);
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: undefined,
        text: undefined,
        season: "current",
        recentBatchFromNow: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 0);
  });
});

// =============================================================================
// add_categories / remove_categories — target widening
// =============================================================================

describe("add_categories with target dispatch", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History"]);
    await seedSingleActive(data, { categories: ["Science", "History"] });
  });

  it("default target 'both' appends to baseline and current season", async () => {
    const tool = createAddCategoriesTool(data, fixtureGetGames);
    await tool.handler(
      { game: FIXTURE_GAME_NAME, categories: ["Quantum Physics"], target: undefined },
      SESSION,
    );
    const baseline = await data.loadCategories();
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.ok(baseline.includes("Quantum Physics"));
    assert.ok(state?.seasons[0].categories.includes("Quantum Physics"));
  });

  it("target 'current' affects only the active season", async () => {
    const tool = createAddCategoriesTool(data, fixtureGetGames);
    await tool.handler(
      { game: FIXTURE_GAME_NAME, categories: ["Cephalopods"], target: "current" },
      SESSION,
    );
    const baseline = await data.loadCategories();
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.ok(!baseline.includes("Cephalopods"));
    assert.ok(state?.seasons[0].categories.includes("Cephalopods"));
  });

  it("target slug affects that specific season's categories", async () => {
    const now = Date.now();
    await seedTimeline(data, [
      {
        slug: "active",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        categories: ["Science"],
      },
      {
        slug: "future",
        startedAt: now + 30 * DAY,
        expectedEndAt: now + 60 * DAY,
        categories: ["Marine"],
        answersFormat: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
    ]);
    const tool = createAddCategoriesTool(data, fixtureGetGames);
    await tool.handler(
      { game: FIXTURE_GAME_NAME, categories: ["Whales"], target: "future" },
      SESSION,
    );
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const future = state?.seasons.find((s) => s.slug === "future");
    assert.ok(future?.categories.includes("Whales"));
    // Active season is unaffected.
    const active = state?.seasons.find((s) => s.slug === "active");
    assert.ok(!active?.categories.includes("Whales"));
  });

  it("target unknown-slug returns an error indication", async () => {
    const tool = createAddCategoriesTool(data, fixtureGetGames);
    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, categories: ["Foo"], target: "no-such-season" },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.ok(parsed.error);
  });

  it("target 'current' during a gap is a warned no-op", async () => {
    const now = Date.now();
    const freshData = createInMemoryDataLayer();
    await freshData.saveCategories(["Science"]);
    await seedTimeline(freshData, [
      {
        slug: "future",
        startedAt: now + 10 * DAY,
        expectedEndAt: now + 40 * DAY,
        categories: ["Science"],
      },
    ]);
    const tool = createAddCategoriesTool(freshData, fixtureGetGames);
    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, categories: ["Foo"], target: "current" },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.ok(parsed.warning);
    assert.equal(parsed.totals.current, null);
  });
});

describe("remove_categories with target dispatch + non-empty guards", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History"]);
    await seedSingleActive(data, { categories: ["Science", "History"] });
  });

  it("default 'both' removes from baseline and active", async () => {
    const tool = createRemoveCategoriesTool(data, fixtureGetGames);
    await tool.handler(
      { game: FIXTURE_GAME_NAME, categories: ["Science"], target: undefined },
      SESSION,
    );
    const baseline = await data.loadCategories();
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.ok(!baseline.includes("Science"));
    assert.ok(!state?.seasons[0].categories.includes("Science"));
  });

  it("rejects emptying the currently-active season's pool", async () => {
    await seedSingleActive(data, { categories: ["Only Topic"] });
    const tool = createRemoveCategoriesTool(data, fixtureGetGames);
    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, categories: ["Only Topic"], target: "current" },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.ok(parsed.error || parsed.isError);
  });

  it("rejects emptying a specifically-targeted season's pool", async () => {
    const now = Date.now();
    await seedTimeline(data, [
      {
        slug: "active",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        categories: ["X", "Y"],
      },
      {
        slug: "future",
        startedAt: now + 30 * DAY,
        expectedEndAt: now + 60 * DAY,
        categories: ["Single"],
      },
    ]);
    const tool = createRemoveCategoriesTool(data, fixtureGetGames);
    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, categories: ["Single"], target: "future" },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.ok(parsed.error || parsed.isError);
  });

  it("target 'default' can drain categories.json (not the active read pool)", async () => {
    const tool = createRemoveCategoriesTool(data, fixtureGetGames);
    await tool.handler(
      { game: FIXTURE_GAME_NAME, categories: ["Science", "History"], target: "default" },
      SESSION,
    );
    const baseline = await data.loadCategories();
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.deepEqual(baseline, []);
    assert.deepEqual(state?.seasons[0].categories, ["Science", "History"]);
  });
});

// =============================================================================
// get_ideas reads via findCurrentSeason
// =============================================================================

describe("get_ideas reads currentCategories via timeline", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Baseline-A", "Baseline-B", "Baseline-C", "Baseline-D"]);
  });

  it("uses the active season's pool when seasons.json exists with a current season", async () => {
    await seedSingleActive(data, { categories: ["Themed-1", "Themed-2", "Themed-3"] });
    const tool = createGetIdeasTool(data, undefined, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.categories.total, 3);
    for (const idea of parsed.categories.ideas) {
      assert.ok(idea.startsWith("Themed-"), `${idea} should come from the themed pool`);
    }
  });

  it("falls back to categories.json during a gap", async () => {
    const now = Date.now();
    await seedTimeline(data, [
      {
        slug: "future-only",
        startedAt: now + 10 * DAY,
        expectedEndAt: now + 40 * DAY,
        categories: ["Themed"],
      },
    ]);
    const tool = createGetIdeasTool(data, undefined, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    // Gap → reads from categories.json (4 baseline entries).
    assert.equal(parsed.categories.total, 4);
  });

  it("falls back to categories.json when seasons.json is absent", async () => {
    const tool = createGetIdeasTool(data, undefined, fixtureGetGames);
    const result = await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.categories.total, 4);
  });
});

// =============================================================================
// save_question validates against active pool
// =============================================================================

describe("save_question validates against active pool", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Baseline-Only"]);
  });

  it("rejects a category that's in baseline but not the active season", async () => {
    await seedSingleActive(data, { categories: ["Marine Biology"] });
    const tool = createSaveQuestionTool(data, undefined, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: "Baseline-Only",
        statement: "A statement long enough to validate",
        answersFormat: "boolean",
        questionType: "fact",
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        isTrue: true,
        choices: undefined,
        correctIndex: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        freeformAnswerShape: undefined,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["🌊"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.ok(parsed.error || parsed.isError);
  });

  it("accepts a category in the active season's pool and stamps season", async () => {
    await seedSingleActive(data, { slug: "marine-fall", categories: ["Marine Biology"] });
    const tool = createSaveQuestionTool(data, undefined, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: "Marine Biology",
        statement: "A statement long enough to validate",
        answersFormat: "boolean",
        questionType: "fact",
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        isTrue: true,
        choices: undefined,
        correctIndex: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        freeformAnswerShape: undefined,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["🌊"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.season, "marine-fall");
  });
});

// =============================================================================
// Prompt content assertions
// =============================================================================

describe("scheduled prompt variants", () => {
  // Under the new design the reveal prompt is a thin renderer brief; seasons logic
  // lives inside `process_reveal_answers` rather than in the prompt. The prompt's
  // content is identical regardless of `trivia.seasons.enabled`.
  it("PROCESS_REVEAL references process_reveal_answers, not the absorbed tools", () => {
    assert.ok(PROCESS_REVEAL_INSTRUCTIONS.includes("process_reveal_answers"));
    // The absorbed tools may be MENTIONED (in a "you will NOT call these" caveat) but
    // they must not appear as required-step verbs.
    assert.ok(!PROCESS_REVEAL_INSTRUCTIONS.includes("Call fetch_channel_messages"));
    assert.ok(!PROCESS_REVEAL_INSTRUCTIONS.includes("Call submit_answers"));
    assert.ok(!PROCESS_REVEAL_INSTRUCTIONS.includes("Call retrieve_scores"));
    assert.ok(!PROCESS_REVEAL_INSTRUCTIONS.includes("Call check_season_status"));
    assert.ok(!PROCESS_REVEAL_INSTRUCTIONS.includes("Call upsert_season"));
    assert.ok(!PROCESS_REVEAL_INSTRUCTIONS.includes("start_new_season"));
  });

  it("PROCESS_REVEAL describes the seasonStatus payload shape", () => {
    assert.ok(PROCESS_REVEAL_INSTRUCTIONS.includes("seasonStatus"));
    assert.ok(PROCESS_REVEAL_INSTRUCTIONS.includes("isLastFireOfSeason"));
  });

  it("CREATE_SCHEDULES references the single-tool reveal requiredTools list", () => {
    assert.ok(CREATE_SCHEDULES_INSTRUCTIONS.includes("mcp__trivia__process_reveal_answers"));
    // The conditionally-called timeline tools must NOT appear in any requiredTools list.
    assert.ok(!CREATE_SCHEDULES_INSTRUCTIONS.includes("mcp__trivia__check_season_status"));
    assert.ok(!CREATE_SCHEDULES_INSTRUCTIONS.includes("mcp__trivia__upsert_season"));
    assert.ok(!CREATE_SCHEDULES_INSTRUCTIONS.includes("mcp__trivia__delete_season"));
    assert.ok(!CREATE_SCHEDULES_INSTRUCTIONS.includes("mcp__trivia__start_new_season"));
  });
});

// =============================================================================
// trivia-check addendum
// =============================================================================

describe("trivia-check instruction variants", () => {
  it("disabled variant has no admin addendum", () => {
    const off = getTriviaCheckInstruction(false);
    assert.ok(!off.includes("upsert_season"));
    assert.ok(!off.includes("delete_season"));
  });

  it("enabled variant references upsert_season and delete_season (not start_new_season)", () => {
    const on = getTriviaCheckInstruction(true);
    assert.ok(on.includes("upsert_season"));
    assert.ok(on.includes("delete_season"));
    assert.ok(!on.includes("start_new_season"));
  });

  it("enabled variant documents per-season answersFormat management", () => {
    const on = getTriviaCheckInstruction(true);
    assert.ok(on.includes("answersFormat"));
    assert.match(on, /answer formats per season/i);
    assert.match(on, /multiple-choice/i);
    assert.match(on, /trivia\.choices/);
  });

  it("disabled variant does not mention answersFormat", () => {
    const off = getTriviaCheckInstruction(false);
    assert.ok(!off.includes("answersFormat"));
  });
});
