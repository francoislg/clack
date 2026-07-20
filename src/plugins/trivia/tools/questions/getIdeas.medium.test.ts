import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createGetIdeasTool } from "./getIdeas.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { TriviaConfig } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };

function makeConfig(trivia: TriviaConfig): TriviaConfig {
  return trivia;
}

describe("get_ideas suggestedPromptMedium", () => {
  let data: FakeTriviaDataLayer;
  const originalRandom = Math.random;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: createdData } = createTriviaDataLayer(sdk);
    data = createdData;
    data.loadCategories.mockResolvedValue(["Flags", "Landmarks", "Animals"]);
  });

  afterEach(() => {
    Math.random = originalRandom;
  });

  it("defaults to text when no promptMedium configured", async () => {
    const tool = createGetIdeasTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.suggestedPromptMedium, "text");
  });

  it("pure-image config: every call returns image", async () => {
    const cfg = makeConfig({ promptMedium: { text: 0, image: 1 } });
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    Math.random = originalRandom;
    for (let i = 0; i < 20; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
      );
      assert.equal(parsed.suggestedPromptMedium, "image");
    }
  });

  it("medium rolls independently of answersFormat", async () => {
    // image medium + choice format both forced — combo must emerge
    const cfg = makeConfig({
      promptMedium: { text: 0, image: 1 },
      answersFormat: { boolean: 0, choice: 1, freeform: 0 },
    });
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    Math.random = originalRandom;
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.suggestedPromptMedium, "image");
    assert.equal(parsed.suggestedAnswersFormat, "choice");
  });

  it("image roll draws categories.ideas from the same pool as text", async () => {
    const cfg = makeConfig({ promptMedium: { text: 0, image: 1 } });
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    Math.random = originalRandom;
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    for (const idea of parsed.categories.ideas) {
      assert.ok(["Flags", "Landmarks", "Animals"].includes(idea), `unexpected category ${idea}`);
    }
  });

  it("mixed config (3:1 text:image): ~1/4 image over many rolls", async () => {
    const cfg = makeConfig({ promptMedium: { text: 3, image: 1 } });
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    Math.random = originalRandom;
    const N = 1500;
    let images = 0;
    for (let i = 0; i < N; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
      );
      if (parsed.suggestedPromptMedium === "image") images++;
    }
    const ratio = images / N;
    assert.ok(Math.abs(ratio - 0.25) < 0.05, `image ratio off: ${ratio}`);
  });

  it("current season's promptMedium overrides config", async () => {
    const now = Date.now();
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue({
      seasons: [
        {
          slug: "active",
          startedAt: now - 1000,
          expectedEndAt: now + 100_000,
          categories: ["X"],
          promptMedium: { text: 0, image: 1 },
        },
      ],
    });
    const cfg = makeConfig({
      seasons: { enabled: true, prompt: "monthly" },
      promptMedium: { text: 1, image: 0 },
    });
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    Math.random = originalRandom;
    for (let i = 0; i < 20; i++) {
      const parsed = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
      );
      assert.equal(parsed.suggestedPromptMedium, "image");
    }
  });
});
