import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createUpsertSeasonTool } from "./upsertSeason.js";
import { upsertSeasonArgs, type UpsertSeasonArgs } from "./upsertSeason.testHelpers.js";
import { createGetIdeasTool } from "../questions/getIdeas.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { TriviaConfig } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

function makeArgs(overrides: Partial<UpsertSeasonArgs>): UpsertSeasonArgs {
  return upsertSeasonArgs({ game: FIXTURE_GAME_NAME, slug: "s1", ...overrides });
}

describe("upsert_season — promptMedium argument", () => {
  let data: FakeTriviaDataLayer;
  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const result = createTriviaDataLayer(sdk);
    data = result.dataLayer;
    await data.saveCategories(["Flags", "Landmarks"]);
  });

  it("create stores promptMedium verbatim", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const parsed = parseToolResult(
      await tool.handler(
        makeArgs({
          slug: "visual-season",
          startedAt: future,
          expectedEndAt: future + 30 * DAY,
          promptMedium: { text: 0, image: 1 },
        }),
        SESSION,
      ),
    );
    assert.equal(parsed.action, "created");
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "visual-season");
    assert.deepEqual(entry?.promptMedium, { text: 0, image: 1 });
  });

  it("create omits promptMedium when not passed", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      makeArgs({ slug: "plain", startedAt: future, expectedEndAt: future + 30 * DAY }),
      SESSION,
    );
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "plain");
    assert.equal(entry?.promptMedium, undefined);
  });

  it("update clears promptMedium with null", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      makeArgs({
        slug: "clearme",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        promptMedium: { text: 1, image: 1 },
      }),
      SESSION,
    );
    await tool.handler(makeArgs({ slug: "clearme", promptMedium: null }), SESSION);
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "clearme");
    assert.equal(entry?.promptMedium, undefined);
  });

  it("mid-season promptMedium is reflected by get_ideas", async () => {
    const config: TriviaConfig = {
      seasons: { enabled: true, prompt: "monthly" },
      promptMedium: { text: 1, image: 0 },
    };
    const upsert = createUpsertSeasonTool(data, fixtureGetGames);
    const now = Date.now();
    await upsert.handler(
      makeArgs({
        slug: "active",
        startedAt: now - DAY,
        expectedEndAt: now + 30 * DAY,
        categories: ["Flags"],
        promptMedium: { text: 0, image: 1 },
      }),
      SESSION,
    );
    const getIdeas = createGetIdeasTool(data, () => config, fixtureGetGames);
    for (let i = 0; i < 10; i++) {
      const parsed = parseToolResult(
        await getIdeas.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
      );
      assert.equal(parsed.suggestedPromptMedium, "image");
    }
  });
});
