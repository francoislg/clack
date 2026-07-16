import { describe, it, beforeEach, expect } from "vitest";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createGetIdeasTool } from "./getIdeas.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaConfig, TriviaGame } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

const gamesWith = (overrides: Partial<TriviaGame>): TriviaGame[] => [
  {
    name: FIXTURE_GAME_NAME,
    channel: "C1",
    questionCron: "0 9 * * 1-5",
    revealCron: "0 17 * * 1-5",
    timezone: "America/Montreal",
    ...overrides,
  },
];

describe("get_ideas — instructions and additionalInstructions payload", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: createdData } = createTriviaDataLayer(sdk);
    data = createdData;
    data.loadCategories.mockResolvedValue(["Science", "History", "Geography"]);
  });

  it("omits both keys when no tier sets them", async () => {
    const tool = createGetIdeasTool(data, () => ({}), fixtureGetGames);
    const result = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    expect(result.instructions).toBeUndefined();
    expect(result.additionalInstructions).toBeUndefined();
  });

  it("emits resolved instructions when workspace alone sets it", async () => {
    const cfg: TriviaConfig = { instructions: "Be funny." };
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    const result = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    expect(result.instructions).toBe("Be funny.");
    expect(result.additionalInstructions).toBeUndefined();
  });

  it("game tier wins over workspace for instructions (replace cascade)", async () => {
    const cfg: TriviaConfig = { instructions: "Workspace rule." };
    const tool = createGetIdeasTool(
      data,
      () => cfg,
      () => gamesWith({ instructions: "Game rule." }),
    );
    const result = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    expect(result.instructions).toBe("Game rule.");
  });

  it("emits concatenated, labeled additionalInstructions across workspace + game", async () => {
    const cfg: TriviaConfig = { additionalInstructions: "Avoid politics." };
    const tool = createGetIdeasTool(
      data,
      () => cfg,
      () => gamesWith({ additionalInstructions: "Be concise." }),
    );
    const result = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    expect(result.additionalInstructions).toBe("[Workspace] Avoid politics.\n\n[Game] Be concise.");
  });

  it("includes season-tier values when a season is active", async () => {
    const now = Date.now();
    const seasonsState = {
      seasons: [
        {
          slug: "active",
          startedAt: now - DAY,
          expectedEndAt: now + 30 * DAY,
          categories: ["Science", "History"],
          instructions: "Season rule.",
          additionalInstructions: "Spooky angles.",
        },
      ],
    };
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue(seasonsState);

    const cfg: TriviaConfig = { additionalInstructions: "Avoid politics." };
    const tool = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    const result = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    expect(result.instructions).toBe("Season rule.");
    expect(result.additionalInstructions).toBe(
      "[Workspace] Avoid politics.\n\n[Season] Spooky angles.",
    );
  });
});
