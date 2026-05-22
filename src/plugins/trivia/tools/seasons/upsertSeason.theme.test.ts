import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createUpsertSeasonTool } from "./upsertSeason.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer } from "../../core/types.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

function baseArgs(slug: string, future: number) {
  return {
    game: FIXTURE_GAME_NAME,
    slug,
    startedAt: future,
    expectedEndAt: future + 30 * DAY,
    endedAt: undefined,
    categories: undefined,
    theme: undefined,
    answersFormat: undefined,
    questionType: undefined,
    freeformAnswerShape: undefined,
    contexts: undefined,
    difficulty: undefined,
    format: undefined,
  };
}

describe("upsert_season — theme argument", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History", "Geography"]);
  });

  it("create with theme persists the value and reports hasTheme: true", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = await tool.handler(
      { ...baseArgs("halloween-2026", future), theme: "Halloween Spooktacular" },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "created");
    assert.equal(parsed.hasTheme, true);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "halloween-2026");
    assert.equal(entry?.theme, "Halloween Spooktacular");
  });

  it("create without theme leaves the field absent and reports hasTheme: false", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = await tool.handler(baseArgs("no-theme", future), SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "created");
    assert.equal(parsed.hasTheme, false);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "no-theme");
    assert.ok(entry !== undefined);
    assert.equal(entry?.theme, undefined);
    assert.ok(!Object.prototype.hasOwnProperty.call(entry, "theme"));
  });

  it("update can add a theme to a previously theme-less season", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(baseArgs("blank", future), SESSION);

    const updated = parseToolResult(
      await tool.handler(
        {
          ...baseArgs("blank", future),
          startedAt: undefined,
          expectedEndAt: undefined,
          theme: "Music Mayhem",
        },
        SESSION,
      ),
    );
    assert.equal(updated.action, "updated");
    assert.equal(updated.hasTheme, true);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.equal(state?.seasons[0].theme, "Music Mayhem");
  });

  it("update with theme: null clears the field", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler({ ...baseArgs("themed", future), theme: "Music Mayhem" }, SESSION);

    const cleared = parseToolResult(
      await tool.handler(
        {
          ...baseArgs("themed", future),
          startedAt: undefined,
          expectedEndAt: undefined,
          theme: null,
        },
        SESSION,
      ),
    );
    assert.equal(cleared.action, "updated");
    assert.equal(cleared.hasTheme, false);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "themed");
    assert.equal(entry?.theme, undefined);
    assert.ok(!Object.prototype.hasOwnProperty.call(entry, "theme"));
  });

  it("update omitting theme preserves the existing value", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler({ ...baseArgs("kept", future), theme: "Sci-Fi Showdown" }, SESSION);

    const updated = parseToolResult(
      await tool.handler(
        { ...baseArgs("kept", future), startedAt: undefined, expectedEndAt: future + 45 * DAY },
        SESSION,
      ),
    );
    assert.equal(updated.action, "updated");
    assert.equal(updated.hasTheme, true);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "kept");
    assert.equal(entry?.theme, "Sci-Fi Showdown");
  });

  it("rejects empty string theme on create", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = await tool.handler({ ...baseArgs("bad-theme", future), theme: "" }, SESSION);
    const parsed = parseToolResult(result);
    assert.ok(parsed.error || parsed.isError, "expected error for empty theme");

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.equal(
      state?.seasons.find((s) => s.slug === "bad-theme"),
      undefined,
    );
  });

  it("rejects whitespace-only theme on create", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = await tool.handler(
      { ...baseArgs("space-theme", future), theme: "   \t  " },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.ok(parsed.error || parsed.isError, "expected error for whitespace-only theme");
  });

  it("rejects empty / whitespace-only theme on update without clearing the existing value", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler({ ...baseArgs("preserved", future), theme: "Originals Only" }, SESSION);

    const result = await tool.handler(
      {
        ...baseArgs("preserved", future),
        startedAt: undefined,
        expectedEndAt: undefined,
        theme: "  ",
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.ok(parsed.error || parsed.isError);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.equal(state?.seasons.find((s) => s.slug === "preserved")?.theme, "Originals Only");
  });

  it("trims surrounding whitespace from a valid theme", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler({ ...baseArgs("trimmed", future), theme: "  Trim Me  " }, SESSION);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "trimmed");
    assert.equal(entry?.theme, "Trim Me");
  });

  it("round-trip persistence: write theme → reload → field preserved verbatim", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const themeValue = "Pop Culture 90s — REWIND!";
    await tool.handler({ ...baseArgs("roundtrip", future), theme: themeValue }, SESSION);

    // Reload from a fresh data-layer view (simulates restart)
    const reloaded = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = reloaded?.seasons.find((s) => s.slug === "roundtrip");
    assert.equal(entry?.theme, themeValue);
  });
});
