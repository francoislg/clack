import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createUpsertSeasonTool } from "./upsertSeason.js";
import { createGetIdeasTool } from "../questions/getIdeas.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer } from "../../core/types.js";
import type { TriviaConfig } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

type UpsertArgs = Parameters<ReturnType<typeof createUpsertSeasonTool>["handler"]>[0];

// All-fields-present base so the SDK-inferred handler arg type is satisfied; per-test overrides.
function makeArgs(overrides: Partial<UpsertArgs>): UpsertArgs {
  return {
    game: FIXTURE_GAME_NAME,
    slug: "s1",
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
    format: undefined,
    slotOverrides: undefined,
    liveAnswersVisible: undefined,
    revealResponses: undefined,
    instructions: undefined,
    additionalInstructions: undefined,
    hint: undefined,
    judgeLeniency: undefined,
    choices: undefined,
    choiceEmojiStyle: undefined,
    points: undefined,
    ...overrides,
  };
}

describe("upsert_season — promptMedium argument", () => {
  let data: TriviaDataLayer;
  beforeEach(async () => {
    data = createInMemoryDataLayer();
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
